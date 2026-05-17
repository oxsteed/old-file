import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  Loader2,
  Shield,
  Sparkles,
  ToggleLeft,
  Wrench,
} from 'lucide-react';
import adminApi from '../../../lib/adminApi';

const SECTION_CONFIG = {
  fees: {
    title: 'Revenue Controls',
    description: 'Platform commission and brokerage settings that shape unit economics for new transactions.',
    icon: DollarSign,
    tone: 'from-emerald-500/18 via-emerald-500/6 to-transparent border-emerald-500/25',
  },
  jobs: {
    title: 'Marketplace Rules',
    description: 'Guardrails for job creation, bidding windows, escrow timing, and quality thresholds.',
    icon: Briefcase,
    tone: 'from-amber-500/18 via-amber-500/6 to-transparent border-amber-500/25',
  },
  system: {
    title: 'Platform Controls',
    description: 'Operational switches that affect registrations, verification, maintenance posture, and support handling.',
    icon: Shield,
    tone: 'from-sky-500/18 via-sky-500/6 to-transparent border-sky-500/25',
  },
};

function prettifyKey(key) {
  return key.replace(/_/g, ' ');
}

function countChanged(settings, editing) {
  return settings.filter((setting) => String(editing[setting.key] ?? setting.value) !== String(setting.value)).length;
}

function inferredSection(setting) {
  if (setting.key.includes('fee') || setting.key.includes('broker_cut')) return 'fees';
  if (['max_job_budget', 'bid_expiry_hours', 'escrow_release_delay_hrs', 'min_helper_rating'].includes(setting.key)) return 'jobs';
  if (['maintenance_mode', 'new_user_registrations', 'require_id_verification', 'support_email'].includes(setting.key)) return 'system';
  return 'system';
}

function valueTypeLabel(setting) {
  if (setting.value_type === 'number') return 'Numeric';
  if (setting.value_type === 'boolean') return 'Boolean';
  if ((setting.key || '').includes('email')) return 'Contact';
  return 'Text';
}

function MessageBanner({ message }) {
  if (!message) return null;

  const success = message.type === 'success';
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${
      success
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
        : 'border-red-500/30 bg-red-500/10 text-red-300'
    }`}>
      {message.text}
    </div>
  );
}

function OverviewCard({ icon: Icon, label, value, hint, color = 'text-white' }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-[#111318] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</span>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-800 bg-gray-900/70">
          <Icon className="h-4 w-4 text-gray-400" />
        </div>
      </div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      {hint && <p className="mt-2 text-xs leading-5 text-gray-500">{hint}</p>}
    </div>
  );
}

function SettingsSection({ sectionKey, config, settings, editing, setEditing, onSave, saving }) {
  const Icon = config.icon;

  return (
    <section className={`rounded-[28px] border bg-gradient-to-br p-5 ${config.tone}`}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
              <Icon className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{sectionKey}</p>
              <h2 className="text-lg font-semibold text-white">{config.title}</h2>
            </div>
          </div>
          <p className="text-sm leading-6 text-gray-300">{config.description}</p>
        </div>
        <div className="hidden rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-gray-300 lg:block">
          {settings.length} setting{settings.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="space-y-3">
        {settings.map((setting) => {
          const currentValue = editing[setting.key] ?? setting.value;
          const dirty = String(currentValue) !== String(setting.value);

          return (
            <div
              key={setting.key}
              className={`rounded-2xl border p-4 transition ${
                dirty
                  ? 'border-orange-500/30 bg-orange-500/8'
                  : 'border-gray-800 bg-[#111318]/85'
              }`}
            >
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">{prettifyKey(setting.key)}</p>
                    <span className="rounded-full border border-gray-700 bg-gray-900/80 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-gray-400">
                      {valueTypeLabel(setting)}
                    </span>
                    {dirty && (
                      <span className="rounded-full border border-orange-500/30 bg-orange-500/12 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-orange-300">
                        Unsaved
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-5 text-gray-500">
                    {setting.description || 'No description provided for this platform control.'}
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center xl:shrink-0">
                  <input
                    type={setting.value_type === 'number' ? 'number' : 'text'}
                    value={currentValue}
                    onChange={(event) => setEditing((prev) => ({
                      ...prev,
                      [setting.key]: event.target.value,
                    }))}
                    step={setting.value_type === 'number' ? '0.01' : undefined}
                    className="min-w-[170px] rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-orange-500"
                  />
                  <button
                    onClick={() => onSave(setting.key)}
                    disabled={saving === setting.key || !dirty}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {saving === setting.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {saving === setting.key ? 'Saving' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FeatureFlagRow({ flag, onToggle }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-[#111318] p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">{prettifyKey(flag.key)}</p>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em] ${
              flag.enabled
                ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300'
                : 'border-gray-700 bg-gray-900/70 text-gray-400'
            }`}>
              {flag.enabled ? 'Live' : 'Off'}
            </span>
          </div>
          <p className="text-xs leading-5 text-gray-500">
            {flag.description || 'No description provided for this rollout flag.'}
          </p>
        </div>

        <button
          onClick={onToggle}
          className={`inline-flex items-center gap-3 rounded-2xl border px-4 py-2 text-sm font-medium transition ${
            flag.enabled
              ? 'border-orange-500/30 bg-orange-500/12 text-orange-200 hover:bg-orange-500/18'
              : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500 hover:text-white'
          }`}
        >
          <ToggleLeft className={`h-5 w-5 transition ${flag.enabled ? 'rotate-180 text-orange-300' : 'text-gray-500'}`} />
          {flag.enabled ? 'Disable flag' : 'Enable flag'}
          <ChevronRight className="h-4 w-4 opacity-60" />
        </button>
      </div>
    </div>
  );
}

