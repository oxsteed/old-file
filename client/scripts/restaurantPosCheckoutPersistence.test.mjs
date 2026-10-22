import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutStorageKey, clearPersistedCheckout, readPersistedCheckout, writePersistedCheckout } from '../src/pages/food/posCheckoutPersistence.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('POS checkout identity and ticket survive a reload within the bounded age', () => {
  const storage = memoryStorage();
  const checkout = { ticket: [{ item: { id: 7, name: 'Soup' }, qty: 1 }], checkoutId: 'order-retry-7', checkoutOrder: null };
  assert.equal(writePersistedCheckout('3', checkout, storage, 10_000), true);
  assert.deepEqual(readPersistedCheckout('3', storage, 10_000 + 60_000), { ...checkout, restaurantId: '3', savedAt: 10_000 });
  assert.equal(storage.getItem(checkoutStorageKey('3')) !== null, true);
});

test('stale or cleared checkout state cannot resurrect an abandoned ticket', () => {
  const storage = memoryStorage();
  writePersistedCheckout('3', { ticket: [{ item: { id: 7 } }], checkoutId: 'old' }, storage, 0);
  assert.equal(readPersistedCheckout('3', storage, 2 * 60 * 60 * 1000 + 1), null);
  writePersistedCheckout('3', { ticket: [{ item: { id: 7 } }], checkoutId: 'new' }, storage, 20);
  clearPersistedCheckout('3', storage);
  assert.equal(readPersistedCheckout('3', storage, 20), null);
});
