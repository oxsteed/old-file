import { useEffect, useMemo, useSyncExternalStore } from 'react';
import api from '../api/axios';
import { getAccountSnapshot, invalidateAccountSnapshots } from '../api/accountSnapshot';
import { useAuth } from '../context/AuthContext';
import { useSocket } from './useSocket';
// Cost audit 2026-11-13 item 12 (fixed): the media tab used to show media
// rows among the latest 100 UNSCOPED notifications, filtered client-side,
// so it undercounted whenever more than 100 recent notifications preceded
// an unread media notification. The store is still keyed by userId only
// (one socket lifecycle per user), but it now holds TWO lists: the
// unscoped latest 100 for Navbar/Dashboard, and a scoped media latest
// 100 (GET /notifications?scope=media, its own limit) fetched when a
// media consumer mounts. Each scope shares one load among its consumers
// (the 5s getAccountSnapshot coalesce keys on params, so the two scopes
// never merge), and the server's scoped unread_count is the exact media
// badge count, not a count of the fetched window. The media type list
// lives server-side only now (notificationController.js); the client no
// longer filters by type.
const unreadOf = (rows) => rows.filter(n => !n.is_read && !n.read_at).length;
const stores = new Map();
function getStore(userId) {
  const key = JSON.stringify([userId]);
  if (stores.has(key)) return stores.get(key);
  let state = {
    notifications: [], unreadCount: 0, loading: Boolean(userId),
    mediaNotifications: [], mediaUnreadCount: 0, mediaLoading: Boolean(userId),
  };
  const listeners = new Set();
  const update = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const store = { refs: 0, mediaRefs: 0, pending: null, mediaPending: null, loaded: false, mediaLoaded: false,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => state,
    refresh: async () => {
      if (!userId) return;
      if (store.pending) return store.pending;
      store.pending = (async () => {
        try {
          const { data } = await getAccountSnapshot(userId, '/notifications', { limit: 100 });
          const rows = Array.isArray(data) ? data : data?.notifications || [];
          store.loaded = true;
          update({ notifications: rows, unreadCount: data?.unread_count ?? unreadOf(rows), loading: false });
        } catch { update({ loading: false }); }
        finally { store.pending = null; }
      })();
      return store.pending;
    },
    // Scoped media fetch: its own query and limit, so media rows outside
    // the latest-100 unscoped window are visible. Shares one load among
    // media consumers via mediaPending, like refresh does for unscoped.
    refreshMedia: async () => {
      if (!userId) return;
      if (store.mediaPending) return store.mediaPending;
      store.mediaPending = (async () => {
        try {
          const { data } = await getAccountSnapshot(userId, '/notifications', { limit: 100, scope: 'media' });
          const rows = Array.isArray(data) ? data : data?.notifications || [];
          store.mediaLoaded = true;
          update({ mediaNotifications: rows, mediaUnreadCount: data?.unread_count ?? unreadOf(rows), mediaLoading: false });
        } catch { update({ mediaLoading: false }); }
        finally { store.mediaPending = null; }
      })();
      return store.mediaPending;
    },
    markAsRead: async id => {
      await api.put(`/notifications/${id}/read`);
      invalidateAccountSnapshots(userId);
      store.read(id);
      if (store.refs) void store.refresh();
      if (store.mediaRefs) void store.refreshMedia();
    },
    read: id => {
      const wasUnread = state.notifications.some(n => String(n.id) === String(id) && !n.is_read && !n.read_at);
      const wasUnreadMedia = state.mediaNotifications.some(n => String(n.id) === String(id) && !n.is_read && !n.read_at);
      const markRead = n => String(n.id) === String(id) ? { ...n, is_read: true, read_at: new Date().toISOString() } : n;
      update({
        notifications: state.notifications.map(markRead),
        unreadCount: Math.max(0, state.unreadCount - Number(wasUnread)),
        mediaNotifications: state.mediaNotifications.map(markRead),
        mediaUnreadCount: Math.max(0, state.mediaUnreadCount - Number(wasUnreadMedia)),
      });
    },
    markAllAsRead: async (scope) => {
      await api.put('/notifications/read-all', null, { params: scope ? { scope } : undefined });
      invalidateAccountSnapshots(userId);
      if (store.refs) await store.refresh();
      if (store.mediaRefs) await store.refreshMedia();
    },
    deleteNotification: async id => {
      await api.delete(`/notifications/${id}`); invalidateAccountSnapshots(userId);
      store.read(id); store.remove(id);
    },
    remove: id => update({
      notifications: state.notifications.filter(n => String(n.id) !== String(id)),
      mediaNotifications: state.mediaNotifications.filter(n => String(n.id) !== String(id)),
    }),
    userId,
  };
  stores.set(key, store);
  for (const [k, s] of stores) if (s.userId !== userId && !s.refs && !s.mediaRefs) stores.delete(k);
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
    const isMedia = scope === 'media';
    if (isMedia) store.mediaRefs++; else store.refs++;
    if (store.refs + store.mediaRefs === 1) {
      const refreshActive = () => {
        if (document.visibilityState !== 'hidden') {
          if (store.refs) void store.refresh();
          if (store.mediaRefs) void store.refreshMedia();
        }
      };
      const changed = () => { invalidateAccountSnapshots(userId); refreshActive(); };
      refreshActive();
      socket?.on('notification:new', changed);
      socket?.on('connect', changed);
      document.addEventListener('visibilitychange', changed);
      window.addEventListener('online', changed);
      store.cleanup = () => {
        socket?.off('notification:new', changed); socket?.off('connect', changed);
        document.removeEventListener('visibilitychange', changed); window.removeEventListener('online', changed);
      };
    } else if (isMedia) {
      // A later media consumer only loads when the scope never loaded
      // (first mount fetches; read-backs must not re-fire, and the 5s
      // cache plus socket refreshes keep the list fresh otherwise).
      if (!store.mediaLoaded) void store.refreshMedia();
    } else {
      if (!store.loaded) void store.refresh();
    }
    return () => {
      if (isMedia) store.mediaRefs--; else store.refs--;
      if (store.refs + store.mediaRefs === 0) store.cleanup?.();
    };
  }, [store, socket, userId, scope]);
  const safe = action => (...args) => action(...args).catch(() => {});
  if (scope === 'media') {
    return { ...state, notifications: state.mediaNotifications, unreadCount: state.mediaUnreadCount, loading: state.mediaLoading, refresh: store.refreshMedia, markAsRead: safe(store.markAsRead), markAllAsRead: safe(() => store.markAllAsRead(scope)), deleteNotification: safe(store.deleteNotification) };
  }
  return { ...state, refresh: store.refresh, markAsRead: safe(store.markAsRead), markAllAsRead: safe(() => store.markAllAsRead(null)), deleteNotification: safe(store.deleteNotification) };
}
