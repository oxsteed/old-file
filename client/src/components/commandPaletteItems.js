/**
 * Item registry, fuzzy search, and recents for the global command palette
 * (Cmd+K / Ctrl+K). Client-only; the admin tab list is built from the admin
 * navigation contract so labels and grant gates stay in one place.
 */
import api from '../api/axios';
import { REGULAR_NAV, SUPER_NAV } from '../admin/layouts/AdminLayout';

export const RECENT_STORAGE_KEY = 'oxsteed:cmdk:recent';
const MAX_RECENT = 8;
const MAX_DYNAMIC = 5;

/**
 * Subsequence fuzzy score. Higher is better; -1 means no match. Word starts
 * and consecutive runs score more so "msg" ranks "Messages" above "Images".
 */
export function fuzzyScore(query, text) {
  const q = String(query || '').toLowerCase();
  const t = String(text || '').toLowerCase();
  if (!q) return 0;
  let qi = 0;
  let score = 0;
  let lastIndex = -1;
  let run = 0;
  for (let i = 0; i < t.length && qi < q.length; i += 1) {
    if (t[i] === q[qi]) {
      const wordStart = i === 0 || /[\s\-_/.:]/.test(t[i - 1]);
      score += wordStart ? 4 : 1;
      if (lastIndex === i - 1) {
        run += 1;
        score += run;
      } else {
        run = 0;
      }
      lastIndex = i;
      qi += 1;
    }
  }
  return qi === q.length ? score : -1;
}

/** Rank items against a query across label, keywords, and path. */
export function searchItems(items, query) {
  const q = String(query || '').trim();
  if (!q) return items;
  const scored = [];
  for (const item of items) {
    const haystack = `${item.label} ${item.keywords || ''} ${item.path || ''}`;
    const score = fuzzyScore(q, haystack);
    if (score >= 0) scored.push({ item, score: score + (item.recentPick ? 60 : 0) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ item }) => item);
}

