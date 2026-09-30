'use strict';
const { normalizeReport, normalizeRestore } = require('../services/coolifyBackupEvidence');
async function readInput(stream) {
  let input = '';
  for await (const chunk of stream) {
    input += chunk;
    if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('Evidence exceeds 1 MiB');
  }
  return JSON.parse(input);
}
async function main(args) {
  if (args.some(arg => !['--apply', '--restore', '--collector-failed'].includes(arg))
    || args.includes('--restore') && args.includes('--collector-failed')) throw new Error('Invalid arguments');
  const apply = args.includes('--apply');
  const restore = args.includes('--restore');
  const failure = args.includes('--collector-failed');
  let report, normalized;
  if (!failure) {
    report = await readInput(process.stdin);
    normalized = restore ? normalizeRestore(report) : normalizeReport(report);
  }
  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, type: failure ? 'collector_failure' : restore ? 'restore' : 'coolify',
      executions: normalized?.events?.length, writes: 0 }));
    return;
  }
  // Loaded only after validation and explicit opt-in; no dotenv or new credentials.
  const monitor = require('../services/backupMonitor');
  const pool = require('../db');
  try {
    const result = failure ? await monitor.recordCollectorFailure()
      : restore ? await monitor.ingestRestorationEvidence(report) : await monitor.ingestCoolifyReport(report);
    console.log(JSON.stringify({ applied: true, result }));
  } finally { await pool.end(); }
}
if (require.main === module) main(process.argv.slice(2)).catch(() => {
  // Do not echo malformed payloads, database errors, or connection strings.
  console.error('Backup evidence ingestion failed; no successful report acknowledged'); process.exitCode = 1;
});
module.exports = { readInput, main };
