import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users, KeyRound, ScrollText, Loader2, AlertCircle, Check,
  ShieldCheck, ShieldAlert, Fingerprint, Key, ExternalLink,
  Plus, X, Clock, UserX,
} from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { useAbortableFetch } from '../../../lib/useAbortableFetch';
import AdminErrorState from '../../../lib/AdminErrorState';
import { adminDate } from '../../../lib/formatters';
import useDestructiveConfirm from '../../../hooks/useDestructiveConfirm';

const API = '/admin/super/workforce';

function ts(d, fallback = '-') {
  if (!d) return fallback;
  return adminDate(d, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function dateOnly(d) {
  if (!d) return '-';
  return adminDate(d, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Format a Date as a local (non-UTC) datetime-local input value.
function toLocalDatetimeInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function StatusBadge({ status }) {
  const { t } = useTranslation();
  if (status === 'revoked') {
    return (
      <span className="px-2 py-0.5 text-xs rounded-full bg-red-900 text-red-300 font-medium">
        {t('wsWorkforce.statusRevoked')}
      </span>
    );
  }
  if (status === 'expired') {
    return (
      <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-900 text-yellow-300 font-medium">
        {t('wsWorkforce.statusExpired')}
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 text-xs rounded-full bg-green-900 text-green-300 font-medium">
      {t('wsWorkforce.statusActive')}
    </span>
  );
}

const TABS = [
  { id: 'staff', icon: Users },
  { id: 'delegations', icon: KeyRound },
  { id: 'lifecycle', icon: ScrollText },
];

// ── Staff tab ─────────────────────────────────────────────────────────────────

function StaffTab() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data } = await adminApi.get(`${API}/staff`, { signal });
    return data.staff || [];
  }, []);
  const staff = data || [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <a
          href="/admin/super/admin-accounts"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                     text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
        >
          <Users size={12} /> {t('wsWorkforce.manageAccountsLink')} <ExternalLink size={11} />
        </a>
        <a
          href="/admin/super/permissions"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                     text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
        >
          <Key size={12} /> {t('wsWorkforce.manageGrantsLink')} <ExternalLink size={11} />
        </a>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-purple-400" />
        </div>
      ) : error ? (
        <AdminErrorState onRetry={reload} />
      ) : staff.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-12">{t('wsWorkforce.noStaff')}</p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                  <th className="px-4 py-3 font-semibold">{t('wsWorkforce.colName')}</th>
                  <th className="px-4 py-3 font-semibold">{t('wsWorkforce.colRole')}</th>
                  <th className="px-4 py-3 font-semibold">{t('wsWorkforce.colStatus')}</th>
                  <th className="px-4 py-3 font-semibold">{t('wsWorkforce.colTwoFactor')}</th>
                  <th className="px-4 py-3 font-semibold">{t('wsWorkforce.colPasskeys')}</th>
                  <th className="px-4 py-3 font-semibold">{t('wsWorkforce.colScopes')}</th>
                  <th className="px-4 py-3 font-semibold">{t('wsWorkforce.colLastLogin')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {staff.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{s.name}</p>
                      <p className="text-xs text-gray-500">{s.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                        s.role === 'super_admin'
                          ? 'bg-purple-900 text-purple-300'
                          : 'bg-blue-900 text-blue-300'
                      }`}>
                        {s.role === 'super_admin' ? t('wsWorkforce.roleSuperAdmin') : t('wsWorkforce.roleAdmin')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {s.is_active ? (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-green-900 text-green-300 font-medium">
                          {t('wsWorkforce.activeYes')}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-gray-700 text-gray-400 font-medium">
                          {t('wsWorkforce.activeNo')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.two_factor_status === 'totp' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-green-900 text-green-300 font-medium">
                          <ShieldCheck size={11} /> {t('wsWorkforce.totpOn')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-red-900 text-red-300 font-medium">
                          <ShieldAlert size={11} /> {t('wsWorkforce.totpOff')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs text-gray-300">
                        <Fingerprint size={12} className="text-gray-500" />
                        {Number(s.passkey_count) || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      {(s.grant_scopes || []).length === 0 ? (
                        <span className="text-xs text-gray-600">{t('wsWorkforce.noScopes')}</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {(s.grant_scopes || []).slice(0, 4).map((sc) => (
                            <span key={sc} className="px-1.5 py-0.5 bg-purple-900/50 text-purple-300 text-xs rounded font-mono">
                              {sc}
                            </span>
                          ))}
                          {(s.grant_scopes || []).length > 4 && (
                            <span className="text-xs text-gray-500">
                              {t('wsWorkforce.moreScopes', { count: s.grant_scopes.length - 4 })}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {ts(s.last_login_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Delegations tab ───────────────────────────────────────────────────────────

function CreateDelegationForm({ staff, scopes, onCreated }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ grantee_id: '', scopes: [], expires_at: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const toggleScope = (key) => {
    setForm((f) => ({
      ...f,
      scopes: f.scopes.includes(key)
        ? f.scopes.filter((s) => s !== key)
        : [...f.scopes, key],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { data } = await adminApi.post(`${API}/delegations`, {
        grantee_id: form.grantee_id,
        scopes: form.scopes,
        expires_at: new Date(form.expires_at).toISOString(),
        reason: form.reason.trim() || undefined,
      });
      onCreated(data.delegation);
      setForm({ grantee_id: '', scopes: [], expires_at: '', reason: '' });
    } catch (err) {
      setError(err.response?.data?.error || t('wsWorkforce.createFailed'));
    } finally {
      setSaving(false);
    }
  };

  const now = new Date();
  const minDate = toLocalDatetimeInput(now);
  const maxDate = toLocalDatetimeInput(new Date(now.getTime() + 30 * 24 * 3600_000));

  return (
    <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-5">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
        <Plus size={14} className="text-purple-400" />
        {t('wsWorkforce.createTitle')}
      </h2>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1.5">
            {t('wsWorkforce.granteeLabel')}
          </label>
          <select
            required
            value={form.grantee_id}
            onChange={(e) => setForm((f) => ({ ...f, grantee_id: e.target.value }))}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg
                       text-sm text-white focus:outline-none focus:border-purple-500"
          >
            <option value="">{t('wsWorkforce.granteePlaceholder')}</option>
            {staff.filter((s) => s.is_active).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.email})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1.5">
            {t('wsWorkforce.expiresLabel')}
          </label>
          <input
            type="datetime-local"
            required
            min={minDate}
            max={maxDate}
            value={form.expires_at}
            onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg
                       text-sm text-white focus:outline-none focus:border-purple-500"
          />
          <p className="text-[11px] text-gray-600 mt-1">{t('wsWorkforce.maxDaysHint')}</p>
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-xs font-semibold text-gray-400 mb-1.5">
          {t('wsWorkforce.scopesLabel')}
        </label>
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 bg-gray-800/50 rounded-lg">
          {scopes.map((sc) => (
            <button
              key={sc.key}
              type="button"
              onClick={() => toggleScope(sc.key)}
              title={sc.description}
              className={`px-2 py-1 text-xs rounded font-mono transition ${
                form.scopes.includes(sc.key)
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {sc.key}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-xs font-semibold text-gray-400 mb-1.5">
          {t('wsWorkforce.reasonLabel')}{' '}
          <span className="text-gray-600">({t('wsWorkforce.optional')})</span>
        </label>
        <input
          type="text"
          placeholder={t('wsWorkforce.reasonPlaceholder')}
          value={form.reason}
          onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg
                     text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 mt-4 bg-red-950 border border-red-800
                        rounded-lg text-red-300 text-xs">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="flex justify-end mt-4">
        <button
          type="submit"
          disabled={saving || !form.grantee_id || form.scopes.length === 0 || !form.expires_at}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm
                     font-semibold rounded-lg transition disabled:opacity-40
                     disabled:cursor-not-allowed flex items-center gap-2"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {saving ? t('wsWorkforce.creating') : t('wsWorkforce.createButton')}
        </button>
      </div>
    </form>
  );
}

function DelegationsTab() {
  const { t } = useTranslation();
  const { confirmDestructive, dialog: confirmDialog } = useDestructiveConfirm();
  const [statusFilter, setStatusFilter] = useState('all');
  const [revoking, setRevoking] = useState(null);
  const [flash, setFlash] = useState(null);

  const showMsg = (type, text) => {
    setFlash({ type, text });
    setTimeout(() => setFlash(null), 4000);
  };

  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const [staffRes, delegRes, scopesRes] = await Promise.all([
      adminApi.get(`${API}/staff`, { signal }),
      adminApi.get(`${API}/delegations`, {
        signal,
        params: statusFilter === 'all' ? {} : { status: statusFilter },
      }),
      adminApi.get('/admin/permission-scopes', { signal }),
    ]);
    return {
      staff: staffRes.data.staff || [],
      delegations: delegRes.data.delegations || [],
      scopes: scopesRes.data.scopes || [],
    };
  }, [statusFilter]);

  const delegations = data?.delegations || [];
  const staff = data?.staff || [];
  const scopes = data?.scopes || [];

  const handleRevoke = async (grantId) => {
    const ok = await confirmDestructive({
      description: t('wsWorkforce.revokeConfirm'),
      confirmLabel: t('wsWorkforce.revoke'),
      requireTypeText: 'REVOKE',
    });
    if (!ok) return;
    setRevoking(grantId);
    try {
      await adminApi.post(`${API}/delegations/${grantId}/revoke`, {});
      showMsg('success', t('wsWorkforce.revokeSuccess'));
      reload();
    } catch (err) {
      showMsg('error', err.response?.data?.error || t('wsWorkforce.revokeFailed'));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div>
      {confirmDialog}

      {flash && (
        <div className={`flex items-center gap-2 p-3 rounded-xl mb-4 text-sm border ${
          flash.type === 'success'
            ? 'bg-green-950 border-green-800 text-green-300'
            : 'bg-red-950 border-red-800 text-red-300'
        }`}>
          {flash.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
          {flash.text}
        </div>
      )}

      {!loading && !error && (
        <CreateDelegationForm
          staff={staff}
          scopes={scopes}
          onCreated={() => {
            showMsg('success', t('wsWorkforce.createSuccess'));
            reload();
          }}
        />
      )}

      <div className="flex items-center gap-3 mb-5">
        <label className="text-xs font-semibold text-gray-400">
          {t('wsWorkforce.statusFilterLabel')}
        </label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg
                     text-sm text-white focus:outline-none focus:border-purple-500"
        >
          <option value="all">{t('wsWorkforce.statusAll')}</option>
          <option value="active">{t('wsWorkforce.statusActive')}</option>
          <option value="expired">{t('wsWorkforce.statusExpired')}</option>
          <option value="revoked">{t('wsWorkforce.statusRevoked')}</option>
        </select>
      </div>

      <p className="flex items-start gap-2 text-xs text-gray-500 mb-4">
        <Clock size={12} className="shrink-0 mt-0.5" />
        {t('wsWorkforce.registryNote')}
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-purple-400" />
        </div>
      ) : error ? (
        <AdminErrorState onRetry={reload} />
      ) : delegations.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-12">{t('wsWorkforce.noDelegations')}</p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="divide-y divide-gray-800">
            {delegations.map((d) => {
              const inactive = d.effective_status !== 'active';
              return (
                <div key={d.id} className={`px-4 py-3 ${inactive ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-white">{d.grantee_name}</p>
                        <span className="text-xs text-gray-500">{d.grantee_email}</span>
                        <StatusBadge status={d.effective_status} />
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {(d.scopes || []).map((s) => (
                          <span key={s} className="px-1.5 py-0.5 bg-purple-900/50 text-purple-300 text-xs rounded font-mono">
                            {s}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                        <span>{t('wsWorkforce.grantedBy', { name: d.grantor_name })}</span>
                        <span>·</span>
                        <span>{t('wsWorkforce.expiresOn', { date: dateOnly(d.expires_at) })}</span>
                        {d.reason && (
                          <>
                            <span>·</span>
                            <span className="italic">{d.reason}</span>
                          </>
                        )}
                        {d.revoked_at && (
                          <>
                            <span>·</span>
                            <span>{t('wsWorkforce.revokedOn', { date: dateOnly(d.revoked_at) })}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {!inactive && (
                      <button
                        onClick={() => handleRevoke(d.id)}
                        disabled={revoking === d.id}
                        className="px-3 py-1.5 bg-red-900/50 hover:bg-red-900 text-red-400
                                   hover:text-red-300 text-xs font-medium rounded-lg transition
                                   shrink-0 disabled:opacity-40 flex items-center gap-1.5"
                      >
                        {revoking === d.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                        {t('wsWorkforce.revoke')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Lifecycle tab ─────────────────────────────────────────────────────────────

const ACTION_ICONS = {
  delegation_grant_created: Plus,
  delegation_grant_revoked: X,
  permission_grant_create: Key,
  permission_grant_revoke: UserX,
  admin_account_created: Users,
  admin_account_enabled: ShieldCheck,
  admin_account_disabled: ShieldAlert,
  force_logout: Clock,
};

function LifecycleTab() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data } = await adminApi.get(`${API}/lifecycle`, { signal });
    return data.events || [];
  }, []);
  const events = data || [];

  const actionLabel = (action) => {
    const key = `wsWorkforce.action_${action}`;
    const label = t(key);
    // i18next returns the key itself when no translation exists; fall back
    // to a humanized action string so new audit actions never render blank.
    return label === key ? action.replace(/_/g, ' ') : label;
  };

  return (
    <div>
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-purple-400" />
        </div>
      ) : error ? (
        <AdminErrorState onRetry={reload} />
      ) : events.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-12">{t('wsWorkforce.noEvents')}</p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                  <th className="px-4 py-3 font-semibold">{t('wsWorkforce.colAction')}</th>
                  <th className="px-4 py-3 font-semibold">{t('wsWorkforce.colActor')}</th>
                  <th className="px-4 py-3 font-semibold">{t('wsWorkforce.colTarget')}</th>
                  <th className="px-4 py-3 font-semibold">{t('wsWorkforce.colAt')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {events.map((ev) => {
                  const Icon = ACTION_ICONS[ev.action] || ScrollText;
                  return (
                    <tr key={ev.id} className="hover:bg-gray-800/40">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-white text-sm">
                          <Icon size={13} className="text-purple-400 shrink-0" />
                          {actionLabel(ev.action)}
                        </span>
                        {ev.description && (
                          <p className="text-xs text-gray-500 mt-0.5 ml-5">{ev.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-300">{ev.actor_name}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                        {ev.target_key || ev.target_id || '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {ts(ev.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WorkforcePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('staff');

  const tabLabel = useMemo(
    () => ({ staff: t('wsWorkforce.tabs.staff'), delegations: t('wsWorkforce.tabs.delegations'), lifecycle: t('wsWorkforce.tabs.lifecycle') }),
    [t]
  );

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Users size={20} className="text-purple-400" />
          {t('wsWorkforce.title')}
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          {t('wsWorkforce.subtitle')}
        </p>
      </div>

      <div className="flex gap-1 mb-6 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        {TABS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition ${
              tab === id
                ? 'bg-purple-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            <Icon size={14} />
            {tabLabel[id]}
          </button>
        ))}
      </div>

      {tab === 'staff' && <StaffTab />}
      {tab === 'delegations' && <DelegationsTab />}
      {tab === 'lifecycle' && <LifecycleTab />}
    </div>
  );
}
