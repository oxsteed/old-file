// Group 9 Slice G (items 496/497): the driver offline action
// outbox — the per-job localStorage queue that extends the GPS
// queue's pattern to status updates, proof metadata, issue reports,
// and stop completions. Run with:
//   node --test client/src/utils/driverOfflineOutbox.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOutboxExecutors,
  checklistItems,
  discardEntry,
  enqueueAction,
  flushOutbox,
  holdProofFile,
  isNetworkFailure,
  queuedCount,
  readOutbox,
  retryEntry,
} from '../components/delivery/driverOfflineOutbox.js';

function stubStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

function networkError() {
  const error = new Error('Network Error');
  error.code = 'ERR_NETWORK';
  return error;
}

function validationError() {
  const error = new Error('Bad request');
  error.response = { status: 400, data: { code: 'delivery_status_invalid', error: 'Unsupported delivery status' } };
  return error;
}

test('enqueue stores actions in recorded order and counts the queued ones', () => {
  const storage = stubStorage();
  const first = enqueueAction(storage, 7, 'status', { status: 'picked_up' });
  const second = enqueueAction(storage, 7, 'issue', { code: 'delay', description: 'Traffic' });
  enqueueAction(storage, 9, 'status', { status: 'in_transit' });
  assert.equal(queuedCount(storage, 7), 2);
  assert.equal(queuedCount(storage, 9), 1);
  const entries = readOutbox(storage, 7);
  assert.deepEqual(entries.map((entry) => entry.id), [first.id, second.id]);
  assert.ok(entries.every((entry) => entry.state === 'queued'));
});

test('flush runs the queued actions in order and marks them synced', async () => {
  const storage = stubStorage();
  enqueueAction(storage, 7, 'status', { status: 'picked_up' });
  enqueueAction(storage, 7, 'issue', { code: 'delay', description: 'Traffic' });
  const seen = [];
  const executors = {
    status: async () => { seen.push('status'); },
    issue: async () => { seen.push('issue'); },
  };
  const after = await flushOutbox(storage, 7, executors);
  assert.deepEqual(seen, ['status', 'issue']);
  assert.ok(after.every((entry) => entry.state === 'synced'));
  assert.equal(queuedCount(storage, 7), 0);
});

test('flush stops at a network failure and leaves the rest queued', async () => {
  const storage = stubStorage();
  enqueueAction(storage, 7, 'status', { status: 'picked_up' });
  enqueueAction(storage, 7, 'issue', { code: 'delay', description: 'Traffic' });
  const seen = [];
  const executors = {
    status: async () => { throw networkError(); },
    issue: async () => { seen.push('issue'); },
  };
  const after = await flushOutbox(storage, 7, executors);
  assert.deepEqual(seen, []);
  assert.equal(after[0].state, 'queued');
  assert.equal(after[1].state, 'queued');
});

test('flush marks a validation failure as failed and continues with the rest', async () => {
  const storage = stubStorage();
  enqueueAction(storage, 7, 'status', { status: 'bogus' });
  enqueueAction(storage, 7, 'issue', { code: 'delay', description: 'Traffic' });
  const seen = [];
  const executors = {
    status: async () => { throw validationError(); },
    issue: async () => { seen.push('issue'); },
  };
  const after = await flushOutbox(storage, 7, executors);
  assert.deepEqual(seen, ['issue']);
  assert.equal(after[0].state, 'failed');
  assert.match(after[0].error, /Unsupported delivery status/);
  assert.equal(after[1].state, 'synced');
});

test('a failed entry can be retried or explicitly discarded, never silently dropped', async () => {
  const storage = stubStorage();
  const entry = enqueueAction(storage, 7, 'status', { status: 'bogus' });
  const executors = { status: async () => { throw validationError(); } };
  await flushOutbox(storage, 7, executors);
  assert.equal(readOutbox(storage, 7)[0].state, 'failed');
  retryEntry(storage, 7, entry.id);
  assert.equal(readOutbox(storage, 7)[0].state, 'queued');
  discardEntry(storage, 7, entry.id);
  assert.deepEqual(readOutbox(storage, 7), []);
});

