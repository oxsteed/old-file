import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CREDIT_CURRENCIES,
  getCreditMinorUnits,
  parseCreditMajorAmount,
  parseOptionalCreditMajorAmount,
} from '../src/lib/creditCurrency.js';

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

test('Credit amount parsing uses exact decimal arithmetic for each currency precision', () => {
  assert.equal(parseCreditMajorAmount('0.29', 'USD'), 29);
  assert.equal(parseCreditMajorAmount('1.005', 'KWD'), 1005);
  assert.equal(parseCreditMajorAmount('125', 'JPY'), 125);
  assert.equal(parseCreditMajorAmount('10.5', 'JPY'), null);
  assert.equal(parseCreditMajorAmount('0.001', 'USD'), null);
});

test('Credit amount parsing rejects values outside the safe minor-unit range', () => {
  assert.equal(parseCreditMajorAmount('90071992547409.91', 'USD'), Number.MAX_SAFE_INTEGER);
  assert.equal(parseCreditMajorAmount('90071992547409.92', 'USD'), null);
});

test('optional Credit limits distinguish blank input from invalid input', () => {
  assert.deepEqual(parseOptionalCreditMajorAmount('', 'USD'), { value: null, valid: true });
  assert.deepEqual(parseOptionalCreditMajorAmount('   ', 'USD'), { value: null, valid: true });
  assert.deepEqual(parseOptionalCreditMajorAmount('not-an-amount', 'USD'), { value: null, valid: false });
  assert.deepEqual(parseOptionalCreditMajorAmount('0.29', 'USD'), { value: 29, valid: true });
});
