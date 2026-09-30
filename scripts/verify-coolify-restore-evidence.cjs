'use strict';
// Runs the existing verifier only in an explicitly labeled disposable DB container.
const { createHash, randomUUID } = require('node:crypto');
const { createReadStream, writeFileSync } = require('node:fs');
const { basename, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeRestore } = require('../server/services/coolifyBackupEvidence');
const profiles = require('../server/services/restoreVerificationProfiles');
function passedChecks(stdout) {
  const line = stdout.split('\n').find(line => line.startsWith('Production restore verification passed: '));
  const checks = {
    migrations: /\bmigrations=[1-9][0-9]*\b/.test(line || ''),
    creditTables: /\bcredit_tables=12\b/.test(line || ''),
    creditIntegrityTriggers: /\bcredit_integrity_triggers=5\b/.test(line || ''),
    directServices: /\bdirect_services=1000\b/.test(line || ''),
    directTools: /\bdirect_tools=40\b/.test(line || ''),
    // The verifier exits on any failed probe, and emits this line only after rollback.
    immutableTriggerProbe: !!line,
  };
  return checks;
}
async function main(args) {
  if (!(args.length === 4 || args.length === 6 && args[4] === '--profile')) throw new Error('Usage: node scripts/verify-coolify-restore-evidence.cjs EXECUTION_UUID DUMP DISPOSABLE_DB_CONTAINER OUTPUT_JSON [--profile legacy-exact-v1]');
  const [executionUuid, dump, container, output] = args;
  const profile = args[5] || 'legacy-exact-v1';
  if (!Object.hasOwn(profiles, profile)) throw new Error('Unknown restore profile');
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(executionUuid) || !/^oxsteed-restore-[a-zA-Z0-9_.-]+$/.test(container)) throw new Error('Invalid restore target');
  const inspected = spawnSync('docker', ['--context', 'colima', 'inspect', '-f', '{{index .Config.Labels "oxsteed.restore-verification"}}', container],
    { encoding: 'utf8', timeout: 10000 });
  if (inspected.status !== 0 || inspected.stdout.trim() !== 'true') throw new Error('Disposable restore container label required');
  const startedAt = new Date().toISOString(), checksum = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of createReadStream(dump)) { checksum.update(chunk); sizeBytes += chunk.length; }
  const result = spawnSync('bash', [resolve(__dirname, 'verify-production-restore.sh'), resolve(dump)], {
    env: { ...process.env, DOCKER_CONTEXT: 'colima', APP_DB_CONTAINER: container,
      MIGRATIONS_DIR: resolve(__dirname, '../server/migrations') },
    encoding: 'utf8', timeout: 30 * 60 * 1000, maxBuffer: 4 * 1024 * 1024,
  });
  const checks = passedChecks(result.stdout || '');
  // A dump changed during verification cannot support a successful restore claim.
  const afterChecksum = createHash('sha256');
  let afterSize = 0;
  for await (const chunk of createReadStream(dump)) { afterChecksum.update(chunk); afterSize += chunk.length; }
  const dumpSha256 = checksum.digest('hex');
  const stable = afterSize === sizeBytes && afterChecksum.digest('hex') === dumpSha256;
  const success = stable && result.status === 0 && !result.error && Object.values(checks).every(Boolean);
  const report = { schemaVersion: 1, source: 'isolated_restore_verifier', testId: randomUUID(), executionUuid,
    startedAt, completedAt: new Date().toISOString(), filename: basename(dump), sizeBytes,
    dumpSha256, isolated: true, profile, checks, success,
    exitCode: success ? 0 : result.exitCode > 0 ? result.exitCode : result.status > 0 ? result.status : 1 };
  normalizeRestore(report);
  writeFileSync(resolve(output), JSON.stringify(report) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ success, testId: report.testId, evidenceFile: resolve(output) }));
  if (!success) process.exitCode = 1;
}
if (require.main === module) main(process.argv.slice(2)).catch(() => {
  console.error('Isolated restore verification could not produce evidence'); process.exitCode = 1;
});
module.exports = { passedChecks };