export function readRecentIds() {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === 'string').slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function pushRecentId(id) {
  try {
    const ids = [id, ...readRecentIds().filter((existing) => existing !== id)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Private mode or unavailable storage: recents are a nicety, not a must.
  }
}

// Curated client pages. labelKey reuses existing `nav.*` keys where they
// exist; the rest live under `commandPalette.pages.*` in every locale.
const CLIENT_PAGES = [
  { id: 'page:dashboard', path: '/dashboard', labelKey: 'nav.dashboard', keywords: 'home overview' },
  { id: 'page:messages', path: '/messages', labelKey: 'nav.messages', keywords: 'chat inbox conversations' },
  { id: 'page:bookings', path: '/my-bookings', labelKey: 'commandPalette.pages.bookings', keywords: 'appointments reservations schedule' },
  { id: 'page:jobs', path: '/my-jobs', labelKey: 'commandPalette.pages.jobs', keywords: 'my gigs work posted' },
  { id: 'page:browse-jobs', path: '/jobs', labelKey: 'nav.browseJobs', keywords: 'find work gigs hiring' },
  { id: 'page:helpers', path: '/helpers', labelKey: 'commandPalette.pages.helpers', keywords: 'hire pros services professionals' },
  { id: 'page:calendar', path: '/calendar', labelKey: 'nav.calendar', keywords: 'schedule appointments availability' },
  { id: 'page:food', path: '/food', labelKey: 'commandPalette.pages.food', keywords: 'order delivery eat restaurants' },
  { id: 'page:restaurants', path: '/restaurants', labelKey: 'commandPalette.pages.restaurants', keywords: 'directory dine food places' },
  { id: 'page:tool-rentals', path: '/tool-rentals', labelKey: 'commandPalette.pages.toolRentals', keywords: 'rent tools equipment borrow' },
  { id: 'page:direct', path: '/direct', labelKey: 'commandPalette.pages.direct', keywords: 'services catalog quote request' },
  { id: 'page:learn', path: '/learn', labelKey: 'nav.learnToDiy', keywords: 'guides diy tutorials videos how to' },
  { id: 'page:discover', path: '/discover', labelKey: 'commandPalette.pages.discover', keywords: 'explore search browse' },
  { id: 'page:wallet', path: '/wallet', labelKey: 'nav.wallet', keywords: 'money balance funds' },
  { id: 'page:credit', path: '/oxsteed-credit', labelKey: 'commandPalette.pages.credit', keywords: 'oxsteed credit balance wallet' },
  { id: 'page:orders', path: '/orders', labelKey: 'commandPalette.pages.orders', keywords: 'purchases history food' },
  { id: 'page:invoices', path: '/invoices', labelKey: 'commandPalette.pages.invoices', keywords: 'bills receipts payments' },
  { id: 'page:disputes', path: '/disputes', labelKey: 'commandPalette.pages.disputes', keywords: 'arbitration claims resolution' },
  { id: 'page:support', path: '/support', labelKey: 'commandPalette.pages.support', keywords: 'help tickets contact' },
  { id: 'page:logistics', path: '/logistics', labelKey: 'nav.logistics', keywords: 'shipping freight supply' },
  { id: 'page:business-hub', path: '/business-hub', labelKey: 'commandPalette.pages.businessHub', keywords: 'merchant manage business' },
  { id: 'page:helper-dashboard', path: '/helper-dashboard', labelKey: 'commandPalette.pages.helperDashboard', keywords: 'pro helper work earnings' },
  { id: 'page:network', path: '/network', labelKey: 'commandPalette.pages.network', keywords: 'community apps' },
  { id: 'page:activity', path: '/activity', labelKey: 'commandPalette.pages.activity', keywords: 'feed notifications updates' },
  { id: 'page:settings', path: '/settings', labelKey: 'nav.settings', keywords: 'preferences account profile' },
];

const CLIENT_ACTIONS = [
  { id: 'action:new-booking', path: '/helpers', labelKey: 'commandPalette.actions.newBooking', keywords: 'book hire helper appointment schedule' },
  { id: 'action:new-job', path: '/post-job', labelKey: 'commandPalette.actions.newJob', keywords: 'post create gig hire request' },
  { id: 'action:new-quote', path: '/quote-request', labelKey: 'commandPalette.actions.newQuote', keywords: 'request quote estimate price' },
  { id: 'action:order-food', path: '/food', labelKey: 'commandPalette.actions.orderFood', keywords: 'delivery restaurant eat meal' },
  { id: 'action:open-wallet', path: '/wallet', labelKey: 'commandPalette.actions.openWallet', keywords: 'money balance credit funds' },
  { id: 'action:get-support', path: '/support', labelKey: 'commandPalette.actions.getSupport', keywords: 'help contact ticket assistance' },
];

export function buildClientItems(t) {
  const pages = CLIENT_PAGES.map((entry) => ({
    ...entry,
    label: t(entry.labelKey),
    group: 'pages',
  }));
  const actions = CLIENT_ACTIONS.map((entry) => ({
    ...entry,
    label: t(entry.labelKey),
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

/** Lazily fetch the user's most recent bookings and conversations. Never throws. */
export async function fetchDynamicRecents(t) {
  const [bookings, conversations] = await Promise.all([
    api.get('/bookings', { params: { limit: MAX_DYNAMIC } })
      .then(({ data }) => {
        const list = Array.isArray(data?.data) ? data.data : [];
        return list.slice(0, MAX_DYNAMIC).map((booking) => ({
          id: `booking:${booking.id}`,
          path: '/my-bookings',
          label: bookingLabel(booking, t),
          keywords: 'booking appointment reservation',
          group: 'bookings',
        }));
      })
      .catch(() => []),
    api.get('/messages/conversations', { params: { limit: MAX_DYNAMIC } })
      .then(({ data }) => {
        const payload = data?.data ?? data;
        const list = Array.isArray(payload) ? payload : (payload?.conversations || []);
        return list.slice(0, MAX_DYNAMIC).map((conversation) => ({
          id: `conversation:${conversation.id}`,
          path: `/messages/${conversation.id}`,
          label: conversationLabel(conversation, t),
          keywords: 'message chat conversation',
          group: 'conversations',
        }));
      })
      .catch(() => []),
  ]);
  return [...bookings, ...conversations];
}

/** Split registry items into recents-first ordering for an empty query. */
export function orderForEmptyQuery(allItems, recentIds) {
  const byId = new Map(allItems.map((item) => [item.id, item]));
  const recents = [];
  for (const id of recentIds) {
    const item = byId.get(id);
    if (item && !recents.includes(item)) recents.push({ ...item, recentPick: true });
  }
  const recentSet = new Set(recents.map((item) => item.id));
  return [...recents, ...allItems.filter((item) => !recentSet.has(item.id))];
}
