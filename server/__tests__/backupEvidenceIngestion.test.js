'use strict';
const { mockQuery, resetMocks } = require('./setup');
const monitor = require('../services/backupMonitor');
jest.mock('../services/metricsService', () => ({ incrementCounter: jest.fn(), recordHistogram: jest.fn(), recordSecurityEvent: jest.fn() }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const metrics = require('../services/metricsService');
const logger = require('../utils/logger');
const { TARGET, SOURCE_ID, normalizeReport, normalizeRestore } = require('../services/coolifyBackupEvidence');
let clock;
const now = Date.parse('2026-09-30T12:00:00.000Z');
function report() {
  return { schemaVersion: 1, source: 'coolify', observedAt: '2026-09-30T11:59:00.000Z',
    target: { ...TARGET, enabled: true, frequency: '0 6 * * *', keepLocal: true, saveS3: true, isR2: true }, truncated: false,
    executions: [{ uuid: 'execution-1', databaseName: TARGET.databaseName, status: 'success',
      startedAt: '2026-09-30T06:00:00.000Z', finishedAt: '2026-09-30T06:00:16.000Z',
      filename: 'db.dmp', sizeBytes: 1234, s3Uploaded: true, localDeleted: false, s3Deleted: false }] };
}
function restore() {
  return { schemaVersion: 1, source: 'isolated_restore_verifier', executionUuid: 'execution-1', testId: 'restore-1',
    startedAt: '2026-09-30T09:00:00.000Z', completedAt: '2026-09-30T09:00:20.000Z', filename: 'db.dmp',
    sizeBytes: 1234, dumpSha256: 'a'.repeat(64), isolated: true, profile: 'legacy-exact-v1', success: true, exitCode: 0,
    checks: { migrations: true, creditTables: true, creditIntegrityTriggers: true, directServices: true,
      directTools: true, immutableTriggerProbe: true } };
}
const row = e => ({ backup_id: e.backupId, success: e.success, details: e.details, created_at: e.timestamp });
beforeEach(() => { resetMocks(); jest.clearAllMocks(); monitor.backupHistory = []; clock = jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => clock.mockRestore());
// Stateful persistence mock: SQL equality and rollback failures remain covered explicitly.
function storage() {
  const rows = new Map();
  mockQuery.mockImplementation(async (sql, values) => {
    if (sql.startsWith('SELECT details') || sql.startsWith('SELECT success')) return { rows: rows.has(values[0]) ? [rows.get(values[0])] : [] };
    if (sql.startsWith('INSERT INTO backup_log')) {
      rows.set(values[0], { success: values[1], details: JSON.parse(values[2]), created_at: values[3] });
      return { rows: [{ backup_id: values[0] }] };
    }
    return { rows: [] };
  });
  return rows;
}
test('ingests atomically, deduplicates retries, and uses execution time', async () => {
  const rows = storage();
  expect(await monitor.ingestCoolifyReport(report())).toEqual({ executions: 1, changed: 1 });
  expect(await monitor.ingestCoolifyReport(report())).toEqual({ executions: 1, changed: 0 });
  expect(rows.size).toBe(2);
  expect(rows.get('coolify:execution-1').created_at).toBe('2026-09-30T06:00:00.000Z');
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes('pg_advisory_xact_lock'))).toBe(true);
});
test('older observation cannot regress deletion or upload evidence', async () => {
  const rows = storage(), newer = report(); newer.observedAt = '2026-09-30T12:00:00.000Z'; newer.executions[0].s3Deleted = true;
  await monitor.ingestCoolifyReport(newer); await monitor.ingestCoolifyReport(report());
  expect(rows.get('coolify:execution-1').details.offsite).toBe(false);
  expect(rows.get(SOURCE_ID).details.observedAt).toBe(newer.observedAt);
});
test('same observation with contradictory evidence rolls back', async () => {
  storage(); await monitor.ingestCoolifyReport(report());
  const changed = report(); changed.executions[0].s3Uploaded = false;
  await expect(monitor.ingestCoolifyReport(changed)).rejects.toThrow('Conflicting evidence');
  expect(mockQuery.mock.calls.at(-1)[0]).toBe('ROLLBACK');
});
test('database failure propagates and rolls back before acknowledging', async () => {
  mockQuery.mockImplementation(async sql => { if (sql.startsWith('INSERT')) throw new Error('write failed'); return { rows: [] }; });
  await expect(monitor.ingestCoolifyReport(report())).rejects.toThrow('write failed');
  expect(mockQuery.mock.calls.at(-1)[0]).toBe('ROLLBACK'); expect(monitor.backupHistory).toEqual([]);
});
test('failed legacy persistence never seeds successful memory history', async () => {
  mockQuery.mockRejectedValueOnce(new Error('write failed'));
  await expect(monitor.recordBackup('b1', 'db.dmp', 1, 1, true)).rejects.toThrow();
  expect(monitor.backupHistory).toEqual([]);
});
test('invalid input never starts a transaction', async () => {
  await expect(monitor.ingestCoolifyReport({})).rejects.toThrow(); expect(mockQuery).not.toHaveBeenCalled();
});
test('observability follows durable outcomes once, including refreshed observations', async () => {
  storage(); await monitor.ingestCoolifyReport(report()); await monitor.ingestCoolifyReport(report());
  const refreshed = report(); refreshed.observedAt = '2026-09-30T12:00:00.000Z';
  await monitor.ingestCoolifyReport(refreshed);
  expect(metrics.incrementCounter).toHaveBeenCalledTimes(1);
  expect(metrics.incrementCounter).toHaveBeenCalledWith('backup.success', 1);
  expect(metrics.recordHistogram).toHaveBeenCalledWith('backup.duration_ms', 16000);
  expect(metrics.recordHistogram).toHaveBeenCalledWith('backup.size_bytes', 1234);
});
test('real failure emits fixed codes and security event once after commit', async () => {
  storage(); const failed = report(); Object.assign(failed.executions[0], { status: 'failed', message: 'private-message', filename: null, sizeBytes: 0 });
  await monitor.ingestCoolifyReport(failed); await monitor.ingestCoolifyReport(failed);
  expect(metrics.incrementCounter).toHaveBeenCalledTimes(1);
  expect(metrics.recordSecurityEvent).toHaveBeenCalledWith('backup_failure', 'critical', 'system', { backupId: 'coolify:execution-1', error: 'backup_failed' });
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private-message');
});
test('rollback never emits success telemetry', async () => {
  mockQuery.mockImplementation(async sql => { if (sql === 'COMMIT') throw new Error('commit failed'); return { rows: [] }; });
  await expect(monitor.ingestCoolifyReport(report())).rejects.toThrow('commit failed');
  expect(metrics.incrementCounter).not.toHaveBeenCalled(); expect(metrics.recordHistogram).not.toHaveBeenCalled();
});
test('verified restoration failure emits one security event after durable ingestion', async () => {
  storage(); await monitor.ingestCoolifyReport(report());
  const failed = { ...restore(), success: false, exitCode: 1, stderr: 'private-message' };
  await monitor.ingestRestorationEvidence(failed); await monitor.ingestRestorationEvidence(failed);
  expect(metrics.recordSecurityEvent).toHaveBeenCalledTimes(1);
  expect(metrics.recordSecurityEvent).toHaveBeenCalledWith('restoration_test_failure', 'critical', 'system', { testId: 'restore-1', error: 'restoration_test_failed' });
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private-message');
});
test('restore event persists once and cannot overwrite a different result', async () => {
  const rows = storage(); await monitor.ingestCoolifyReport(report());
  expect(await monitor.ingestRestorationEvidence(restore())).toEqual({ changed: true });
  expect(await monitor.ingestRestorationEvidence(restore())).toEqual({ changed: false });
  expect(rows.get('restore:restore-1').details.dumpSha256).toBe('a'.repeat(64));
  await expect(monitor.ingestRestorationEvidence({ ...restore(), success: false, exitCode: 1 })).rejects.toThrow('Conflicting restore');
});
test('unlinked or mismatched restore never creates a success', async () => {
  storage(); await expect(monitor.ingestRestorationEvidence(restore())).rejects.toThrow('does not match');
  await monitor.ingestCoolifyReport(report());
  await expect(monitor.ingestRestorationEvidence({ ...restore(), sizeBytes: 1 })).rejects.toThrow('does not match');
});
function statusFixture(backupChange, sourceChange, restoration) {
  const data = normalizeReport(report(), now), backup = row(data.events[0]), source = row(data.source);
  if (backupChange) backupChange(backup);
  if (sourceChange) sourceChange(source);
  mockQuery.mockResolvedValueOnce({ rows: [backup] }).mockResolvedValueOnce({ rows: [source, ...(restoration ? [row(restoration)] : [])] });
}
test('reports durable backup and restore separately after restart', async () => {
  statusFixture(null, null, normalizeRestore(restore(), now));
  const status = await monitor.getStatus();
  expect(status).toMatchObject({ backupHealthy: true, recoveryReady: true, restorationVerified: true, hoursSinceBackup: '6.00' });
  expect(status.lastBackupTime).toBe('2026-09-30T06:00:00.000Z');
});
test.each([
  ['upload unconfirmed', b => { b.details.offsite = false; }, null],
  ['local removed', b => { b.details.local = false; }, null],
  ['latest failure', b => { b.success = false; b.details.filename = null; }, null],
  ['pending latest', b => { b.success = false; b.details.state = 'running'; }, null],
  ['old execution', b => { b.created_at = '2026-09-29T06:00:00.000Z'; }, null],
  ['future execution', b => { b.created_at = '2026-10-01T06:00:00.000Z'; }, null],
  ['stale collector', null, s => { s.details.observedAt = '2026-09-30T09:00:00.000Z'; }],
  ['collector failure', null, s => { s.success = false; }],
  ['disabled schedule', null, s => { s.details.config.enabled = false; }],
  ['changed schedule', null, s => { s.details.config.frequency = '0 7 * * *'; }],
  ['missing execution', null, s => { s.details.observedAt = '2026-09-30T12:00:00.000Z'; }],
])('fails closed for %s', async (_, b, s) => {
  statusFixture(b, s); expect((await monitor.getStatus()).backupHealthy).toBe(false);
});
test('missing restore cannot become recovery readiness', async () => {
  statusFixture(); expect(await monitor.getStatus()).toMatchObject({ backupHealthy: true, restorationVerified: false, recoveryReady: false });
});
test('persisted restore failure survives restart', async () => {
  statusFixture(null, null, normalizeRestore({ ...restore(), success: false, exitCode: 1 }, now));
  expect((await monitor.getStatus()).alerts).toContainEqual({ severity: 'critical', message: 'Last restoration test FAILED' });
});
test('empty compliance and database outage are never compliant', async () => {
  expect((await monitor.getComplianceStats()).status).toBe('AT_RISK');
  mockQuery.mockRejectedValue(new Error('unavailable'));
  expect(await monitor.getStatus()).toMatchObject({ persistenceAvailable: false, backupHealthy: false });
  expect((await monitor.getComplianceStats()).status).toBe('AT_RISK');
});
