'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertIsolated, invoke, rejectsCode } = require('../server/scripts/verify-media-credit-isolated');

const isolated = {
  NODE_ENV: 'test', MEDIA_TEST_MODE: 'true', CREDIT_TEST_PROJECT: 'oxsteed-credit-test-20261009t120000z-1234',
  DATABASE_URL: 'postgresql://oxsteed:synthetic@postgres:5432/oxsteed_db?sslmode=disable',
};

test('financial verifier only accepts the explicitly disposable compose database', () => {
  assert.doesNotThrow(() => assertIsolated(isolated));
  for (const override of [
    { NODE_ENV: 'production' }, { MEDIA_TEST_MODE: 'false' }, { CREDIT_TEST_PROJECT: 'oxsteed-production' },
    { CREDIT_TEST_PROJECT: '' }, { DATABASE_URL: '' },
    { DATABASE_URL: 'postgresql://oxsteed:synthetic@localhost:5432/oxsteed_db?sslmode=disable' },
    { DATABASE_URL: 'postgresql://oxsteed:synthetic@postgres:5432/production?sslmode=disable' },
    { DATABASE_URL: 'postgresql://root:synthetic@postgres:5432/oxsteed_db?sslmode=disable' },
    { DATABASE_URL: 'postgresql://oxsteed:synthetic@postgres:5433/oxsteed_db?sslmode=disable' },
    { DATABASE_URL: 'postgresql://oxsteed:synthetic@postgres:5432/oxsteed_db?sslmode=require' },
    { DATABASE_URL: 'https://oxsteed:synthetic@postgres:5432/oxsteed_db?sslmode=disable' },
  ]) assert.throws(() => assertIsolated({ ...isolated, ...override }), /disposable Media compose/);
});

test('controller adapter carries user, input and durable key without swallowing errors', async () => {
  const result = await invoke(async (req, res) => {
    assert.equal(req.user.id, 'synthetic-user');
    assert.equal(req.body.amountCents, 125);
    assert.equal(req.params.tipId, 'synthetic-tip');
    assert.equal(req.get('Idempotency-Key'), 'durable-key');
    res.status(202).json({ tip: { id: req.params.tipId } });
  }, 'synthetic-user', { amountCents: 125 }, { tipId: 'synthetic-tip' }, 'durable-key');
  assert.deepEqual(result, { status: 202, tip: { id: 'synthetic-tip' } });
  const failure = Object.assign(new Error('Funds unavailable'), { code: 'credit_insufficient_funds' });
  await rejectsCode(() => invoke(async (req, res, next) => next(failure), 'synthetic-user'), 'credit_insufficient_funds');
  await assert.rejects(() => invoke(async () => {}, 'synthetic-user'), /controller must return a response/);
});

function scannerEntrypoint(t, extraEnv = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxsteed-clamav-entrypoint-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const log = path.join(directory, 'calls.log');
  const commands = {
    chown: 'printf "chown:%s\\n" "$*" >> "$CLAMAV_TEST_LOG"',
    freshclam: 'printf "freshclam:%s\\n" "$*" >> "$CLAMAV_TEST_LOG"; exit "${FRESHCLAM_EXIT:-0}"',
    clamd: 'printf "clamd:%s\\n" "$*" >> "$CLAMAV_TEST_LOG"; exit "${CLAMD_EXIT:-0}"',
    su: 'printf "unexpected-su\\n" >> "$CLAMAV_TEST_LOG"; exit 1',
  };
  for (const [name, body] of Object.entries(commands)) {
    fs.writeFileSync(path.join(directory, name), '#!/bin/sh\n' + body + '\n', { mode: 0o755 });
  }
  const result = spawnSync('sh', [path.resolve(__dirname, '../.github/ci/clamav/entrypoint.sh')], {
    encoding: 'utf8',
    env: { ...process.env, PATH: directory + path.delimiter + process.env.PATH, CLAMAV_TEST_LOG: log, ...extraEnv },
  });
  assert.ifError(result.error);
  return { result, calls: fs.readFileSync(log, 'utf8').trim().split('\n') };
}

test('CI scanner uses FreshClam privilege dropping without a service-account login', (t) => {
  const { result, calls } = scannerEntrypoint(t);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, [
    'chown:-R clamav:clamav /var/lib/clamav /var/log/clamav',
    'freshclam:--stdout --user=clamav',
    'clamd:--foreground=true --config-file=/etc/clamav/clamd.conf',
  ]);
});

test('cached signatures can still start clamd when an update is unavailable', (t) => {
  const { result, calls } = scannerEntrypoint(t, { FRESHCLAM_EXIT: '52' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(calls[1], /^freshclam:/);
  assert.match(calls[2], /^clamd:/);
});

test('CI scanner startup propagates daemon failure instead of reporting readiness', (t) => {
  const { result } = scannerEntrypoint(t, { FRESHCLAM_EXIT: '52', CLAMD_EXIT: '1' });
  assert.equal(result.status, 1);
});
