import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Crown,
  Edit3,
  Globe2,
  Loader2,
  Plus,
  Shield,
  Sparkles,
  Target,
  Users2,
  X,
} from 'lucide-react';
import {
  getCorporateCatalog,
  listCorporateAssignments,
  setDepartmentDefaultPermissions,
  upsertCorporateDepartment,
  upsertCorporateTitle,
} from '../../../api/corporateRoles';
import { INTERNAL_ROLE_FOCUS as ROLE_FOCUS, INTERNAL_WORKSPACE_PLAYBOOKS as DEPARTMENT_PLAYBOOKS } from '../../../utils/internalWorkspaces';

function formatCodeLabel(code) {
  return String(code || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function DepartmentModal({ initial, onClose, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    id: initial?.id || null,
    code: initial?.code || '',
    name: initial?.name || '',
    description: initial?.description || '',
    icon: initial?.icon || '',
    color: initial?.color || '#7c3aed',
    sort_order: initial?.sort_order ?? 0,
    is_active: initial?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function setF(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await upsertCorporateDepartment(form);
      onSaved();
    } catch (err) {
      setError(err?.response?.data?.error || t('corporateOrg.departments.form.errorSave'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {initial ? t('corporateOrg.departments.editDepartment') : t('corporateOrg.departments.newDepartment')}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.form.codeLabel')}</label>
              <input
                type="text"
                value={form.code}
                onChange={(event) => setF('code', event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                disabled={Boolean(initial)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.form.nameLabel')}</label>
              <input
                type="text"
                value={form.name}
                onChange={(event) => setF('name', event.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.form.descriptionLabel')}</label>
            <textarea
              value={form.description}
              onChange={(event) => setF('description', event.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.form.colorLabel')}</label>
              <input
                type="color"
                value={form.color}
                onChange={(event) => setF('color', event.target.value)}
                className="h-10 w-full cursor-pointer rounded-lg border border-gray-700 bg-gray-800"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.form.iconLabel')}</label>
              <input
                type="text"
                value={form.icon}
                onChange={(event) => setF('icon', event.target.value)}
                placeholder={t('adminCorporateDeptsIconPlaceholder')}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.form.sortLabel')}</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(event) => setF('sort_order', Number(event.target.value))}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => setF('is_active', event.target.checked)}
            />
            {t('corporateOrg.departments.form.active')}
          </label>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-900 bg-red-900/30 px-3 py-2 text-sm text-red-300">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
              {t('corporateOrg.departments.form.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {t('corporateOrg.departments.form.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TitleModal({ initial, departments, onClose, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    id: initial?.id || null,
    department_id: initial?.department_id || departments[0]?.id || '',
    code: initial?.code || '',
    name: initial?.name || '',
    description: initial?.description || '',
    seniority_level: initial?.seniority_level ?? 4,
    is_csuite: initial?.is_csuite ?? false,
    is_active: initial?.is_active ?? true,
    sort_order: initial?.sort_order ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function setF(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await upsertCorporateTitle(form);
      onSaved();
    } catch (err) {
      setError(err?.response?.data?.error || t('corporateOrg.departments.form.errorSave'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {initial ? t('corporateOrg.departments.editTitle') : t('corporateOrg.departments.newTitle')}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.form.departmentLabel')}</label>
            <select
              value={form.department_id}
              onChange={(event) => setF('department_id', Number(event.target.value))}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
            >
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.form.codeLabel')}</label>
              <input
                type="text"
                value={form.code}
                onChange={(event) => setF('code', event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                disabled={Boolean(initial)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.form.nameLabel')}</label>
              <input
                type="text"
                value={form.name}
                onChange={(event) => setF('name', event.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.form.descriptionLabel')}</label>
            <textarea
              value={form.description}
              onChange={(event) => setF('description', event.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.form.seniorityLabel')}</label>
              <input
                type="number"
                min="1"
                max="10"
                value={form.seniority_level}
                onChange={(event) => setF('seniority_level', Number(event.target.value))}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('adminCorporateDeptsSortOrder')}</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(event) => setF('sort_order', Number(event.target.value))}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={form.is_csuite}
                onChange={(event) => setF('is_csuite', event.target.checked)}
              />
              {t('corporateOrg.departments.form.csuite')}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => setF('is_active', event.target.checked)}
              />
              {t('corporateOrg.departments.form.active')}
            </label>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-900 bg-red-900/30 px-3 py-2 text-sm text-red-300">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
              {t('corporateOrg.departments.form.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {t('corporateOrg.departments.form.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PermissionsEditor({ department, catalog, onSaved }) {
  const { t } = useTranslation();
  const allPermissions = catalog?.permissions || [];
  const [allowed, setAllowed] = useState(new Set(department.permissions || []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const grouped = useMemo(() => {
    const next = {};
    for (const permission of allPermissions) {
      if (!next[permission.group_key]) next[permission.group_key] = [];
      next[permission.group_key].push(permission);
    }
    return next;
  }, [allPermissions]);

  function toggle(code) {
    setAllowed((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = Array.from(allowed).map((code) => ({ code, allow: true }));
      await setDepartmentDefaultPermissions(department.id, payload);
      onSaved();
    } catch (err) {
      setError(err?.response?.data?.error || t('adminCorporateDeptsSavePermsFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950 p-4">
      <div className="mb-3 text-sm font-medium text-white">{t('adminCorporateDeptsDefaultPermissions')}</div>
      <div className="max-h-[400px] space-y-3 overflow-y-auto">
        {Object.entries(grouped).map(([group, permissions]) => (
          <div key={group}>
            <div className="mb-1 text-xs uppercase text-gray-500">{group}</div>
            <div className="space-y-1">
              {permissions.map((permission) => (
                <label key={permission.code} className="flex items-start gap-2 rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-900">
                  <input
                    type="checkbox"
                    checked={allowed.has(permission.code)}
                    onChange={() => toggle(permission.code)}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <code className="text-xs text-orange-300">{permission.code}</code>
                    {permission.description && (
                      <div className="text-xs text-gray-500">{permission.description}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {error && <div className="mt-3 text-sm text-red-300">{error}</div>}
      <div className="mt-3 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {t('corporateOrg.departments.savePermissions')}
        </button>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{label}</div>
        <Icon size={16} className="text-gray-500" />
      </div>
      <div className="text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-sm text-gray-400">{hint}</div>
    </div>
  );
}

function CoveragePill({ status }) {
  const { t } = useTranslation();
  const styles = {
    assigned: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    country: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    global: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    open: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  };
  const labels = {
    assigned: t('adminCorporateDeptsStatusAssigned'),
    country: t('adminCorporateDeptsStatusCountry'),
    global: t('adminCorporateDeptsStatusGlobal'),
    open: t('adminCorporateDeptsStatusOpen'),
  };

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${styles[status] || styles.open}`}>
      {labels[status] || labels.open}
    </span>
  );
}

function PriorityRoleCard({ item, selectedCountry, onEdit }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {item.title?.is_csuite && <Crown size={13} className="text-yellow-400" />}
            <div className="font-medium text-white">{item.title?.name || formatCodeLabel(item.code)}</div>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {item.title ? `L${item.title.seniority_level} - ${item.title.code}` : item.code}
          </div>
        </div>
        <CoveragePill status={item.status} />
      </div>

      <div className="text-sm leading-6 text-gray-300">
        {ROLE_FOCUS[item.code] || t('adminCorporateDeptsRoleFocusFallback')}
      </div>

      {selectedCountry && (
        <div className="mt-3 text-xs text-gray-400">
          {item.status === 'country' && t('adminCorporateDeptsAssignedInCountry', { country: selectedCountry })}
          {item.status === 'global' && t('adminCorporateDeptsGlobalCoverage', { country: selectedCountry })}
          {item.status === 'open' && t('adminCorporateDeptsNoCoverage', { country: selectedCountry })}
        </div>
      )}

      {!selectedCountry && item.status === 'assigned' && (
        <div className="mt-3 text-xs text-gray-400">
          {t('adminCorporateDeptsAssignedSomewhere')}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
        <span>{t('adminCorporateDeptsActiveSeats', { count: item.assignmentCount })}</span>
        {item.title && (
          <button onClick={() => onEdit(item.title)} className="text-gray-400 hover:text-white">
            {t('corporateOrg.departments.editTitle')}
          </button>
        )}
      </div>
    </div>
  );
}

export default function CorporateDepartments() {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openDept, setOpenDept] = useState(null);
  const [showPerms, setShowPerms] = useState(null);
  const [deptModal, setDeptModal] = useState(null);
  const [titleModal, setTitleModal] = useState(null);
  const [countryCode, setCountryCode] = useState('');

  const selectedCountry = countryCode.trim().toUpperCase();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogResponse, activeAssignments] = await Promise.all([
        getCorporateCatalog(),
        listCorporateAssignments({ active: 'true' }),
      ]);
      setCatalog(catalogResponse);
      setAssignments(activeAssignments);
    } catch (err) {
      setError(err?.response?.data?.error || t('adminCorporateDeptsLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const assignmentCounts = useMemo(() => {
    const byTitle = new Map();
    const byDept = new Map();
    const byTitleInCountry = new Map();
    const byDeptInCountry = new Map();
    const globalByTitle = new Map();

    for (const assignment of assignments) {
      byTitle.set(assignment.title_id, (byTitle.get(assignment.title_id) || 0) + 1);
      byDept.set(assignment.department_id, (byDept.get(assignment.department_id) || 0) + 1);

      if (selectedCountry && assignment.country_code === selectedCountry) {
        byTitleInCountry.set(assignment.title_id, (byTitleInCountry.get(assignment.title_id) || 0) + 1);
        byDeptInCountry.set(assignment.department_id, (byDeptInCountry.get(assignment.department_id) || 0) + 1);
      }

      if (!assignment.country_code) {
        globalByTitle.set(assignment.title_id, (globalByTitle.get(assignment.title_id) || 0) + 1);
      }
    }

    return { byTitle, byDept, byTitleInCountry, byDeptInCountry, globalByTitle };
  }, [assignments, selectedCountry]);

  const dashboard = useMemo(() => {
    const departments = catalog?.departments || [];
    const departmentSummaries = departments.map((department) => {
      const playbook = DEPARTMENT_PLAYBOOKS[department.code] || {
        mission: department.description || t('adminCorporateDeptsMissionFallback'),
        launchObjective: t('adminCorporateDeptsObjectiveFallback'),
        owns: [],
        firstHireCodes: [],
      };

      const titleLookup = new Map((department.titles || []).map((title) => [title.code, title]));
      const priorityRoles = playbook.firstHireCodes.map((code) => {
        const title = titleLookup.get(code);
        const titleId = title?.id;
        const countryFilled = Boolean(selectedCountry && titleId && assignmentCounts.byTitleInCountry.get(titleId));
        const globalFilled = Boolean(titleId && assignmentCounts.globalByTitle.get(titleId));
        const assignmentCount = titleId ? (assignmentCounts.byTitle.get(titleId) || 0) : 0;
        return {
          code,
          title,
          assignmentCount,
          status: selectedCountry
            ? (countryFilled ? 'country' : (globalFilled ? 'global' : 'open'))
            : (assignmentCount > 0 ? 'assigned' : 'open'),
        };
      });

      const criticalCovered = priorityRoles.filter((role) => role.status !== 'open').length;
      const criticalTotal = priorityRoles.length;
      const readinessPercent = criticalTotal ? Math.round((criticalCovered / criticalTotal) * 100) : 100;
      const openRoles = priorityRoles.filter((role) => role.status === 'open');

      return {
        department,
        playbook,
        priorityRoles,
        criticalCovered,
        criticalTotal,
        readinessPercent,
        openRoles,
        totalAssignments: assignmentCounts.byDept.get(department.id) || 0,
        countryAssignments: assignmentCounts.byDeptInCountry.get(department.id) || 0,
      };
    });

    const totalTitles = departments.reduce((sum, department) => sum + (department.titles?.length || 0), 0);
    const totalPermissions = departments.reduce((sum, department) => sum + (department.permissions?.length || 0), 0);
    const activeDepartments = departmentSummaries.filter((item) => item.totalAssignments > 0).length;
    const staffedDepartmentsInCountry = selectedCountry
      ? departmentSummaries.filter((item) => item.countryAssignments > 0).length
      : activeDepartments;
    const totalCountryAssignments = selectedCountry
      ? assignments.filter((assignment) => assignment.country_code === selectedCountry).length
      : 0;
    const totalCriticalRoles = departmentSummaries.reduce((sum, item) => sum + item.criticalTotal, 0);
    const coveredCriticalRoles = departmentSummaries.reduce((sum, item) => sum + item.criticalCovered, 0);
    const openLaunchRoles = departmentSummaries.flatMap((item) => item.openRoles.map((role) => ({
      ...role,
      departmentName: item.department.name,
    })));

    return {
      departments: departmentSummaries,
      totalTitles,
      totalPermissions,
      activeDepartments,
      staffedDepartmentsInCountry,
      totalCountryAssignments,
      totalCriticalRoles,
      coveredCriticalRoles,
      openLaunchRoles,
    };
  }, [assignmentCounts, assignments, catalog, selectedCountry, t]);

  if (loading) {
    return (
      <div className="p-10 text-center text-gray-400">
        <Loader2 className="mr-2 inline animate-spin" size={18} /> {t('common.loading')}
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-red-400">{error}</div>;
  }

  return (
    <div className="mx-auto max-w-[96rem] p-6">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-white">
            <Shield size={22} />
            {t('corporateOrg.departments.pageTitle')}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-400">
            {t('adminCorporateDeptsSubtitle')}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-300">
            <Globe2 size={15} className="text-gray-500" />
            <span>{t('adminCorporateDeptsCountryLaunch')}</span>
            <input
              type="text"
              value={countryCode}
              onChange={(event) => setCountryCode(event.target.value.toUpperCase().slice(0, 2))}
              placeholder="US"
              className="w-16 border-0 bg-transparent p-0 text-right text-white placeholder:text-gray-500 focus:outline-none"
            />
          </label>

          <button
            onClick={() => setDeptModal({})}
            className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"
          >
            <Plus size={16} /> {t('corporateOrg.departments.newDepartment')}
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Building2}
          label={t('adminCorporateDeptsDepartments')}
          value={dashboard.departments.length}
          hint={t('adminCorporateDeptsActiveHint', { count: dashboard.activeDepartments })}
        />
        <MetricCard
          icon={Briefcase}
          label={t('adminCorporateDeptsTitles')}
          value={dashboard.totalTitles}
          hint={t('adminCorporateDeptsPermsHint', { count: dashboard.totalPermissions })}
        />
        <MetricCard
          icon={Users2}
          label={selectedCountry ? t('adminCorporateDeptsCountryCoverage', { country: selectedCountry }) : t('adminCorporateDeptsOrgCoverage')}
          value={selectedCountry ? `${dashboard.staffedDepartmentsInCountry}/${dashboard.departments.length}` : `${dashboard.activeDepartments}/${dashboard.departments.length}`}
          hint={selectedCountry ? t('adminCorporateDeptsCountryAssignmentsHint', { count: dashboard.totalCountryAssignments }) : t('adminCorporateDeptsOrgCoverageHint')}
        />
        <MetricCard
          icon={Target}
          label={t('adminCorporateDeptsLaunchReadiness')}
          value={`${dashboard.coveredCriticalRoles}/${dashboard.totalCriticalRoles}`}
          hint={selectedCountry ? t('adminCorporateDeptsReadinessHint', { country: selectedCountry }) : t('adminCorporateDeptsReadinessHintGlobal')}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_0.9fr]">
        <div className="rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-950 via-gray-900 to-gray-900 p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-orange-300">
                <Sparkles size={15} />
                {t('adminCorporateDeptsLaunchConsole')}
              </div>
              <h2 className="mt-2 text-xl font-semibold text-white">
                {selectedCountry ? t('adminCorporateDeptsConsoleStaffed', { country: selectedCountry }) : t('adminCorporateDeptsConsoleStructure')}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
                {t('adminCorporateDeptsConsoleText')}
              </p>
            </div>
            {selectedCountry && (
              <div className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300">
                {t('adminCorporateDeptsFocusMarket', { country: selectedCountry })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{t('adminCorporateDeptsCountryStaffedDepts')}</div>
              <div className="mt-2 text-2xl font-semibold text-white">
                {selectedCountry ? dashboard.staffedDepartmentsInCountry : dashboard.activeDepartments}
              </div>
              <div className="mt-1 text-sm text-gray-400">
                {selectedCountry ? t('adminCorporateDeptsDirectOwnership', { country: selectedCountry }) : t('adminCorporateDeptsSomeoneAssigned')}
              </div>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{t('adminCorporateDeptsPriorityOpen')}</div>
              <div className="mt-2 text-2xl font-semibold text-white">{dashboard.openLaunchRoles.length}</div>
              <div className="mt-1 text-sm text-gray-400">
                {t('adminCorporateDeptsPriorityOpenHint')}
              </div>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{t('adminCorporateDeptsGlobalBackstop')}</div>
              <div className="mt-2 text-2xl font-semibold text-white">
                {dashboard.totalCriticalRoles - dashboard.openLaunchRoles.length}
              </div>
              <div className="mt-1 text-sm text-gray-400">
                {t('adminCorporateDeptsGlobalBackstopHint')}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
          <div className="mb-3 text-sm font-medium text-white">{t('adminCorporateDeptsHiringView')}</div>
          {dashboard.openLaunchRoles.length ? (
            <div className="space-y-3">
              {dashboard.openLaunchRoles.slice(0, 6).map((role) => (
                <div key={`${role.departmentName}-${role.code}`} className="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">{role.title?.name || formatCodeLabel(role.code)}</div>
                      <div className="mt-1 text-xs text-gray-500">{role.departmentName}</div>
                    </div>
                    <CoveragePill status={role.status} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-300">
                <CheckCircle2 size={16} />
                {t('adminCorporateDeptsNoOpenRoles')}
              </div>
              <p className="mt-2 text-sm leading-6 text-emerald-100/80">
                {t('adminCorporateDeptsNoOpenRolesText')}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {dashboard.departments.map((item) => {
          const { department, playbook, priorityRoles } = item;
          const isOpen = openDept === department.code;

          return (
            <div key={department.code} className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
              <div
                className="cursor-pointer px-5 py-4 hover:bg-gray-950"
                style={{ borderLeft: `4px solid ${department.color || '#7c3aed'}` }}
                onClick={() => setOpenDept((current) => (current === department.code ? null : department.code))}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-start gap-3">
                    <Building2 size={18} style={{ color: department.color || '#7c3aed' }} className="mt-1" />
                    <div>
                      <div className="text-lg font-semibold text-white">{department.name}</div>
                      <div className="mt-1 text-sm text-gray-400">{playbook.mission}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                        <span>{t('corporateOrg.departments.metaTitles', { count: department.titles?.length || 0 })}</span>
                        <span>{t('corporateOrg.departments.metaPermissions', { count: department.permissions?.length || 0 })}</span>
                        <span>{t('adminCorporateDeptsActiveSeats', { count: item.totalAssignments })}</span>
                        {selectedCountry && <span>{t('adminCorporateDeptsInCountry', { count: item.countryAssignments, country: selectedCountry })}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-[220px]">
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                        <span>{t('adminCorporateDeptsLaunchCoverage')}</span>
                        <span>{item.criticalCovered}/{item.criticalTotal || 0}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                        <div
                          className="h-full rounded-full bg-orange-500 transition-all"
                          style={{ width: `${item.readinessPercent}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setShowPerms((current) => (current === department.id ? null : department.id));
                          setOpenDept(department.code);
                        }}
                        className="rounded-lg border border-gray-700 px-3 py-1 text-xs text-gray-300 hover:border-gray-500 hover:text-white"
                      >
                        {t('corporateOrg.departments.permissionsButton')}
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeptModal(department);
                        }}
                        className="p-1 text-gray-500 hover:text-white"
                        title={t('corporateOrg.departments.editDepartment')}
                      >
                        <Edit3 size={15} />
                      </button>
                      {isOpen ? (
                        <ChevronDown size={18} className="text-gray-500" />
                      ) : (
                        <ChevronRight size={18} className="text-gray-500" />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {isOpen && (
                <div className="border-t border-gray-800 p-5">
                  <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.9fr]">
                    <div className="rounded-2xl border border-gray-800 bg-gray-950 p-4">
                      <div className="text-sm font-medium text-white">{t('adminCorporateDeptsWhatOwns')}</div>
                      <p className="mt-2 text-sm leading-6 text-gray-400">{playbook.launchObjective}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {(playbook.owns || []).map((itemText) => (
                          <span key={itemText} className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-300">
                            {itemText}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-800 bg-gray-950 p-4">
                      <div className="text-sm font-medium text-white">
                        {selectedCountry ? t('adminCorporateDeptsLaunchNote', { country: selectedCountry }) : t('adminCorporateDeptsFounderNote')}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-gray-400">
                        {selectedCountry
                          ? t('adminCorporateDeptsLaunchNoteText', { country: selectedCountry })
                          : t('adminCorporateDeptsFounderNoteText')}
                      </p>
                    </div>
                  </div>

                  <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <MetricCard
                      icon={Briefcase}
                      label={t('adminCorporateDeptsDefinedTitles')}
                      value={department.titles?.length || 0}
                      hint={t('adminCorporateDeptsDefinedTitlesHint')}
                    />
                    <MetricCard
                      icon={Users2}
                      label={t('adminCorporateDeptsActiveSeatsLabel')}
                      value={item.totalAssignments}
                      hint={t('adminCorporateDeptsActiveSeatsHint')}
                    />
                    <MetricCard
                      icon={Globe2}
                      label={selectedCountry ? t('adminCorporateDeptsCountrySeats', { country: selectedCountry }) : t('adminCorporateDeptsGlobalSeats')}
                      value={selectedCountry ? item.countryAssignments : item.totalAssignments}
                      hint={selectedCountry ? t('adminCorporateDeptsDirectlyAssigned') : t('adminCorporateDeptsInspectStaffing')}
                    />
                    <MetricCard
                      icon={Target}
                      label={t('adminCorporateDeptsPriorityFilled')}
                      value={`${item.criticalCovered}/${item.criticalTotal || 0}`}
                      hint={t('adminCorporateDeptsPriorityFilledHint')}
                    />
                  </div>

                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-gray-300">{t('adminCorporateDeptsHiringSequence')}</h3>
                      <p className="mt-1 text-xs text-gray-500">
                        {t('adminCorporateDeptsHiringSequenceHint')}
                      </p>
                    </div>
                    <button
                      onClick={() => setTitleModal({ department_id: department.id })}
                      className="flex items-center gap-1 px-3 py-1 text-xs text-orange-300 hover:text-orange-200"
                    >
                      <Plus size={12} /> {t('corporateOrg.departments.addTitle')}
                    </button>
                  </div>

                  <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
                    {priorityRoles.map((role) => (
                      <PriorityRoleCard
                        key={`${department.code}-${role.code}`}
                        item={role}
                        selectedCountry={selectedCountry}
                        onEdit={(title) => setTitleModal(title)}
                      />
                    ))}
                    {!priorityRoles.length && (
                      <div className="col-span-full rounded-xl border border-dashed border-gray-800 bg-gray-950 p-4 text-sm text-gray-500">
                        {t('adminCorporateDeptsNoPlaybook')}
                      </div>
                    )}
                  </div>

                  <div className="mb-3 text-sm font-medium text-gray-300">{t('adminCorporateDeptsAllTitles')}</div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {(department.titles || [])
                      .slice()
                      .sort((left, right) => right.seniority_level - left.seniority_level || left.sort_order - right.sort_order)
                      .map((title) => {
                        const totalAssignments = assignmentCounts.byTitle.get(title.id) || 0;
                        const inCountry = assignmentCounts.byTitleInCountry.get(title.id) || 0;
                        const focus = ROLE_FOCUS[title.code] || title.description || t('adminCorporateDeptsOwnershipRole', { department: department.name });

                        return (
                          <div key={title.id} className="rounded-xl border border-gray-800 bg-gray-950 p-4">
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  {title.is_csuite && <Crown size={13} className="text-yellow-400" />}
                                  <div className="truncate text-sm font-medium text-white">{title.name}</div>
                                </div>
                                <div className="mt-1 text-xs text-gray-500">
                                  L{title.seniority_level} - {title.code}
                                </div>
                              </div>
                              <button
                                onClick={() => setTitleModal(title)}
                                className="p-1 text-gray-500 hover:text-white"
                                title={t('corporateOrg.departments.editTitle')}
                              >
                                <Edit3 size={13} />
                              </button>
                            </div>

                            <div className="text-sm leading-6 text-gray-400">{focus}</div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              <span className="rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-gray-300">
                                {t('adminCorporateDeptsActiveSeats', { count: totalAssignments })}
                              </span>
                              {selectedCountry && (
                                <span className="rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-gray-300">
                                  {t('adminCorporateDeptsInCountry', { count: inCountry, country: selectedCountry })}
                                </span>
                              )}
                              {title.is_csuite && (
                                <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-xs text-yellow-300">
                                  {t('adminCorporateDeptsCSuite')}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}

                    {!department.titles?.length && (
                      <div className="col-span-full text-xs italic text-gray-500">
                        {t('corporateOrg.departments.noTitles')}
                      </div>
                    )}
                  </div>

                  {showPerms === department.id && (
                    <PermissionsEditor
                      department={department}
                      catalog={catalog}
                      onSaved={async () => {
                        setShowPerms(null);
                        await load();
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {deptModal && (
        <DepartmentModal
          initial={deptModal.id ? deptModal : null}
          onClose={() => setDeptModal(null)}
          onSaved={async () => {
            setDeptModal(null);
            await load();
          }}
        />
      )}

      {titleModal && (
        <TitleModal
          initial={titleModal.id ? titleModal : null}
          departments={catalog.departments}
          onClose={() => setTitleModal(null)}
          onSaved={async () => {
            setTitleModal(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
