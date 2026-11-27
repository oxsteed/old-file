/**
 * Item registry, fuzzy search, and recents for the global command palette
 * (Cmd+K / Ctrl+K). Client-only; the admin tab list is built from the admin
 * navigation contract so labels and grant gates stay in one place.
 */
import api from '../api/axios';
import { REGULAR_NAV, SUPER_NAV } from '../admin/layouts/AdminLayout';
import { getLaunchRedirect } from '../utils/launchScope';
import { paletteAllowedDestinations, isPalettePageVisible, derivePalettePages } from '../utils/paletteVisibility';

// Search, scoring, and recents live in the pure module so they are
// unit-testable with plain node --test; re-exported here so the lazy
// palette module keeps one API.
export { RECENT_STORAGE_KEY, fuzzyScore, searchItems, readRecentIds, pushRecentId, orderForEmptyQuery, mergeDiscoverResults } from '../utils/paletteSearch';

const MAX_DYNAMIC = 5;
const MAX_LIVE = 5;

// Pages the app offers that the projection navigation does not render.
// The palette index itself is derived from the navigation (palette item 1,
// D-721): buildClientItems takes every nav destination first, then adds
// these extras only for paths the nav does not already cover. An extra
// with `requires` still shows only when the projection offers one of those
// destinations. labelKey reuses existing `nav.*` keys where they exist;
// the rest live under `commandPalette.pages.*` in every locale.
const CLIENT_PAGE_EXTRAS = [
  { id: 'page:bookings', path: '/my-bookings', labelKey: 'commandPalette.pages.bookings', keywordsKey: 'commandPalette.keywords.bookings' },
  { id: 'page:browse-jobs', path: '/jobs', labelKey: 'nav.browseJobs', keywordsKey: 'commandPalette.keywords.browseJobs' },
  { id: 'page:calendar', path: '/calendar', labelKey: 'nav.calendar', keywordsKey: 'commandPalette.keywords.calendar' },
  { id: 'page:food', path: '/food', labelKey: 'commandPalette.pages.food', keywordsKey: 'commandPalette.keywords.food' },
  { id: 'page:tool-rentals', path: '/tool-rentals', labelKey: 'commandPalette.pages.toolRentals', keywordsKey: 'commandPalette.keywords.toolRentals' },
  { id: 'page:direct', path: '/direct', labelKey: 'commandPalette.pages.direct', keywordsKey: 'commandPalette.keywords.direct' },
  // Universal finder step 1: the Discover entry points at the live /discover
  // route (the homepage submit has since PR #815). While discoverEverything
  // is off, the launch-redirect filter below hides it and /jobs stays
  // reachable through the browse-jobs entry.
  { id: 'page:discover', path: '/discover', labelKey: 'commandPalette.pages.discover', keywordsKey: 'commandPalette.keywords.discover' },
  { id: 'page:invoices', path: '/invoices', labelKey: 'commandPalette.pages.invoices', keywordsKey: 'commandPalette.keywords.invoices' },
  { id: 'page:disputes', path: '/disputes', labelKey: 'commandPalette.pages.disputes', keywordsKey: 'commandPalette.keywords.disputes' },
  // Universal finder step 1: `requires` lists projection-derived
  // destinations; the entry shows only when the projection offers one of
  // them. /logistics itself is not a nav destination (only its buyer and
  // organizer pages are), so it stays a gated extra.
  { id: 'page:logistics', path: '/logistics', labelKey: 'nav.logistics', keywordsKey: 'commandPalette.keywords.logistics', requires: ['/logistics/buyer', '/logistics/organizer'] },
  { id: 'page:activity', path: '/activity', labelKey: 'commandPalette.pages.activity', keywordsKey: 'commandPalette.keywords.activity' },
];

const CLIENT_ACTIONS = [
  { id: 'action:new-booking', path: '/helpers', labelKey: 'commandPalette.actions.newBooking', keywordsKey: 'commandPalette.keywords.newBooking' },
  { id: 'action:new-job', path: '/post-job', labelKey: 'commandPalette.actions.newJob', keywordsKey: 'commandPalette.keywords.newJob' },
  { id: 'action:new-quote', path: '/quote-request', labelKey: 'commandPalette.actions.newQuote', keywordsKey: 'commandPalette.keywords.newQuote' },
  { id: 'action:order-food', path: '/food', labelKey: 'commandPalette.actions.orderFood', keywordsKey: 'commandPalette.keywords.orderFood' },
  { id: 'action:open-wallet', path: '/wallet', labelKey: 'commandPalette.actions.openWallet', keywordsKey: 'commandPalette.keywords.openWallet' },
  { id: 'action:get-support', path: '/support', labelKey: 'commandPalette.actions.getSupport', keywordsKey: 'commandPalette.keywords.getSupport' },
];

