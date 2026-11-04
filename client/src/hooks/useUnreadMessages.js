import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getAccountSnapshot, invalidateAccountSnapshots } from '../api/accountSnapshot';
import { useAuth } from '../context/AuthContext';
import { useSocket } from './useSocket';

// Cost audit 2026-11-04 item 12: the unread-message count used to be
// fetched separately by Navbar and by Dashboard, each maintaining its own
// copy. This is the shared external store both read, mirroring
// useNotifications: one fetch per user, refreshed on socket events,
// focus, visibility, and the messages-read signal. The count covers
// conversations plus guest inquiries, exactly as Navbar computed it.
const stores = new Map();
function getStore(userId) {
  if (stores.has(userId)) return stores.get(userId);
  let state = { unreadCount: 0 };
  const listeners = new Set();
  const update = (patch) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); };
  const store = {
    refs: 0,
    pending: null,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => state,
    refresh: async () => {
      if (!userId) return;
      if (store.pending) return store.pending;
      store.pending = (async () => {
        try {
          const [msgRes, guestRes] = await Promise.allSettled([
            getAccountSnapshot(userId, '/messages/conversations'),
            getAccountSnapshot(userId, '/messages/guest-inquiries'),
          ]);
          const convos = msgRes.status === 'fulfilled'
            ? (msgRes.value.data?.conversations || msgRes.value.data || [])
            : [];
          const guestInquiries = guestRes.status === 'fulfilled'
            ? (guestRes.value.data?.inquiries || guestRes.value.data || [])
            : [];
          update({
            unreadCount:
              (Array.isArray(convos) ? convos : []).filter((c) => Number(c.unread_count) > 0).length
              + (Array.isArray(guestInquiries) ? guestInquiries : []).filter((i) => Number(i.unread_count) > 0).length,
          });
        } catch { /* a failed count refresh keeps the last count */ }
        finally { store.pending = null; }
      })();
      return store.pending;
    },
    userId,
  };
  stores.set(userId, store);
  for (const [k, s] of stores) if (s.userId !== userId && !s.refs) stores.delete(k);
  return store;
}

export default function useUnreadMessages() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const userId = user?.id;
  const store = useMemo(() => getStore(userId), [userId]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    if (!userId) return undefined;
    store.refs++;
    if (store.refs === 1) {
      const refresh = () => { if (document.visibilityState !== 'hidden') void store.refresh(); };
      const changed = () => { invalidateAccountSnapshots(userId); refresh(); };
      refresh();
      const messageEvents = ['message:new', 'profile_chat:new_message', 'business_inbox:conversation', 'messages:read', 'connect'];
      messageEvents.forEach((eventName) => socket?.on(eventName, changed));
      window.addEventListener('focus', changed);
      window.addEventListener('oxsteed:messages-read', changed);
      const onVisibility = () => { if (document.visibilityState === 'visible') changed(); };
      document.addEventListener('visibilitychange', onVisibility);
      store.cleanup = () => {
        messageEvents.forEach((eventName) => socket?.off(eventName, changed));
        window.removeEventListener('focus', changed);
        window.removeEventListener('oxsteed:messages-read', changed);
        document.removeEventListener('visibilitychange', onVisibility);
      };
    }
    return () => { if (--store.refs === 0) store.cleanup?.(); };
  }, [store, socket, userId]);
  return { ...state, refresh: store.refresh };
}
