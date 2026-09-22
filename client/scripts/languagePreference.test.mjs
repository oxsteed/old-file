import test from 'node:test';
import assert from 'node:assert/strict';
import { hasExplicitLanguagePreference } from '../src/lib/languagePreference.js';

test('server language does not replace a saved local language choice', () => {
  const storage = { getItem: (key) => (key === 'oxs:language' ? 'ar' : null) };
  assert.equal(hasExplicitLanguagePreference(storage), true);
});

test('server language can initialize a user without a saved local choice', () => {
  const storage = { getItem: () => null };
  assert.equal(hasExplicitLanguagePreference(storage), false);
  assert.equal(hasExplicitLanguagePreference(null), false);
});
