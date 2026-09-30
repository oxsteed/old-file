'use strict';
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeReport } = require('../server/services/coolifyBackupEvidence');
const root = resolve(__dirname, '..');
function collect(run = spawnSync) {
  const input = readFileSync(resolve(root, 'server/scripts/export-coolify-backup-evidence.sql'), 'utf8');
  const result = run('docker', ['--context', 'colima', 'exec', '-i', 'coolify-db', 'sh', '-lc',
    'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
  { input, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error('Coolify metadata collection failed');
  const report = JSON.parse(result.stdout);
  normalizeReport(report);
  return report;
}
function deliver(container, args, input, run = spawnSync) {
  const result = run('docker', ['--context', 'colima', 'exec', '-i', container,
    'node', '/app/server/scripts/ingest-backup-evidence.cjs', '--apply', ...args],
  { input, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error('Backup evidence delivery failed');
  return result.stdout;
}
function main(args, run = spawnSync) {
  const apply = args[0] === '--apply';
  const container = apply && args[1] === '--app-container' ? args[2] : null;
  if (args.length && !(apply && args.length === 3 && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container || '')))
    throw new Error('Usage: node scripts/sync-coolify-backup-monitor.cjs [--apply --app-container NAME]');
  let report;
  try { report = collect(run); }
  catch (error) {
    if (apply) deliver(container, ['--collector-failed'], '', run);
    throw error;
  }
  if (apply) {
    try { process.stdout.write(deliver(container, [], JSON.stringify(report), run)); }
    catch (error) {
      // Best effort: if persistence itself is down, the last observation expires.
      try { deliver(container, ['--collector-failed'], '', run); } catch (_) { /* Retry on next scheduled run. */ }
      throw error;
    }
  }
  else {
    const events = normalizeReport(report).events;
    console.log(JSON.stringify({ dryRun: true, writes: 0, target: report.target,
      executions: events.map(e => ({ backupId: e.backupId, startedAt: e.timestamp,
        state: e.details.state, local: e.details.local, offsite: e.details.offsite,
        verificationLevel: e.details.verificationLevel })), truncated: report.truncated }));
  }
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error('Backup monitor sync failed; retry after correcting source or delivery'); process.exitCode = 1; }
}
module.exports = { collect, deliver, main };
