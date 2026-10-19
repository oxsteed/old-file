import test from 'node:test';
import assert from 'node:assert/strict';
import { isWakeLockSupported } from './displayWakeLock.js';

test('supported when wakeLock.request is a function', () => {
  assert.equal(
    isWakeLockSupported({ wakeLock: { request: async () => ({}) } }),
    true,
  );
});

test('unsupported on iPad Safari and other browsers without the API', () => {
  assert.equal(isWakeLockSupported({}), false);
  assert.equal(isWakeLockSupported({ wakeLock: {} }), false);
  assert.equal(
    isWakeLockSupported({ wakeLock: { request: 'screen' } }),
    false,
  );
  assert.equal(isWakeLockSupported(null), false);
  assert.equal(isWakeLockSupported(undefined), false);
});
