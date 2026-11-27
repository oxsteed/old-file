import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { paletteAllowedDestinations, isPalettePageVisible, derivePalettePages } from '../src/utils/paletteVisibility.js';
import { deriveAdaptiveNavigation } from '../src/utils/personaNavigation.js';

const projection = (personal = ['customer'], organizations = [], extra = {}) => ({
  flags: { accessProjection: true },
  access: { personal, organizations, ...extra },
});

test('customer baseline offers dashboard and hides capability pages', () => {
  const allowed = paletteAllowedDestinations(projection());
  assert.ok(allowed.has('/dashboard'));
  assert.ok(allowed.has('/post-job'));
  assert.ok(!allowed.has('/helper-dashboard'));
  assert.ok(!allowed.has('/business-hub'));
  assert.ok(!allowed.has('/logistics/buyer'));
  assert.ok(!allowed.has('/logistics/organizer'));
});

test('helper capability offers the helper dashboard and browse-jobs', () => {
  const allowed = paletteAllowedDestinations(projection(['customer', 'helper.offer_services']));
  assert.ok(allowed.has('/helper-dashboard'));
  assert.ok(allowed.has('/jobs'));
});

test('business owner offers the business hub', () => {
  const allowed = paletteAllowedDestinations(projection(['customer'], [
    { type: 'business', id: 'b1', name: 'Test Biz', role: 'owner' },
  ]));
  assert.ok(allowed.has('/business-hub'));
});

test('logistics capability offers the buyer and organizer destinations', () => {
  const allowed = paletteAllowedDestinations(projection(['customer', 'logistics.ship']));
  assert.ok(allowed.has('/logistics/buyer'));
  assert.ok(allowed.has('/logistics/organizer'));
});

test('a missing or not-ready projection fails closed to the customer baseline', () => {
  for (const p of [null, undefined, {}, { flags: {}, access: null }]) {
    const allowed = paletteAllowedDestinations(p);
    assert.ok(allowed.has('/dashboard'));
    assert.ok(!allowed.has('/helper-dashboard'));
    assert.ok(!allowed.has('/business-hub'));
    assert.ok(!allowed.has('/logistics/buyer'));
  }
});

test('isPalettePageVisible: no requires means always visible, any match shows', () => {
  const customer = paletteAllowedDestinations(projection());
  const helper = paletteAllowedDestinations(projection(['customer', 'helper.offer_services']));
  const logistics = paletteAllowedDestinations(projection(['customer', 'logistics.ship']));
  assert.equal(isPalettePageVisible({ id: 'page:food', path: '/food' }, customer), true);
  assert.equal(isPalettePageVisible({ requires: ['/helper-dashboard'] }, customer), false);
  assert.equal(isPalettePageVisible({ requires: ['/helper-dashboard'] }, helper), true);
  assert.equal(isPalettePageVisible({ requires: ['/logistics/buyer', '/logistics/organizer'] }, customer), false);
  assert.equal(isPalettePageVisible({ requires: ['/logistics/buyer', '/logistics/organizer'] }, logistics), true);
});

// The registry itself (commandPaletteItems.js) cannot be imported in plain
// node --test: it pulls in the admin layout. Pin its annotations by reading
// the source, the same way adaptiveNavbar.test.mjs pins locale parity.
const registrySource = () => readFile(
  new URL('../src/utils/paletteRegistry.js', import.meta.url),
  'utf8',
);
const paletteIndexSource = () => readFile(
  new URL('../src/utils/paletteIndex.js', import.meta.url),
  'utf8',
);
const paletteSource = () => readFile(
  new URL('../src/components/CommandPalette.jsx', import.meta.url),
  'utf8',
);

test('registry: the Discover entry points at /discover, not the old /jobs', async () => {
  const source = await registrySource();
  assert.match(source, /id: 'page:discover', path: '\/discover'/);
  assert.doesNotMatch(source, /id: 'page:discover', path: '\/jobs'/);
});

