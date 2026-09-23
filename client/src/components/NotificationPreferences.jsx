import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import toast from 'react-hot-toast';
import useWebPush from '../hooks/useWebPush';
import './NotificationPreferences.css';

function Toggle({ checked, onChange, disabled, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`notification-settings__toggle ${checked ? 'is-on' : 'is-off'}`}
    >
      <span className="notification-settings__toggle-thumb" />
    </button>
  );
}

export function BrowserPushPanel() {
  const { t } = useTranslation();
  const wp = useWebPush();

  if (!wp.ready) return null;

  const handleToggle = async (next) => {
    if (next) {
      const ok = await wp.subscribe();
      if (ok) toast.success(t('notifications.webPush.enabledToast'));
      else if (wp.permission === 'denied') toast.error(t('notifications.webPush.deniedToast'));
      else toast.error(wp.error || t('notifications.failedSave'));
    } else {
      const ok = await wp.unsubscribe();
      if (ok) toast.success(t('notifications.webPush.disabledToast'));
      else toast.error(wp.error || t('notifications.failedSave'));
    }
  };

  const handleTest = async () => {
    const ok = await wp.sendTest();
    if (ok) toast.success(t('notifications.webPush.testSentToast'));
    else toast.error(wp.error || t('notifications.failedSave'));
  };

  let statusText = t('notifications.webPush.statusOff');
  if (!wp.isSupported)        statusText = t('notifications.webPush.statusUnsupported');
  else if (!wp.serverEnabled) statusText = t('notifications.webPush.statusServerOff');
  else if (wp.permission === 'denied') statusText = t('notifications.webPush.statusDenied');
  else if (wp.isSubscribed)   statusText = t('notifications.webPush.statusOn');

  const disabled =
    !wp.isSupported || !wp.serverEnabled || wp.loading || wp.permission === 'denied';

  return (
    <div className="notification-settings__browser-panel">
      <div className="notification-settings__section-heading">
        <h3 className="notification-settings__section-title">
          {t('notifications.webPush.title')}
        </h3>
        <p className="notification-settings__muted notification-settings__section-description">
          {t('notifications.webPush.subtitle')}
        </p>
      </div>
      <div className="notification-settings__browser-shell">
        <div className="notification-settings__browser-row">
          <div className="min-w-0">
            <div className="notification-settings__row-title">
              {t('notifications.webPush.toggleLabel')}
            </div>
            <div className="notification-settings__muted notification-settings__row-status">
              {statusText}
            </div>
          </div>
          <Toggle
            checked={wp.isSubscribed}
            onChange={handleToggle}
            disabled={disabled}
            ariaLabel={t('notifications.webPush.toggleLabel')}
          />
        </div>

        {wp.isSubscribed && (
          <div className="notification-settings__browser-actions">
            <button
              type="button"
              onClick={handleTest}
              disabled={wp.loading}
              className="notification-settings__secondary-button"
            >
              {t('notifications.webPush.sendTest')}
            </button>
          </div>
        )}

        {wp.isSupported && !wp.serverEnabled && (
          <div className="notification-settings__status-callout">
            <p className="notification-settings__status-title">{statusText}</p>
            <p className="notification-settings__status-body">
              {t('notifications.webPush.setupHelp', {
                defaultValue: 'An administrator must configure browser push on the server before this browser can be enabled.',
              })}
            </p>
            <button
              type="button"
              onClick={wp.refresh}
              disabled={wp.loading}
              className="notification-settings__secondary-button"
            >
              {t('notifications.webPush.checkAgain', { defaultValue: 'Check again' })}
            </button>
          </div>
        )}

        {wp.permission === 'denied' && (
          <div className="notification-settings__status-callout notification-settings__status-callout--error">
            {t('notifications.webPush.deniedHelp')}
          </div>
        )}
      </div>
    </div>
  );
}

