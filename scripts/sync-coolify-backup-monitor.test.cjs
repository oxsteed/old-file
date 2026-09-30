'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collect, main } = require('./sync-coolify-backup-monitor.cjs');
const { passedChecks } = require('./verify-coolify-restore-evidence.cjs');
const { TARGET } = require('../server/services/coolifyBackupEvidence');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
function report() {
  return { schemaVersion: 1, source: 'coolify', observedAt: new Date(Date.now() - 1000).toISOString(),
    target: { ...TARGET, enabled: true, frequency: '0 6 * * *', saveS3: true, keepLocal: true, isR2: true },
    truncated: false, executions: [] };
}
test('collector uses Colima, read-only allowlisted SQL, no credential extraction', () => {
  const result = collect((command, args, options) => {
    assert.equal(command, 'docker'); assert.deepEqual(args.slice(0, 6), ['--context', 'colima', 'exec', '-i', 'coolify-db', 'sh']);
    assert.match(options.input, /REPEATABLE READ READ ONLY/);
    assert.doesNotMatch(options.input, /s\.secret|s\.key|e\.message|INSERT|UPDATE|DELETE/);
    assert.match(args.at(-1), /psql -X -qAt -v ON_ERROR_STOP=1/);
    return { status: 0, stdout: JSON.stringify(report()) };
  });
  assert.equal(result.executions.length, 0);
});
test('dry run collects once and never delivers', () => {
  let calls = 0;
  main([], () => { calls++; return { status: 0, stdout: JSON.stringify(report()) }; });
  assert.equal(calls, 1);
});
test('apply requires an explicit safe app container', () => {
  assert.throws(() => main(['--apply']), /Usage/);
  assert.throws(() => main(['--apply', '--app-container', 'bad;command']), /Usage/);
});
test('collector failure delivers only a failure observation and exits failed', () => {
  const calls = [];
  assert.throws(() => main(['--apply', '--app-container', 'app-test'], (cmd, args) => {
    calls.push(args); return calls.length === 1 ? { status: 1, stderr: 'private error' } : { status: 0, stdout: '' };
  }), /collection failed/);
  assert.equal(calls.length, 2); assert.equal(calls[1].at(-1), '--collector-failed');
});
test('ingestion failure attempts a failure observation and never acknowledges success', () => {
  const calls = [];
  assert.throws(() => main(['--apply', '--app-container', 'app-test'], (cmd, args) => {
    calls.push(args);
    return calls.length === 1 ? { status: 0, stdout: JSON.stringify(report()) } : { status: 1, stderr: 'private error' };
  }), /delivery failed/);
  assert.equal(calls.length, 3); assert.equal(calls[2].at(-1), '--collector-failed');
});
test('ingestion CLI default validates without DB access', () => {
  const result = spawnSync(process.execPath, [resolve(__dirname, '../server/scripts/ingest-backup-evidence.cjs')], {
    input: JSON.stringify(report()), encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'intentionally-invalid' }, timeout: 5000,
  });
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).writes, 0);
});
test('malformed ingestion input is rejected without echoing private text', () => {
  const result = spawnSync(process.execPath, [resolve(__dirname, '../server/scripts/ingest-backup-evidence.cjs')], {
    input: 'private-example-not-json', encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1); assert.doesNotMatch(result.stderr, /private-example/);
});
test('restore checks require the actual verifier success line and complete results', () => {
  assert.equal(Object.values(passedChecks('pg_restore --list passed')).some(Boolean), false);
  const line = 'Production restore verification passed: migrations=610 direct_services=1000 direct_tools=40 credit_tables=12 credit_integrity_triggers=5 temporary_database=oxsteed_restore_verify_test';
  assert.equal(Object.values(passedChecks(line)).every(Boolean), true);
  assert.equal(passedChecks(line.replace('credit_tables=12', 'credit_tables=11')).creditTables, false);
});
