import test from 'node:test';
import assert from 'node:assert/strict';
import { isNetworkFailure, replayCashOutboxEntries } from '../src/pages/food/offlineCashReplay.js';

test('cash replay removes only completed entries and preserves order after a failure', async () => {
  const entries = [
    { operationId: 'cash-1', attempts: 0 },
    { operationId: 'cash-2', attempts: 1 },
    { operationId: 'cash-3', attempts: 0 },
  ];
  const replayed = [];
  const remaining = await replayCashOutboxEntries(entries, async (entry) => {
    replayed.push(entry.operationId);
    if (entry.operationId === 'cash-2') throw new Error('shift closed');
  });
  assert.deepEqual(replayed, ['cash-1', 'cash-2']);
  assert.deepEqual(remaining, [
    { operationId: 'cash-2', attempts: 2, lastError: 'shift closed' },
    { operationId: 'cash-3', attempts: 0 },
  ]);
});

test('network failures are replayable while server responses remain fail-closed', () => {
  assert.equal(isNetworkFailure({ code: 'ERR_NETWORK' }), true);
  assert.equal(isNetworkFailure({ response: { status: 422 } }), false);
});
