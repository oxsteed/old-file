import test from 'node:test';
import assert from 'node:assert/strict';
import { readSessionStorage } from '../src/utils/sessionStorage.js';

test('returns the optional value when storage is available', () => {
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: (key) => key === 'token' ? 'value' : null };
  try {
    assert.equal(readSessionStorage('token'), 'value');
    assert.equal(readSessionStorage('missing'), null);
  } finally {
    globalThis.sessionStorage = previous;
  }
});

test('does not block callers when storage access throws', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() { throw new Error('storage blocked'); },
  });
  try {
    assert.equal(readSessionStorage('token'), null);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else delete globalThis.sessionStorage;
  }
});
