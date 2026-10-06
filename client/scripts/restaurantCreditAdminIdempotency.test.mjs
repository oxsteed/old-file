import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const component = fs.readFileSync(new URL('../src/admin/pages/super/RestaurantCreditAdmin.jsx', import.meta.url), 'utf8');

test('restaurant conversion policy mutations send a stable idempotency key', () => {
  assert.match(component, /createStableIdempotencyKeyStore/);
  assert.match(component, /idempotencyKeysRef\.current\.get\('credit-restaurant-conversion-policy', keyPayload\)/);
  assert.match(component, /headers:\s*\{\s*'Idempotency-Key': idempotencyKeysRef\.current\.get/);
  assert.match(component, /idempotencyKeysRef\.current\.clear\('credit-restaurant-conversion-policy', keyPayload\)/);

  const requestIndex = component.indexOf("adminApi.put('/admin/super/oxsteed-credit/restaurant-conversion-policies'");
  const clearIndex = component.indexOf("idempotencyKeysRef.current.clear('credit-restaurant-conversion-policy', keyPayload)");
  assert.ok(requestIndex >= 0, 'conversion policy request should exist');
  assert.ok(clearIndex > requestIndex, 'the key should be cleared only after the request succeeds');
});
