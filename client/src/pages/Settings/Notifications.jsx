import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bell } from 'lucide-react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';

const PREF_GROUPS = [
  {
    key: 'in_app',
    label: 'In-App Notifications',
    description: 'Shown inside the app in your notification center.',
    prefs: [
      { key: 'in_app_new_bid',          label: 'New bid on my job'        },
      { key: 'in_app_bid_accepted',     label: 'My bid was accepted'      },
      { key: 'in_app_job_started',      label: 'Job started'              },
      { key: 'in_app_job_completed',    label: 'Job completed'            },
      { key: 'in_app_payment_released', label: 'Payment released'         },
      { key: 'in_app_new_review',       label: 'New review received'      },
      { key: 'in_app_dispute_update',   label: 'Dispute updates'          },
      { key: 'in_app_subscription',     label: 'Subscription updates'     },
    ],
  },
  {
    key: 'push',
    label: 'Push Notifications',
    description: 'Alerts sent directly to your device.',
    prefs: [
      { key: 'push_new_job_nearby',   label: 'New jobs near me'         },
      { key: 'push_new_bid',          label: 'New bid on my job'        },
      { key: 'push_bid_accepted',     label: 'My bid was accepted'      },
      { key: 'push_payment_released', label: 'Payment released'         },
      { key: 'push_dispute_update',   label: 'Dispute updates'          },
    ],
  },
  {
    key: 'email',
    label: 'Email Notifications',
    description: 'Messages sent to your registered email address.',
    prefs: [
      { key: 'email_bid_accepted',      label: 'Bid accepted'             },
      { key: 'email_payment_released',  label: 'Payment released'         },
      { key: 'email_subscription',      label: 'Subscription events'      },
      { key: 'email_dispute_update',    label: 'Dispute updates'          },
      { key: 'email_weekly_summary',    label: 'Weekly activity summary'  },
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
      setPrefs(prev => ({ ...prev, [key]: !value }));
      toast.error('Failed to save preference');
    } finally {
      setSaving(false);
    }
  }, []);

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
            Back to Settings
          </Link>

          {/* Page header */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
              <Bell size={20} className="text-orange-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Notification Settings</h1>
              <p className="text-sm text-gray-400 mt-0.5">
                Choose how and when you receive notifications.
              </p>
            </div>
            {saving && (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-orange-400">
                <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Saving...
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
                    <h2 className="text-base font-semibold text-white">{group.label}</h2>
                    <p className="text-xs text-gray-500 mt-0.5">{group.description}</p>
                  </div>

                  {/* Pref rows */}
                  <div>
                    {group.prefs.map((pref, idx) => {
                      const enabled = prefs?.[pref.key] ?? true;
                      return (
                        <div
                          key={pref.key}
                          className={`flex items-center justify-between px-6 py-3.5 hover:bg-gray-800/40 transition-colors ${
                            idx !== group.prefs.length - 1 ? 'border-b border-gray-800/60' : ''
                          }`}
                        >
                          <label
                            htmlFor={pref.key}
                            className="text-sm text-gray-200 cursor-pointer select-none"
                          >
                            {pref.label}
                          </label>
                          <Toggle
                            checked={enabled}
                            onChange={(val) => handleToggle(pref.key, val)}
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
