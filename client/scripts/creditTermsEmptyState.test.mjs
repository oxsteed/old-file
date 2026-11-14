import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'src/pages/CreditTermsPage.jsx'), 'utf8');

// Domain 1 audit finding 11 (Nov 10, 2026): with zero disclosures the
// public terms page rendered a blank body, and the error branch was a
// bare alert with no retry (recovery required changing currency or
// language). The page must show an empty-state line when ready with no
// items, and a Retry button on error that re-runs the fetch.

test('ready with zero disclosures renders an empty-state line', () => {
  assert.match(
    src,
    /state\.items\.length === 0/,
    'page must branch on an empty items array',
  );
  assert.match(
    src,
    /creditTermsPage\.noTerms/,
    'empty state must use the creditTermsPage.noTerms string',
  );
});

test('error branch offers a Retry button that re-runs the fetch', () => {
  const errorBranch = src.match(/state\.status === 'error' &&[\s\S]*?(?=\n\s*\{state\.status === 'ready')/);
  assert.ok(errorBranch, 'error branch not found');
  assert.match(errorBranch[0], /<button[^>]*>/, 'error branch must render a button');
  assert.match(errorBranch[0], /t\('creditTermsPage\.retry'\)/, 'retry button must use the creditTermsPage.retry string');
  assert.match(
    src,
    /retryNonce/,
    'retry must re-trigger the disclosures fetch (retry nonce in the effect deps)',
  );
  assert.match(
    src,
    /\[lang, currency, retryNonce\]/,
    'fetch effect must depend on the retry nonce',
  );
});

test('empty-state string exists in all five locales', () => {
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(readFileSync(path.join(root, `src/locales/${locale}.json`), 'utf8'));
    for (const key of ['noTerms', 'retry']) {
      assert.equal(
        typeof catalog.creditTermsPage?.[key],
        'string',
        `creditTermsPage.${key} missing in ${locale}`,
      );
      assert.ok(catalog.creditTermsPage[key].length > 0, `empty ${key} in ${locale}`);
    }
  }
});
