'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureBridge, applyBridgeSchema, promoteAutomatic } = require('./automatic-web-release.cjs');

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
      promoted.push([runId, options]);
      if (runId === 'candidate') return promoted.length > 2 ? { status: 'finished' } : { status: 'waiting_for_schema', gitSha: 'c'.repeat(40) };
      return { status: 'already_current' };
    },
    loadPlan: sha => { assert.equal(sha, 'c'.repeat(40)); return plan; },
    applySchema: options => {
      assert.equal(options.plan, plan);
      return { status: 'schema_applied' };
    },
    promoteWorker: async sha => ({ status: 'worker_finished', gitSha: sha }),
  });
  assert.equal(result.status, 'finished');
  assert.equal(result.worker, 'worker_finished');
  assert.deepEqual(promoted, [['candidate', undefined], ['7', { bridge: true }], ['candidate', undefined]]);
});
