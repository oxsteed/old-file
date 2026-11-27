import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const discoverSource = () => readFile(
  new URL('../src/pages/DiscoverPage.jsx', import.meta.url),
  'utf8',
);
const paletteIndexSource = () => readFile(
  new URL('../src/utils/paletteIndex.js', import.meta.url),
  'utf8',
);

// Palette item 7 (D-727): Discover's "Pages & actions" section is the
// second door of the same index the palette uses.
test('Discover builds its Pages & actions section from the shared pure index', async () => {
  const source = await discoverSource();
  assert.match(source, /import \{ buildPaletteIndex \} from '\.\.\/utils\/paletteIndex'/);
  assert.match(source, /import \{ searchItems \} from '\.\.\/utils\/paletteSearch'/);
  assert.match(source, /useAccessProjection\(user\)/);
  assert.match(source, /t\('discover\.pagesActions'\)/);
  // The section ranks the index against the same query and caps at 8.
  assert.match(source, /searchItems\(entries, query\)\.slice\(0, 8\)/);
  // The /discover entry itself is dropped: it would link to this page.
  assert.match(source, /entry\.path !== '\/discover'/);
  // The section shows even when no typed results match.
  assert.match(source, /!loading && !error && q\.trim\(\) && pageMatches\.length > 0/);
});

test('Discover never imports the admin-layout-bound palette module', async () => {
  const source = await discoverSource();
  assert.doesNotMatch(source, /commandPaletteItems/);
  assert.doesNotMatch(source, /AdminLayout/);
  const index = await paletteIndexSource();
  assert.doesNotMatch(index, /AdminLayout/);
  assert.doesNotMatch(index, /import .*commandPaletteItems/);
});

test('the shared index derives pages from the projection navigation', async () => {
  const source = await paletteIndexSource();
  assert.match(source, /derivePalettePages\(projection\)/);
  assert.match(source, /CLIENT_PAGE_EXTRAS/);
  assert.match(source, /getLaunchRedirect\(entry\.to\)/);
});

test('locale parity: discover.pagesActions exists in all five locales', async () => {
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(await readFile(
      new URL(`../src/locales/${locale}.json`, import.meta.url),
      'utf8',
    ));
    const value = catalog?.discover?.pagesActions;
    assert.equal(typeof value, 'string', `${locale}: missing discover.pagesActions`);
    assert.ok(value.trim().length > 0, `${locale}: empty discover.pagesActions`);
  }
});
