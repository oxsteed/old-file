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

const DEPARTMENT_PLAYBOOKS = {
  executive: {
    mission: 'Sets country strategy, governance, budget, and launch sequencing.',
    launchObjective: 'Make the market-entry plan real: local partnerships, operating model, and executive accountability.',
    owns: ['Country entry decision-making', 'Executive escalation and risk calls', 'Budget approval and cross-team coordination'],
    firstHireCodes: ['vp_strategy_bizdev', 'vp_operations', 'general_counsel'],
  },
  technology: {
    mission: 'Keeps the product stable while localizing workflows, tooling, and support operations.',
    launchObjective: 'Ship country-specific configuration, payments, compliance hooks, and operational tooling without slowing the core platform.',
    owns: ['Platform reliability and security', 'Localization and internal tools', 'Technical delivery for launch-critical work'],
    firstHireCodes: ['vp_engineering', 'devops_sre', 'senior_fullstack_developer'],
  },
  operations: {
    mission: 'Turns launch plans into repeatable marketplace operations and customer outcomes.',
    launchObjective: 'Stand up onboarding, support, verification, and day-to-day execution for the new country team.',
    owns: ['Marketplace operations and SLAs', 'Customer and helper onboarding', 'Escalations, verification, and payments operations'],
    firstHireCodes: ['director_operations', 'customer_success_manager', 'verification_compliance'],
  },
  marketing: {
    mission: 'Drives demand, partnerships, and local market awareness.',
    launchObjective: 'Create the launch story, demand engine, and channel partnerships that bring in customers and providers fast.',
    owns: ['Go-to-market strategy', 'Brand, performance, and content', 'Partnerships and pipeline building'],
    firstHireCodes: ['director_marketing', 'growth_marketing_manager', 'partnerships_manager'],
  },
  finance: {
    mission: 'Protects the business with solid controls, licensing, and financial visibility.',
    launchObjective: 'Set up local compliance, payment controls, reporting, and licensing so launch can scale safely.',
    owns: ['Compliance and licensing', 'Financial controls and treasury', 'Contracts, risk, and insurance readiness'],
    firstHireCodes: ['controller', 'compliance_officer', 'insurance_licensing_coord'],
  },
  people: {
    mission: 'Builds the local team, hiring engine, and administrative backbone.',
    launchObjective: 'Recruit the country team, define HR process, and make the office/admin side dependable from day one.',
    owns: ['Hiring and org design', 'HR operations and employee experience', 'Office, admin, and people systems'],
    firstHireCodes: ['vp_people', 'talent_acquisition', 'office_facilities_manager'],
  },
  data: {
    mission: 'Creates the measurement loop that shows whether the launch is healthy or drifting.',
    launchObjective: 'Instrument the country launch so leadership can spot traction, fraud, unit economics, and product gaps early.',
    owns: ['KPIs and launch dashboards', 'Research and experimentation', 'Analytics for growth, quality, and fraud prevention'],
    firstHireCodes: ['data_science_manager', 'bi_analyst', 'innovation_lead'],
  },
};

