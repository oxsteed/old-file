import { useEffect, useState } from 'react';
import api                     from '../../api/api';

const PREF_GROUPS = [
  {
    label: 'In-App Notifications',
    prefix: 'in_app',
    prefs: [
      { key: 'new_bid',          label: 'New bid on my job'       },
      { key: 'bid_accepted',     label: 'My bid was accepted'     },
      { key: 'job_started',      label: 'Job started'             },
      { key: 'job_completed',    label: 'Job completed'           },
      { key: 'payment_released', label: 'Payment released'        },
      { key: 'new_review',       label: 'New review received'     },
      { key: 'dispute_update',   label: 'Dispute updates'         },
      { key: 'subscription',     label: 'Subscription updates'    },
    ]
  },
  {
    label: 'Push Notifications',
    prefix: 'push',
    prefs: [
      { key: 'new_job_nearby',   label: 'New jobs near me'        },
      { key: 'new_bid',          label: 'New bid on my job'       },
      { key: 'bid_accepted',     label: 'My bid was accepted'     },
      { key: 'payment_released', label: 'Payment released'        },
      { key: 'dispute_update',   label: 'Dispute updates'         },
    ]
  },
  {
    label: 'Email Notifications',
    prefix: 'email',
    prefs: [
      { key: 'bid_accepted',     label: 'Bid accepted'            },
      { key: 'payment_released', label: 'Payment released'        },
      { key: 'subscription',     label: 'Subscription events'     },
      { key: 'dispute_update',   label: 'Dispute updates'         },
      { key: 'weekly_summary',   label: 'Weekly activity summary' },
    ]
  }
];

export default function NotificationSettings() {
  const [prefs,   setPrefs]   = useState({});
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const { data } = await api.get('/notifications/preferences');
        setPrefs(data.preferences);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  const toggle = (key) => {
    setPrefs(prev => ({ ...prev, [key]: !prev[key] }));
    setSaved(false);
  };

  const savePrefs = async () => {
    setSaving(true);
    try {
      // Only send boolean pref keys
      const filtered = Object.fromEntries(
        Object.entries(prefs).filter(([k]) =>
          k.startsWith('in_app_') ||
          k.startsWith('push_')   ||
          k.startsWith('email_')
        )
      );
      await api.put('/notifications/preferences', filtered);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-400">Loading...</div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Notification Settings
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Choose how and when you receive notifications.
          </p>
        </div>
        <button
          onClick={savePrefs}
          disabled={saving}
          className={`px-5 py-2.5 rounded-xl text-sm font-semibold
                      transition ${
            saved
              ? 'bg-green-500 text-white'
              : 'bg-orange-500 text-white hover:bg-orange-600'
          } disabled:opacity-50`}
        >
          {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
        </button>
      </div>

      <div className="space-y-6">
        {PREF_GROUPS.map(group => (
          <div key={group.label}
               className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="font-semibold text-gray-800 mb-4">
              {group.label}
            </h2>
            <div className="space-y-4">
              {group.prefs.map(pref => {
                const fullKey = `${group.prefix}_${pref.key}`;
                const enabled = prefs[fullKey] !== false;
                return (
                  <div key={fullKey}
                       className="flex items-center justify-between gap-4">
                    abel
                      htmlFor={fullKey}
                      className="text-sm text-gray-700 cursor-pointer"
                    >
                      {pref.label}
                    </label>
                    <button
                      id={fullKey}
                      type="button"
                      onClick={() => toggle(fullKey)}
                      className={`relative inline-flex h-6 w-11 shrink-0
                                  rounded-full transition-colors duration-200
                                  focus:outline-none ${
                        enabled ? 'bg-orange-500' : 'bg-gray-200'
                      }`}
                    >
                      <span className={`inline-block h-5 w-5 transform
                                        rounded-full bg-white shadow
                                        transition-transform duration-200
                                        mt-0.5 ${
                        enabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
