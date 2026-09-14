import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CREDIT_CURRENCIES, getCreditMinorUnits } from '../src/lib/creditCurrency.js';

test('Credit admin fallback exposes the complete verified international currency set', () => {
  assert.equal(DEFAULT_CREDIT_CURRENCIES.length, 49);
  assert.equal(new Set(DEFAULT_CREDIT_CURRENCIES).size, 49);
  assert.ok(DEFAULT_CREDIT_CURRENCIES.includes('USD'));
  assert.ok(DEFAULT_CREDIT_CURRENCIES.includes('JPY'));
  assert.ok(DEFAULT_CREDIT_CURRENCIES.includes('KWD'));
  assert.ok(DEFAULT_CREDIT_CURRENCIES.includes('XOF'));
});

test('Credit currency precision handles zero and three minor-unit currencies', () => {
  assert.equal(getCreditMinorUnits('JPY'), 0);
  assert.equal(getCreditMinorUnits('KWD'), 3);
  assert.equal(getCreditMinorUnits('USD'), 2);
});
