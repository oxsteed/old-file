import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Bell } from 'lucide-react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import { BrowserPushPanel } from '../../components/NotificationPreferences';
import OfferPreferencesPanel from '../../growth/OfferPreferencesPanel';

// Master toggles gate whole channels: push_notifications covers every push
// channel (Expo, Web Push, native), sms_notifications covers all SMS.
// Removed (review P2-8-F03): in_app_message_mention, push_message_mention
// (no mention events exist) and push_new_job_nearby (no nearby-job events).
const MASTER_PREFS = ['push_notifications', 'sms_notifications'];

const PREF_GROUPS = [
  {
    key: 'in_app',
    prefs: [
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
    prefs: [
      'push_new_bid',
      'push_bid_accepted',
      'push_payment_released',
      'push_dispute_update',
      'push_new_message',
    ],
  },
  {
    key: 'email',
    prefs: [
      'email_bid_accepted',
      'email_payment_released',
      'email_subscription',
      'email_dispute_update',
      'email_weekly_summary',
      'email_new_message',
    ],
  },
];

function Toggle({ checked, onChange, disabled, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`notification-settings__toggle ${checked ? 'is-on' : 'is-off'}`} data-track="ui.1a983f2bdd.1"
    >
      <span className="notification-settings__toggle-thumb" />
    </button>
  );
}

