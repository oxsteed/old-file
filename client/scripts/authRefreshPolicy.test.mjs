import test from 'node:test';
import assert from 'node:assert/strict';
import { isTransientRefreshFailure } from '../src/api/authRefreshPolicy.js';

function responseError(status) {
  return { response: { status } };
}

test('preserves sessions for infrastructure and rate-limit refresh failures', () => {
  assert.equal(isTransientRefreshFailure(), true);
  assert.equal(isTransientRefreshFailure(new Error('network unavailable')), true);
  assert.equal(isTransientRefreshFailure(responseError(408)), true);
  assert.equal(isTransientRefreshFailure(responseError(429)), true);
  assert.equal(isTransientRefreshFailure(responseError(500)), true);
  assert.equal(isTransientRefreshFailure(responseError(503)), true);
});

test('clears sessions only for definitive authentication failures', () => {
  assert.equal(isTransientRefreshFailure(responseError(400)), false);
  assert.equal(isTransientRefreshFailure(responseError(401)), false);
  assert.equal(isTransientRefreshFailure(responseError(403)), false);
  assert.equal(isTransientRefreshFailure(responseError(404)), false);
});

