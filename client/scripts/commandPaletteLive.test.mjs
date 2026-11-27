import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { searchItems, orderForEmptyQuery, mergeDiscoverResults } from '../src/utils/paletteSearch.js';

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

// D-728 regression: the per-open-session fetch guard. The live effect's
// deps include `user` by object identity; a caller returning a fresh user
// object on every render (the first-click fixture's useAuth mock) would
// otherwise re-run the effect forever and starve the main thread.
test('live fetch is guarded to once per open session, resetting on close', async () => {
  const source = await paletteSource();
  assert.match(source, /fetchedForOpenRef = useRef\(false\)/);
  assert.match(source, /if \(!open\) \{ fetchedForOpenRef\.current = false;/);
  assert.match(source, /if \(fetchedForOpenRef\.current\) return undefined;/);
  assert.match(source, /fetchedForOpenRef\.current = true;/);
  // The Discover empty branch keeps the previous array when already empty.
  assert.match(source, /setDiscoverItems\(\(prev\) => \(prev\.length === 0 \? prev : \[\]\)\)/);
});

test('locale parity: the live groups exist in all five locales', async () => {
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(await readFile(
      new URL(`../src/locales/${locale}.json`, import.meta.url),
      'utf8',
    ));
    for (const key of ['orders', 'deliveries', 'discover']) {
      const value = catalog?.commandPalette?.groups?.[key];
      assert.equal(typeof value, 'string', `${locale}: missing groups.${key}`);
      assert.ok(value.trim().length > 0, `${locale}: empty groups.${key}`);
    }
  }
});

// Palette item 4 (D-724): Discover results rank after the user's own items.
test('mergeDiscoverResults appends Discover after own items, capped at 5', () => {
  const own = [item('page:jobs', { label: 'Jobs' })];
  const discover = Array.from({ length: 7 }, (_, i) => item(`discover:job:${i}`, {
    label: `Job ${i}`, path: `/jobs/${i}`, group: 'discover',
  }));
  const merged = mergeDiscoverResults(own, discover);
  assert.equal(merged.length, 6);
  assert.equal(merged[0].id, 'page:jobs');
  assert.ok(merged.slice(1).every((i) => i.group === 'discover'));
});

test('mergeDiscoverResults never duplicates an own destination', () => {
  const own = [item('page:jobs', { label: 'Jobs', path: '/jobs' })];
  const discover = [item('discover:job:1', { label: 'Job 1', path: '/jobs', group: 'discover' })];
  assert.deepEqual(mergeDiscoverResults(own, discover).map((i) => i.id), ['page:jobs']);
});

test('live Discover fetch hits /discover with the query, capped at 5', async () => {
  const source = await registrySource();
  assert.match(source, /export async function fetchDiscoverItems\(t, query\)/);
  // The axios instance already carries the /api base URL; hand-writing it
  // would double-prefix to /api/api/discover (apiPrefixGuard).
  assert.match(source, /api\.get\('\/discover', \{ params: \{ q, limit: 5 \} \}/);
  assert.doesNotMatch(source, /api\.get\('\/api\/discover'/);
  assert.match(source, /result\.url\.startsWith\('\/'\)/);
  assert.match(source, /group: 'discover'/);
  assert.match(source, /id: `discover:\$\{result\.type\}:\$\{result\.id\}`/);
});

test('palette dialog debounces Discover and appends it after own items', async () => {
  const source = await paletteSource();
  assert.match(source, /setTimeout\(\(\) => \{\n\s+fetchDiscover\(q\)/);
  assert.match(source, /300\)/);
  assert.match(source, /mergeDiscoverResults\(own, itemsApi\.searchItems\(discoverItems, query\)\)/);
  assert.match(source, /fetchDiscover=\{fetchDiscover\}/);
});
