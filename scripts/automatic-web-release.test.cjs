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
  const result = applyBridgeSchema({
    gitSha: 'b'.repeat(40), runId: '22',
    list: () => 'one two',
    inspect: id => JSON.stringify({ Config: { Labels: {
      'org.opencontainers.image.revision': id === 'one' ? 'b'.repeat(40) : 'other',
      'com.oxsteed.release.kind': 'schema-bridge',
    } } }),
    exec: () => JSON.stringify({ ok: true, pending: [], applied: [
      '20261108173000_franchise_royalty_redrive.sql',
      '20261109080000_customer360_worker_heartbeats.sql',
    ] }),
    combinedList: () => 'combined',
    copyManifest: () => {},
    verifyCombined: () => ({ status: 'ready' }),
  });
  assert.equal(result.status, 'schema_applied');
  assert.equal(applyBridgeSchema({ gitSha: 'b'.repeat(40), runId: '22', list: () => 'one two', inspect: () => JSON.stringify({ Config: { Labels: { 'org.opencontainers.image.revision': 'b'.repeat(40), 'com.oxsteed.release.kind': 'schema-bridge' } } }) }).status, 'waiting_for_schema_apply');
});

test('automatic promotion bridges, applies, then retries the exact candidate', async () => {
  const promoted = [];
  const result = await promoteAutomatic('candidate', {
    api: () => ({ workflow_runs: [{ id: 7, head_sha: 'c'.repeat(40), event: 'workflow_dispatch', status: 'completed', conclusion: 'success' }] }),
    promote: async (runId, options) => {
      promoted.push([runId, options]);
      if (runId === 'candidate') return promoted.length > 2 ? { status: 'finished' } : { status: 'waiting_for_schema', gitSha: 'c'.repeat(40) };
      return { status: 'already_current' };
    },
    applySchema: () => ({ status: 'schema_applied' }),
  });
  assert.equal(result.status, 'finished');
  assert.deepEqual(promoted, [['candidate', undefined], ['7', { bridge: true }], ['candidate', undefined]]);
});
