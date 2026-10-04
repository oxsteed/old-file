import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import adminApi from '../../../lib/adminApi';
import { useAuth } from '../../../hooks/useAuth';
import ConfirmDialog from '../../lib/ConfirmDialog';
import { getInternalWorkspaceMeta, internalWorkspaceSlug } from '../../../utils/internalWorkspaces';
import { SuggestDropdown } from '../../../components/SuggestDropdown';
import '../../lib/suggestDropdownAdmin.css';

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

function roleLabel(role, t) {
  if (role === 'super_admin') return t('adminLogisticsAccessRoleSuperAdmin');
  if (role === 'admin') return t('adminLogisticsAccessRoleAdmin');
  return t('adminLogisticsAccessRoleEmployee');
}

function logisticsRoleLabel(role) {
  return String(role || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function routeLabel(route, t) {
  if (route === 'admin_portal') return t('adminLogisticsAccessRouteAdminPortal');
  if (route === 'operations') return t('adminLogisticsAccessRouteOperations');
  if (route === 'compliance') return t('adminLogisticsAccessRouteCompliance');
  return getInternalWorkspaceMeta(route).label;
}

function routePath(route) {
  if (route === 'admin_portal') return '/admin/login';
  if (route === 'operations') return '/logistics/login?mode=operations';
  if (route === 'compliance') return '/logistics/login?mode=compliance';
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
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const [records, setRecords] = useState([]);

  // Typeahead suggestions from the loaded internal-access rows.
  const logisticsAccessSuggestItems = useMemo(() => {
    const seen = new Set();
    const items = [];
    for (const record of records) {
      const id = record.user_id ?? record.id;
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      const title = [record.first_name, record.last_name].filter(Boolean).join(' ') || record.internal_name || record.email || String(id);
      items.push({ id, title, meta: record.email || record.internal_name || undefined });
    }
    return items;
  }, [records]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const selectedRecord = useMemo(
    () => records.find((record) => record.user_id === selectedUserId) || null,
    [records, selectedUserId]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
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
        if (!active) return;
        setLoadError(true);
        toast.error(err?.response?.data?.error || t('adminLogisticsAccessLoadFailed'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [me?.id, retryKey]);

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

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!selectedRecord) {
      toast.error(t('adminLogisticsAccessChooseAccount'));
      return;
    }
    setConfirmSave(true);
  };

  const doSave = async () => {
    setSaving(true);
    try {
      await adminApi.put(`/admin/super/logistics-internal-access/${selectedRecord.user_id}`, form);
      await refreshRecords(selectedRecord.user_id);
      toast.success(t('adminLogisticsAccessUpdated'));
    } catch (err) {
      throw new Error(err?.response?.data?.error || t('adminLogisticsAccessSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-white">{t('adminLogisticsAccessTitle')}</h1>
        <p className="max-w-5xl text-sm text-gray-400">
          {t('adminLogisticsAccessSubtitle')}
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
          <div className="text-xs uppercase tracking-[0.22em] text-gray-500">{t('adminLogisticsAccessStaff')}</div>
          <div className="mt-3 text-3xl font-semibold text-white">{summary.total}</div>
          <div className="mt-2 text-sm text-gray-400">{t('adminLogisticsAccessStaffHint')}</div>
        </div>
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-5">
          <div className="text-xs uppercase tracking-[0.22em] text-emerald-300/70">{t('adminLogisticsAccessActiveRecords')}</div>
          <div className="mt-3 text-3xl font-semibold text-white">{summary.active}</div>
          <div className="mt-2 text-sm text-emerald-100/80">{t('adminLogisticsAccessActiveRecordsHint')}</div>
        </div>
        <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-5">
          <div className="text-xs uppercase tracking-[0.22em] text-amber-300/70">{t('adminLogisticsAccessNeedsSetup')}</div>
          <div className="mt-3 text-3xl font-semibold text-white">{summary.needsSetup}</div>
          <div className="mt-2 text-sm text-amber-100/80">{t('adminLogisticsAccessNeedsSetupHint')}</div>
        </div>
        <div className="rounded-xl border border-sky-900/50 bg-sky-950/20 p-5">
          <div className="text-xs uppercase tracking-[0.22em] text-sky-300/70">{t('adminLogisticsAccessDeptUsers')}</div>
          <div className="mt-3 text-3xl font-semibold text-white">{summary.internalDepartmentUsers}</div>
          <div className="mt-2 text-sm text-sky-100/80">{t('adminLogisticsAccessDeptUsersHint')}</div>
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
        {loading ? (
          <div className="text-sm text-gray-400">{t('adminLogisticsAccessLoading')}</div>
        ) : loadError ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-red-300">{t('adminLogisticsAccessLoadFailed')}</p>
            <button
              type="button"
              onClick={() => setRetryKey((key) => key + 1)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 transition hover:border-gray-500 hover:text-white"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(380px,460px)_1fr]">
            <div className="space-y-5">
              <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-4">
                <div className="flex flex-col gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-white">{t('adminLogisticsAccessConsole')}</h2>
                    <p className="mt-1 text-xs text-gray-500">
                      {t('adminLogisticsAccessConsoleHint')}
                    </p>
                  </div>
                  <SuggestDropdown
                    id="logistics-internal-access-search"
                    items={logisticsAccessSuggestItems}
                    value={query}
                    onQueryChange={setQuery}
                    onSelect={(item) => setQuery(item.title || '')}
                    recentsKey="oxsteed_admin_logistics_internal_access_search_recents"
                    placeholder={t('adminLogisticsAccessSearchPlaceholder')}
                    ariaLabel={t('adminLogisticsAccessSearchPlaceholder')}
                    className="sd-admin-dark"
                  />
                  <div className="flex flex-wrap gap-2">
                    {[
                      ['all', t('common.all')],
                      ['needs_setup', t('adminLogisticsAccessNeedsSetup')],
                      ['ready', t('adminLogisticsAccessReady')],
                      ['inactive', t('adminLogisticsAccessInactive')],
                      ['employees', t('adminLogisticsAccessEmployees')],
                      ['admins', t('adminLogisticsAccessAdmins')],
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
                    <h3 className="text-sm font-semibold text-white">{t('adminLogisticsAccessQueue')}</h3>
                    <p className="mt-1 text-xs text-gray-500">{t('adminLogisticsAccessQueueHint')}</p>
                  </div>
                  <div className="text-xs text-amber-300">{t('adminLogisticsAccessQueued', { count: provisioningQueue.length })}</div>
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
                          <div className="mt-1 text-xs text-gray-500">{roleLabel(record.role, t)}{record.department_names?.length ? ` · ${record.department_names.join(', ')}` : ''}</div>
                        </div>
                        <div className="rounded-full border border-amber-500/30 px-2 py-1 text-[11px] text-amber-200">{t('adminLogisticsAccessNeedsSetup')}</div>
                      </div>
                    </button>
                  )) : (
                    <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/40 px-3 py-4 text-sm text-gray-500">
                      {t('adminLogisticsAccessQueueEmpty')}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-950/40 overflow-hidden">
                <div className="border-b border-gray-800 px-4 py-3">
                  <h2 className="text-sm font-semibold text-white">{t('adminLogisticsAccessAccounts')}</h2>
                  <p className="mt-1 text-xs text-gray-500">
                    {t('adminLogisticsAccessAccountsHint')}
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
                              {isSelf && <span className="ml-2 text-xs text-orange-400">{t('adminLogisticsAccessYou')}</span>}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">{record.email}</div>
                            {record.logistics_role && (
                              <div className="mt-1 text-[11px] text-gray-500">{t('adminLogisticsAccessLogisticsRole', { role: logisticsRoleLabel(record.logistics_role) })}</div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-[11px] uppercase tracking-wide text-gray-500">{roleLabel(record.role, t)}</div>
                            <div className={`mt-2 rounded-full border px-2 py-1 text-[11px] ${
                              tone === 'ready'
                                ? 'border-emerald-500/40 text-emerald-200'
                                : tone === 'inactive'
                                  ? 'border-gray-700 text-gray-400'
                                  : 'border-amber-500/40 text-amber-200'
                            }`}>
                              {tone === 'ready' ? t('adminLogisticsAccessReady') : tone === 'inactive' ? t('adminLogisticsAccessInactive') : t('adminLogisticsAccessNeedsSetup')}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                          <span className={`rounded-full border px-2 py-1 ${record.has_record ? 'border-emerald-500/40 text-emerald-300' : 'border-gray-700 text-gray-500'}`}>
                            {record.has_record ? t('adminLogisticsAccessInternalNameValue', { name: record.internal_name }) : t('adminLogisticsAccessNoRecord')}
                          </span>
                          {(record.department_names || []).slice(0, 2).map((name) => (
                            <span key={`${record.user_id}-${name}`} className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                              {name}
                            </span>
                          ))}
                          {(record.eligible_routes || []).slice(0, 3).map((route) => (
                            <span key={`${record.user_id}-${route}`} className={`rounded-full border px-2 py-1 ${routeChipClass(route, true)}`}>
                              {routeLabel(route, t)}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  }) : (
                    <div className="px-4 py-8 text-sm text-gray-500">{t('adminLogisticsAccessNoMatch')}</div>
                  )}
                </div>
              </div>
            </div>

            <section className="rounded-xl border border-gray-800 bg-gray-950/40 p-5">
              {!selectedRecord ? (
                <div className="text-sm text-gray-400">{t('adminLogisticsAccessSelectAccount')}</div>
              ) : (
                <form className="space-y-6" onSubmit={handleSubmit}>
                  <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-lg font-semibold text-white">{selectedRecord.first_name} {selectedRecord.last_name}</div>
                          <div className="mt-1 text-sm text-gray-400">{selectedRecord.email}</div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            <span className="rounded-full border border-gray-700 px-2 py-1 text-gray-300">{roleLabel(selectedRecord.role, t)}</span>
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
                          {statusTone(selectedRecord) === 'ready' ? t('adminLogisticsAccessReady') : statusTone(selectedRecord) === 'inactive' ? t('adminLogisticsAccessInactive') : t('adminLogisticsAccessNeedsSetup')}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-gray-500">{t('adminLogisticsAccessRoutesUnlocked')}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedEnabledRoutes.length ? selectedEnabledRoutes.map((route) => (
                          <span key={`enabled-${route}`} className={`rounded-full border px-2 py-1 text-xs ${routeChipClass(route, true)}`}>
                            {routeLabel(route, t)}
                          </span>
                        )) : (
                          <span className="rounded-full border border-gray-700 px-2 py-1 text-xs text-gray-500">{t('adminLogisticsAccessNoRoutes')}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <label htmlFor="internal_name" className="mb-2 block text-sm font-medium text-gray-200">
                        {t('adminLogisticsAccessInternalNameLabel')}
                      </label>
                      <input
                        id="internal_name"
                        type="text"
                        value={form.internal_name}
                        onChange={(event) => updateField('internal_name', event.target.value)}
                        className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none"
                        placeholder={t('adminLogisticsAccessInternalNamePlaceholder')}
                        required
                      />
                      <p className="mt-2 text-xs text-gray-500">
                        {t('adminLogisticsAccessInternalNameHint')}
                      </p>
                    </div>

                    <div>
                      <label htmlFor="security_key" className="mb-2 block text-sm font-medium text-gray-200">
                        {selectedRecord.has_record ? t('adminLogisticsAccessReplaceSecurityKey') : t('adminLogisticsAccessSecurityKey')}
                      </label>
                      <input
                        id="security_key"
                        type="password"
                        value={form.security_key}
                        onChange={(event) => updateField('security_key', event.target.value)}
                        className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none"
                        placeholder={selectedRecord.has_record ? t('adminLogisticsAccessSecurityKeyPlaceholderKeep') : t('adminLogisticsAccessSecurityKeyPlaceholderNew')}
                      />
                      <p className="mt-2 text-xs text-gray-500">
                        {t('adminLogisticsAccessSecurityKeyHint')}
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
                        <div className="text-sm font-medium text-white">{t('adminLogisticsAccessEnableAdminPortal')}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {t('adminLogisticsAccessEnableAdminPortalHint')}
                        </div>
                        {selectedRecord.role === 'employee' && (
                          <div className="mt-2 text-xs text-amber-400">
                            {t('adminLogisticsAccessEmployeePortalNote')}
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
                        <div className="text-sm font-medium text-white">{t('adminLogisticsAccessRecordActive')}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {t('adminLogisticsAccessRecordActiveHint')}
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
                        <div className="text-sm font-medium text-white">{t('adminLogisticsAccessEnableOperations')}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {t('adminLogisticsAccessEnableOperationsHint')}
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
                        <div className="text-sm font-medium text-white">{t('adminLogisticsAccessEnableCompliance')}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {t('adminLogisticsAccessEnableComplianceHint')}
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="rounded-xl border border-blue-900/40 bg-blue-950/20 p-4">
                    <div className="text-sm font-medium text-white">{t('adminLogisticsAccessDeptDriven')}</div>
                    <p className="mt-2 text-sm text-blue-100">
                      {t('adminLogisticsAccessDeptDrivenText')}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {(selectedRecord.department_codes || []).length ? selectedRecord.department_codes.map((route) => (
                        <span key={`dept-route-${route}`} className={`rounded-full border px-2 py-1 ${routeChipClass(route, true)}`}>
                          {routeLabel(route, t)} · {routePath(route)}
                        </span>
                      )) : (
                        <span className="rounded-full border border-gray-700 px-2 py-1 text-gray-400">
                          {t('adminLogisticsAccessNoDeptAssignment')}
                        </span>
                      )}
                    </div>
                  </div>

                  {selectedRecord.has_record && (
                    <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4 text-sm text-gray-400">
                      <div>
                        {t('adminLogisticsAccessInternalIdentity')}
                        <span className="ml-2 font-medium text-white">{selectedRecord.internal_name}</span>
                      </div>
                      <div className="mt-2">
                        {t('adminLogisticsAccessLastCheck')}
                        <span className="ml-2 text-gray-300">
                          {selectedRecord.last_verified_at ? new Date(selectedRecord.last_verified_at).toLocaleString() : t('adminLogisticsAccessNever')}
                        </span>
                      </div>
                      <div className="mt-2">
                        {t('adminLogisticsAccessLastRoute')}
                        <span className="ml-2 text-gray-300">{selectedRecord.last_verified_route ? routeLabel(selectedRecord.last_verified_route, t) : t('adminLogisticsAccessNotApplicable')}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3">
                    <div className="text-xs text-gray-500">
                      {t('adminLogisticsAccessSaveHint')}
                    </div>
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center justify-center rounded-lg bg-orange-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:opacity-50"
                    >
                      {saving ? t('adminLogisticsAccessSaving') : selectedRecord.has_record ? t('adminLogisticsAccessUpdate') : t('adminLogisticsAccessCreate')}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmSave}
        title={t('adminLogisticsAccessConfirmTitle')}
        message={selectedRecord
          ? t('adminLogisticsAccessConfirmMessage', { name: `${selectedRecord.first_name || ''} ${selectedRecord.last_name || ''}`.trim() || selectedRecord.email })
          : t('adminLogisticsAccessConfirmMessageGeneric')}
        confirmLabel={selectedRecord?.has_record ? t('adminLogisticsAccessUpdate') : t('adminLogisticsAccessCreate')}
        onConfirm={doSave}
        onClose={() => setConfirmSave(false)}
      />
    </div>
  );
}
