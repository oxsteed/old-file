import { useEffect, useState } from 'react';

/**
 * Recently-viewed tracking (client-only, localStorage).
 *
 * Storage key follows the existing `oxs:*` convention and holds one object:
 *   { helpers: [...], restaurants: [...], guides: [...] }
 * Each entry: { id, title, subtitle?, image?, href, ts }, most-recent-first,
 * capped at RECENT_MAX entries per kind.
 */

const KEY = 'oxs:recentlyViewed';
export const RECENT_MAX = 8;
export const RECENT_KINDS = ['helpers', 'restaurants', 'guides'];

function blankStore() {
  return { helpers: [], restaurants: [], guides: [] };
}

function loadAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blankStore();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return blankStore();
    const out = blankStore();
    for (const kind of RECENT_KINDS) {
      if (Array.isArray(parsed[kind])) {
        out[kind] = parsed[kind].filter((i) => i && i.id != null && i.href);
      }
    }
    return out;
  } catch {
    return blankStore();
  }
}

function saveAll(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Non-fatal: private-mode or quota issues should never break the page.
  }
}

/**
 * Record that the user viewed an entity. Safe to call from any page;
 * does not throw and silently skips invalid input.
 */
export function recordView(kind, entry) {
  if (!RECENT_KINDS.includes(kind) || !entry || entry.id == null || !entry.href) return;
  const id = String(entry.id);
  const all = loadAll();
  all[kind] = [
    { id, title: entry.title || '', subtitle: entry.subtitle || '', image: entry.image || null, href: entry.href, ts: Date.now() },
    ...all[kind].filter((i) => String(i.id) !== id),
  ].slice(0, RECENT_MAX);
  saveAll(all);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('oxs:recentlyViewed', { detail: { kind } }));
  }
}

/**
 * React hook returning the most-recent-first items for a kind.
 * Refreshes when another view is recorded in the same tab or another tab.
 */
export function useRecentlyViewed(kind) {
  const [items, setItems] = useState(() => (RECENT_KINDS.includes(kind) ? loadAll()[kind] : []));
  useEffect(() => {
    if (!RECENT_KINDS.includes(kind)) return undefined;
    const refresh = () => setItems(loadAll()[kind]);
    refresh();
    window.addEventListener('oxs:recentlyViewed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('oxs:recentlyViewed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [kind]);
  return items;
}
