import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import toast from 'react-hot-toast';
import useWebPush from '../hooks/useWebPush';
import './NotificationPreferences.css';

// ─── Shared settings primitives (Track C) ──────────────────────────
// Every notification toggle on the settings surfaces rides SettingsToggle
// + PreferenceSection, and every toggle gates through the same backend
// surface (the prefs API) and the same gate (prefAllows in
// notificationService.js): the master toggle, per-type opt-outs,
// quiet-hours and SMS toggles are not one-off pages or per-type cases.
export function SettingsToggle({ checked, onChange, disabled, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`notification-settings__toggle ${checked ? 'is-on' : 'is-off'}`} data-track="ui.58eace89d8.1"
    >
      <span className="notification-settings__toggle-thumb" />
    </button>
  );
}

// Section shell shared by the settings page and the panels below: header
// (title + description) over a bordered preference list.
export function PreferenceSection({ title, description, children }) {
  return (
    <div className="notification-settings__preference-list rounded-2xl mb-6">
      <div className="px-6 py-4 border-b" style={{ borderBottomColor: 'var(--color-border)' }}>
        <h2 className="notification-settings__section-title">{title}</h2>
        {description ? (
          <p className="notification-settings__muted text-xs mt-0.5">{description}</p>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

// EmailPreferencesPanel (item 5): surfaces the unsubscribed-from-all state
// from GET /notifications/email and offers the explicit re-subscribe action
// (POST /notifications/email/resubscribe-all). Saving other email
// preferences never re-subscribes; only this button clears the flag.
export function EmailPreferencesPanel() {
  const { t } = useTranslation();
  const [unsubscribed, setUnsubscribed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/notifications/email')
      .then(r => {
        setUnsubscribed(!!r.data?.data?.unsubscribeAll);
        setLoading(false);
      })
      .catch(() => {
        toast.error(t('notifications.emailPrefs.failedLoad'));
        setLoading(false);
      });
  }, [t]);

  const runAction = useCallback(async (action) => {
    setSaving(true);
    try {
      if (action === 'resubscribe') {
        await api.post('/notifications/email/resubscribe-all');
        setUnsubscribed(false);
        toast.success(t('notifications.emailPrefs.resubscribedToast'));
      } else {
        await api.post('/notifications/email/unsubscribe-all');
        setUnsubscribed(true);
        toast.success(t('notifications.emailPrefs.unsubscribedToast'));
      }
    } catch {
      toast.error(t('notifications.emailPrefs.failedAction'));
    } finally {
      setSaving(false);
    }
  }, [t]);

  if (loading) return null;

  return (
    <PreferenceSection
      title={t('notifications.emailPrefs.title')}
      description={t('notifications.emailPrefs.description')}
    >
      {unsubscribed ? (
        <div className="notification-settings__preference-row">
          <div>
            <p className="notification-settings__row-title">{t('notifications.emailPrefs.unsubscribedTitle')}</p>
            <p className="notification-settings__muted text-xs mt-0.5">{t('notifications.emailPrefs.unsubscribedBody')}</p>
          </div>
          <button
            type="button"
            onClick={() => runAction('resubscribe')}
            disabled={saving}
            className="notification-settings__secondary-button" data-track="ui.58eace89d8.5"
          >
            {t('notifications.emailPrefs.resubscribe')}
          </button>
        </div>
      ) : (
        <div className="notification-settings__preference-row">
          <div>
            <p className="notification-settings__row-title">{t('notifications.emailPrefs.subscribedTitle')}</p>
            <p className="notification-settings__muted text-xs mt-0.5">{t('notifications.emailPrefs.subscribedBody')}</p>
          </div>
          <button
            type="button"
            onClick={() => runAction('unsubscribe')}
            disabled={saving}
            className="notification-settings__secondary-button" data-track="ui.58eace89d8.6"
          >
            {t('notifications.emailPrefs.unsubscribeAll')}
          </button>
        </div>
      )}
    </PreferenceSection>
  );
}

// Humanize a notification type key into a readable label. Per-type labels
// are NOT translated: ~100 labels x 5 locales is out of scope for this
// batch, and the humanized key is unambiguous (e.g. bid_received ->
// "Bid received"). Group names and all UI chrome are translated.
export function humanizeNotificationType(type) {
  const words = String(type || '').replace(/[:_]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return String(type || '');
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

const TYPE_GROUP_ORDER = [
  'work', 'payments', 'orders', 'appointments', 'messages', 'media',
  'restaurant', 'credit', 'support', 'account', 'other',
];

// TypeOptOutPanel (item 12): grouped per-type opt-out toggles for every
// discovered send type, one row per type with an In-app / Push / Email
// toggle each. The list comes from GET /preferences/types (scripted
// extraction from sendNotification call sites) and the state from GET
// /preferences/type-opt-outs; both ride the same prefs API as the master
// toggle, and every toggle gates through the same prefAllows gate. A type
// with no opt-out row is ON.
export function TypeOptOutPanel() {
  const { t } = useTranslation();
  const [types, setTypes] = useState(null);
  const [optOuts, setOptOuts] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/notifications/preferences/types'),
      api.get('/notifications/preferences/type-opt-outs'),
    ])
      .then(([typesRes, optOutsRes]) => {
        if (cancelled) return;
        setTypes(typesRes.data?.types || []);
        setOptOuts(optOutsRes.data?.opt_outs || []);
      })
      .catch(() => {
        if (!cancelled) toast.error(t('notifications.typeOptOuts.failedLoad'));
      });
    return () => { cancelled = true; };
  }, [t]);

  const groups = useMemo(() => {
    if (!types) return [];
    const byGroup = new Map();
    for (const entry of types) {
      if (!byGroup.has(entry.group)) byGroup.set(entry.group, []);
      byGroup.get(entry.group).push(entry.type);
    }
    return TYPE_GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
      key: g,
      types: [...byGroup.get(g)].sort(),
    }));
  }, [types]);

  const isOptedOut = useCallback((type, channel) => (
    (optOuts || []).some((o) => o.type === type && o.channel === channel)
  ), [optOuts]);

  const handleToggle = useCallback(async (type, channel, enabled) => {
    const optedOut = !enabled;
    setOptOuts((prev) => {
      const next = (prev || []).filter((o) => !(o.type === type && o.channel === channel));
      if (optedOut) next.push({ type, channel });
      return next;
    });
    setSaving(true);
    try {
      await api.put('/notifications/preferences/type-opt-outs', { type, channel, optedOut });
      toast.success(t('notifications.prefSaved'));
    } catch {
      setOptOuts((prev) => {
        const next = (prev || []).filter((o) => !(o.type === type && o.channel === channel));
        if (!optedOut) next.push({ type, channel });
        return next;
      });
      toast.error(t('notifications.failedSave'));
    } finally {
      setSaving(false);
    }
  }, [t]);

  if (!types || !optOuts) return null;

  const channels = ['in_app', 'push', 'email'];

  return (
    <div>
      <div className="notification-settings__section-heading">
        <h2 className="notification-settings__section-title">{t('notifications.typeOptOuts.title')}</h2>
        <p className="notification-settings__muted notification-settings__section-description">{t('notifications.typeOptOuts.description')}</p>
      </div>
      <div className="space-y-6">
        {groups.map((group) => (
          <PreferenceSection
            key={group.key}
            title={t(`notifications.typeGroups.${group.key}.label`)}
            description={t(`notifications.typeGroups.${group.key}.description`)}
          >
            <div className="notification-settings__preference-row">
              <span />
              <span className="flex items-center gap-4">
                {channels.map((channel) => (
                  <span key={channel} className="notification-settings__muted text-xs w-14 text-center">
                    {t(`notifications.typeOptOuts.${channel === 'in_app' ? 'inApp' : channel}`)}
                  </span>
                ))}
              </span>
            </div>
            {group.types.map((type, idx) => (
              <div
                key={type}
                className={`notification-settings__preference-row ${idx !== group.types.length - 1 ? 'has-border' : ''}`}
              >
                <span className="notification-settings__row-title">{humanizeNotificationType(type)}</span>
                <span className="flex items-center gap-4">
                  {channels.map((channel) => (
                    <span key={channel} className="w-14 flex justify-center">
                      <SettingsToggle
                        checked={!isOptedOut(type, channel)}
                        onChange={(val) => handleToggle(type, channel, val)}
                        disabled={saving}
                        ariaLabel={`${humanizeNotificationType(type)}: ${t(`notifications.typeOptOuts.${channel === 'in_app' ? 'inApp' : channel}`)}`}
                      />
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </PreferenceSection>
        ))}
      </div>
    </div>
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
    !wp.isSupported || !wp.serverEnabled || wp.loading || wp.permission === 'denied' || wp.needsInstallForPush;

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
          <SettingsToggle
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
              className="notification-settings__secondary-button" data-track="ui.58eace89d8.2"
            >
              {t('notifications.webPush.sendTest')}
            </button>
          </div>
        )}

        {wp.needsInstallForPush && (
          <div className="notification-settings__status-callout">
            <p className="notification-settings__status-title">{t('pwa.iosTitle')}</p>
            <p className="notification-settings__status-body">
              {t('notifications.webPush.iosInstallRequired')}
            </p>
            <ol className="notification-settings__status-body">
              <li>1. {t('pwa.iosStep1')}</li>
              <li>2. {t('pwa.iosStep2')}</li>
              <li>3. {t('pwa.iosStep3')}</li>
            </ol>
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
              className="notification-settings__secondary-button" data-track="ui.58eace89d8.3"
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
    in_app_media_creator_update: t('notifications.prefs.in_app_media_creator_update'),
    in_app_notifications:    t('notifications.prefs.in_app_notifications'),
    sms_support_replies:     t('notifications.prefs.sms_support_replies'),
    in_app_staff_time_entry_system_closed: t('notifications.prefs.in_app_staff_time_entry_system_closed'),
    in_app_staff_time_entry_missing_punch: t('notifications.prefs.in_app_staff_time_entry_missing_punch'),
    in_app_staff_time_entry_closeout_failed: t('notifications.prefs.in_app_staff_time_entry_closeout_failed'),
    in_app_restaurant_temperature_breach: t('notifications.prefs.in_app_restaurant_temperature_breach'),
    in_app_restaurant_scheduled_report: t('notifications.prefs.in_app_restaurant_scheduled_report'),
    in_app_restaurant_erasure_requested: t('notifications.prefs.in_app_restaurant_erasure_requested'),
    in_app_restaurant_erasure_decided: t('notifications.prefs.in_app_restaurant_erasure_decided'),
    in_app_restaurant_erasure_completed: t('notifications.prefs.in_app_restaurant_erasure_completed'),
    push_new_bid:            t('notifications.prefs.push_new_bid'),
    push_bid_accepted:       t('notifications.prefs.push_bid_accepted'),
    push_payment_released:   t('notifications.prefs.push_payment_released'),
    push_dispute_update:     t('notifications.prefs.push_dispute_update'),
    push_new_message:        t('notifications.prefs.push_new_message'),
    email_bid_accepted:      t('notifications.prefs.email_bid_accepted'),
    email_payment_released:  t('notifications.prefs.email_payment_released'),
    email_subscription:      t('notifications.prefs.email_subscription'),
    email_dispute_update:    t('notifications.prefs.email_dispute_update'),
    email_weekly_summary:    t('notifications.prefs.email_weekly_summary'),
    email_new_message:       t('notifications.prefs.email_new_message'),
  }), [t]);

  const SECTIONS = useMemo(() => [
    {
      key: 'masters',
      title: t('notifications.groups.masters.label'),
      description: t('notifications.groups.masters.description'),
      keys: [
        'in_app_notifications',
      ],
    },
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
      ],
    },
    {
      key: 'push',
      title: t('notifications.groups.push.label'),
      description: t('notifications.groups.push.description'),
      keys: [
        'push_new_bid',
        'push_bid_accepted',
        'push_payment_released',
        'push_dispute_update',
        'push_new_message',
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
    {
      key: 'restaurant',
      title: t('notifications.groups.restaurant.label'),
      description: t('notifications.groups.restaurant.description'),
      keys: [
        'in_app_staff_time_entry_system_closed',
        'in_app_staff_time_entry_missing_punch',
        'in_app_staff_time_entry_closeout_failed',
        'in_app_restaurant_temperature_breach',
        'in_app_restaurant_scheduled_report',
        'in_app_restaurant_erasure_requested',
        'in_app_restaurant_erasure_decided',
        'in_app_restaurant_erasure_completed',
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

      <EmailPreferencesPanel />

      <TypeOptOutPanel />

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
                  <SettingsToggle
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
