import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('W11 queue controls retain five-language catalog parity and page interpolation', () => {
  for (const language of ['en', 'es', 'fr', 'ht', 'ar']) {
    const legacy = JSON.parse(fs.readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8')).reviewW11Learn;
    const namespaced = JSON.parse(fs.readFileSync(new URL(`../src/i18n/locales/${language}/common.json`, import.meta.url), 'utf8')).reviewW11Learn;
    assert.deepEqual(namespaced, legacy);
    assert.ok(legacy.previousPage.length && legacy.nextPage.length);
    assert.match(legacy.pageNumber, /\{\{page\}\}/);
    assert.equal(legacy.pageNumber.match(/\{\{page\}\}/g).length, 1);
  }
});