export function buildClientItems(t, projection) {
  // Review P1-222: don't offer pages the launch scope redirects away
  // (e.g. /discover while discoverEverything is off).
  // Palette item 1 (D-721): the page index is derived from the projection
  // navigation, the same navigation the navbar renders. Every nav
  // destination becomes a palette page with the nav's own label, so a page
  // the user can see is always findable. A missing or not-ready projection
  // fails closed to the customer baseline (D-614). Curated extras below
  // fill only the paths the nav does not render; an extra carrying
  // `requires` still shows only when the projection offers one of those
  // destinations.
  const allowed = paletteAllowedDestinations(projection);
  const pages = [];
  const seen = new Set();
  for (const entry of derivePalettePages(projection)) {
    if (getLaunchRedirect(entry.to)) continue;
    const label = t(entry.labelKey);
    seen.add(entry.to);
    pages.push({
      id: entry.id,
      path: entry.to,
      label,
      keywords: `${label} ${entry.to}`,
      group: 'pages',
    });
  }
  for (const entry of CLIENT_PAGE_EXTRAS) {
    if (seen.has(entry.path) || getLaunchRedirect(entry.path)) continue;
    if (!isPalettePageVisible(entry, allowed)) continue;
    seen.add(entry.path);
    pages.push({
      id: entry.id,
      path: entry.path,
      label: t(entry.labelKey),
      // Palette item 2 (D-722): keywords are localized strings from the
      // catalog, resolved here; English is the i18n fallback (fallbackLng).
      keywords: t(entry.keywordsKey),
      group: 'pages',
    });
  }
  // D-612: actions are application entries (post a job, order food, get
  // support). They stay visible to every account, un-gated, so a user can
  // always find the way in to something they cannot do yet.
  const actions = CLIENT_ACTIONS.map((entry) => ({
    id: entry.id,
    path: entry.path,
    label: t(entry.labelKey),
    keywords: t(entry.keywordsKey),
    group: 'actions',
  }));
  return { pages, actions };
}

/**
 * Admin tabs from the admin navigation contract, with the same grant gating
 * AdminLayout applies: super admins see everything; regular admins only see
 * entries backed by one of their scopes.
 */
export function buildAdminItems(t, { isSuper, scopes }) {
  const items = [];
  const visible = (entry, superSection) => (superSection
    ? (isSuper || (entry.grant && scopes.includes(entry.grant)))
    : (!entry.grant || isSuper || scopes.includes(entry.grant)));
  const pushSection = (nav, superSection) => {
    for (const entry of nav) {
      if (!visible(entry, superSection)) continue;
      items.push({
        id: `admin:${entry.to}`,
        path: entry.to,
        label: t(entry.labelKey),
        keywords: entry.to,
        group: 'admin',
      });
    }
  };
  pushSection(REGULAR_NAV, false);
  pushSection(SUPER_NAV, true);
  return items;
}

function bookingLabel(booking, t) {
  const name = booking.service_name || booking.title || booking.helper_name
    || booking.business_name || `#${booking.id}`;
  return `${t('commandPalette.pages.bookings')}: ${name}`;
}

function conversationLabel(conversation, t) {
  const name = conversation.job_title || conversation.subject || conversation.title
    || `#${conversation.id}`;
  return `${t('nav.messages')}: ${name}`;
}

function orderLabel(order, t) {
  return `${t('commandPalette.pages.orders')}: #${order.id}`;
}

function deliveryLabel(order, t) {
  const name = order.restaurant_name || `#${order.id}`;
  return `${name} · #${order.id}`;
}

// Every live endpoint below is caller-scoped server-side (customer_id or
// the caller's own rows) and fails closed to [] on error, so the palette
// never surfaces another user's orders, bookings, or conversations. This
// is the fail-closed scope rule: a missing or failed scope yields
// nothing, never everything.
async function loadBookings() {
  return api.get('/bookings', { params: { limit: 10 } })
    .then(({ data }) => (Array.isArray(data?.data) ? data.data : []))
    .catch(() => []);
}

async function loadConversations() {
  return api.get('/messages/conversations', { params: { limit: MAX_DYNAMIC } })
    .then(({ data }) => {
      const payload = data?.data ?? data;
      return Array.isArray(payload) ? payload : (payload?.conversations || []);
    })
    .catch(() => []);
}

