/**
 * Pure search, scoring, and recents for the global command palette.
 *
 * No React, no API, no admin layout, so it is unit-testable with plain
 * `node --test`. The registry (commandPaletteItems.js) imports these and
 * re-exports them for the lazy palette module.
 */
import { expandSearchTerms } from './discoverTermExpansion.js';

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

/**
 * Bounded Levenshtein distance between two words, bailing out as soon as
 * the distance must exceed `max`. Keeps typo matching cheap on short
 * palette haystacks.
 */
export function levenshteinBounded(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Typo-tolerant score: every query word must land within a small edit
 * distance of some haystack word (1 edit for short words, 2 for longer
 * ones). Returns -1 when any word is too far off, else a small score that
 * grows as the matches get closer. Catches wrong or transposed letters
 * the subsequence score misses ("plubmer" -> "plumber").
 */
export function typoScore(query, text) {
  const qWords = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const tWords = String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!qWords.length || !tWords.length) return -1;
  let total = 0;
  for (const qw of qWords) {
    const tol = qw.length <= 4 ? 1 : 2;
    let best = Infinity;
    for (const tw of tWords) {
      if (Math.abs(tw.length - qw.length) > tol) continue;
      const d = levenshteinBounded(qw, tw, tol);
      if (d < best) best = d;
      if (best === 0) break;
    }
    if (best > tol) return -1;
    total += tol - best;
  }
  return total;
}

/** Direct match: subsequence first, then typo tolerance. -1 means no match. */
function matchScore(query, haystack) {
  const direct = fuzzyScore(query, haystack);
  return direct >= 0 ? direct : typoScore(query, haystack);
}

/**
 * Rank items against a query across label, keywords, and path. Direct
 * matches rank above synonym matches: a query word that matches only
 * through Discover's synonym expansion (e.g. "maid" -> "housekeeping")
 * still surfaces, but never above an item the query matches directly.
 * Within each tier the score decides, with recent/live boosts.
 */
export function searchItems(items, query) {
  const q = String(query || '').trim();
  if (!q) return items;
  const expanded = expandSearchTerms(q);
  const scored = [];
  for (const item of items) {
    const haystack = `${item.label} ${item.keywords || ''} ${item.path || ''}`;
    let score = matchScore(q, haystack);
    let viaSynonym = false;
    if (score < 0) {
      for (const term of expanded) {
        const synonym = matchScore(term, haystack);
        if (synonym >= 0) score = Math.max(score, synonym - 2);
      }
      if (score >= 0) viaSynonym = true;
    }
    // Live items (the user's own open orders, deliveries, active bookings,
    // conversations) rank above plain recents, which rank above static
    // pages and actions.
    if (score >= 0) scored.push({ item, score: score + (item.recentPick ? 60 : 0) + (item.livePick ? 40 : 0), viaSynonym });
  }
  scored.sort((a, b) => (a.viaSynonym - b.viaSynonym) || (b.score - a.score));
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