const ROLE_FOCUS = {
  vp_strategy_bizdev: 'Owns market-entry strategy, local partnerships, and expansion pacing.',
  vp_operations: 'Builds the local execution system and clears cross-functional blockers.',
  general_counsel: 'Owns legal structure, contracts, and regulatory interpretation.',
  vp_engineering: 'Leads technical delivery for launch-critical platform changes.',
  devops_sre: 'Keeps uptime, deployments, monitoring, and incident response healthy.',
  senior_fullstack_developer: 'Ships customer-facing and internal workflows needed for launch.',
  director_operations: 'Runs the daily operating rhythm for the new country.',
  customer_success_manager: 'Owns service quality, retention, and issue resolution.',
  verification_compliance: 'Protects marketplace trust with checks, reviews, and controls.',
  director_marketing: 'Owns launch narrative, positioning, and channel mix.',
  growth_marketing_manager: 'Builds repeatable acquisition loops and campaign measurement.',
  partnerships_manager: 'Opens local business channels and strategic relationships.',
  controller: 'Owns reporting discipline, controls, and close processes.',
  compliance_officer: 'Keeps the operation aligned with rules and internal policies.',
  insurance_licensing_coord: 'Tracks local registrations, permits, and coverage.',
  vp_people: 'Designs the org, hiring plan, and people policies.',
  talent_acquisition: 'Sources and closes the critical early hires.',
  office_facilities_manager: 'Keeps the local office and admin setup running cleanly.',
  data_science_manager: 'Leads measurement, forecasting, and decision support.',
  bi_analyst: 'Builds the dashboards leadership will rely on each week.',
  innovation_lead: 'Turns new market learnings into product and process experiments.',
};

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
      setError(err?.response?.data?.error || t('corporateOrg.departments.errorSave'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {initial ? t('corporateOrg.departments.editDeptTitle') : t('corporateOrg.departments.newDeptTitle')}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.fieldCode')} *</label>
              <input
                type="text"
                value={form.code}
                onChange={(event) => setF('code', event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                disabled={Boolean(initial)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.fieldName')} *</label>
              <input
                type="text"
                value={form.name}
                onChange={(event) => setF('name', event.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.fieldDesc')}</label>
            <textarea
              value={form.description}
              onChange={(event) => setF('description', event.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.fieldColor')}</label>
              <input
                type="color"
                value={form.color}
                onChange={(event) => setF('color', event.target.value)}
                className="h-10 w-full cursor-pointer rounded-lg border border-gray-700 bg-gray-800"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.fieldIcon')}</label>
              <input
                type="text"
                value={form.icon}
                onChange={(event) => setF('icon', event.target.value)}
                placeholder={t('corporateOrg.departments.iconPlaceholder')}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.fieldSort')}</label>
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
            {t('corporateOrg.departments.fieldActive')}
          </label>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-900 bg-red-900/30 px-3 py-2 text-sm text-red-300">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
              {t('corporateOrg.departments.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {t('corporateOrg.departments.save')}
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
      setError(err?.response?.data?.error || t('corporateOrg.departments.errorSave'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {initial ? t('corporateOrg.departments.editTitleTitle') : t('corporateOrg.departments.newTitleTitle')}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.fieldDept')} *</label>
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
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.fieldCode')} *</label>
              <input
                type="text"
                value={form.code}
                onChange={(event) => setF('code', event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                disabled={Boolean(initial)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.fieldName')} *</label>
              <input
                type="text"
                value={form.name}
                onChange={(event) => setF('name', event.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.fieldDesc')}</label>
            <textarea
              value={form.description}
              onChange={(event) => setF('description', event.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.fieldSeniority')}</label>
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
              <label className="mb-1 block text-sm text-gray-400">{t('corporateOrg.departments.fieldSortOrder')}</label>
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
              {t('corporateOrg.departments.fieldCsuite')}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => setF('is_active', event.target.checked)}
              />
              {t('corporateOrg.departments.fieldActive')}
            </label>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-900 bg-red-900/30 px-3 py-2 text-sm text-red-300">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
              {t('corporateOrg.departments.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {t('corporateOrg.departments.save')}
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
      setError(err?.response?.data?.error || t('corporateOrg.departments.errorSavePerms'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950 p-4">
      <div className="mb-3 text-sm font-medium text-white">{t('corporateOrg.departments.defaultPerms')}</div>
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
          {t('corporateOrg.departments.saveDefaults')}
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
    assigned: t('corporateOrg.departments.coverage.assigned'),
    country: t('corporateOrg.departments.coverage.country'),
    global: t('corporateOrg.departments.coverage.global'),
    open: t('corporateOrg.departments.coverage.open'),
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
        {ROLE_FOCUS[item.code] || 'Define how this role supports the launch in this department.'}
      </div>

      {selectedCountry && (
        <div className="mt-3 text-xs text-gray-400">
          {item.status === 'country' && `Already assigned directly in ${selectedCountry}.`}
          {item.status === 'global' && `Currently covered by a global assignment, but no direct ${selectedCountry} seat yet.`}
          {item.status === 'open' && `No active assignment is covering this launch role for ${selectedCountry}.`}
        </div>
      )}

      {!selectedCountry && item.status === 'assigned' && (
        <div className="mt-3 text-xs text-gray-400">
          This role already has at least one active assignment somewhere in the organization.
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
        <span>{t('corporateOrg.departments.activeSeat', { count: item.assignmentCount })}</span>
        {item.title && (
          <button onClick={() => onEdit(item.title)} className="text-gray-400 hover:text-white">
            {t('corporateOrg.departments.editTitleLink')}
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
      setError(err?.response?.data?.error || t('corporateOrg.departments.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, []);

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
        mission: department.description || 'Define what this team should own.',
        launchObjective: 'Clarify how this department supports country launch execution.',
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
  }, [assignmentCounts, assignments, catalog, selectedCountry]);

  if (loading) {
    return (
      <div className="p-10 text-center text-gray-400">
        <Loader2 className="mr-2 inline animate-spin" size={18} /> {t('corporateOrg.departments.loading')}
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
            {t('corporateOrg.departments.title')}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-400">
            {t('corporateOrg.departments.subtitle')}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-300">
            <Globe2 size={15} className="text-gray-500" />
            <span>Country launch</span>
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
            <Plus size={16} /> {t('corporateOrg.departments.addDept')}
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Building2}
          label="Departments"
          value={dashboard.departments.length}
          hint={`${dashboard.activeDepartments} currently have at least one active assignment.`}
        />
        <MetricCard
          icon={Briefcase}
          label="Titles"
          value={dashboard.totalTitles}
          hint={`${dashboard.totalPermissions} default permissions mapped across departments.`}
        />
        <MetricCard
          icon={Users2}
          label={selectedCountry ? `${selectedCountry} coverage` : 'Org coverage'}
          value={selectedCountry ? `${dashboard.staffedDepartmentsInCountry}/${dashboard.departments.length}` : `${dashboard.activeDepartments}/${dashboard.departments.length}`}
          hint={selectedCountry ? `${dashboard.totalCountryAssignments} active country-scoped assignments in this launch market.` : 'Departments with live ownership across the organization.'}
        />
        <MetricCard
          icon={Target}
          label="Launch readiness"
          value={`${dashboard.coveredCriticalRoles}/${dashboard.totalCriticalRoles}`}
          hint={selectedCountry ? `Priority launch roles covered for ${selectedCountry}.` : 'Priority launch roles covered by country or global leadership.'}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_0.9fr]">
        <div className="rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-950 via-gray-900 to-gray-900 p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-orange-300">
                <Sparkles size={15} />
                Launch Console
              </div>
              <h2 className="mt-2 text-xl font-semibold text-white">
                {selectedCountry ? `How OxSteed is staffed for ${selectedCountry}` : 'How OxSteed is structured to expand'}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
                Use the country filter when you are entering a new market. The page will show which departments already have local ownership, which roles are only covered globally, and where you still need direct hires.
              </p>
            </div>
            {selectedCountry && (
              <div className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300">
                Focus market: {selectedCountry}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Country-staffed departments</div>
              <div className="mt-2 text-2xl font-semibold text-white">
                {selectedCountry ? dashboard.staffedDepartmentsInCountry : dashboard.activeDepartments}
              </div>
              <div className="mt-1 text-sm text-gray-400">
                {selectedCountry ? `Departments with direct ${selectedCountry} ownership.` : 'Departments with someone actively assigned.'}
              </div>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Priority roles open</div>
              <div className="mt-2 text-2xl font-semibold text-white">{dashboard.openLaunchRoles.length}</div>
              <div className="mt-1 text-sm text-gray-400">
                Roles you likely need to hire or explicitly assign next.
              </div>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Global backstop</div>
              <div className="mt-2 text-2xl font-semibold text-white">
                {dashboard.totalCriticalRoles - dashboard.openLaunchRoles.length}
              </div>
              <div className="mt-1 text-sm text-gray-400">
                Priority roles covered either locally or by global leaders.
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
          <div className="mb-3 text-sm font-medium text-white">Immediate founder hiring view</div>
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
                No open priority roles in the current view
              </div>
              <p className="mt-2 text-sm leading-6 text-emerald-100/80">
                The current setup already has launch-critical ownership covered. You can still expand deeper into execution roles inside each department below.
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
                        <span>{department.titles?.length || 0} titles</span>
                        <span>{department.permissions?.length || 0} default permissions</span>
                        <span>{item.totalAssignments} active seats</span>
                        {selectedCountry && <span>{item.countryAssignments} in {selectedCountry}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-[220px]">
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                        <span>Launch coverage</span>
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
                        Permissions
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeptModal(department);
                        }}
                        className="p-1 text-gray-500 hover:text-white"
                        title={t('corporateOrg.departments.editDeptTitle')}
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
                      <div className="text-sm font-medium text-white">What this department owns</div>
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
                        {selectedCountry ? `Launch note for ${selectedCountry}` : 'Founder note'}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-gray-400">
                        {selectedCountry
                          ? `When you travel to ${selectedCountry} to stand up operations, this team needs an owner who can make decisions locally and still stay connected to global standards.`
                          : 'Use this page to decide who owns strategy, execution, compliance, and growth before expansion work starts.'}
                      </p>
                    </div>
                  </div>

                  <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <MetricCard
                      icon={Briefcase}
                      label="Defined titles"
                      value={department.titles?.length || 0}
                      hint="Total role slots available in this department."
                    />
                    <MetricCard
                      icon={Users2}
                      label="Active seats"
                      value={item.totalAssignments}
                      hint="Current active assignments across all scopes."
                    />
                    <MetricCard
                      icon={Globe2}
                      label={selectedCountry ? `${selectedCountry} seats` : 'Global seats'}
                      value={selectedCountry ? item.countryAssignments : item.totalAssignments}
                      hint={selectedCountry ? 'Directly assigned into the selected country.' : 'Use country filter to inspect local market staffing.'}
                    />
                    <MetricCard
                      icon={Target}
                      label="Priority filled"
                      value={`${item.criticalCovered}/${item.criticalTotal || 0}`}
                      hint="Launch-sequence roles that already have coverage."
                    />
                  </div>

                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-gray-300">Priority hiring sequence</h3>
                      <p className="mt-1 text-xs text-gray-500">
                        These are the first roles this department usually needs when opening a new country.
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
                        No launch playbook is defined for this department yet.
                      </div>
                    )}
                  </div>

                  <div className="mb-3 text-sm font-medium text-gray-300">All titles</div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {(department.titles || [])
                      .slice()
                      .sort((left, right) => right.seniority_level - left.seniority_level || left.sort_order - right.sort_order)
                      .map((title) => {
                        const totalAssignments = assignmentCounts.byTitle.get(title.id) || 0;
                        const inCountry = assignmentCounts.byTitleInCountry.get(title.id) || 0;
                        const focus = ROLE_FOCUS[title.code] || title.description || `${department.name} ownership role.`;

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
                                title={t('corporateOrg.departments.editTitleLink')}
                              >
                                <Edit3 size={13} />
                              </button>
                            </div>

                            <div className="text-sm leading-6 text-gray-400">{focus}</div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              <span className="rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-gray-300">
                                {t('corporateOrg.departments.activeSeat', { count: totalAssignments })}
                              </span>
                              {selectedCountry && (
                                <span className="rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-gray-300">
                                  {inCountry} in {selectedCountry}
                                </span>
                              )}
                              {title.is_csuite && (
                                <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-xs text-yellow-300">
                                  C-suite
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}

                    {!department.titles?.length && (
                      <div className="col-span-full text-xs italic text-gray-500">
                        No titles defined.
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
