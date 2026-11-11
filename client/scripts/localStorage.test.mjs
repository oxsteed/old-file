import test from 'node:test';
import assert from 'node:assert/strict';
import { readLocalStorage, writeLocalStorage } from '../src/utils/localStorage.js';
import { hasExplicitLanguagePreference } from '../src/lib/languagePreference.js';

test('local preference access stays usable when storage is blocked', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('storage blocked'); },
  });
  try {
    assert.equal(readLocalStorage('oxs:language'), null);
    writeLocalStorage('oxs:language', 'fr');
    assert.equal(hasExplicitLanguagePreference(), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
