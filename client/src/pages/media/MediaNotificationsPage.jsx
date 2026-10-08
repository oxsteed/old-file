import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useNotifications from '../../hooks/useNotifications';

const ICONS = {
  new_bid: '🎯',
  bid_accepted: '✅',
  job_started: '🔨',
  job_completed: '🏁',
  payment_released: '💰',
  payout_deposited: '🏦',
  new_review: '⭐',
  dispute_update: '⚠️',
  new_job_nearby: '📍',
  onboarding_complete: '🎉',
  media_reply: '💬',
  media_like: '❤️',
};

function notificationTime(value, language) {
  if (!value) return '';
  try {
    const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
    const absolute = Math.abs(seconds);
    const unit = absolute < 60 ? 'second' : absolute < 3600 ? 'minute' : absolute < 86400 ? 'hour' : 'day';
    const divisor = unit === 'second' ? 1 : unit === 'minute' ? 60 : unit === 'hour' ? 3600 : 86400;
    return new Intl.RelativeTimeFormat(language || 'en', { numeric: 'auto' }).format(Math.round(seconds / divisor), unit);
  } catch {
    return '';
  }
}

export default function MediaNotificationsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    refresh,
  } = useNotifications();

  return (
    <div className="media-activity-page media-notifications-page">
      <header className="media-activity-header">
        <div>
          <p className="media-page-kicker"><Bell size={14} aria-hidden="true" />{t('media.notifications.kicker')}</p>
          <h1>{t('media.shell.notifications')}</h1>
          <p>{t('media.notifications.description')}</p>
        </div>
        <button
          type="button"
          className="media-icon-button"
          onClick={refresh}
          disabled={loading}
          aria-label={t('media.notifications.refresh')}
        >
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="media-activity-toolbar">
        <span className="media-activity-count">
          {t('media.notifications.unread', { count: unreadCount })}
        </span>
        {unreadCount > 0 && (
          <button type="button" className="media-text-button" onClick={markAllAsRead}>
            <Check size={15} aria-hidden="true" />
            {t('media.notifications.markAllRead')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="media-activity-empty"><p>{t('media.notifications.loading')}</p></div>
      ) : notifications.length === 0 ? (
        <div className="media-activity-empty">
          <span className="media-activity-empty-icon" aria-hidden="true"><Bell size={27} /></span>
          <h2>{t('media.notifications.emptyHeading')}</h2>
          <p>{t('media.notifications.emptyDescription')}</p>
        </div>
      ) : (
        <div className="media-notification-list" role="list">
          {notifications.map((notification) => {
            const unread = !notification.is_read && !notification.read_at;
            return (
              <article
                key={notification.id}
                className={`media-notification-row${unread ? ' unread' : ''}`}
                role="listitem"
                onClick={() => {
                  if (unread) markAsRead(notification.id);
                  if (notification.action_url) navigate(notification.action_url);
                }}
              >
                <span className="media-notification-icon" aria-hidden="true">
                  {ICONS[notification.type] || '🔔'}
                </span>
                <div className="media-notification-body">
                  <h2>{notification.title}</h2>
                  {notification.body && <p>{notification.body}</p>}
                  <time dateTime={notification.created_at}>{notificationTime(notification.created_at, i18n.language)}</time>
                </div>
                {unread && <span className="media-notification-dot" aria-label={t('media.notifications.unreadLabel')} />}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
