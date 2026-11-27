import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { searchItems, orderForEmptyQuery } from '../src/utils/paletteSearch.js';

const item = (id, extra = {}) => ({
  id, path: `/${id}`, label: id, keywords: id, group: 'pages', ...extra,
});

// Palette item 3 (D-723): live items rank first, above stored recents.
test('orderForEmptyQuery puts live items before stored recents', () => {
  const live = item('order:1', { livePick: true, group: 'orders' });
  const recent = item('page:dashboard');
  const plain = item('page:settings');
  const ordered = orderForEmptyQuery([plain, recent, live], ['page:dashboard']);
  assert.deepEqual(ordered.map((i) => i.id), ['order:1', 'page:dashboard', 'page:settings']);
  assert.equal(ordered[1].recentPick, true);
});

test('orderForEmptyQuery shows a live item once when it is also a stored recent', () => {
  const liveBooking = item('booking:7', { livePick: true, group: 'bookings' });
  const ordered = orderForEmptyQuery([liveBooking, item('page:dashboard')], ['booking:7']);
  assert.deepEqual(ordered.map((i) => i.id), ['booking:7', 'page:dashboard']);
  assert.equal(ordered.filter((i) => i.id === 'booking:7').length, 1);
});

test('searchItems boosts live items above recents and static entries', () => {
  const items = [
    item('page:orders', { label: 'Orders' }),
    item('booking:7', { label: 'Bookings: plumbing', recentPick: true, group: 'bookings' }),
    item('order:9', { label: 'Orders: #9', livePick: true, group: 'orders' }),
  ];
  const ranked = searchItems(items, 'order');
  assert.equal(ranked[0].id, 'order:9');
});

test('searchItems keeps the subsequence match for non-live items', () => {
  const ranked = searchItems([item('page:messages', { label: 'Messages' })], 'msg');
  assert.equal(ranked.length, 1);
});

const registrySource = () => readFile(
  new URL('../src/components/commandPaletteItems.js', import.meta.url),
  'utf8',
);
const paletteSource = () => readFile(
  new URL('../src/components/CommandPalette.jsx', import.meta.url),
  'utf8',
);

test('live fetch hits the caller-scoped endpoints with active/open filters', async () => {
  const source = await registrySource();
  assert.match(source, /export async function fetchLiveItems\(t\)/);
  assert.match(source, /api\.get\('\/orders', \{ params: \{ limit: 10 \} \}/);
  assert.match(source, /OPEN_ORDER_STATUSES\.has\(order\.status\)/);
  assert.match(source, /api\.get\('\/food\/my\/orders', \{ params: \{ status: 'active', limit: MAX_LIVE \} \}/);
  assert.match(source, /ACTIVE_BOOKING_STATUSES\.has\(booking\.status\)/);
  assert.match(source, /group: 'orders'/);
  assert.match(source, /group: 'deliveries'/);
  assert.match(source, /livePick: true/);
});

test('palette refetches live items on every open, not once per mount', async () => {
  const source = await paletteSource();
  assert.doesNotMatch(source, /fetchedRef/);
  assert.match(source, /fetchLiveItems\(t\)/);
  assert.match(source, /fetchDynamicRecents\(t\)/);
});

test('locale parity: the live groups exist in all five locales', async () => {
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(await readFile(
      new URL(`../src/locales/${locale}.json`, import.meta.url),
      'utf8',
    ));
    for (const key of ['orders', 'deliveries']) {
      const value = catalog?.commandPalette?.groups?.[key];
      assert.equal(typeof value, 'string', `${locale}: missing groups.${key}`);
      assert.ok(value.trim().length > 0, `${locale}: empty groups.${key}`);
    }
  }
});
