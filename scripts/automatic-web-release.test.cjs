'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureBridge, applyBridgeSchema, promoteAutomatic, verifyWorkerContinuity } = require('./automatic-web-release.cjs');

test('dispatches one schema bridge for a pending candidate and reuses it', () => {
  const calls = [];
  const api = () => ({ workflow_runs: [] });
  assert.equal(ensureBridge('a'.repeat(40), api, sha => calls.push(sha)), null);
  assert.deepEqual(calls, ['a'.repeat(40)]);
  const existing = { id: 99, head_sha: 'a'.repeat(40), event: 'workflow_dispatch', status: 'queued' };
  assert.equal(ensureBridge('a'.repeat(40), () => ({ workflow_runs: [existing] }), () => { throw Error('duplicate dispatch'); }), existing);
});

test('schema apply requires exactly one healthy bridge with the expected revision', () => {
  const calls = [];
  const plan = { baseCommit: 'a'.repeat(40), migrations: { '20261109231751_reviewed.sql': 'a'.repeat(64) } };
  const options = {
    gitSha: 'b'.repeat(40), runId: '22',
    plan,
    list: () => 'one two',
    inspect: id => JSON.stringify({ Config: { Labels: {
      'org.opencontainers.image.revision': id === 'one' ? 'b'.repeat(40) : 'other',
      'com.oxsteed.release.kind': 'schema-bridge',
    } } }),
    exec: () => {
      calls.push('apply');
      return JSON.stringify({ ok: true, pending: [], applied: [] });
    },
    combinedList: () => ['combined'],
    copyManifest: (id, migrations) => {
      assert.equal(id, 'combined');
      assert.deepEqual(migrations, plan.migrations);
      calls.push('install compatibility');
    },
    verifyCombined: () => {
      calls.push('check owner');
      return { status: 'ready', releaseMetadata: { gitSha: plan.baseCommit }, checks: { workers: { mode: 'combined' } } };
    },
  };
  assert.equal(applyBridgeSchema(options).status, 'schema_applied');
  assert.deepEqual(calls, ['check owner', 'install compatibility', 'check owner', 'apply']);
  calls.length = 0;
  assert.equal(applyBridgeSchema({ ...options, verifyCombined: () => ({ status: 'ready' }) }).reason,
    'combined_runtime_compatibility_not_ready');
  assert.deepEqual(calls, []);
  assert.equal(applyBridgeSchema({ gitSha: 'b'.repeat(40), runId: '22', list: () => 'one two', inspect: () => JSON.stringify({ Config: { Labels: { 'org.opencontainers.image.revision': 'b'.repeat(40), 'com.oxsteed.release.kind': 'schema-bridge' } } }) }).status, 'waiting_for_schema_apply');
});

test('automatic promotion bridges, applies, then retries the exact candidate', async () => {
  const promoted = [];
  const plan = { baseCommit: 'a'.repeat(40), migrations: {} };
  const result = await promoteAutomatic('candidate', {
    api: () => ({ workflow_runs: [{ id: 7, head_sha: 'c'.repeat(40), event: 'workflow_dispatch', status: 'completed', conclusion: 'success' }] }),
    promote: async (runId, options) => {
      promoted.push(runId);
      if (runId === 'candidate') {
        assert.equal(options.beforePromotion('c'.repeat(40)), null);
        return promoted.length > 2 ? { status: 'finished' } : { status: 'waiting_for_schema', gitSha: 'c'.repeat(40) };
      }
      assert.deepEqual(options, { bridge: true });
      return { status: 'already_current' };
    },
    loadPlan: sha => { assert.equal(sha, 'c'.repeat(40)); return plan; },
    applySchema: options => {
      assert.equal(options.plan, plan);
      return { status: 'schema_applied' };
    },
    verifyWorker: sha => ({ status: 'worker_already_current', workerSha: sha }),
  });
  assert.equal(result.status, 'finished');
  assert.equal(result.worker, 'worker_already_current');
  assert.deepEqual(promoted, ['candidate', '7', 'candidate']);
});

test('allows only independent web changes while retaining the healthy Compose worker', async () => {
  const workerSha = 'a'.repeat(40), gitSha = 'b'.repeat(40);
  const opts = {
    list: () => ['owner'],
    read: () => ({ status: 'ready', releaseMetadata: { gitSha: workerSha }, checks: { workers: { mode: 'combined' } } }),
  };
  const check = files => verifyWorkerContinuity(gitSha, { ...opts, api: () => ({ status: 'ahead', files }) });
  assert.equal(verifyWorkerContinuity(workerSha, opts).status, 'worker_already_current');
  assert.equal(check([{ filename: 'client/src/routes.tsx' }]).status, 'worker_retained');
  assert.equal(check([{ filename: 'client/src/routes.tsx', previous_filename: 'server/jobs/foo.js' }]).status,
    'worker_release_requires_rolling_target');
  assert.equal(check([{ filename: 'server/migrations/20261110120000_next.sql' }]).status,
    'worker_release_requires_rolling_target');
  assert.equal(check([]).status, 'worker_release_requires_rolling_target');
  assert.equal(verifyWorkerContinuity(gitSha, { ...opts, list: () => ['one', 'two'] }).status, 'waiting_for_healthy_runtime');

  const held = await promoteAutomatic('candidate', {
    promote: async (runId, { beforePromotion }) => beforePromotion(gitSha),
    verifyWorker: () => check([{ filename: 'server/jobs/foo.js' }]),
    api: () => { throw new Error('must not dispatch a bridge for a held release'); },
  });
  assert.equal(held.status, 'worker_release_requires_rolling_target');
});
