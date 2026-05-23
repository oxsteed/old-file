import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import adminApi from '../../../lib/adminApi';
import { useAuth } from '../../../hooks/useAuth';
import { getInternalWorkspaceMeta, internalWorkspaceSlug } from '../../../utils/internalWorkspaces';

const EMPTY_FORM = {
  internal_name: '',
  security_key: '',
  operations_enabled: false,
  compliance_enabled: false,
  admin_portal_enabled: false,
  is_active: true,
};

function makeForm(record) {
  if (!record) return EMPTY_FORM;
  return {
    internal_name: record.internal_name || '',
    security_key: '',
    operations_enabled: !!record.operations_enabled,
    compliance_enabled: !!record.compliance_enabled,
    admin_portal_enabled: !!record.admin_portal_enabled,
    is_active: record.has_record ? !!record.is_active : true,
  };
}

function roleLabel(role) {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'admin') return 'Admin';
  return 'Employee';
}

function logisticsRoleLabel(role) {
  return String(role || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function routeLabel(route) {
  if (route === 'admin_portal') return 'Admin Portal';
  if (route === 'operations') return 'Logistics Operations';
  if (route === 'compliance') return 'Logistics Compliance';
  return getInternalWorkspaceMeta(route).label;
}

function routePath(route) {
  if (route === 'admin_portal') return '/admin/login';
  if (route === 'operations') return '/logistics/operations/login';
  if (route === 'compliance') return '/logistics/compliance-workspace/login';
  return `/internal/${internalWorkspaceSlug(route)}/login`;
}

function routeChipClass(route, enabled = true) {
  if (!enabled) return 'border-gray-700 text-gray-500 bg-gray-950/40';
  if (route === 'admin_portal') return 'border-amber-500/40 text-amber-200 bg-amber-500/10';
  if (route === 'operations') return 'border-sky-500/40 text-sky-200 bg-sky-500/10';
  if (route === 'compliance') return 'border-violet-500/40 text-violet-200 bg-violet-500/10';
  return 'border-emerald-500/40 text-emerald-200 bg-emerald-500/10';
}

function statusTone(record) {
  if (!record.has_record) return 'needs_setup';
  if (!record.is_active) return 'inactive';
  return 'ready';
}

export default function LogisticsInternalAccess() {
  const { user: me } = useAuth();
  const [records, setRecords] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const selectedRecord = useMemo(
    () => records.find((record) => record.user_id === selectedUserId) || null,
    [records, selectedUserId]
  );

  useEffect(() => {
    let active = true;
    adminApi.get('/admin/super/logistics-internal-access')
      .then(({ data }) => {
        if (!active) return;
        const nextRecords = data?.records || [];
        setRecords(nextRecords);
        const preferred = nextRecords.find((record) => record.user_id === me?.id) || nextRecords[0] || null;
        setSelectedUserId(preferred?.user_id || null);
        setForm(makeForm(preferred));
      })
      .catch((err) => {
        toast.error(err?.response?.data?.error || 'Failed to load internal access settings.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [me?.id]);

  useEffect(() => {
    setForm(makeForm(selectedRecord));
  }, [selectedRecord]);

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const refreshRecords = async (targetUserId = selectedUserId) => {
    const { data } = await adminApi.get('/admin/super/logistics-internal-access');
    const nextRecords = data?.records || [];
    setRecords(nextRecords);
    const nextSelected = nextRecords.find((record) => record.user_id === targetUserId)
      || nextRecords.find((record) => record.user_id === me?.id)
      || nextRecords[0]
      || null;
    setSelectedUserId(nextSelected?.user_id || null);
    setForm(makeForm(nextSelected));
  };

  const filteredRecords = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      if (filter === 'needs_setup' && record.has_record) return false;
      if (filter === 'ready' && (!record.has_record || !record.is_active)) return false;
      if (filter === 'inactive' && (!record.has_record || record.is_active)) return false;
      if (filter === 'employees' && record.role !== 'employee') return false;
      if (filter === 'admins' && !['admin', 'super_admin'].includes(record.role)) return false;
      if (!needle) return true;
      const haystack = [
        record.first_name,
        record.last_name,
        record.email,
        record.internal_name,
        record.role,
        record.logistics_role,
        ...(record.department_names || []),
        ...(record.department_codes || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [records, query, filter]);

  const summary = useMemo(() => {
    const total = records.length;
    const withRecord = records.filter((record) => record.has_record).length;
    const active = records.filter((record) => record.has_record && record.is_active).length;
    const needsSetup = records.filter((record) => !record.has_record).length;
    const internalDepartmentUsers = records.filter((record) => (record.department_codes || []).length > 0).length;
    return { total, withRecord, active, needsSetup, internalDepartmentUsers };
  }, [records]);

  const provisioningQueue = useMemo(
    () => records
      .filter((record) => !record.has_record)
      .sort((a, b) => {
        const aScore = ['super_admin', 'admin'].includes(a.role) ? 0 : 1;
        const bScore = ['super_admin', 'admin'].includes(b.role) ? 0 : 1;
        if (aScore !== bScore) return aScore - bScore;
        return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
      })
      .slice(0, 6),
    [records]
  );

  const selectedEnabledRoutes = useMemo(() => {
    if (!selectedRecord) return [];
    const enabled = [];
    if (form.admin_portal_enabled) enabled.push('admin_portal');
    if (form.operations_enabled) enabled.push('operations');
    if (form.compliance_enabled) enabled.push('compliance');
    for (const route of selectedRecord.department_codes || []) {
      if (!enabled.includes(route)) enabled.push(route);
    }
    return enabled;
  }, [form.admin_portal_enabled, form.operations_enabled, form.compliance_enabled, selectedRecord]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!selectedRecord) {
      toast.error('Choose an internal staff account first.');
      return;
    }

    setSaving(true);
    try {
      await adminApi.put(`/admin/super/logistics-internal-access/${selectedRecord.user_id}`, form);
      await refreshRecords(selectedRecord.user_id);
      toast.success('Internal access updated.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save internal access settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-white">Internal Access Control</h1>
        <p className="max-w-5xl text-sm text-gray-400">
          Provision the credential gate that sits in front of internal workspaces. This screen should tell you who is ready,
          who still needs setup, which route each person can use, and whether their access is tied to Admin Portal, Logistics,
          or department dashboards like HR, Finance, Legal, and Corporate Ops.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
          <div className="text-xs uppercase tracking-[0.22em] text-gray-500">Internal staff</div>
          <div className="mt-3 text-3xl font-semibold text-white">{summary.total}</div>
          <div className="mt-2 text-sm text-gray-400">People who currently qualify for an internal access identity.</div>
        </div>
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-5">
          <div className="text-xs uppercase tracking-[0.22em] text-emerald-300/70">Active records</div>
          <div className="mt-3 text-3xl font-semibold text-white">{summary.active}</div>
          <div className="mt-2 text-sm text-emerald-100/80">Internal identities that can sign in right now.</div>
        </div>
        <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-5">
          <div className="text-xs uppercase tracking-[0.22em] text-amber-300/70">Needs setup</div>
          <div className="mt-3 text-3xl font-semibold text-white">{summary.needsSetup}</div>
          <div className="mt-2 text-sm text-amber-100/80">Eligible staff without an internal name and security key yet.</div>
        </div>
        <div className="rounded-xl border border-sky-900/50 bg-sky-950/20 p-5">
          <div className="text-xs uppercase tracking-[0.22em] text-sky-300/70">Department users</div>
          <div className="mt-3 text-3xl font-semibold text-white">{summary.internalDepartmentUsers}</div>
          <div className="mt-2 text-sm text-sky-100/80">People whose internal access also unlocks company-wide department dashboards.</div>
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
        {loading ? (
          <div className="text-sm text-gray-400">Loading internal access settings…</div>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(380px,460px)_1fr]">
            <div className="space-y-5">
              <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-4">
                <div className="flex flex-col gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-white">Provisioning Console</h2>
                    <p className="mt-1 text-xs text-gray-500">
                      Search the roster, filter by status, and jump straight into the next account that still needs provisioning.
                    </p>
                  </div>
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name, email, route, department…"
                    className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-2">
                    {[
                      ['all', 'All'],
                      ['needs_setup', 'Needs setup'],
                      ['ready', 'Ready'],
                      ['inactive', 'Inactive'],
                      ['employees', 'Employees'],
                      ['admins', 'Admins'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setFilter(value)}
                        className={`rounded-full border px-3 py-1.5 text-xs transition ${
                          filter === value
                            ? 'border-orange-500/50 bg-orange-500/10 text-orange-200'
                            : 'border-gray-700 text-gray-400 hover:text-white'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Provisioning Queue</h3>
                    <p className="mt-1 text-xs text-gray-500">Most useful next actions for this screen.</p>
                  </div>
                  <div className="text-xs text-amber-300">{provisioningQueue.length} queued</div>
                </div>
                <div className="mt-4 space-y-2">
                  {provisioningQueue.length ? provisioningQueue.map((record) => (
                    <button
                      key={`queue-${record.user_id}`}
                      type="button"
                      onClick={() => setSelectedUserId(record.user_id)}
                      className="w-full rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-3 text-left transition hover:border-amber-500/40 hover:bg-amber-500/5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-white">{record.first_name} {record.last_name}</div>
                          <div className="mt-1 text-xs text-gray-500">{roleLabel(record.role)}{record.department_names?.length ? ` · ${record.department_names.join(', ')}` : ''}</div>
                        </div>
                        <div className="rounded-full border border-amber-500/30 px-2 py-1 text-[11px] text-amber-200">Needs setup</div>
                      </div>
                    </button>
                  )) : (
                    <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/40 px-3 py-4 text-sm text-gray-500">
                      No unprovisioned records in the current eligible roster.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-950/40 overflow-hidden">
                <div className="border-b border-gray-800 px-4 py-3">
                  <h2 className="text-sm font-semibold text-white">Internal Staff Accounts</h2>
                  <p className="mt-1 text-xs text-gray-500">
                    Choose the employee, admin, or super-admin account that should own the internal access identity.
                  </p>
                </div>
                <div className="max-h-[780px] divide-y divide-gray-800 overflow-y-auto">
                  {filteredRecords.length ? filteredRecords.map((record) => {
                    const isSelected = record.user_id === selectedUserId;
                    const isSelf = record.user_id === me?.id;
                    const tone = statusTone(record);
                    return (
                      <button
                        key={record.user_id}
                        type="button"
                        onClick={() => setSelectedUserId(record.user_id)}
                        className={`w-full px-4 py-4 text-left transition ${
                          isSelected ? 'bg-orange-500/10' : 'hover:bg-gray-900/60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-white">
                              {record.first_name} {record.last_name}
                              {isSelf && <span className="ml-2 text-xs text-orange-400">(you)</span>}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">{record.email}</div>
                            {record.logistics_role && (
                              <div className="mt-1 text-[11px] text-gray-500">Logistics role: {logisticsRoleLabel(record.logistics_role)}</div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-[11px] uppercase tracking-wide text-gray-500">{roleLabel(record.role)}</div>
                            <div className={`mt-2 rounded-full border px-2 py-1 text-[11px] ${
                              tone === 'ready'
                                ? 'border-emerald-500/40 text-emerald-200'
                                : tone === 'inactive'
                                  ? 'border-gray-700 text-gray-400'
                                  : 'border-amber-500/40 text-amber-200'
                            }`}>
                              {tone === 'ready' ? 'Ready' : tone === 'inactive' ? 'Inactive' : 'Needs setup'}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                          <span className={`rounded-full border px-2 py-1 ${record.has_record ? 'border-emerald-500/40 text-emerald-300' : 'border-gray-700 text-gray-500'}`}>
                            {record.has_record ? `Name: ${record.internal_name}` : 'No internal record'}
                          </span>
                          {(record.department_names || []).slice(0, 2).map((name) => (
                            <span key={`${record.user_id}-${name}`} className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                              {name}
                            </span>
                          ))}
                          {(record.eligible_routes || []).slice(0, 3).map((route) => (
                            <span key={`${record.user_id}-${route}`} className={`rounded-full border px-2 py-1 ${routeChipClass(route, true)}`}>
                              {routeLabel(route)}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  }) : (
                    <div className="px-4 py-8 text-sm text-gray-500">No internal staff matched your current filters.</div>
                  )}
                </div>
              </div>
            </div>

            <section className="rounded-xl border border-gray-800 bg-gray-950/40 p-5">
              {!selectedRecord ? (
                <div className="text-sm text-gray-400">Select an internal staff account to manage its internal access.</div>
              ) : (
                <form className="space-y-6" onSubmit={handleSubmit}>
                  <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-lg font-semibold text-white">{selectedRecord.first_name} {selectedRecord.last_name}</div>
                          <div className="mt-1 text-sm text-gray-400">{selectedRecord.email}</div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            <span className="rounded-full border border-gray-700 px-2 py-1 text-gray-300">{roleLabel(selectedRecord.role)}</span>
                            {selectedRecord.logistics_role && (
                              <span className="rounded-full border border-gray-700 px-2 py-1 text-gray-300">{logisticsRoleLabel(selectedRecord.logistics_role)}</span>
                            )}
                            {(selectedRecord.department_names || []).map((name) => (
                              <span key={`dept-${name}`} className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                                {name}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className={`rounded-full border px-3 py-1 text-xs ${
                          statusTone(selectedRecord) === 'ready'
                            ? 'border-emerald-500/40 text-emerald-200'
                            : statusTone(selectedRecord) === 'inactive'
                              ? 'border-gray-700 text-gray-400'
                              : 'border-amber-500/40 text-amber-200'
                        }`}>
                          {statusTone(selectedRecord) === 'ready' ? 'Ready' : statusTone(selectedRecord) === 'inactive' ? 'Inactive' : 'Needs setup'}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-gray-500">Login routes unlocked</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedEnabledRoutes.length ? selectedEnabledRoutes.map((route) => (
                          <span key={`enabled-${route}`} className={`rounded-full border px-2 py-1 text-xs ${routeChipClass(route, true)}`}>
                            {routeLabel(route)}
                          </span>
                        )) : (
                          <span className="rounded-full border border-gray-700 px-2 py-1 text-xs text-gray-500">No routes enabled yet</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <label htmlFor="internal_name" className="mb-2 block text-sm font-medium text-gray-200">
                        Internal name
                      </label>
                      <input
                        id="internal_name"
                        type="text"
                        value={form.internal_name}
                        onChange={(event) => updateField('internal_name', event.target.value)}
                        className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none"
                        placeholder="Example: Emile"
                        required
                      />
                      <p className="mt-2 text-xs text-gray-500">
                        Unique first-step credential for the internal gate. This is what the staff member types before password sign-in.
                      </p>
                    </div>

                    <div>
                      <label htmlFor="security_key" className="mb-2 block text-sm font-medium text-gray-200">
                        {selectedRecord.has_record ? 'Replace security key' : 'Security key'}
                      </label>
                      <input
                        id="security_key"
                        type="password"
                        value={form.security_key}
                        onChange={(event) => updateField('security_key', event.target.value)}
                        className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none"
                        placeholder={selectedRecord.has_record ? 'Leave blank to keep the current key' : 'Create a strong security key'}
                      />
                      <p className="mt-2 text-xs text-gray-500">
                        Stored hashed only. Rotating it forces the linked person to use the new key immediately.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <label className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-4 flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.admin_portal_enabled}
                        onChange={(event) => updateField('admin_portal_enabled', event.target.checked)}
                        disabled={selectedRecord.role === 'employee'}
                        className="mt-1"
                      />
                      <div>
                        <div className="text-sm font-medium text-white">Enable Admin Portal gate</div>
                        <div className="mt-1 text-xs text-gray-500">
                          Protects `/admin/login` with this identity before password login can continue.
                        </div>
                        {selectedRecord.role === 'employee' && (
                          <div className="mt-2 text-xs text-amber-400">
                            Employee accounts cannot use the Admin Portal gate.
                          </div>
                        )}
                      </div>
                    </label>

                    <label className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-4 flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        onChange={(event) => updateField('is_active', event.target.checked)}
                        className="mt-1"
                      />
                      <div>
                        <div className="text-sm font-medium text-white">Record active</div>
                        <div className="mt-1 text-xs text-gray-500">
                          Turning this off disables future internal-access verification for this person.
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <label className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-4 flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.operations_enabled}
                        onChange={(event) => updateField('operations_enabled', event.target.checked)}
                        className="mt-1"
                      />
                      <div>
                        <div className="text-sm font-medium text-white">Enable Logistics Operations gate</div>
                        <div className="mt-1 text-xs text-gray-500">
                          Unlocks `/logistics/operations/login` for branch-specific operations work.
                        </div>
                      </div>
                    </label>

                    <label className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-4 flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.compliance_enabled}
                        onChange={(event) => updateField('compliance_enabled', event.target.checked)}
                        className="mt-1"
                      />
                      <div>
                        <div className="text-sm font-medium text-white">Enable Logistics Compliance gate</div>
                        <div className="mt-1 text-xs text-gray-500">
                          Unlocks `/logistics/compliance-workspace/login` for branch-specific compliance work.
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="rounded-xl border border-blue-900/40 bg-blue-950/20 p-4">
                    <div className="text-sm font-medium text-white">Department dashboards are assignment-driven</div>
                    <p className="mt-2 text-sm text-blue-100">
                      Employees do not need extra toggles for company-wide department routes. Once this person has an active internal-access
                      record and an active corporate assignment, they can use the matching login route automatically:
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {(selectedRecord.department_codes || []).length ? selectedRecord.department_codes.map((route) => (
                        <span key={`dept-route-${route}`} className={`rounded-full border px-2 py-1 ${routeChipClass(route, true)}`}>
                          {routeLabel(route)} · {routePath(route)}
                        </span>
                      )) : (
                        <span className="rounded-full border border-gray-700 px-2 py-1 text-gray-400">
                          No active department assignment on this account yet.
                        </span>
                      )}
                    </div>
                  </div>

                  {selectedRecord.has_record && (
                    <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4 text-sm text-gray-400">
                      <div>
                        Internal identity:
                        <span className="ml-2 font-medium text-white">{selectedRecord.internal_name}</span>
                      </div>
                      <div className="mt-2">
                        Last check:
                        <span className="ml-2 text-gray-300">
                          {selectedRecord.last_verified_at ? new Date(selectedRecord.last_verified_at).toLocaleString() : 'never'}
                        </span>
                      </div>
                      <div className="mt-2">
                        Last route:
                        <span className="ml-2 text-gray-300">{selectedRecord.last_verified_route ? routeLabel(selectedRecord.last_verified_route) : 'n/a'}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3">
                    <div className="text-xs text-gray-500">
                      Department dashboard routes use active corporate assignments. Logistics and Admin Portal use explicit toggles above.
                    </div>
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center justify-center rounded-lg bg-orange-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : selectedRecord.has_record ? 'Update Internal Access' : 'Create Internal Access'}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
