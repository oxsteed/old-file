import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BellOff } from 'lucide-react';
import useNotifications from '../hooks/useNotifications';
import EmptyState from './EmptyState';
import './NotificationCenter.css';

export default function NotificationCenter() {
  const { notifications, unreadCount, loading, fetchNotifications, markAsRead } = useNotifications();
  const { t, i18n } = useTranslation('common');

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'job_posted': return '📋';
      case 'bid_received': return '📩';
      case 'bid_accepted': return '✅';
      case 'bid_rejected': return '❌';
      case 'job_completed': return '🎉';
      case 'payment_received': return '💰';
      case 'review_received': return '⭐';
      case 'dispute_opened': return '⚠️';
      case 'dispute_resolved': return '⚖️';
      default: return '🔔';
    }
  };

  const formatTime = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return t('notificationCenter.time.justNow');
    if (diff < 3600) return t('notificationCenter.time.minutesAgo', { value: Math.floor(diff / 60) });
    if (diff < 86400) return t('notificationCenter.time.hoursAgo', { value: Math.floor(diff / 3600) });
    if (diff < 604800) return t('notificationCenter.time.daysAgo', { value: Math.floor(diff / 86400) });
    return date.toLocaleDateString(i18n.language || 'en', { month: 'short', day: 'numeric' });
  };

  const handleClick = async (notification) => {
    if (!notification.read_at) {
      await markAsRead(notification.id);
    }
  };

  if (loading) {
    return <div className="notification-center-loading">{t('notificationCenter.loading')}</div>;
  }

  return (
    <div className="notification-center">
      <div className="notification-header">
        <h3>
          {t('notificationCenter.title')}
          {unreadCount > 0 && <span className="unread-badge">{unreadCount}</span>}
        </h3>
      </div>
      {notifications.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title={t('notificationCenter.emptyTitle')}
          copy={t('notificationCenter.emptyCopy')}
        />
      ) : (
        <div className="notification-list">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={`notification-item ${!notification.read_at ? 'unread' : ''}`}
              onClick={() => handleClick(notification)}
            >
              <span className="notification-icon">
                {getNotificationIcon(notification.type)}
              </span>
              <div className="notification-content">
                <p className="notification-message">{notification.message || t('notificationCenter.messageFallback')}</p>
                <span className="notification-time">{formatTime(notification.created_at)}</span>
              </div>
              {!notification.read_at && <span className="unread-dot" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
