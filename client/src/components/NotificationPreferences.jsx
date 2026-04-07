import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';

const LABELS = {
  in_app_new_bid:          'New bid received',
  in_app_bid_accepted:     'Bid accepted',
  in_app_job_started:      'Job started',
  in_app_job_completed:    'Job completed',
  in_app_payment_released: 'Payment released',
  in_app_new_review:       'New review',
  in_app_dispute_update:   'Dispute update',
  in_app_subscription:     'Subscription changes',
  push_new_job_nearby:     'New jobs nearby',
  push_new_bid:            'New bid on your job',
  push_bid_accepted:       'Your bid was accepted',
  push_payment_released:   'Payment released',
  push_dispute_update:     'Dispute update',
  email_bid_accepted:      'Bid accepted',
  email_payment_released:  'Payment released',
  email_subscription:      'Subscription changes',
  email_dispute_update:    'Dispute update',
  email_weekly_summary:    'Weekly summary',
};

const SECTIONS = [
  {
    key: 'in_app',
    title: 'In-App',
    description: 'Notifications shown inside the app.',
    keys: [
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
    title: 'Push Notifications',
    description: 'Alerts sent to your device.',
    keys: [
      'push_new_job_nearby',
      'push_new_bid',
      'push_bid_accepted',
      'push_payment_released',
      'push_dispute_update',
    ],
  },
  {
    key: 'email',
    title: 'Email',
    description: 'Messages sent to your email address.',
    keys: [
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
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/notifications/preferences')
      .then(r => {
        setPrefs(r.data?.preferences || {});
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load notification preferences');
        setLoading(false);
      });
  }, []);

  const handleToggle = useCallback(async (key, value) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
    setSaving(true);
    try {
      await api.put('/notifications/preferences', { [key]: value });
      toast.success('Preference saved');
    } catch {
      // Revert on failure
      setPrefs(prev => ({ ...prev, [key]: !value }));
      toast.error('Failed to save preference');
    } finally {
      setSaving(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
        <h2 className="text-xl font-semibold mb-4">Notification Preferences</h2>
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <svg className="animate-spin h-4 w-4 text-orange-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Loading preferences...
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-semibold">Notification Preferences</h2>
        {saving && (
          <span className="flex items-center gap-1.5 text-xs text-orange-400">
            <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Saving...
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-6">Choose how you want to be notified about activity on your account.</p>

      <div className="space-y-8">
        {SECTIONS.map((section, sIdx) => (
          <div key={section.key}>
            <div className="mb-3">
              <h3 className="text-base font-medium text-white">{section.title}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
            </div>
            <div className="space-y-0 rounded-xl border border-gray-800 overflow-hidden">
              {section.keys.map((prefKey, idx) => (
                <div
                  key={prefKey}
                  className={`flex items-center justify-between px-4 py-3 ${
                    idx !== section.keys.length - 1 ? 'border-b border-gray-800' : ''
                  } hover:bg-gray-800/40 transition-colors`}
                >
                  <span className="text-sm text-gray-200">{LABELS[prefKey]}</span>
                  <Toggle
                    checked={prefs?.[prefKey] ?? true}
                    onChange={(val) => handleToggle(prefKey, val)}
                    disabled={saving}
                  />
                </div>
              ))}
            </div>
            {sIdx < SECTIONS.length - 1 && (
              <div className="mt-8 border-t border-gray-800" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
