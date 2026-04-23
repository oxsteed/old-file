import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import toast from 'react-hot-toast';

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? 'bg-orange-500' : 'bg-gray-700'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition duration-200 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
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

      <div className="space-y-8">
        {SECTIONS.map((section, sIdx) => (
          <div key={section.key}>
            <div className="mb-3">
              <h3 className="text-base font-medium" style={{ color: 'var(--app-text,#f1f5f9)' }}>{section.title}</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted-text,#94a3b8)' }}>{section.description}</p>
            </div>
            <div className="space-y-0 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-color,rgba(255,255,255,.08))' }}>
              {section.keys.map((prefKey, idx) => (
                <div
                  key={prefKey}
                  className={`flex items-center justify-between px-4 py-3 transition-colors ${
                    idx !== section.keys.length - 1 ? 'border-b' : ''
                  } hover:bg-white/5`}
                  style={idx !== section.keys.length - 1 ? { borderBottomColor: 'var(--border-color,rgba(255,255,255,.08))' } : {}}
                >
                  <span className="text-sm" style={{ color: 'var(--app-text,#f1f5f9)' }}>{LABELS[prefKey]}</span>
                  <Toggle
                    checked={prefs?.[prefKey] ?? true}
                    onChange={(val) => handleToggle(prefKey, val)}
                    disabled={saving}
                  />
                </div>
              ))}
            </div>
            {sIdx < SECTIONS.length - 1 && (
              <div className="mt-8" style={{ borderTop: '1px solid var(--border-color,rgba(255,255,255,.08))' }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
