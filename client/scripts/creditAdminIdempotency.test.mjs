import assert from 'node:assert/strict';
import test from 'node:test';
import { createStableIdempotencyKeyStore } from '../src/admin/pages/super/creditIdempotency.js';

test('reuses a key for an identical retry and rotates for changed payloads', () => {
  const keys = createStableIdempotencyKeyStore();
  const firstPayload = { customerId: 'customer-1', amountCents: 290, currencyCode: 'USD' };

  const first = keys.get('credit-load', firstPayload);
  assert.equal(keys.get('credit-load', { ...firstPayload }), first);
  assert.notEqual(keys.get('credit-load', { ...firstPayload, amountCents: 291 }), first);
  assert.notEqual(keys.get('credit-adjustment', firstPayload), first);
});

test('clears a completed operation so the next submission gets a fresh key', () => {
  const keys = createStableIdempotencyKeyStore();
  const payload = { settlementId: 'settlement-1', reason: 'payout returned' };

  const completed = keys.get('credit-settlement-reversal', payload);
  keys.clear('credit-settlement-reversal', payload);

  assert.notEqual(keys.get('credit-settlement-reversal', payload), completed);
});
