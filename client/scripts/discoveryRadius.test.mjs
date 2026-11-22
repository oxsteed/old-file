// Group 4 Slice B (item 163): seeding the /jobs radius filter from the
// helper's saved distance preference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidRadiusMiles, resolveSeededRadius } from '../src/utils/discoveryRadius.js';

test('isValidRadiusMiles accepts the stored 1-250 range only', () => {
  for (const value of [1, 25, 50, 250]) assert.equal(isValidRadiusMiles(value), true);
  for (const value of [0, 251, -5, 25.5, '25', null, undefined, NaN]) assert.equal(isValidRadiusMiles(value), false);
});

test('resolveSeededRadius: a saved session radius wins over the preference', () => {
  assert.equal(resolveSeededRadius({ savedRadius: 50, preference: 10 }), 50);
});

test('resolveSeededRadius: the saved preference wins over the built-in default', () => {
  assert.equal(resolveSeededRadius({ savedRadius: null, preference: 60 }), 60);
  assert.equal(resolveSeededRadius({ preference: 60 }), 60);
});

test('resolveSeededRadius: an invalid preference falls back to the default', () => {
  assert.equal(resolveSeededRadius({ savedRadius: null, preference: 0 }), 25);
  assert.equal(resolveSeededRadius({ savedRadius: null, preference: 251 }), 25);
  assert.equal(resolveSeededRadius({ savedRadius: null, preference: null }), 25);
  assert.equal(resolveSeededRadius({}), 25);
});

test('resolveSeededRadius: an invalid saved radius does not block the preference', () => {
  assert.equal(resolveSeededRadius({ savedRadius: 0, preference: 40 }), 40);
  assert.equal(resolveSeededRadius({ savedRadius: 300, preference: 40 }), 40);
});

test('resolveSeededRadius: an explicit fallback is honored', () => {
  assert.equal(resolveSeededRadius({ savedRadius: null, preference: null, fallback: 10 }), 10);
});
