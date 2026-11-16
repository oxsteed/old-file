// WP-015 / WP-016: shared, cached read of GET /api/me/access for Home and
// navigation. Returns null until loaded and whenever the API is unavailable
// or the feature is off, so callers keep their legacy behaviour.
// Re-reads on window focus and on the `oxsteed:access-changed` event (fired
// by the Applications page after a change), so an approval or revocation is
// reflected without a new session.
import { useEffect, useState } from 'react';
import { accessAPI } from '../api/access';
import { currentAuthEpoch, isCurrentAuthEpoch } from '../api/authSessionEpoch';

export const ACCESS_CHANGED_EVENT = 'oxsteed:access-changed';
const TTL_MS = 60_000;
let active = null;

function matches(record, userId, epoch) {
  return Boolean(userId && record?.userId === userId && record.epoch === epoch);
}

function load(record, force = false) {
  if (active !== record || !isCurrentAuthEpoch(record.epoch) || record.inflight) return;
  if (!force && Date.now() - record.at < TTL_MS) return;
  record.inflight = accessAPI.getAccess(record.userId)
    .then((data) => (data?.access ? { access: data.access, flags: data.flags || {} } : null))
    .catch(() => null)
    .then((value) => {
      if (active !== record || !isCurrentAuthEpoch(record.epoch)) return;
      record.at = Date.now();
      record.value = value;
      record.listeners.forEach((publish) => publish(value));
    })
    .finally(() => { record.inflight = null; });
}

export function notifyAccessChanged() {
  try { window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT)); } catch { /* non-browser */ }
}

export default function useAccessProjection(user) {
  const userId = user?.id == null ? null : String(user.id);
  const epoch = currentAuthEpoch();
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    if (!isCurrentAuthEpoch(epoch)) return undefined;
    if (!userId) {
      active = null;
      setSnapshot(null);
      return undefined;
    }
    if (!matches(active, userId, epoch)) {
      active = { userId, epoch, at: 0, value: null, listeners: new Set(), inflight: null };
    }
    const record = active;
    const publish = (value) => setSnapshot({ userId, epoch, value });
    record.listeners.add(publish);
    publish(record.value);
    load(record);
    const refresh = () => load(record, true);
    // Focus is frequent: re-read at most every 15 s; explicit changes always re-read.
    const onFocus = () => { if (Date.now() - record.at > 15_000) refresh(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener(ACCESS_CHANGED_EVENT, refresh);
    return () => {
      record.listeners.delete(publish);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(ACCESS_CHANGED_EVENT, refresh);
    };
  }, [userId, epoch]);
  if (matches(snapshot, userId, epoch)) return snapshot.value;
  return matches(active, userId, epoch) ? active.value : null;
}