export default function NotificationPreferences() {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const LABELS = useMemo(() => ({
    in_app_new_bid:          t('notifications.prefs.in_app_new_bid'),
    in_app_bid_accepted:     t('notifications.prefs.in_app_bid_accepted'),
    in_app_job_started:      t('notifications.prefs.in_app_job_started'),
    in_app_job_completed:    t('notifications.prefs.in_app_job_completed'),
    in_app_payment_released: t('notifications.prefs.in_app_payment_released'),
    in_app_new_review:       t('notifications.prefs.in_app_new_review'),
    in_app_dispute_update:   t('notifications.prefs.in_app_dispute_update'),
    in_app_subscription:     t('notifications.prefs.in_app_subscription'),
    in_app_new_message:      t('notifications.prefs.in_app_new_message'),
    in_app_message_mention:  t('notifications.prefs.in_app_message_mention'),
    push_new_job_nearby:     t('notifications.prefs.push_new_job_nearby'),
    push_new_bid:            t('notifications.prefs.push_new_bid'),
    push_bid_accepted:       t('notifications.prefs.push_bid_accepted'),
    push_payment_released:   t('notifications.prefs.push_payment_released'),
    push_dispute_update:     t('notifications.prefs.push_dispute_update'),
    push_new_message:        t('notifications.prefs.push_new_message'),
    push_message_mention:    t('notifications.prefs.push_message_mention'),
    email_bid_accepted:      t('notifications.prefs.email_bid_accepted'),
    email_payment_released:  t('notifications.prefs.email_payment_released'),
    email_subscription:      t('notifications.prefs.email_subscription'),
    email_dispute_update:    t('notifications.prefs.email_dispute_update'),
    email_weekly_summary:    t('notifications.prefs.email_weekly_summary'),
    email_new_message:       t('notifications.prefs.email_new_message'),
  }), [t]);

  const SECTIONS = useMemo(() => [
    {
      key: 'in_app',
      title: t('notifications.groups.in_app.label'),
      description: t('notifications.groups.in_app.description'),
      keys: [
        'in_app_new_bid',
        'in_app_bid_accepted',
        'in_app_job_started',
        'in_app_job_completed',
        'in_app_payment_released',
        'in_app_new_review',
        'in_app_dispute_update',
        'in_app_subscription',
        'in_app_new_message',
        'in_app_message_mention',
      ],
    },
    {
      key: 'push',
      title: t('notifications.groups.push.label'),
      description: t('notifications.groups.push.description'),
      keys: [
        'push_new_job_nearby',
        'push_new_bid',
        'push_bid_accepted',
        'push_payment_released',
        'push_dispute_update',
        'push_new_message',
        'push_message_mention',
      ],
    },
    {
      key: 'email',
      title: t('notifications.groups.email.label'),
      description: t('notifications.groups.email.description'),
      keys: [
        'email_bid_accepted',
        'email_payment_released',
        'email_subscription',
        'email_dispute_update',
        'email_weekly_summary',
        'email_new_message',
      ],
    },
  ], [t]);

  useEffect(() => {
    api.get('/notifications/preferences')
      .then(r => {
        setPrefs(r.data?.preferences || {});
        setLoading(false);
      })
      .catch(() => {
        toast.error(t('notifications.failedLoad'));
        setLoading(false);
      });
  }, [t]);

  const handleToggle = useCallback(async (key, value) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
    setSaving(true);
    try {
      await api.put('/notifications/preferences', { [key]: value });
      toast.success(t('notifications.prefSaved'));
    } catch {
      // Revert on failure
      setPrefs(prev => ({ ...prev, [key]: !value }));
      toast.error(t('notifications.failedSave'));
    } finally {
      setSaving(false);
    }
  }, [t]);

  if (loading) {
    return (
      <div className="sp-card">
        <h2 className="sp-card-title">{t('notifications.title')}</h2>
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted-text,#94a3b8)' }}>
          <svg className="animate-spin h-4 w-4" style={{ color: '#f97316' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          {t('common.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="sp-card">
      <div className="flex items-center justify-between mb-1">
        <h2 className="sp-card-title" style={{ marginBottom: 0 }}>{t('notifications.title')}</h2>
        {saving && (
          <span className="flex items-center gap-1.5 text-xs" style={{ color: '#f97316' }}>
            <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            {t('common.saving')}
          </span>
        )}
      </div>
      <p className="sp-card-subtitle">{t('notifications.subtitle')}</p>

      <div className="notification-settings__security-notice" role="note">
        <p className="notification-settings__security-title">{t('notifications.securityNoticeTitle')}</p>
        <p className="notification-settings__security-body">{t('notifications.securityNoticeBody')}</p>
      </div>

      <BrowserPushPanel />

      <div className="space-y-8">
        {SECTIONS.map((section, sIdx) => (
          <div key={section.key}>
            <div className="notification-settings__section-heading">
              <h3 className="notification-settings__section-title">{section.title}</h3>
              <p className="notification-settings__muted notification-settings__section-description">{section.description}</p>
            </div>
            <div className="notification-settings__preference-list">
              {section.keys.map((prefKey, idx) => (
                <div
                  key={prefKey}
                  className={`notification-settings__preference-row ${idx !== section.keys.length - 1 ? 'has-border' : ''}`}
                >
                  <span className="notification-settings__row-title">{LABELS[prefKey]}</span>
                  <Toggle
                    checked={prefs?.[prefKey] ?? true}
                    onChange={(val) => handleToggle(prefKey, val)}
                    disabled={saving}
                    ariaLabel={LABELS[prefKey]}
                  />
                </div>
              ))}
            </div>
            {sIdx < SECTIONS.length - 1 && (
              <div className="notification-settings__section-divider" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
