import { useEffect, useMemo, useSyncExternalStore } from 'react';
import api from '../api/axios';
import { getAccountSnapshot, invalidateAccountSnapshots } from '../api/accountSnapshot';
import { useAuth } from '../context/AuthContext';
import { useSocket } from './useSocket';
const stores = new Map();
function getStore(userId, scope) {
  const key = JSON.stringify([userId, scope]);
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
          const { data } = await getAccountSnapshot(userId, '/notifications', scope ? { scope } : undefined);
          const rows = Array.isArray(data) ? data : data?.notifications || [];
          update({ notifications: rows, unreadCount: data?.unread_count ?? rows.filter(n => !n.is_read && !n.read_at).length, loading: false });
        } catch { update({ loading: false }); }
        finally { store.pending = null; }
      })();
      return store.pending;
    },
    markAsRead: async id => {
      await api.put(`/notifications/${id}/read`);
      invalidateAccountSnapshots(userId);
      for (const other of stores.values()) if (other.userId === userId) { other.read(id); void other.refresh(); }
    },
    read: id => {
      const wasUnread = state.notifications.some(n => String(n.id) === String(id) && !n.is_read && !n.read_at);
      update({ notifications: state.notifications.map(n => String(n.id) === String(id) ? { ...n, is_read: true, read_at: new Date().toISOString() } : n), unreadCount: Math.max(0, state.unreadCount - Number(wasUnread)) });
    },
    markAllAsRead: async () => {
      await api.put('/notifications/read-all', null, { params: scope ? { scope } : undefined });
      invalidateAccountSnapshots(userId);
      for (const other of stores.values()) if (other.userId === userId) await other.refresh();
    },
    deleteNotification: async id => {
      await api.delete(`/notifications/${id}`); invalidateAccountSnapshots(userId);
      for (const other of stores.values()) if (other.userId === userId) { other.read(id); other.remove(id); }
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
  const store = useMemo(() => getStore(userId, scope), [userId, scope]);
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
  return { ...state, refresh: store.refresh, markAsRead: safe(store.markAsRead), markAllAsRead: safe(store.markAllAsRead), deleteNotification: safe(store.deleteNotification) };
}