test('registry: gated pages carry their required destinations', async () => {
  const source = await registrySource();
  // Palette item 1 (D-721): helper-dashboard and business-hub are no
  // longer hand-gated extras; the nav derives them when the projection
  // offers them. /logistics itself is not a nav destination, so it stays
  // a gated extra on its buyer/organizer destinations.
  assert.match(source, /requires: \['\/logistics\/buyer', '\/logistics\/organizer'\]/);
  assert.doesNotMatch(source, /requires: \['\/helper-dashboard'\]/);
  assert.doesNotMatch(source, /requires: \['\/business-hub'\]/);
});

// Palette item 1 (D-721): the index is derived from the projection
// navigation, so every destination the nav renders must appear in it.
test('palette index covers every projection-visible nav entry', () => {
  const cases = [
    ['customer baseline', projection()],
    ['helper', projection(['customer', 'helper.offer_services'])],
    ['business owner', projection(['customer'], [
      { type: 'business', id: 'b1', name: 'Test Biz', role: 'owner' },
    ])],
    ['logistics', projection(['customer', 'logistics.ship'])],
    ['investor', projection(['customer', 'investor.reporting'], [], { investorAudience: true })],
    ['consultant', projection(['customer', 'consultant.accept_paying_clients'])],
    ['staff', projection(['customer', 'admin.access'])],
    ['restaurant owner', projection(['customer'], [
      { type: 'restaurant', id: 'r1', name: 'Test Diner', role: 'owner' },
    ])],
  ];
  for (const [name, p] of cases) {
    const nav = deriveAdaptiveNavigation(p);
    const covered = new Set(derivePalettePages(p).map((entry) => entry.to));
    for (const item of [...nav.primary, ...nav.account]) {
      assert.ok(covered.has(item.to), `${name}: nav destination ${item.to} missing from palette index`);
    }
  }
});

test('palette index is empty for a nonhuman projection (fail closed)', () => {
  const pages = derivePalettePages({
    flags: { accessProjection: true },
    access: { actorType: 'nonhuman', personal: [], organizations: [] },
  });
  assert.equal(pages.length, 0);
});

test('registry: buildClientItems derives pages from the projection navigation', async () => {
  // The assembly moved to the pure paletteIndex.js (palette item 7, D-727)
  // so the Discover page can build the same index without the admin
  // layout; buildClientItems is now a thin delegation.
  const itemsSource = await readFile(
    new URL('../src/components/commandPaletteItems.js', import.meta.url),
    'utf8',
  );
  assert.match(itemsSource, /return buildPaletteIndex\(t, projection\)/);
  const source = await paletteIndexSource();
  assert.match(source, /derivePalettePages\(projection\)/);
  assert.match(source, /CLIENT_PAGE_EXTRAS/);
});

// Palette item 2 (D-722): every keywordsKey the registry references must
// exist as a real string in all five locale catalogs, so no language ever
// falls back to English-only keywords.
test('locale parity: every palette keywords key exists in all five locales', async () => {
  const source = await registrySource();
  const keys = [...new Set([...source.matchAll(/keywordsKey: '(commandPalette\.keywords\.[a-zA-Z]+)'/g)].map((m) => m[1]))];
  assert.ok(keys.length >= 17, `expected at least 17 keywords keys, found ${keys.length}`);
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(await readFile(
      new URL(`../src/locales/${locale}.json`, import.meta.url),
      'utf8',
    ));
    for (const key of keys) {
      const value = catalog?.commandPalette?.keywords?.[key.split('.').pop()];
      assert.equal(typeof value, 'string', `${locale}: missing ${key}`);
      assert.ok(value.trim().length > 0, `${locale}: empty ${key}`);
    }
  }
});

test('registry: buildPaletteIndex gates pages by the projection and leaves actions un-gated', async () => {
  // The gating assembly lives in the pure paletteIndex.js (palette item 7,
  // D-727); buildClientItems delegates to it.
  const source = await paletteIndexSource();
  assert.match(source, /export function buildPaletteIndex\(t, projection\)/);
  assert.match(source, /paletteAllowedDestinations\(projection\)/);
  assert.match(source, /isPalettePageVisible\(entry, allowed\)/);
});

test('palette: the client dialog passes the access projection into the items', async () => {
  const source = await paletteSource();
  assert.match(source, /useAccessProjection\(user\)/);
  assert.match(source, /buildClientItems\(t, projection\)/);
});
