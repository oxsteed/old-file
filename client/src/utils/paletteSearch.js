/**
 * Pure search, scoring, and recents for the global command palette.
 *
 * No React, no API, no admin layout, so it is unit-testable with plain
 * `node --test`. The registry (commandPaletteItems.js) imports these and
 * re-exports them for the lazy palette module.
 */

export const RECENT_STORAGE_KEY = 'oxsteed:cmdk:recent';
const MAX_RECENT = 8;

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
    // Live items (the user's own open orders, deliveries, active bookings,
    // conversations) rank above plain recents, which rank above static
    // pages and actions.
    if (score >= 0) scored.push({ item, score: score + (item.recentPick ? 60 : 0) + (item.livePick ? 40 : 0) });
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

/**
 * Split registry items into live-first ordering for an empty query: live
 * items first, then stored recents, then everything else in registry order.
 * An item that is both live and a stored recent appears once, as live.
 */
export function orderForEmptyQuery(allItems, recentIds) {
  const byId = new Map(allItems.map((item) => [item.id, item]));
  const live = allItems.filter((item) => item.livePick);
  const recents = [];
  for (const id of recentIds) {
    const item = byId.get(id);
    if (item && !item.livePick && !recents.includes(item)) recents.push({ ...item, recentPick: true });
  }
  const seen = new Set([...live.map((item) => item.id), ...recents.map((item) => item.id)]);
  return [...live, ...recents, ...allItems.filter((item) => !seen.has(item.id))];
}

/**
 * Append ranked Discover results after the user's own items, never before
 * them and never duplicating an own destination. Discover is a finder of
 * last resort in the palette: it surfaces things the user does not own.
 */
export function mergeDiscoverResults(ownVisible, discoverVisible, maxDiscover = 5) {
  const ownPaths = new Set(ownVisible.map((item) => item.path));
  const extra = discoverVisible.filter((item) => item.path && !ownPaths.has(item.path));
  return [...ownVisible, ...extra.slice(0, maxDiscover)];
}
