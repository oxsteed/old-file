import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const locales = ['en', 'es', 'fr', 'ht', 'ar'];

test('profile visibility interpolation uses react-i18next placeholders in every locale', () => {
  for (const locale of locales) {
    const catalog = JSON.parse(
      fs.readFileSync(path.resolve(`src/locales/${locale}.json`), 'utf8'),
    ).adminProfileVisibility;
    assert.ok(catalog, `${locale} is missing adminProfileVisibility`);
    for (const [key, value] of Object.entries(catalog)) {
      if (typeof value !== 'string') continue;
      assert.doesNotMatch(
        value,
        /(?<!\{)\{[^{}]+\}(?!\})/,
        `${locale} adminProfileVisibility.${key} contains a single-brace placeholder`,
      );
    }
  }
});
