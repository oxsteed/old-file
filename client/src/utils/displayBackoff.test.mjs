import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPLAY_BACKOFF_DEFAULTS,
  computeDisplayBackoffMs,
} from './displayBackoff.js';

test('first failure waits the base delay', () => {
  assert.equal(
    computeDisplayBackoffMs(1, { baseMs: 2000, factor: 2, capMs: 60000 }),
    2000,
  );
});

test('delay doubles per consecutive failure', () => {
  const opts = { baseMs: 2000, factor: 2, capMs: 60000 };
  assert.equal(computeDisplayBackoffMs(2, opts), 4000);
  assert.equal(computeDisplayBackoffMs(3, opts), 8000);
  assert.equal(computeDisplayBackoffMs(4, opts), 16000);
});

test('delay is capped', () => {
  const opts = { baseMs: 2000, factor: 2, capMs: 60000 };
  assert.equal(computeDisplayBackoffMs(10, opts), 60000);
  assert.equal(computeDisplayBackoffMs(100, opts), 60000);
});

test('zero or invalid failure counts behave like the first failure', () => {
  const opts = { baseMs: 2000, factor: 2, capMs: 60000 };
  assert.equal(computeDisplayBackoffMs(0, opts), 2000);
  assert.equal(computeDisplayBackoffMs(-3, opts), 2000);
  assert.equal(computeDisplayBackoffMs(Number.NaN, opts), 2000);
});

test('defaults keep a wall screen retrying at a sane cadence', () => {
  assert.deepEqual(DISPLAY_BACKOFF_DEFAULTS, {
    baseMs: 2000,
    factor: 2,
    capMs: 60000,
  });
  assert.equal(computeDisplayBackoffMs(1), 2000);
  assert.equal(computeDisplayBackoffMs(6), 60000);
});

test('custom schedules are honored', () => {
  assert.equal(
    computeDisplayBackoffMs(3, { baseMs: 1000, factor: 3, capMs: 10000 }),
    9000,
  );
  assert.equal(
    computeDisplayBackoffMs(4, { baseMs: 1000, factor: 3, capMs: 10000 }),
    10000,
  );
});
