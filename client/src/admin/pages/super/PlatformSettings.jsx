import { useEffect, useState } from 'react';
import adminApi                from '../../../lib/adminApi';

export default function PlatformSettings() {
  const [settings, setSettings] = useState([]);
  const [flags,    setFlags]    = useState([]);
  const [editing,  setEditing]  = useState({});
  const [saving,   setSaving]   = useState(null);
  const [message,  setMessage]  = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const { data } = await adminApi.get('/admin/settings');
        setSettings(data.settings);
        setFlags(data.flags);
        // Pre-populate editing state
        const editMap = {};
        data.settings.forEach(s => { editMap[s.key] = s.value; });
        setEditing(editMap);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  const saveSetting = async (key) => {
    setSaving(key);
    setMessage(null);
    try {
      await adminApi.put(`/admin/settings/${key}`, { value: editing[key] });
      setSettings(prev =>
        prev.map(s => s.key === key ? { ...s, value: editing[key] } : s)
      );
      setMessage({ type: 'success', text: `"${key}" saved.` });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.error || 'Save failed.'
      });
    } finally {
      setSaving(null);
    }
  };

  const toggleFlag = async (key, current) => {
    try {
      await adminApi.put(`/admin/feature-flags/${key}`, {
        enabled: !current
      });
      setFlags(prev =>
        prev.map(f => f.key === key ? { ...f, enabled: !current } : f)
      );
      setMessage({ type: 'success', text: `Flag "${key}" updated.` });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.error || 'Update failed.'
      });
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">Loading settings...</div>
    );
  }

  // Group settings by category
  const feeSettings      = settings.filter(s => s.key.includes('fee') || s.key.includes('broker_cut'));
  const jobSettings      = settings.filter(s => ['max_job_budget','bid_expiry_hours','escrow_release_delay_hrs','min_helper_rating'].includes(s.key));
  const systemSettings   = settings.filter(s => ['maintenance_mode','new_user_registrations','require_id_verification','support_email'].includes(s.key));

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-white mb-2">Platform Settings</h1>
      <p className="text-gray-400 text-sm mb-8">
        Changes take effect immediately. All changes are logged.
      </p>

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm mb-6 ${
          message.type === 'success'
            ? 'bg-green-900 border border-green-700 text-green-300'
            : 'bg-red-900 border border-red-700 text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      {/* Fee settings */}
      <SettingsSection
        title="Fee Configuration"
        description="Platform commission rates. Changes affect new jobs only."
        settings={feeSettings}
        editing={editing}
        setEditing={setEditing}
        onSave={saveSetting}
        saving={saving}
      />

      {/* Job settings */}
      <SettingsSection
        title="Job Settings"
        description="Rules governing job creation and bidding."
        settings={jobSettings}
        editing={editing}
        setEditing={setEditing}
        onSave={saveSetting}
        saving={saving}
      />

      {/* System settings */}
      <SettingsSection
        title="System"
        description="Platform-wide operational controls."
        settings={systemSettings}
        editing={editing}
        setEditing={setEditing}
        onSave={saveSetting}
        saving={saving}
      />

      {/* Feature flags */}
      <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 mb-6">
        <h2 className="font-semibold text-white mb-1">Feature Flags</h2>
        <p className="text-gray-400 text-xs mb-5">
          Toggle platform features without a deployment.
        </p>
        <div className="space-y-4">
          {flags.map(flag => (
            <div key={flag.key}
                 className="flex items-center justify-between gap-4
                            pb-4 border-b border-gray-700/50 last:border-0
                            last:pb-0">
              <div>
                <p className="text-sm font-medium text-white">
                  {flag.key.replace(/_/g, ' ')}
                </p>
                {flag.description && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {flag.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => toggleFlag(flag.key, flag.enabled)}
                className={`relative inline-flex h-6 w-11 shrink-0
                            rounded-full transition-colors duration-200
                            focus:outline-none ${
                  flag.enabled ? 'bg-orange-500' : 'bg-gray-600'
                }`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full
                                  bg-white shadow transition-transform
                                  duration-200 mt-0.5 ${
                  flag.enabled ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsSection({
  title, description, settings,
  editing, setEditing, onSave, saving
}) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 mb-6">
      <h2 className="font-semibold text-white mb-1">{title}</h2>
      <p className="text-gray-400 text-xs mb-5">{description}</p>
      <div className="space-y-4">
        {settings.map(setting => (
          <div key={setting.key}
               className="flex items-center justify-between gap-4
                          pb-4 border-b border-gray-700/50
                          last:border-0 last:pb-0">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">
                {setting.key.replace(/_/g, ' ')}
              </p>
              {setting.description && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {setting.description}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type={setting.value_type === 'number' ? 'number' : 'text'}
                value={editing[setting.key] ?? setting.value}
                onChange={e => setEditing(prev => ({
                  ...prev, [setting.key]: e.target.value
                }))}
                step={setting.value_type === 'number' ? '0.01' : undefined}
                className="w-32 px-3 py-1.5 bg-gray-700 border
                           border-gray-600 rounded-lg text-sm text-white
                           text-right focus:outline-none
                           focus:border-orange-500"
              />
              <button
                onClick={() => onSave(setting.key)}
                disabled={
                  saving === setting.key ||
                  String(editing[setting.key]) === String(setting.value)
                }
                className="px-3 py-1.5 bg-orange-500 text-white text-xs
                           font-semibold rounded-lg hover:bg-orange-600
                           disabled:opacity-40 transition"
              >
                {saving === setting.key ? '...' : 'Save'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