test('a photo proof without its held file fails as needsFile; with the file it uploads then delivers', async () => {
  const storage = stubStorage();
  const calls = [];
  const api = {
    updateDeliveryStatus: async (jobId, status, details) => { calls.push(['status', status, details]); },
    uploadDeliveryProof: async (jobId, file, proofType) => { calls.push(['upload', file.name, proofType]); return { uploadId: 'up-1' }; },
    reportDeliveryIssue: async () => { throw new Error('unexpected'); },
    completeDeliveryStop: async () => { throw new Error('unexpected'); },
  };
  const executors = buildOutboxExecutors(7, api);

  const missing = enqueueAction(storage, 7, 'proof', { proofType: 'photo' });
  await flushOutbox(storage, 7, executors);
  const failed = readOutbox(storage, 7).find((entry) => entry.id === missing.id);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.needsFile, true);

  const held = enqueueAction(storage, 7, 'proof', { proofType: 'photo' });
  holdProofFile(held.id, { name: 'proof.jpg' });
  await flushOutbox(storage, 7, executors);
  const synced = readOutbox(storage, 7).find((entry) => entry.id === held.id);
  assert.equal(synced.state, 'synced');
  assert.deepEqual(calls, [
    ['upload', 'proof.jpg', 'photo'],
    ['status', 'delivered', { proofType: 'photo', uploadId: 'up-1', idempotencyKey: `delivery-outbox:${held.id}` }],
  ]);
});

test('replayed calls carry a stable idempotency key per queued entry', async () => {
  const storage = stubStorage();
  const entry = enqueueAction(storage, 7, 'status', { status: 'picked_up', pickupConfirmedPieces: 3 });
  const seen = [];
  const api = {
    updateDeliveryStatus: async (jobId, status, details) => { seen.push(details); },
    reportDeliveryIssue: async () => {},
    completeDeliveryStop: async () => {},
    uploadDeliveryProof: async () => ({ uploadId: 'up-1' }),
  };
  await flushOutbox(storage, 7, buildOutboxExecutors(7, api));
  assert.equal(seen[0].idempotencyKey, `delivery-outbox:${entry.id}`);
  assert.equal(seen[0].pickupConfirmedPieces, 3);
});

test('a stop-complete replay that 409s as already done counts as success', async () => {
  const storage = stubStorage();
  enqueueAction(storage, 7, 'stop_complete', { stopId: 42 });
  const conflict = new Error('already done');
  conflict.response = { status: 409, data: { code: 'delivery_stop_conflict' } };
  const api = {
    updateDeliveryStatus: async () => {},
    reportDeliveryIssue: async () => {},
    completeDeliveryStop: async () => { throw conflict; },
    uploadDeliveryProof: async () => ({ uploadId: 'up-1' }),
  };
  const after = await flushOutbox(storage, 7, buildOutboxExecutors(7, api));
  assert.equal(after[0].state, 'synced');
});

test('isNetworkFailure separates a dropped connection from a server rejection', () => {
  assert.equal(isNetworkFailure(networkError()), true);
  assert.equal(isNetworkFailure(validationError()), false);
  assert.equal(isNetworkFailure(null), false);
});

test('checklistItems derives done / queued / failed / pending from the job, stops, and outbox', () => {
  const job = { status: 'assigned', pieces: 3 };
  const stops = [
    { id: 1, label: 'Pickup', status: 'completed', completed_at: '2026-11-20T00:00:00Z' },
    { id: 2, label: 'Dropoff', status: 'pending', completed_at: null },
  ];
  const entries = [
    { id: 'a', kind: 'status', payload: { status: 'picked_up' }, state: 'queued' },
    { id: 'b', kind: 'stop_complete', payload: { stopId: 2 }, state: 'failed' },
  ];
  const items = checklistItems(job, stops, entries);
  const byKey = Object.fromEntries(items.map((item) => [item.key, item.state]));
  assert.equal(byKey.pickup, 'queued');
  assert.equal(byKey['stop:1'], 'done');
  assert.equal(byKey['stop:2'], 'failed');
  assert.equal(byKey.in_transit, 'pending');
  assert.equal(byKey.proof, 'pending');

  const delivered = checklistItems({ status: 'delivered', picked_up_at: '2026-11-20T00:00:00Z' }, [], []);
  assert.deepEqual(Object.fromEntries(delivered.map((item) => [item.key, item.state])), {
    pickup: 'done', in_transit: 'done', proof: 'done',
  });
});
