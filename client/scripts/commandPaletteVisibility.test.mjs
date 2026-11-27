import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { paletteAllowedDestinations, isPalettePageVisible } from '../src/utils/paletteVisibility.js';

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
  new URL('../src/components/commandPaletteItems.js', import.meta.url),
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
  assert.match(source, /requires: \['\/helper-dashboard'\]/);
  assert.match(source, /requires: \['\/business-hub'\]/);
  assert.match(source, /requires: \['\/logistics\/buyer', '\/logistics\/organizer'\]/);
});

test('registry: buildClientItems gates pages by the projection and leaves actions un-gated', async () => {
  const source = await registrySource();
  assert.match(source, /export function buildClientItems\(t, projection\)/);
  assert.match(source, /paletteAllowedDestinations\(projection\)/);
  assert.match(source, /isPalettePageVisible\(entry, allowed\)/);
});

test('palette: the client dialog passes the access projection into the items', async () => {
  const source = await paletteSource();
  assert.match(source, /useAccessProjection\(user\)/);
  assert.match(source, /buildClientItems\(t, projection\)/);
});
