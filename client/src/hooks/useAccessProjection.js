// Shared access snapshot for the current authentication session. Only an
// explicit server rollback response can select legacy account routing.
import { useEffect, useState } from 'react';
import { accessAPI } from '../api/access';
import { currentAuthEpoch, isCurrentAuthEpoch } from '../api/authSessionEpoch';

export const ACCESS_CHANGED_EVENT = 'oxsteed:access-changed';
const TTL_MS = 60_000;
let active = null;

function matches(record, userId, epoch) {
  return Boolean(userId && record?.userId === userId && record.epoch === epoch);
}

function load(record, { force = false, invalidate = false } = {}) {
  if (active !== record || !isCurrentAuthEpoch(record.epoch)) return;
  if (record.inflight) {
    // The pending read may have started before the application changed.
    if (invalidate) record.invalidated = true;
    return;
  }
  if (!force && Date.now() - record.at < TTL_MS) return;
  record.inflight = accessAPI.getAccess(record.userId)
    .then((data) => (data?.access ? { access: data.access, flags: data.flags || {} } : null))
    .catch(error => error?.response?.status === 503 && error.response.data?.code === 'feature_disabled'
      ? { access: null, flags: { accessProjection: false } } : null)
    .then((value) => {
      if (active !== record || !isCurrentAuthEpoch(record.epoch) || record.invalidated) return;
      record.at = Date.now();
      record.value = value;
      record.listeners.forEach((publish) => publish(value));
    })
    .finally(() => {
      record.inflight = null;
      if (record.invalidated) {
        record.invalidated = false;
        load(record, { force: true });
      }
    });
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
    if (!record.stopListening) {
      const refresh = () => load(record, { force: true });
      const invalidate = () => load(record, { force: true, invalidate: true });
      const onPageShow = event => { if (event.persisted) invalidate(); };
      const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
      window.addEventListener('focus', refresh);
      window.addEventListener('pageshow', onPageShow);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener(ACCESS_CHANGED_EVENT, invalidate);
      record.stopListening = () => {
        window.removeEventListener('focus', refresh);
        window.removeEventListener('pageshow', onPageShow);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener(ACCESS_CHANGED_EVENT, invalidate);
      };
    }
    return () => {
      record.listeners.delete(publish);
      if (record.listeners.size === 0) {
        record.stopListening();
        record.stopListening = null;
      }
    };
  }, [userId, epoch]);
  if (matches(snapshot, userId, epoch)) return snapshot.value;
  return matches(active, userId, epoch) ? active.value : null;
}