export default function PlatformSettings() {
  const [settings, setSettings] = useState([]);
  const [flags, setFlags] = useState([]);
  const [editing, setEditing] = useState({});
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data } = await adminApi.get('/admin/settings');
        setSettings(data.settings || []);
        setFlags(data.flags || []);
        const editMap = {};
        (data.settings || []).forEach((setting) => {
          editMap[setting.key] = setting.value;
        });
        setEditing(editMap);
      } catch (err) {
        console.error(err);
        setMessage({ type: 'error', text: 'Failed to load platform settings.' });
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const saveSetting = async (key) => {
    setSaving(key);
    setMessage(null);
    try {
      await adminApi.put(`/admin/settings/${key}`, { value: editing[key] });
      setSettings((prev) => prev.map((setting) => (
        setting.key === key ? { ...setting, value: editing[key] } : setting
      )));
      setMessage({ type: 'success', text: `"${key}" saved.` });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.error || 'Save failed.',
      });
    } finally {
      setSaving(null);
    }
  };

  const toggleFlag = async (key, current) => {
    setMessage(null);
    try {
      await adminApi.put(`/admin/feature-flags/${key}`, { enabled: !current });
      setFlags((prev) => prev.map((flag) => (
        flag.key === key ? { ...flag, enabled: !current } : flag
      )));
      setMessage({ type: 'success', text: `Flag "${key}" updated.` });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.error || 'Update failed.',
      });
    }
  };

  const groupedSettings = useMemo(() => {
    const groups = { fees: [], jobs: [], system: [] };
    settings.forEach((setting) => {
      groups[inferredSection(setting)].push(setting);
    });
    return groups;
  }, [settings]);

  const changedCount = useMemo(() => countChanged(settings, editing), [settings, editing]);
  const enabledFlagsCount = flags.filter((flag) => flag.enabled).length;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 py-12">
        <div className="rounded-3xl border border-gray-800 bg-[#111318] px-6 py-5 text-center text-gray-400">
          <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin text-orange-400" />
          Loading platform settings...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="overflow-hidden rounded-[30px] border border-gray-800 bg-gradient-to-br from-[#12151c] via-[#0f1218] to-[#0b0d11]">
          <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.25fr)_360px] lg:p-7">
            <div className="space-y-5">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-500/25 bg-orange-500/12">
                  <Wrench className="h-5 w-5 text-orange-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-300/80">Super Admin</p>
                  <h1 className="mt-1 text-3xl font-semibold text-white">Platform Settings</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-300">
                    Central control surface for marketplace rules, revenue logic, platform safety switches, and rollout toggles. Changes apply immediately, so this page should make impact and risk obvious before you save.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <OverviewCard
                  icon={Wrench}
                  label="Total Settings"
                  value={settings.length}
                  hint="Editable platform configuration values loaded from the admin settings store."
                  color="text-sky-300"
                />
                <OverviewCard
                  icon={Sparkles}
                  label="Feature Flags"
                  value={flags.length}
                  hint="Rollout toggles you can activate without shipping a new deployment."
                  color="text-violet-300"
                />
                <OverviewCard
                  icon={AlertTriangle}
                  label="Unsaved Changes"
                  value={changedCount}
                  hint="Inputs that differ from the last saved platform value."
                  color={changedCount > 0 ? 'text-orange-300' : 'text-emerald-300'}
                />
                <OverviewCard
                  icon={ToggleLeft}
                  label="Flags Enabled"
                  value={enabledFlagsCount}
                  hint="Feature toggles currently live on the platform."
                  color="text-emerald-300"
                />
              </div>
            </div>

            <div className="rounded-[26px] border border-gray-800 bg-[#111318] p-5">
              <div className="mb-4 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-orange-400" />
                <p className="text-sm font-semibold text-white">Control Notes</p>
              </div>
              <div className="space-y-3 text-sm leading-6 text-gray-300">
                <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                  Revenue and job-rule changes affect new marketplace activity, so review them like policy decisions, not cosmetic edits.
                </div>
                <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                  System settings and feature flags can materially change onboarding, verification, and availability for users already in production.
                </div>
                <div className="rounded-2xl border border-orange-500/20 bg-orange-500/8 p-4 text-orange-100">
                  Use this page as an operations hub: scan the overview first, save only the rows you intend to change, and treat enabled flags as live rollout commitments.
                </div>
              </div>
            </div>
          </div>
        </div>

        <MessageBanner message={message} />

        <div className="grid gap-4 xl:grid-cols-3">
          <SettingsSection
            sectionKey="fees"
            config={SECTION_CONFIG.fees}
            settings={groupedSettings.fees}
            editing={editing}
            setEditing={setEditing}
            onSave={saveSetting}
            saving={saving}
          />
          <SettingsSection
            sectionKey="jobs"
            config={SECTION_CONFIG.jobs}
            settings={groupedSettings.jobs}
            editing={editing}
            setEditing={setEditing}
            onSave={saveSetting}
            saving={saving}
          />
          <SettingsSection
            sectionKey="system"
            config={SECTION_CONFIG.system}
            settings={groupedSettings.system}
            editing={editing}
            setEditing={setEditing}
            onSave={saveSetting}
            saving={saving}
          />
        </div>

        <section className="rounded-[30px] border border-gray-800 bg-[#0f1117] p-5 lg:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-indigo-500/20 bg-indigo-500/10">
                  <ToggleLeft className="h-4.5 w-4.5 text-indigo-300" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Rollouts</p>
                  <h2 className="text-lg font-semibold text-white">Feature Flags</h2>
                </div>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-gray-300">
                Toggle platform capabilities without deploying. This is the fastest way to gate or reopen functionality, so the interface should make live state very obvious.
              </p>
            </div>
            <div className="hidden rounded-2xl border border-gray-800 bg-[#111318] px-3 py-2 text-xs text-gray-400 lg:block">
              {enabledFlagsCount} enabled
            </div>
          </div>

          <div className="space-y-3">
            {flags.map((flag) => (
              <FeatureFlagRow
                key={flag.key}
                flag={flag}
                onToggle={() => toggleFlag(flag.key, flag.enabled)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