/** Lazily fetch the user's most recent bookings and conversations. Never throws. */
export async function fetchDynamicRecents(t) {
  const [bookings, conversations] = await Promise.all([
    loadBookings().then((list) => list.slice(0, MAX_DYNAMIC).map((booking) => ({
      id: `booking:${booking.id}`,
      path: '/my-bookings',
      label: bookingLabel(booking, t),
      keywords: 'booking appointment reservation',
      group: 'bookings',
    }))),
    loadConversations().then((list) => list.slice(0, MAX_DYNAMIC).map((conversation) => ({
      id: `conversation:${conversation.id}`,
      path: `/messages/${conversation.id}`,
      label: conversationLabel(conversation, t),
      keywords: 'message chat conversation',
      group: 'conversations',
    }))),
  ]);
  return [...bookings, ...conversations];
}

// Open marketplace orders: pending, paid, processing. Completed, cancelled,
// and refunded orders are history, not live.
const OPEN_ORDER_STATUSES = new Set(['pending', 'paid', 'processing']);
// Active bookings: anything not terminally closed.
const ACTIVE_BOOKING_STATUSES = new Set(['pending', 'accepted', 'confirmed', 'in_progress']);

/**
 * Live items for the palette (palette item 3, D-723): the user's own open
 * orders, food deliveries in transit, active bookings, and conversations.
 * Ranked live-first by the pure ordering; never throws.
 */
export async function fetchLiveItems(t) {
  const [orders, deliveries, bookings, conversations] = await Promise.all([
    api.get('/orders', { params: { limit: 10 } })
      .then(({ data }) => {
        const list = Array.isArray(data?.data) ? data.data : [];
        return list
          .filter((order) => OPEN_ORDER_STATUSES.has(order.status))
          .slice(0, MAX_LIVE)
          .map((order) => ({
            id: `order:${order.id}`,
            path: `/marketplace/orders/${order.id}`,
            label: orderLabel(order, t),
            keywords: 'order purchase',
            group: 'orders',
            livePick: true,
          }));
      })
      .catch(() => []),
    api.get('/food/my/orders', { params: { status: 'active', limit: MAX_LIVE } })
      .then(({ data }) => {
        const list = Array.isArray(data?.orders) ? data.orders : [];
        return list.slice(0, MAX_LIVE).map((order) => ({
          id: `delivery:${order.id}`,
          path: `/food/orders/${order.id}`,
          label: deliveryLabel(order, t),
          keywords: 'delivery food order tracking',
          group: 'deliveries',
          livePick: true,
        }));
      })
      .catch(() => []),
    loadBookings().then((list) => list
      .filter((booking) => ACTIVE_BOOKING_STATUSES.has(booking.status))
      .slice(0, MAX_LIVE)
      .map((booking) => ({
        id: `booking:${booking.id}`,
        path: '/my-bookings',
        label: bookingLabel(booking, t),
        keywords: 'booking appointment reservation',
        group: 'bookings',
        livePick: true,
      }))),
    loadConversations().then((list) => list.slice(0, MAX_DYNAMIC).map((conversation) => ({
      id: `conversation:${conversation.id}`,
      path: `/messages/${conversation.id}`,
      label: conversationLabel(conversation, t),
      keywords: 'message chat conversation',
      group: 'conversations',
      livePick: true,
    }))),
  ]);
  return [...orders, ...deliveries, ...bookings, ...conversations];
}

/**
 * Live Discover results for the palette (palette item 4, D-724): the same
 * `/discover` search the Discover page runs, capped at 5. Results carry
 * their own `url`, so the palette navigates straight to the result. Only
 * relative in-app URLs are kept; anything else is dropped. Never throws.
 * The caller ranks these after the user's own items (mergeDiscoverResults).
 */
export async function fetchDiscoverItems(t, query) {
  const q = String(query || '').trim();
  if (!q) return [];
  return api.get('/discover', { params: { q, limit: 5 } })
    .then(({ data }) => {
      const list = Array.isArray(data?.results) ? data.results : [];
      return list
        .filter((result) => result && typeof result.url === 'string' && result.url.startsWith('/'))
        .slice(0, 5)
        .map((result) => ({
          id: `discover:${result.type}:${result.id}`,
          path: result.url,
          label: result.title || result.url,
          keywords: `${result.subtitle || ''} ${result.type || ''}`,
          group: 'discover',
        }));
    })
    .catch(() => []);
}
