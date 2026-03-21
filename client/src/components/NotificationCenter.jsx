import React, { useEffect } from 'react';
import useNotifications from '../hooks/useNotifications';
import './NotificationCenter.css';

export default function NotificationCenter() {
  const { notifications, unreadCount, loading, fetchNotifications, markAsRead } = useNotifications();

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
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const handleClick = async (notification) => {
    if (!notification.read_at) {
      await markAsRead(notification.id);
    }
  };

  if (loading) {
    return <div className="notification-center-loading">Loading notifications...</div>;
  }

  return (
    <div className="notification-center">
      <div className="notification-header">
        <h3>
          Notifications
          {unreadCount > 0 && <span className="unread-badge">{unreadCount}</span>}
        </h3>
      </div>
      {notifications.length === 0 ? (
        <div className="no-notifications">
          <p>🔔 No notifications yet</p>
        </div>
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
                <p className="notification-message">{notification.message}</p>
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
