'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pullRedis, TARGET, SOURCES } = require('./pull-ci-redis.cjs');

test('primary success tags Redis locally without unnecessary fallback', async () => {
  const calls = [];
  const image = await pullRedis({ run: args => { calls.push(args); return { status: 0 }; }, log: () => {}, wait: () => assert.fail('No backoff needed') });
  assert.equal(image, TARGET);
  assert.deepEqual(calls, [['pull', SOURCES[0]], ['tag', SOURCES[0], TARGET]]);
});

test('registry failure falls back to the same official Redis major version', async () => {
  const calls = [];
  await pullRedis({ run: args => { calls.push(args); return { status: calls.length === 1 ? 1 : 0 }; }, log: () => {}, wait: () => assert.fail('No backoff needed') });
  assert.deepEqual(calls, [['pull', SOURCES[0]], ['pull', SOURCES[1]], ['tag', SOURCES[1], TARGET]]);
});

test('failures and command timeouts retry with bounded backoff then fail closed', async () => {
  const calls = [], waits = [];
  await assert.rejects(pullRedis({ run: args => { calls.push(args); return { status: null, error: new Error('Synthetic timeout') }; }, wait: ms => waits.push(ms), log: () => {} }), /unavailable from both/);
  assert.deepEqual(calls, Array.from({ length: 3 }, () => SOURCES.map(source => ['pull', source])).flat());
  assert.deepEqual(waits, [5000, 10000]);
});

test('successful download does not conceal local tag failure', async () => {
  await assert.rejects(pullRedis({ run: args => ({ status: args[0] === 'tag' ? 1 : 0 }), log: () => {} }), /Could not tag/);
});

test('CI runs pull regression tests and prepares the local image before compose startup', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/ci.yml'), 'utf8');
  assert.ok(workflow.includes('scripts/pull-ci-redis.test.cjs'));
  assert.ok(workflow.includes(`CREDIT_TEST_REDIS_IMAGE=${TARGET}`));
  const pull = workflow.indexOf('node scripts/pull-ci-redis.cjs');
  assert.ok(pull > 0 && pull < workflow.indexOf('if ! "${compose[@]}" up -d --build'));
});
