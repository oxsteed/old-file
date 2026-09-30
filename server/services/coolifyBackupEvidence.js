'use strict';
const { createHash } = require('node:crypto');
const profiles = require('./restoreVerificationProfiles');
// Existing production target, verified read-only on 2026-09-30.
const TARGET = Object.freeze({ scheduleUuid: 'fthxpltbf0v8waof9r2fqsi0',
  databaseUuid: 'd8tng2ulcrc1pgbvkr6ehcn4', databaseName: 'oxsteed_db', bucket: 'oxsteed-backups' });
const SOURCE_ID = `coolify-source:${TARGET.scheduleUuid}:${TARGET.databaseName}`;
const SOURCE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
function check(condition, message) {
  if (!condition) throw new Error(`Invalid backup evidence: ${message}`);
}
function timestamp(value, now = Date.now()) {
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value), 'UTC timestamp required');
  const ms = Date.parse(value);
  check(Number.isFinite(ms) && ms <= now, 'invalid or future timestamp');
  check(new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19), 'invalid calendar date');
  return new Date(ms).toISOString();
}
function id(value) {
  check(typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value), 'invalid execution ID');
  return value;
}
function filename(value) {
  check(typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,255}$/.test(value) && !['.', '..'].includes(value), 'invalid dump basename');
  return value;
}
function number(value) {
  check(Number.isSafeInteger(value) && value >= 0, 'nonnegative integer required');
  return value;
}
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function normalizeReport(report, now = Date.now()) {
  check(report?.schemaVersion === 1 && report.source === 'coolify', 'unsupported source/schema');
  const observedAt = timestamp(report.observedAt, now);
  check(now - Date.parse(observedAt) <= 15 * 60 * 1000, 'collector report is stale');
  for (const [key, value] of Object.entries(TARGET)) check(report.target?.[key] === value, `wrong target ${key}`);
  const config = {};
  for (const key of ['enabled', 'saveS3', 'keepLocal', 'isR2']) {
    check(typeof report.target[key] === 'boolean', `missing configuration ${key}`);
    config[key] = report.target[key];
  }
  check(typeof report.target.frequency === 'string' && report.target.frequency.length < 100, 'missing frequency');
  config.frequency = report.target.frequency;
  check(Array.isArray(report.executions) && report.executions.length <= 1000, 'invalid execution list');
  check(typeof report.truncated === 'boolean', 'missing coverage flag');
  const seen = new Set();
  const events = report.executions.map(e => {
    const uuid = id(e.uuid);
    check(!seen.has(uuid), 'duplicate execution ID in report'); seen.add(uuid);
    check(e.databaseName === TARGET.databaseName, 'wrong execution database');
    check(['success', 'failed', 'running', 'pending'].includes(e.status), 'unknown execution status');
    const startedAt = timestamp(e.startedAt, Date.parse(observedAt));
    const finishedAt = e.finishedAt === null ? null : timestamp(e.finishedAt, Date.parse(observedAt));
    check(!finishedAt || finishedAt >= startedAt, 'completion precedes start');
    const sizeBytes = number(e.sizeBytes);
    const name = e.filename === null ? null : filename(e.filename);
    for (const key of ['s3Uploaded', 'localDeleted', 's3Deleted']) check(e[key] === null || typeof e[key] === 'boolean', `invalid ${key}`);
    check(e.status !== 'success' || (finishedAt && sizeBytes > 0 && name), 'success lacks completed nonempty dump');
    const success = e.status === 'success';
    const local = success && e.localDeleted === false;
    const offsite = success && config.isR2 && config.saveS3 && e.s3Uploaded === true && e.s3Deleted === false;
    const details = { eventType: 'backup', source: 'coolify', executionUuid: uuid, ...TARGET,
      observedAt, startedAt, finishedAt, state: e.status, filename: name, sizeBytes,
      durationMs: finishedAt ? Date.parse(finishedAt) - Date.parse(startedAt) : null,
      local, offsite, s3Uploaded: e.s3Uploaded, localDeleted: e.localDeleted, s3Deleted: e.s3Deleted,
      verificationLevel: 'coolify_execution',
      error: e.status === 'failed' ? 'coolify_execution_failed' : success && !offsite ? 'r2_copy_unconfirmed'
        : success && !local ? 'local_copy_unconfirmed' : null };
    // Projection excludes messages, environment, and credentials.
    details.evidenceHash = hash(details);
    return { backupId: `coolify:${uuid}`, success, timestamp: startedAt, details };
  });
  const sourceDetails = { eventType: 'backup_source', source: 'coolify', ...TARGET, observedAt, config,
    truncated: report.truncated, executionCount: events.length };
  sourceDetails.evidenceHash = hash(sourceDetails);
  return { events, source: { backupId: SOURCE_ID, success: true, timestamp: observedAt, details: sourceDetails } };
}
function normalizeRestore(report, now = Date.now()) {
  check(report?.schemaVersion === 1 && report.source === 'isolated_restore_verifier', 'unsupported restore source/schema');
  const startedAt = timestamp(report.startedAt, now), completedAt = timestamp(report.completedAt, now);
  check(completedAt >= startedAt, 'restore completion precedes start');
  check(typeof report.success === 'boolean', 'restore result required');
  check(Number.isInteger(report.exitCode) && report.exitCode >= 0, 'restore exit code required');
  check(report.success === (report.exitCode === 0), 'restore result contradicts exit code');
  check(typeof report.dumpSha256 === 'string' && /^[a-f0-9]{64}$/.test(report.dumpSha256), 'dump checksum required');
  check(report.isolated === true, 'isolated restore required');
  check(Object.hasOwn(profiles, report.profile), 'unknown restore verification profile');
  const checks = profiles[report.profile];
  check(report.checks && Object.keys(report.checks).every(key => checks.includes(key)), 'unknown restore check');
  check(Object.values(report.checks).every(value => typeof value === 'boolean'), 'restore check booleans required');
  if (report.success) for (const key of checks) check(report.checks?.[key] === true, `restore check ${key} missing`);
  const details = { eventType: 'restoration_test', source: report.source,
    backupId: `coolify:${id(report.executionUuid)}`, testId: id(report.testId), profile: report.profile, startedAt, completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt), filename: filename(report.filename),
    sizeBytes: number(report.sizeBytes), dumpSha256: report.dumpSha256, isolated: true, exitCode: report.exitCode,
    checks: Object.fromEntries(checks.map(key => [key, report.checks?.[key] === true])),
    error: report.success ? null : 'isolated_restore_failed' };
  details.evidenceHash = hash(details);
  return { backupId: `restore:${details.testId}`, success: report.success, timestamp: completedAt, details };
}
module.exports = { TARGET, SOURCE_ID, SOURCE_MAX_AGE_MS, normalizeReport, normalizeRestore };
