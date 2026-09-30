'use strict';
const { TARGET, normalizeReport, normalizeRestore } = require('../services/coolifyBackupEvidence');
const now = Date.parse('2026-09-30T12:00:00.000Z');
function report(overrides = {}) {
  return { schemaVersion: 1, source: 'coolify', observedAt: '2026-09-30T11:59:00.000Z',
    target: { ...TARGET, enabled: true, frequency: '0 6 * * *', keepLocal: true, saveS3: true, isR2: true },
    truncated: false, executions: [{ uuid: 'execution-1', databaseName: TARGET.databaseName,
      status: 'success', startedAt: '2026-09-30T06:00:00.000Z', finishedAt: '2026-09-30T06:00:16.000Z',
      filename: 'db.dmp', sizeBytes: 1234, s3Uploaded: true, localDeleted: false, s3Deleted: false }], ...overrides };
}
function restore(overrides = {}) {
  return { schemaVersion: 1, source: 'isolated_restore_verifier', executionUuid: 'execution-1', testId: 'restore-1',
    startedAt: '2026-09-30T09:00:00.000Z', completedAt: '2026-09-30T09:00:20.000Z',
    filename: 'db.dmp', sizeBytes: 1234, dumpSha256: 'a'.repeat(64), isolated: true, profile: 'legacy-exact-v1', success: true, exitCode: 0,
    checks: { migrations: true, creditTables: true, creditIntegrityTriggers: true, directServices: true,
      directTools: true, immutableTriggerProbe: true }, ...overrides };
}
test('projects verified execution timestamps and sanitized provenance', () => {
  const input = report(); input.executions[0].message = 'private failure details'; input.target.secret = 'excluded';
  const value = normalizeReport(input, now);
  expect(value.events[0]).toMatchObject({ backupId: 'coolify:execution-1', success: true,
    timestamp: '2026-09-30T06:00:00.000Z', details: { local: true, offsite: true, durationMs: 16000,
      verificationLevel: 'coolify_execution' } });
  expect(JSON.stringify(value)).not.toMatch(/private failure|excluded/);
});
test.each([
  ['s3Uploaded', null, 'offsite'], ['s3Uploaded', false, 'offsite'], ['s3Deleted', true, 'offsite'],
  ['s3Deleted', null, 'offsite'], ['localDeleted', true, 'local'], ['localDeleted', null, 'local'],
])('does not infer copy confirmation from %s=%s', (key, value, field) => {
  const input = report(); input.executions[0][key] = value;
  expect(normalizeReport(input, now).events[0].details[field]).toBe(false);
});
test.each(['failed', 'running', 'pending'])('preserves %s without inventing success or a filename', status => {
  const input = report(); Object.assign(input.executions[0], { status, filename: null, sizeBytes: 0, finishedAt: null });
  expect(normalizeReport(input, now).events[0]).toMatchObject({ success: false, details: { state: status } });
});
test.each([
  ['future observation', r => { r.observedAt = '2026-09-30T12:01:00.000Z'; }],
  ['stale observation', r => { r.observedAt = '2026-09-30T11:00:00.000Z'; }],
  ['wrong bucket', r => { r.target.bucket = 'other'; }],
  ['wrong database', r => { r.executions[0].databaseName = 'coolify'; }],
  ['unknown status', r => { r.executions[0].status = 'completed'; }],
  ['missing completion', r => { r.executions[0].finishedAt = null; }],
  ['empty dump', r => { r.executions[0].sizeBytes = 0; }],
  ['unsafe filename', r => { r.executions[0].filename = '../db.dmp'; }],
  ['string boolean', r => { r.executions[0].s3Uploaded = 'true'; }],
  ['duplicate identity', r => { r.executions.push(r.executions[0]); }],
  ['invalid calendar', r => { r.executions[0].startedAt = '2026-02-30T06:00:00.000Z'; }],
])('rejects %s', (_, mutate) => {
  const input = report(); mutate(input); expect(() => normalizeReport(input, now)).toThrow('Invalid backup evidence');
});
test('configuration alone and an empty execution list never create a backup', () => {
  expect(normalizeReport(report({ executions: [] }), now).events).toEqual([]);
});
test('restore proof includes checksum and checks, but omits arbitrary details', () => {
  expect(normalizeRestore(restore({ stdout: 'excluded' }), now)).toMatchObject({ success: true,
    backupId: 'restore:restore-1', details: { backupId: 'coolify:execution-1', durationMs: 20000, dumpSha256: 'a'.repeat(64) } });
});
test.each([
  { exitCode: 1 }, { dumpSha256: null }, { isolated: false }, { checks: {} },
  { completedAt: '2026-09-30T08:00:00.000Z' },
])('rejects unsupported restoration claims %j', change => {
  expect(() => normalizeRestore(restore(change), now)).toThrow();
});
test('records a failed restore without passing checks', () => {
  expect(normalizeRestore(restore({ success: false, exitCode: 1, checks: {} }), now).success).toBe(false);
});
module.exports = { report, restore };
