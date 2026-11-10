'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handoff, workerAlias } = require('./handoff-worker.cjs');

function fixture() {
  const calls = [];
  const old = { gitSha: 'a'.repeat(40) };
  const next = { gitSha: 'b'.repeat(40), digest: 'sha256:' + 'c'.repeat(64) };
  const webSha = 'd'.repeat(40);
  const dependencies = {
    incumbent: 'old',
    candidate: 'new',
    verify: () => { calls.push('verify'); return { old, next, webSha }; },
    stop: (id, clean) => calls.push(`stop ${id} ${clean}`),
    activate: id => calls.push(`activate ${id}`),
    start: id => calls.push(`start ${id}`),
    read: id => {
      calls.push(`read ${id}`);
      const release = id === 'old' ? old : next;
      return { status: 'ready', worker: { ok: true, mode: 'combined' },
        releaseMetadata: { gitSha: release.gitSha, imageDigest: release.digest } };
    },
    publicReady: sha => { assert.equal(sha, webSha); calls.push('web ready'); },
  };
  return { calls, dependencies };
}

test('check mode verifies the standby without changing either worker', async () => {
  const { calls, dependencies } = fixture();
  assert.equal((await handoff(dependencies)).status, 'standby_verified');
  assert.deepEqual(calls, ['verify']);
});

test('promotes only after the incumbent has stopped and the candidate proves ownership', async () => {
  const { calls, dependencies } = fixture();
  assert.equal((await handoff({ ...dependencies, apply: true })).status, 'worker_promoted');
  assert.deepEqual(calls, ['verify', 'stop old true', 'activate new', 'read new', 'web ready']);
});

test('rolls back a failed activation after stopping the candidate', async () => {
  const { calls, dependencies } = fixture();
  await assert.rejects(handoff({
    ...dependencies,
    apply: true,
    activate: () => { calls.push('activate new'); throw new Error('synthetic failure'); },
  }), /incumbent was restored and verified/);
  assert.deepEqual(calls, ['verify', 'stop old true', 'activate new', 'stop new false', 'start old', 'read old', 'web ready']);
});

test('accepts only a private worker slot with the expected alias', () => {
  const slot = 'oxsteed-worker-a';
  const worker = { aliases: [slot], labels: { 'com.oxsteed.worker-slot': slot } };
  assert.equal(workerAlias(worker), slot);
  assert.equal(workerAlias({ ...worker, aliases: ['foreign'] }), null);
  assert.equal(workerAlias({ ...worker, ports: { '5000/tcp': [{}] } }), null);
  assert.equal(workerAlias({ ...worker, labels: { ...worker.labels, 'traefik.enable': 'true' } }), null);
});
