import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/axios';
import { useSocket } from './useSocket';

export default function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const knownNotificationIds = useRef(new Set());
  const { socket } = useSocket();

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/notifications');
      const rows = Array.isArray(data) ? data : (data?.notifications || []);
      knownNotificationIds.current = new Set(
        rows.map((notification) => String(notification?.id || '')).filter(Boolean)
      );
      setNotifications(rows);
      setUnreadCount(data?.unread_count ?? rows.filter(n => !n.read_at && !n.is_read).length);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const markAsRead = useCallback(async (notificationId) => {
    try {
      await api.put(`/notifications/${notificationId}/read`);
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      await api.put('/notifications/read-all');
      setNotifications(prev =>
        prev.map(n => ({ ...n, is_read: true, read_at: n.read_at || new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  }, []);

  const deleteNotification = useCallback(async (notificationId) => {
    try {
      await api.delete(`/notifications/${notificationId}`);
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
    } catch (err) {
      console.error('Failed to delete notification:', err);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Media is an in-shell view of the account notification stream. Subscribe
  // to the authenticated socket so its badge and list update immediately;
  // polling remains the recovery path after a reconnect or missed event.
  useEffect(() => {
    if (!socket) return undefined;

    const handleNewNotification = (notification) => {
      const id = String(notification?.id || '');
      if (id && knownNotificationIds.current.has(id)) return;
      if (id) knownNotificationIds.current.add(id);
      setNotifications((previous) => [notification, ...previous].slice(0, 100));
      if (!notification?.is_read && !notification?.read_at) {
        setUnreadCount((previous) => previous + 1);
      }
    };
    const handleReconnect = () => { fetchNotifications(); };

    socket.on('notification:new', handleNewNotification);
    socket.on('connect', handleReconnect);
    return () => {
      socket.off('notification:new', handleNewNotification);
      socket.off('connect', handleReconnect);
    };
  }, [socket, fetchNotifications]);

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refresh: fetchNotifications,
  };
}
