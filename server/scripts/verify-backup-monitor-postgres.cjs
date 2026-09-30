'use strict';
// Synthetic data only. The host runner gives this process a private disposable PG.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Pool } = require('pg');
const { TARGET } = require('../services/coolifyBackupEvidence');
async function main() {
  if (process.env.OXSTEED_DISPOSABLE_BACKUP_TEST !== 'true') throw new Error('Disposable test guard required');
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', database: 'postgres', ssl: false });
  require.cache[require.resolve('../db')] = { exports: pool };
  let monitor = require('../services/backupMonitor');
  const now = Date.now(), iso = delta => new Date(now + delta).toISOString();
  const base = { schemaVersion: 1, source: 'coolify', observedAt: iso(-1000),
    target: { ...TARGET, enabled: true, frequency: '0 6 * * *', keepLocal: true, saveS3: true, isR2: true },
    truncated: false, executions: [{ uuid: 'pg-test-execution', databaseName: TARGET.databaseName,
      status: 'success', startedAt: iso(-3600000), finishedAt: iso(-3590000),
      filename: 'pg-test.dmp', sizeBytes: 1234, s3Uploaded: true, localDeleted: false, s3Deleted: false }] };
  const copy = () => JSON.parse(JSON.stringify(base));
  try {
    await pool.query("SET TIME ZONE 'America/New_York'");
    await pool.query(readFileSync(resolve(__dirname, '../migrations/205_backup_log.sql'), 'utf8'));
    const race = await Promise.all([monitor.ingestCoolifyReport(copy()), monitor.ingestCoolifyReport(copy())]);
    assert.equal(race.reduce((sum, r) => sum + r.changed, 0), 1);
    assert.equal(Number((await pool.query('SELECT count(*) FROM backup_log')).rows[0].count), 2);
    assert.equal((await monitor.getStatus()).lastBackupTime, base.executions[0].startedAt);
    assert.equal((await monitor.getStatus()).backupHealthy, true);
    assert.equal((await monitor.getStatus()).restorationVerified, false);
    const changed = copy(); changed.observedAt = iso(-500); changed.executions[0].s3Deleted = true;
    await monitor.ingestCoolifyReport(changed); await monitor.ingestCoolifyReport(copy());
    assert.equal((await monitor.getStatus()).lastBackupOffsite, false);
    const conflict = JSON.parse(JSON.stringify(changed)); conflict.executions[0].s3Deleted = false;
    await assert.rejects(monitor.ingestCoolifyReport(conflict), /Conflicting evidence/);
    const before = Number((await pool.query('SELECT count(*) FROM backup_log')).rows[0].count);
    const partial = JSON.parse(JSON.stringify(changed));
    partial.executions.unshift({ ...partial.executions[0], uuid: 'must-rollback' });
    partial.executions[1].s3Deleted = false;
    await assert.rejects(monitor.ingestCoolifyReport(partial), /Conflicting evidence/);
    assert.equal(Number((await pool.query('SELECT count(*) FROM backup_log')).rows[0].count), before);
    // Re-importing an old dump does not refresh its age.
    const old = copy(); old.observedAt = iso(-100); old.executions[0].startedAt = iso(-26 * 3600000);
    old.executions[0].finishedAt = iso(-26 * 3600000 + 10000);
    await monitor.ingestCoolifyReport(old); assert.equal((await monitor.getStatus()).backupHealthy, false);
    const latest = copy(); latest.observedAt = iso(-50); await monitor.ingestCoolifyReport(latest);
    const restoration = { schemaVersion: 1, source: 'isolated_restore_verifier', testId: 'pg-restore-test', executionUuid: 'pg-test-execution',
      startedAt: iso(-60000), completedAt: iso(-30000), filename: 'pg-test.dmp', sizeBytes: 1234,
      dumpSha256: 'a'.repeat(64), success: false, exitCode: 1, isolated: true, profile: 'legacy-exact-v1', checks: {} };
    await monitor.ingestRestorationEvidence(restoration); await monitor.ingestRestorationEvidence(restoration);
    assert.equal(Number((await pool.query("SELECT count(*) FROM backup_log WHERE backup_id LIKE 'restore:%'")).rows[0].count), 1);
    delete require.cache[require.resolve('../services/backupMonitor')]; monitor = require('../services/backupMonitor');
    const restarted = await monitor.getStatus();
    assert.equal(restarted.backupHealthy, true); assert.equal(restarted.restorationVerified, false);
    assert(restarted.alerts.some(a => a.message === 'Last restoration test FAILED'));
    assert.equal(restarted.lastBackupTime, base.executions[0].startedAt);
    const failed = copy(); failed.observedAt = new Date().toISOString(); failed.executions = [{ ...base.executions[0],
      uuid: 'latest-failure', status: 'failed', filename: null, sizeBytes: 0, startedAt: iso(-20000), finishedAt: iso(-10000) }];
    await monitor.ingestCoolifyReport(failed);
    assert.equal((await monitor.getStatus()).lastBackupSuccess, false);
    const compliance = await monitor.getComplianceStats();
    assert.equal(compliance.failureCount, 1); assert.equal(compliance.status, 'AT_RISK');
    console.log('Real PostgreSQL backup tests passed: concurrent retry uniqueness, UTC execution age, monotonic evidence, atomic rollback, restore deduplication, restart persistence, latest failure and compliance');
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
