// WP-015 / WP-016: shared, cached read of GET /api/me/access for Home and
// navigation. Returns null until loaded and whenever the API is unavailable
// or the feature is off, so callers keep their legacy behaviour.
// Re-reads on window focus and on the `oxsteed:access-changed` event (fired
// by the Applications page after a change), so an approval or revocation is
// reflected without a new session.
import { useEffect, useState } from 'react';
import { accessAPI } from '../api/access';

export const ACCESS_CHANGED_EVENT = 'oxsteed:access-changed';
const TTL_MS = 60_000;
let cache = { userId: null, at: 0, value: null };
let inflight = null;
const listeners = new Set();

function load(userId, force = false) {
  if (!force && cache.userId === userId && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.value);
  if (!inflight) {
    inflight = accessAPI.getAccess()
      .then((d) => (d && d.access ? { access: d.access, flags: d.flags || {} } : null))
      .catch(() => null)
      .then((value) => {
        cache = { userId, at: Date.now(), value };
        listeners.forEach((fn) => fn(value));
        return value;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function notifyAccessChanged() {
  try { window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT)); } catch { /* non-browser */ }
}

export default function useAccessProjection(user) {
  const userId = user?.id || null;
  const [value, setValue] = useState(() => (userId && cache.userId === userId ? cache.value : null));
  useEffect(() => {
    if (!userId) { setValue(null); return undefined; }
    let alive = true;
    const set = (v) => { if (alive) setValue(v); };
    listeners.add(set);
    load(userId).then(set);
    const refresh = () => load(userId, true);
    // Focus is frequent: re-read at most every 15 s; explicit changes always re-read.
    const onFocus = () => { if (Date.now() - cache.at > 15_000) refresh(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener(ACCESS_CHANGED_EVENT, refresh);
    return () => {
      alive = false;
      listeners.delete(set);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(ACCESS_CHANGED_EVENT, refresh);
    };
  }, [userId]);
  return value;
}
