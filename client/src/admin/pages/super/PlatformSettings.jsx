import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  X,
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

const BOOLEAN_SETTING_KEYS = new Set([
  'maintenance_mode',
  'new_user_registrations',
  'require_id_verification',
]);

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
  if (setting.value_type === 'boolean' || BOOLEAN_SETTING_KEYS.has(setting.key)) return 'Boolean';
  if ((setting.key || '').includes('email')) return 'Contact';
  return 'Text';
}

function isBooleanSetting(setting) {
  return setting.value_type === 'boolean' || BOOLEAN_SETTING_KEYS.has(setting.key);
}

function MessageBanner({ message }) {
  if (!message) return null;

  const success = message.type === 'success';
  return (
    <div role={success ? 'status' : 'alert'} className={`rounded-2xl border px-4 py-3 text-sm ${
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

function SettingsSection({ sectionKey, config, settings, editing, setEditing, onSave, onReset, saving }) {
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
        {settings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/25 px-4 py-8 text-center text-sm text-gray-500">
            No settings match the current filter.
          </div>
        ) : settings.map((setting) => {
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
                  {isBooleanSetting(setting) ? (
                    <select
                      value={String(currentValue).toLowerCase() === 'true' ? 'true' : 'false'}
                      onChange={(event) => setEditing((prev) => ({
                        ...prev,
                        [setting.key]: event.target.value,
                      }))}
                      aria-label={prettifyKey(setting.key)}
                      className="min-w-[170px] rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-orange-500"
                    >
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  ) : (
                    <input
                      type={setting.value_type === 'number' ? 'number' : 'text'}
                      value={currentValue}
                      onChange={(event) => setEditing((prev) => ({
                        ...prev,
                        [setting.key]: event.target.value,
                      }))}
                      aria-label={prettifyKey(setting.key)}
                      step={setting.value_type === 'number' ? '0.01' : undefined}
                      className="min-w-[170px] rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-orange-500"
                    />
                  )}
                  {dirty && (
                    <button
                      type="button"
                      onClick={() => onReset(setting.key)}
                      title="Discard unsaved change"
                      aria-label={`Reset ${prettifyKey(setting.key)}`}
                      className="inline-flex items-center justify-center rounded-xl border border-gray-700 px-3 py-2 text-gray-400 transition hover:border-gray-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onSave(setting.key)}
                    disabled={saving !== null || !dirty}
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

function FeatureFlagRow({ flag, onToggle, updating }) {
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
          type="button"
          onClick={onToggle}
          disabled={updating}
          aria-pressed={flag.enabled}
          aria-label={`${flag.enabled ? 'Disable' : 'Enable'} ${prettifyKey(flag.key)}`}
          className={`inline-flex items-center gap-3 rounded-2xl border px-4 py-2 text-sm font-medium transition ${
            flag.enabled
              ? 'border-orange-500/30 bg-orange-500/12 text-orange-200 hover:bg-orange-500/18'
              : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500 hover:text-white'
          }`}
        >
          {updating ? <Loader2 className="h-5 w-5 animate-spin text-orange-300" /> : <ToggleLeft className={`h-5 w-5 transition ${flag.enabled ? 'rotate-180 text-orange-300' : 'text-gray-500'}`} />}
          {updating ? 'Updating' : flag.enabled ? 'Disable flag' : 'Enable flag'}
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
  const [refreshing, setRefreshing] = useState(false);
  const [flagUpdating, setFlagUpdating] = useState(null);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState('all');

  const fetchSettings = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const { data } = await adminApi.get('/admin/settings');
      setSettings(data.settings || []);
      setFlags(data.flags || []);
      const editMap = {};
      (data.settings || []).forEach((setting) => {
        editMap[setting.key] = setting.value;
      });
      setEditing(editMap);
      setLastLoadedAt(new Date());
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: silent ? 'Refresh failed. Existing values are still shown.' : 'Failed to load platform settings.' });
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const filterText = query.trim().toLowerCase();
  const matchesQuery = (item) => (
    !filterText || `${item.key} ${item.description || ''}`.toLowerCase().includes(filterText)
  );

  const filteredSettings = useMemo(() => settings.filter((setting) => {
    if (filterMode === 'flags') return false;
    const dirty = String(editing[setting.key] ?? setting.value) !== String(setting.value);
    return (filterMode !== 'changed' || dirty) && matchesQuery(setting);
  }), [settings, editing, filterMode, filterText]);

  const filteredFlags = useMemo(() => flags.filter((flag) => (
    filterMode !== 'changed' && matchesQuery(flag)
  )), [flags, filterMode, filterText]);

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

  const resetSetting = (key) => {
    const saved = settings.find((setting) => setting.key === key);
    if (!saved) return;
    setEditing((prev) => ({ ...prev, [key]: saved.value }));
    setMessage(null);
  };

  const saveAll = async () => {
    const dirtySettings = settings.filter((setting) => (
      String(editing[setting.key] ?? setting.value) !== String(setting.value)
    ));
    if (!dirtySettings.length) return;

    setSaving('__all__');
    setMessage(null);
    let savedCount = 0;
    try {
      for (const setting of dirtySettings) {
        await adminApi.put(`/admin/settings/${setting.key}`, { value: editing[setting.key] });
        savedCount += 1;
        setSettings((prev) => prev.map((item) => (
          item.key === setting.key ? { ...item, value: editing[setting.key] } : item
        )));
      }
      setMessage({ type: 'success', text: `${savedCount} setting${savedCount === 1 ? '' : 's'} saved.` });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.error || `${savedCount} saved. The remaining settings could not be saved.`,
      });
    } finally {
      setSaving(null);
    }
  };

  const toggleFlag = async (key, current) => {
    setMessage(null);
    setFlagUpdating(key);
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
    } finally {
      setFlagUpdating(null);
    }
  };

  const groupedSettings = useMemo(() => {
    const groups = { fees: [], jobs: [], system: [] };
    filteredSettings.forEach((setting) => {
      groups[inferredSection(setting)].push(setting);
    });
    return groups;
  }, [filteredSettings]);

  const changedCount = useMemo(() => countChanged(settings, editing), [settings, editing]);
  const enabledFlagsCount = flags.filter((flag) => flag.enabled).length;

  const hasFilteredResults = filteredSettings.length > 0 || filteredFlags.length > 0;

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

        <section className="sticky top-0 z-20 rounded-2xl border border-gray-800 bg-[#0f1117]/95 p-3 shadow-xl shadow-black/10 backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search platform settings</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search settings and feature flags..."
                className="w-full rounded-xl border border-gray-700 bg-gray-900 py-2.5 pl-10 pr-10 text-sm text-white placeholder-gray-500 outline-none transition focus:border-orange-500"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear settings search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-gray-500 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Settings filters">
              {[
                { value: 'all', label: 'All', count: settings.length + flags.length },
                { value: 'changed', label: 'Changed', count: changedCount },
                { value: 'flags', label: 'Flags', count: flags.length },
              ].map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setFilterMode(filter.value)}
                  aria-pressed={filterMode === filter.value}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-orange-500 ${filterMode === filter.value ? 'border-orange-500/50 bg-orange-500/12 text-orange-200' : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-500 hover:text-white'}`}
                >
                  {filter.label} <span className="ml-1 text-[10px] opacity-70">{filter.count}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => fetchSettings({ silent: true })}
                disabled={refreshing || saving !== null || flagUpdating !== null}
                title="Reload settings from the server"
                className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={saveAll}
                disabled={changedCount === 0 || saving !== null || flagUpdating !== null}
                className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving === '__all__' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save changes{changedCount > 0 ? ` (${changedCount})` : ''}
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-gray-500">
            <span>{filterText ? `${filteredSettings.length + filteredFlags.length} matching item${filteredSettings.length + filteredFlags.length === 1 ? '' : 's'}` : `${settings.length + flags.length} total controls`}</span>
            <span>{lastLoadedAt ? `Last refreshed ${lastLoadedAt.toLocaleTimeString()}` : 'Not refreshed yet'}</span>
          </div>
        </section>

        {filterMode !== 'flags' && (
          <div className="grid gap-4 xl:grid-cols-3">
            {Object.entries(SECTION_CONFIG).map(([sectionKey, config]) => (
              <SettingsSection
                key={sectionKey}
                sectionKey={sectionKey}
                config={config}
                settings={groupedSettings[sectionKey]}
                editing={editing}
                setEditing={setEditing}
                onSave={saveSetting}
                onReset={resetSetting}
                saving={saving}
              />
            ))}
          </div>
        )}

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
            {filteredFlags.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/25 px-4 py-8 text-center text-sm text-gray-500">
                No feature flags match the current filter.
              </div>
            ) : filteredFlags.map((flag) => (
              <FeatureFlagRow
                key={flag.key}
                flag={flag}
                updating={flagUpdating === flag.key}
                onToggle={() => toggleFlag(flag.key, flag.enabled)}
              />
            ))}
          </div>
        </section>
        {!hasFilteredResults && (
          <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/25 px-4 py-10 text-center text-sm text-gray-500">
            No platform controls match &quot;{query}&quot;. Try a different search or filter.
          </div>
        )}
      </div>
    </div>
  );
}
