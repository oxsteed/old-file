// Nov 10 #1 (STILL LIVE): licence tables show "Nothing to show" while
// loading AND on fetch failure (zero .loading references in the licence
// sections). LicenceTable must render distinct loading and error states with
// a retry, and every table backed by a useLicenceGet query must pass its
// loading/error/reload through. The one exemption is the sanctions
// name-search results table, which is local search output, not a query.
//
// Run: node --test scripts/creditLicenceLoadingStates.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFile(join(root, rel), 'utf8');
const LICENCE_DIR = 'src/admin/pages/super/oxsteedCredit/licence';
const CORE_LANGS = ['en', 'es', 'fr', 'ht', 'ar'];

test('LicenceTable renders distinct loading, error and empty states', async () => {
  const shared = await src(`${LICENCE_DIR}/licenceShared.jsx`);
  const table = shared.split('export function LicenceTable')[1].split('export function')[0];
  // Loading beats the empty message while the first fetch is in flight.
  assert.match(table, /if \(loading && \(!rows \|\| rows\.length === 0\)\)/);
  assert.match(table, /t\('adminLicence\.loading'\)/);
  assert.match(table, /role="status"/);
  // A failed fetch shows the error and a retry, not "Nothing to show".
  assert.match(table, /if \(error && \(!rows \|\| rows\.length === 0\)\)/);
  assert.match(table, /role="alert"/);
  assert.match(table, /<ActionButton onClick=\{onRetry\}>/);
  assert.match(table, /t\('adminLicence\.retry'\)/);
  // Rows already on screen survive a background reload; only a first load
  // with no rows yet shows the loading/error states.
  assert.match(table, /if \(!rows \|\| rows\.length === 0\) return <p[^>]*>\{empty \|\| t\('adminLicence\.empty'\)\}<\/p>/);
});

test('every query-backed licence table passes loading, error and onRetry', async () => {
  const files = fs.readdirSync(join(root, LICENCE_DIR)).filter((f) => f.endsWith('Section.jsx'));
  let checked = 0;
  for (const file of files) {
    const section = await src(`${LICENCE_DIR}/${file}`);
    for (const [, block] of section.matchAll(/<LicenceTable([\s\S]*?)\/>/g)) {
      // The sanctions name-search results are local search output, not a
      // query: no loading/error state applies.
      if (/rows=\{matches/.test(block)) continue;
      checked += 1;
      const loading = block.match(/loading=\{(\w+)\.loading\}/);
      assert.ok(loading, `${file}: LicenceTable without loading prop:\n${block}`);
      const query = loading[1];
      assert.match(block, new RegExp(`error=\\{${query}\\.error\\}`), `${file}: error prop must use ${query}`);
      assert.match(block, new RegExp(`onRetry=\\{${query}\\.reload\\}`), `${file}: onRetry prop must use ${query}`);
      // When the rows come straight from a query, the props must name that query.
      const rowsQuery = block.match(/rows=\{[^}]*?(\w+)\.data/);
      if (rowsQuery) assert.equal(rowsQuery[1], query, `${file}: props name ${query} but rows come from ${rowsQuery[1]}`);
    }
  }
  assert.ok(checked >= 20, `expected 20+ query-backed tables, checked ${checked}`);
});

test('the loading and retry labels exist in all five credit catalogs', async () => {
  for (const lang of CORE_LANGS) {
    const catalog = JSON.parse(await src(`src/i18n/locales/${lang}/credit.json`));
    for (const key of ['loading', 'retry']) {
      const value = catalog?.adminLicence?.[key];
      assert.equal(typeof value, 'string', `${lang}: missing adminLicence.${key}`);
      assert.ok(value.length > 0, `${lang}: empty adminLicence.${key}`);
    }
    if (lang !== 'en') {
      assert.notEqual(catalog.adminLicence.loading, 'Loading…', `${lang}: loading is untranslated`);
      assert.notEqual(catalog.adminLicence.retry, 'Retry', `${lang}: retry is untranslated`);
    }
  }
});