// P2-8-F07: the calendar notification-preferences endpoint (channel arrays +
// quiet hours) previously had no client UI. This panel wires the quiet-hours
// fields (toggle + start/end) to GET/PUT /calendar/notification-preferences.
function QuietHoursPanel() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [start, setStart] = useState('22:00');
  const [end, setEnd] = useState('07:00');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const toHHMM = (value) => String(value || '').slice(0, 5) || '';

  useEffect(() => {
    api.get('/calendar/notification-preferences')
      .then(r => {
        const p = r.data || {};
        setEnabled(!!p.quiet_hours_enabled);
        if (p.quiet_hours_start) setStart(toHHMM(p.quiet_hours_start));
        if (p.quiet_hours_end) setEnd(toHHMM(p.quiet_hours_end));
        setLoading(false);
      })
      .catch(() => {
        toast.error(t('notifications.quietHours.failedLoad'));
        setLoading(false);
      });
  }, [t]);

  const save = useCallback(async (next) => {
    setSaving(true);
    try {
      await api.put('/calendar/notification-preferences', next);
      toast.success(t('notifications.quietHours.saved'));
    } catch {
      toast.error(t('notifications.quietHours.failedSave'));
    } finally {
      setSaving(false);
    }
  }, [t]);

  const handleToggle = (value) => {
    setEnabled(value);
    save({ quiet_hours_enabled: value, quiet_hours_start: start, quiet_hours_end: end });
  };

  const handleTimeChange = (which, value) => {
    const nextStart = which === 'start' ? value : start;
    const nextEnd = which === 'end' ? value : end;
    if (which === 'start') setStart(value); else setEnd(value);
    save({ quiet_hours_enabled: enabled, quiet_hours_start: nextStart, quiet_hours_end: nextEnd });
  };

  return (
    <div className="notification-settings__preference-list rounded-2xl mb-6">
      <div className="px-6 py-4 border-b" style={{ borderBottomColor: 'var(--color-border)' }}>
        <h2 className="notification-settings__section-title">{t('notifications.quietHours.title')}</h2>
        <p className="notification-settings__muted text-xs mt-0.5">{t('notifications.quietHours.description')}</p>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin h-6 w-6 border-2 border-orange-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div>
          <div className="notification-settings__preference-row has-border">
            <div>
              <label className="notification-settings__row-title cursor-pointer select-none">
                {t('notifications.quietHours.enabled')}
              </label>
              <p className="notification-settings__muted text-xs mt-0.5">{t('notifications.quietHours.enabledDesc')}</p>
            </div>
            <Toggle
              checked={enabled}
              onChange={handleToggle}
              disabled={saving}
              ariaLabel={t('notifications.quietHours.enabled')}
            />
          </div>
          <div className="notification-settings__preference-row">
            <div>
              <label className="notification-settings__row-title select-none">
                {t('notifications.quietHours.window')}
              </label>
              <p className="notification-settings__muted text-xs mt-0.5">{t('notifications.quietHours.windowDesc')}</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={start}
                disabled={!enabled || saving}
                onChange={(e) => handleTimeChange('start', e.target.value)}
                aria-label={t('notifications.quietHours.startLabel')}
                className="px-2 py-1.5 rounded-lg border text-sm bg-transparent"
                style={{ borderColor: 'var(--color-border)' }}
              />
              <span className="notification-settings__muted text-sm">{t('notifications.quietHours.to')}</span>
              <input
                type="time"
                value={end}
                disabled={!enabled || saving}
                onChange={(e) => handleTimeChange('end', e.target.value)}
                aria-label={t('notifications.quietHours.endLabel')}
                className="px-2 py-1.5 rounded-lg border text-sm bg-transparent"
                style={{ borderColor: 'var(--color-border)' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NotificationSettings() {
  const { t } = useTranslation();
  const [prefs,   setPrefs]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

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
      setPrefs(prev => ({ ...prev, [key]: !value }));
      toast.error(t('notifications.failedSave'));
    } finally {
      setSaving(false);
    }
  }, [t]);

  return (
    <div className="min-h-screen sp-page">
      <Navbar />

      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 py-10">

          {/* Back link */}
          <Link
            to="/settings"
            className="notification-settings__back-link inline-flex items-center gap-2 mb-8 transition text-sm"
          >
            <ArrowLeft size={16} />
            {t('notifications.backToSettings')}
          </Link>

          {/* Page header */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
              <Bell size={20} className="text-orange-400" />
            </div>
            <div>
              <h1 className="notification-settings__page-title text-2xl font-bold">{t('notifications.title')}</h1>
              <p className="notification-settings__muted text-sm mt-0.5">
                {t('notifications.subtitle')}
              </p>
            </div>
            {saving && (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-orange-600">
                <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {t('notifications.saving')}
              </span>
            )}
          </div>

          <div className="notification-settings__security-notice" role="note">
            <p className="notification-settings__security-title">{t('notifications.securityNoticeTitle')}</p>
            <p className="notification-settings__security-body">{t('notifications.securityNoticeBody')}</p>
          </div>

          <BrowserPushPanel />

          <OfferPreferencesPanel />

          <QuietHoursPanel />

          {/* Master channel toggles */}
          {!loading && (
            <div className="notification-settings__preference-list rounded-2xl mb-6">
              <div className="px-6 py-4 border-b" style={{ borderBottomColor: 'var(--color-border)' }}>
                <h2 className="notification-settings__section-title">{t('notifications.groups.masters.label')}</h2>
                <p className="notification-settings__muted text-xs mt-0.5">{t('notifications.groups.masters.description')}</p>
              </div>
              <div>
                {MASTER_PREFS.map((prefKey, idx) => {
                  const enabled = prefs?.[prefKey] ?? true;
                  return (
                    <div
                      key={prefKey}
                      className={`notification-settings__preference-row ${idx !== MASTER_PREFS.length - 1 ? 'has-border' : ''}`}
                    >
                      <div>
                        <label
                          htmlFor={prefKey}
                          className="notification-settings__row-title cursor-pointer select-none"
                        >
                          {t(`notifications.prefs.${prefKey}`)}
                        </label>
                        <p className="notification-settings__muted text-xs mt-0.5">{t(`notifications.prefs.${prefKey}Desc`)}</p>
                      </div>
                      <Toggle
                        checked={enabled}
                        onChange={(val) => handleToggle(prefKey, val)}
                        disabled={saving}
                        ariaLabel={t(`notifications.prefs.${prefKey}`)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="animate-spin h-8 w-8 border-2 border-orange-500 border-t-transparent rounded-full" />
            </div>
          ) : (
            <div className="space-y-6">
              {PREF_GROUPS.map((group) => (
                <div
                  key={group.key}
                  className="notification-settings__preference-list rounded-2xl"
                >
                  {/* Group header */}
                  <div className="px-6 py-4 border-b" style={{ borderBottomColor: 'var(--color-border)' }}>
                    <h2 className="notification-settings__section-title">{t(`notifications.groups.${group.key}.label`)}</h2>
                    <p className="notification-settings__muted text-xs mt-0.5">{t(`notifications.groups.${group.key}.description`)}</p>
                  </div>

                  {/* Pref rows */}
                  <div>
                    {group.prefs.map((prefKey, idx) => {
                      const enabled = prefs?.[prefKey] ?? true;
                      return (
                        <div
                          key={prefKey}
                          className={`notification-settings__preference-row ${idx !== group.prefs.length - 1 ? 'has-border' : ''}`}
                        >
                          <label
                            htmlFor={prefKey}
                            className="notification-settings__row-title cursor-pointer select-none"
                          >
                            {t(`notifications.prefs.${prefKey}`)}
                          </label>
                          <Toggle
                            checked={enabled}
                            onChange={(val) => handleToggle(prefKey, val)}
                            disabled={saving}
                            ariaLabel={t(`notifications.prefs.${prefKey}`)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
