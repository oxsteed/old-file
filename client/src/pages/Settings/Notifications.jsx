import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Bell } from 'lucide-react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';

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
    ],
  },
  {
    key: 'push',
    prefs: [
      'push_new_job_nearby',
      'push_new_bid',
      'push_bid_accepted',
      'push_payment_released',
      'push_dispute_update',
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
    ],
  },
];

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-gray-950 disabled:opacity-40 disabled:cursor-not-allowed ${
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
  }, []);

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
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <Navbar />

      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 py-10">

          {/* Back link */}
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-8 transition text-sm"
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
              <h1 className="text-2xl font-bold text-white">{t('notifications.title')}</h1>
              <p className="text-sm text-gray-400 mt-0.5">
                {t('notifications.subtitle')}
              </p>
            </div>
            {saving && (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-orange-400">
                <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {t('notifications.saving')}
              </span>
            )}
          </div>

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
                  className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden"
                >
                  {/* Group header */}
                  <div className="px-6 py-4 border-b border-gray-800">
                    <h2 className="text-base font-semibold text-white">{t(`notifications.groups.${group.key}.label`)}</h2>
                    <p className="text-xs text-gray-500 mt-0.5">{t(`notifications.groups.${group.key}.description`)}</p>
                  </div>

                  {/* Pref rows */}
                  <div>
                    {group.prefs.map((prefKey, idx) => {
                      const enabled = prefs?.[prefKey] ?? true;
                      return (
                        <div
                          key={prefKey}
                          className={`flex items-center justify-between px-6 py-3.5 hover:bg-gray-800/40 transition-colors ${
                            idx !== group.prefs.length - 1 ? 'border-b border-gray-800/60' : ''
                          }`}
                        >
                          <label
                            htmlFor={prefKey}
                            className="text-sm text-gray-200 cursor-pointer select-none"
                          >
                            {t(`notifications.prefs.${prefKey}`)}
                          </label>
                          <Toggle
                            checked={enabled}
                            onChange={(val) => handleToggle(prefKey, val)}
                            disabled={saving}
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
