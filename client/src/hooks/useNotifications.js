import { useEffect, useMemo, useSyncExternalStore } from 'react';
import api from '../api/axios';
import { getAccountSnapshot, invalidateAccountSnapshots } from '../api/accountSnapshot';
import { useAuth } from '../context/AuthContext';
import { useSocket } from './useSocket';
// Cost audit 2026-11-13 item 12 (STILL LIVE since Nov 4 #13): Navbar's
// scope-null store and MediaShell's 'media' store used to be two separate
// stores keyed [userId, scope], each doing its own GET /notifications on
// mount, because the 5s coalesce in getAccountSnapshot keys on params and
// never merged the two scopes. The stores are now keyed by userId only:
// one fetch per user, with scope applied as a client-side filter.
// MEDIA_NOTIFICATION_TYPES must match the server-side list in
// server/controllers/notificationController.js. The single fetch is the
// unscoped list (limit 100, the server max) so the media view has a wide
// window to filter from; the media badge counts unread media rows among
// the fetched window, which is exact in the common case and can only
// undercount when more than 100 recent notifications precede an unread
// media notification. markAllAsRead still passes scope to the server so
// "mark all read" inside Media only marks media notifications read.
const MEDIA_NOTIFICATION_TYPES = [
  'media_reply', 'media_like', 'media_repost', 'media_quote',
  'media_follow', 'media_creator_update',
];
const isMediaNotification = (n) => MEDIA_NOTIFICATION_TYPES.includes(n?.type);
const unreadOf = (rows) => rows.filter(n => !n.is_read && !n.read_at).length;
const stores = new Map();
function getStore(userId) {
  const key = JSON.stringify([userId]);
  if (stores.has(key)) return stores.get(key);
  let state = { notifications: [], unreadCount: 0, loading: Boolean(userId) };
  const listeners = new Set();
  const update = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const store = { refs: 0, pending: null,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => state,
    refresh: async () => {
      if (!userId) return;
      if (store.pending) return store.pending;
      store.pending = (async () => {
        try {
          const { data } = await getAccountSnapshot(userId, '/notifications', { limit: 100 });
          const rows = Array.isArray(data) ? data : data?.notifications || [];
          update({ notifications: rows, unreadCount: data?.unread_count ?? unreadOf(rows), loading: false });
        } catch { update({ loading: false }); }
        finally { store.pending = null; }
      })();
      return store.pending;
    },
    markAsRead: async id => {
      await api.put(`/notifications/${id}/read`);
      invalidateAccountSnapshots(userId);
      store.read(id);
      void store.refresh();
    },
    read: id => {
      const wasUnread = state.notifications.some(n => String(n.id) === String(id) && !n.is_read && !n.read_at);
      update({ notifications: state.notifications.map(n => String(n.id) === String(id) ? { ...n, is_read: true, read_at: new Date().toISOString() } : n), unreadCount: Math.max(0, state.unreadCount - Number(wasUnread)) });
    },
    markAllAsRead: async (scope) => {
      await api.put('/notifications/read-all', null, { params: scope ? { scope } : undefined });
      invalidateAccountSnapshots(userId);
      await store.refresh();
    },
    deleteNotification: async id => {
      await api.delete(`/notifications/${id}`); invalidateAccountSnapshots(userId);
      store.read(id); store.remove(id);
    },
    remove: id => update({ notifications: state.notifications.filter(n => String(n.id) !== String(id)) }),
    userId,
  };
  stores.set(key, store);
  for (const [k, s] of stores) if (s.userId !== userId && !s.refs) stores.delete(k);
  return store;
}
export default function useNotifications(scope = null) {
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
      socket?.on('notification:new', changed);
      socket?.on('connect', changed);
      document.addEventListener('visibilitychange', changed);
      window.addEventListener('online', changed);
      store.cleanup = () => {
        socket?.off('notification:new', changed); socket?.off('connect', changed);
        document.removeEventListener('visibilitychange', changed); window.removeEventListener('online', changed);
      };
    }
    return () => { if (--store.refs === 0) store.cleanup?.(); };
  }, [store, socket, userId]);
  const safe = action => (...args) => action(...args).catch(() => {});
  if (scope === 'media') {
    const mediaNotifications = state.notifications.filter(isMediaNotification);
    return { ...state, notifications: mediaNotifications, unreadCount: unreadOf(mediaNotifications), refresh: store.refresh, markAsRead: safe(store.markAsRead), markAllAsRead: safe(() => store.markAllAsRead(scope)), deleteNotification: safe(store.deleteNotification) };
  }
  return { ...state, refresh: store.refresh, markAsRead: safe(store.markAsRead), markAllAsRead: safe(() => store.markAllAsRead(null)), deleteNotification: safe(store.deleteNotification) };
}
