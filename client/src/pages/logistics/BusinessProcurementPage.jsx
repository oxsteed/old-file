import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { listSourcingRequests, listRecurringPrograms, createRecurringProgram, updateRecurringProgramStatus, listLanes, getBusinessProcurementAccess } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import UnsavedChangesGuard from '../../components/logistics/UnsavedChangesGuard';
import WorkspaceOverviewStrip, { WorkspaceDataErrorBanner } from '../../components/logistics/LogisticsWorkspacePanels';
import { useAuth } from '../../context/AuthContext';
import { canAccessBusinessProcurementWorkspace, isBusinessProcurementEligibleMembership } from '../../utils/logisticsWorkspaces';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

const CADENCE_OPTIONS = ['weekly', 'biweekly', 'monthly', 'quarterly', 'custom'];

/**
 * BusinessProcurementPage - business procurement workspace (Phase 2 refactor).
 *
 * Shared LogisticsLayout replaces the workspace tile grid; the layout gets
 * the businessAccess grant so the nav stays permission-aware. Recurring
 * program creation is guarded by an unsaved-changes confirmation. All
 * status pills and colors use theme tokens.
 */
export default function BusinessProcurementPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [requests, setRequests] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [lanes, setLanes] = useState([]);
  const [businessAccess, setBusinessAccess] = useState({ businesses: [], eligibleBusinesses: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    category: '',
    cadence: 'monthly',
    lane_id: '',
    target_qty: '',
    target_unit: 'unit',
    destination_country: '',
    destination_city: '',
    budget_max_usd: '',
    next_run_date: '',
    notes: '',
    sourcing_request_id: '',
  });

  const load = () => {
    setLoading(true);
    setLoadError(false);
    Promise.all([
      listSourcingRequests({ limit: 50 }),
      listRecurringPrograms(),
      listLanes(),
      getBusinessProcurementAccess(),
    ])
      .then(([requestRes, programRes, laneRes, businessAccessRes]) => {
        setRequests(requestRes.requests || []);
        setPrograms(programRes.data || []);
        setLanes(laneRes.data || []);
        const businesses = Array.isArray(businessAccessRes?.businesses) ? businessAccessRes.businesses : [];
        setBusinessAccess({
          businesses,
          eligibleBusinesses: businesses.filter(isBusinessProcurementEligibleMembership),
        });
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const hasAccess = canAccessBusinessProcurementWorkspace(user, businessAccess);
  const eligibleBusinessIds = useMemo(
    () => new Set(businessAccess.eligibleBusinesses.map((entry) => entry.business_id)),
    [businessAccess]
  );

  const procurementEligible = useMemo(
    () => requests.filter((row) => (row.business_id && eligibleBusinessIds.has(row.business_id)) || row.converted_to === 'procurement'),
    [requests, eligibleBusinessIds]
  );
  const activePrograms = programs.filter((program) => program.status === 'active').length;
  const upcomingRuns = programs.filter((program) => {
    if (!program.next_run_date) return false;
    const nextRun = new Date(program.next_run_date);
    const now = new Date();
    const horizon = new Date();
    horizon.setDate(now.getDate() + 21);
    return nextRun >= now && nextRun <= horizon;
  }).length;
  const laneBoundPrograms = programs.filter((program) => !!program.lane_id).length;

  // One clear next step, driven by workspace state.
  const openProgramForm = () => setShowForm(true);
  const nextStep = loadError
    ? null
    : upcomingRuns > 0
      ? {
          kind: 'link',
          href: '#lx-procurement-programs',
          label: tx('logistics.workspace.business.nextStep.reviewRuns.label', 'Review upcoming runs'),
          hint: tx(
            'logistics.workspace.business.nextStep.reviewRuns.hint',
            '{{count}} program runs land within 21 days. Check quantity, lane fit, and destination readiness.',
            { count: upcomingRuns }
          ),
        }
      : programs.length === 0
        ? {
            kind: 'action',
            onClick: openProgramForm,
            label: tx('logistics.workspace.business.nextStep.createProgram.label', 'Create a recurring program'),
            hint: tx(
              'logistics.workspace.business.nextStep.createProgram.hint',
              'No restock programs yet. Set a cadence so repeat demand plans itself.'
            ),
          }
        : {
            kind: 'link',
            href: '/logistics/requests/new',
            label: tx('logistics.workspace.business.nextStep.newRequest.label', 'Open a business-linked request'),
            hint: tx(
              'logistics.workspace.business.nextStep.newRequest.hint',
              'Programs are running. Tie new demand to one of your businesses.'
            ),
          };

  const recentActivity = [
    ...programs.map((row) => ({
      key: `program-${row.id}`,
      label: row.title,
      href: '#lx-procurement-programs',
      date: row.updated_at || row.created_at,
    })),
    ...requests.map((row) => ({
      key: `request-${row.id}`,
      label: row.title,
      href: `/logistics/requests/${row.id}`,
      date: row.created_at || row.updated_at,
    })),
  ]
    .filter((item) => item.date && !Number.isNaN(new Date(item.date).getTime()))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  const createProgramFromForm = async () => {
    if (!form.title) {
      toast.error(tx('logistics.procurement.form.titleRequired', 'Program title is required'));
      return;
    }
    setSaving(true);
    try {
      await createRecurringProgram({
        ...form,
        lane_id: form.lane_id || null,
        target_qty: form.target_qty || null,
        budget_max_usd: form.budget_max_usd || null,
        sourcing_request_id: form.sourcing_request_id || null,
        status: 'active',
      });
      toast.success(tx('logistics.procurement.form.created', 'Recurring procurement program created'));
      setShowForm(false);
      setForm({
        title: '', category: '', cadence: 'monthly', lane_id: '', target_qty: '', target_unit: 'unit',
        destination_country: '', destination_city: '', budget_max_usd: '', next_run_date: '', notes: '', sourcing_request_id: '',
      });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleProgram = async (program) => {
    const nextStatus = program.status === 'active' ? 'paused' : 'active';
    try {
      await updateRecurringProgramStatus(program.id, nextStatus);
      toast.success(tx('logistics.procurement.program.statusChanged', 'Program {{status}}', { status: nextStatus }));
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  const formDirty = showForm && Object.values(form).some((value) => value !== '' && value !== 'monthly' && value !== 'unit');

  return (
    <PageShell>
      <LogisticsLayout
        title={tx('logistics.procurement.title', 'Business Procurement Dashboard')}
        subtitle={tx('logistics.procurement.subtitle', 'Manage restock rhythm, recurring sourcing lanes, and business-approved demand without losing sight of which company the order is for.')}
        businessAccess={businessAccess}
        actions={
          hasAccess && (
            <>
              <button type="button" className="lx-btn-primary lx-next-step-action" onClick={() => setShowForm((current) => !current)} data-track="ui.dfab316fe8.1">
                {showForm
                  ? tx('logistics.procurement.actions.closePlanner', 'Close planner')
                  : tx('logistics.procurement.actions.newProgram', 'New recurring program')}
              </button>
              <Link to="/logistics/requests/new" className="lx-action-ghost">
                {tx('logistics.procurement.actions.newRequest', 'Open business-linked request')}
              </Link>
            </>
          )
        }
      >
        <UnsavedChangesGuard when={formDirty && !saving} />
        <div className="lx-workspaces">
          {!loading && !hasAccess && (
            <div className="lx-card lx-callout lx-callout--warning lx-mb-6" role="alert">
              <h2 className="lx-card-title">{tx('logistics.procurement.noAccess.title', 'Business Procurement is not enabled for this account')}</h2>
              <p>{tx('logistics.procurement.noAccess.body', 'This workspace is reserved for users who can act on behalf of a business in procurement and operations. Right now, OxSteed enables it for business owners, active managers, and memberships that hold operations-style permissions.')}</p>
              <div className="lx-kv-list">
                <div className="lx-kv-row">
                  <span className="lx-kv-label">{tx('logistics.procurement.noAccess.eligibleCount', 'Your eligible business workspaces')}</span>
                  <span className="lx-kv-value">{businessAccess.eligibleBusinesses.length}</span>
                </div>
                <div className="lx-kv-row">
                  <span className="lx-kv-label">{tx('logistics.procurement.noAccess.howDetermined', 'How access is determined')}</span>
                  <span className="lx-kv-value lx-t-small">{tx('logistics.procurement.noAccess.howDeterminedHint', 'ownership, active manager membership, or a non-owner membership with operations/procurement-style permissions.')}</span>
                </div>
              </div>
              <div className="lx-btn-row lx-mt-6">
                <Link to="/logistics" className="lx-action-secondary">{tx('logistics.procurement.noAccess.backToLogistics', 'Back to Logistics')}</Link>
                <Link to="/business-hub" className="lx-action-primary">{tx('logistics.procurement.noAccess.openBusinessHub', 'Open Business Hub')}</Link>
              </div>
            </div>
          )}

          {hasAccess && (
            <>
              <div className="lx-dashboard-hero">
                <div className="lx-card lx-dashboard-hero-main">
                  <div className="lx-dashboard-kicker">{tx('logistics.procurement.kicker', 'Business procurement')}</div>
                  <h2 className="lx-page-title">{tx('logistics.procurement.title', 'Business Procurement Dashboard')}</h2>
                  <p className="lx-page-sub">{tx('logistics.procurement.subtitle', 'Manage restock rhythm, recurring sourcing lanes, and business-approved demand without losing sight of which company the order is for.')}</p>
                  <div className="lx-dashboard-stat-grid">
                    <div className="lx-dashboard-stat">
                      <div className="lx-dashboard-stat-value">{activePrograms}</div>
                      <div className="lx-dashboard-stat-label">{tx('logistics.procurement.stats.activePrograms.label', 'Active restock programs')}</div>
                      <div className="lx-dashboard-stat-meta">{tx('logistics.procurement.stats.activePrograms.meta', 'Cadences already driving repeat sourcing demand.')}</div>
                    </div>
                    <div className="lx-dashboard-stat">
                      <div className="lx-dashboard-stat-value">{businessAccess.eligibleBusinesses.length}</div>
                      <div className="lx-dashboard-stat-label">{tx('logistics.procurement.stats.eligibleBusinesses.label', 'Eligible businesses')}</div>
                      <div className="lx-dashboard-stat-meta">{tx('logistics.procurement.stats.eligibleBusinesses.meta', 'Companies this account can legitimately buy for.')}</div>
                    </div>
                    <div className="lx-dashboard-stat">
                      <div className="lx-dashboard-stat-value">{upcomingRuns}</div>
                      <div className="lx-dashboard-stat-label">{tx('logistics.procurement.stats.upcomingRuns.label', 'Runs within 21 days')}</div>
                      <div className="lx-dashboard-stat-meta">{tx('logistics.procurement.stats.upcomingRuns.meta', 'Upcoming procurement cycles that need readiness checks.')}</div>
                    </div>
                  </div>
                </div>

                <div className="lx-dashboard-side">
                  <div className="lx-card">
                    <h2 className="lx-dashboard-panel-title">{tx('logistics.procurement.pressure.title', 'Procurement pressure points')}</h2>
                    <p className="lx-dashboard-panel-copy">{tx('logistics.procurement.pressure.copy', 'This workspace is strongest when it tells you what to reorder, what to lane-match, and which business needs action first.')}</p>
                    <div className="lx-alert-list">
                      <div className="lx-alert-item">
                        <div>
                          <strong>{tx('logistics.procurement.pressure.upcomingRuns.label', 'Upcoming runs')}</strong>
                          <span>{tx('logistics.procurement.pressure.upcomingRuns.hint', 'Programs that execute soon should be checked for quantity, lane fit, and destination readiness.')}</span>
                        </div>
                        <div className="lx-alert-count">{upcomingRuns}</div>
                      </div>
                      <div className="lx-alert-item">
                        <div>
                          <strong>{tx('logistics.procurement.pressure.laneBound.label', 'Lane-bound programs')}</strong>
                          <span>{tx('logistics.procurement.pressure.laneBound.hint', 'These already have a defined lane, so pricing and compliance planning can be more deliberate.')}</span>
                        </div>
                        <div className="lx-alert-count">{laneBoundPrograms}</div>
                      </div>
                      <div className="lx-alert-item">
                        <div>
                          <strong>{tx('logistics.procurement.pressure.linkedRequests.label', 'Business-linked requests')}</strong>
                          <span>{tx('logistics.procurement.pressure.linkedRequests.hint', 'Demand already tied to a qualified business should be prioritized before generic sourcing.')}</span>
                        </div>
                        <div className="lx-alert-count">{procurementEligible.length}</div>
                      </div>
                    </div>
                  </div>

                  <div className="lx-card">
                    <h2 className="lx-dashboard-panel-title">{tx('logistics.procurement.eligibleLanes.title', 'Eligible business lanes')}</h2>
                    {businessAccess.eligibleBusinesses.length > 0 ? (
                      <div className="lx-mini-list">
                        {businessAccess.eligibleBusinesses.slice(0, 3).map((entry) => (
                          <div key={entry.business_id} className="lx-mini-list-item">
                            <strong>{entry.business_name}</strong>
                            <span>
                              {entry.is_owner
                                ? tx('logistics.procurement.eligibleLanes.ownerAccess', 'Owner access')
                                : tx('logistics.procurement.eligibleLanes.roleAccess', '{{role}} access', { role: entry.role })}
                              {' '}{tx('logistics.procurement.eligibleLanes.authority', 'with procurement-style authority.')}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="lx-empty-state">{tx('logistics.procurement.eligibleLanes.empty', 'No eligible businesses are attached to this account yet.')}</div>
                    )}
                  </div>
                </div>
              </div>

              {loadError && !loading && <WorkspaceDataErrorBanner onRetry={load} />}

              <WorkspaceOverviewStrip
                loading={loading}
                loadError={loadError}
                nextStep={nextStep}
                recentActivity={recentActivity}
                emptyActivityText={t('logistics.workspace.business.recentActivity.empty')}
              />

              <div className="lx-key-metrics">
                {[
                  {
                    label: tx('logistics.procurement.metrics.programs.label', 'Recurring programs'),
                    value: programs.length,
                    icon: '🔁',
                    note: tx('logistics.procurement.metrics.programs.note', 'Saved cadences for repeat inventory and supply demand.'),
                  },
                  {
                    label: tx('logistics.procurement.metrics.linkedRequests.label', 'Business-linked requests'),
                    value: procurementEligible.length,
                    icon: '🏢',
                    note: tx('logistics.procurement.metrics.linkedRequests.note', 'Requests already tied to a qualified business context.'),
                  },
                  {
                    label: tx('logistics.procurement.metrics.activePrograms.label', 'Active programs'),
                    value: activePrograms,
                    icon: '✅',
                    note: tx('logistics.procurement.metrics.activePrograms.note', 'Programs that should currently influence sourcing planning.'),
                  },
                  {
                    label: tx('logistics.procurement.metrics.eligibleBusinesses.label', 'Eligible businesses'),
                    value: businessAccess.eligibleBusinesses.length,
                    icon: '🏬',
                    note: tx('logistics.procurement.metrics.eligibleBusinesses.note', 'Separate business contexts you can operate procurement for.'),
                  },
                ].map((metric) => (
                  <div key={metric.label} className="lx-key-metric-card">
                    <div className="lx-key-metric-top">
                      <div className="lx-key-metric-value">{metric.value}</div>
                      <div className="lx-key-metric-icon" aria-hidden="true">{metric.icon}</div>
                    </div>
                    <div className="lx-key-metric-label">{metric.label}</div>
                    <div className="lx-key-metric-note">{metric.note}</div>
                  </div>
                ))}
              </div>

              {showForm && (
                <div className="lx-card lx-login-accent lx-mb-6">
                  <h2 className="lx-section-title lx-mb-4">{tx('logistics.procurement.form.title', 'Recurring procurement planner')}</h2>
                  <div className="lx-form-grid-2">
                    <div className="lx-form-group"><label className="lx-label" htmlFor="lx-program-title">{tx('logistics.procurement.form.programTitle', 'Program title')}</label><input id="lx-program-title" className="lx-input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
                    <div className="lx-form-group"><label className="lx-label" htmlFor="lx-program-category">{tx('logistics.procurement.form.category', 'Category')}</label><input id="lx-program-category" className="lx-input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} /></div>
                    <div className="lx-form-group"><label className="lx-label" htmlFor="lx-program-cadence">{tx('logistics.procurement.form.cadence', 'Cadence')}</label><select id="lx-program-cadence" className="lx-select" value={form.cadence} onChange={(e) => setForm((f) => ({ ...f, cadence: e.target.value }))}>{CADENCE_OPTIONS.map((option) => <option key={option} value={option}>{tx(`logistics.procurement.cadence.${option}`, option)}</option>)}</select></div>
                    <div className="lx-form-group"><label className="lx-label" htmlFor="lx-program-lane">{tx('logistics.procurement.form.lane', 'Lane')}</label><select id="lx-program-lane" className="lx-select" value={form.lane_id} onChange={(e) => setForm((f) => ({ ...f, lane_id: e.target.value }))}><option value="">{tx('logistics.procurement.form.anyLane', 'Any approved lane')}</option>{lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.name} ({lane.origin_country} → {lane.destination_country})</option>)}</select></div>
                    <div className="lx-form-group"><label className="lx-label" htmlFor="lx-program-qty">{tx('logistics.procurement.form.targetQty', 'Target quantity')}</label><input id="lx-program-qty" className="lx-input" type="number" value={form.target_qty} onChange={(e) => setForm((f) => ({ ...f, target_qty: e.target.value }))} /></div>
                    <div className="lx-form-group"><label className="lx-label" htmlFor="lx-program-unit">{tx('logistics.procurement.form.unit', 'Unit')}</label><input id="lx-program-unit" className="lx-input" value={form.target_unit} onChange={(e) => setForm((f) => ({ ...f, target_unit: e.target.value }))} /></div>
                    <div className="lx-form-group"><label className="lx-label" htmlFor="lx-program-country">{tx('logistics.procurement.form.destCountry', 'Destination country')}</label><input id="lx-program-country" className="lx-input" maxLength={2} value={form.destination_country} onChange={(e) => setForm((f) => ({ ...f, destination_country: e.target.value.toUpperCase() }))} /></div>
                    <div className="lx-form-group"><label className="lx-label" htmlFor="lx-program-city">{tx('logistics.procurement.form.destCity', 'Destination city')}</label><input id="lx-program-city" className="lx-input" value={form.destination_city} onChange={(e) => setForm((f) => ({ ...f, destination_city: e.target.value }))} /></div>
                    <div className="lx-form-group"><label className="lx-label" htmlFor="lx-program-budget">{tx('logistics.procurement.form.budgetMax', 'Budget max (USD)')}</label><input id="lx-program-budget" className="lx-input" type="number" value={form.budget_max_usd} onChange={(e) => setForm((f) => ({ ...f, budget_max_usd: e.target.value }))} /></div>
                    <div className="lx-form-group"><label className="lx-label" htmlFor="lx-program-nextrun">{tx('logistics.procurement.form.nextRun', 'Next run date')}</label><input id="lx-program-nextrun" className="lx-input" type="date" value={form.next_run_date} onChange={(e) => setForm((f) => ({ ...f, next_run_date: e.target.value }))} /></div>
                    <div className="lx-form-group lx-form-group--full">
                      <label className="lx-label" htmlFor="lx-program-linked">{tx('logistics.procurement.form.linkedRequest', 'Linked sourcing request (optional)')}</label>
                      <select id="lx-program-linked" className="lx-select" value={form.sourcing_request_id} onChange={(e) => setForm((f) => ({ ...f, sourcing_request_id: e.target.value }))}>
                        <option value="">{tx('logistics.procurement.form.noLinkedRequest', 'No linked request')}</option>
                        {procurementEligible.map((request) => <option key={request.id} value={request.id}>{request.reference} · {request.title}</option>)}
                      </select>
                    </div>
                    <div className="lx-form-group lx-form-group--full"><label className="lx-label" htmlFor="lx-program-notes">{tx('logistics.procurement.form.notes', 'Notes')}</label><textarea id="lx-program-notes" className="lx-textarea" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
                  </div>
                  <div className="lx-btn-row">
                    <button type="button" className="lx-btn-primary" disabled={saving} onClick={createProgramFromForm} data-track="ui.dfab316fe8.2">{saving ? tx('logistics.procurement.form.saving', 'Saving…') : tx('logistics.procurement.form.create', 'Create program')}</button>
                    <button type="button" className="lx-btn-secondary" onClick={() => setShowForm(false)} data-track="ui.dfab316fe8.3">{tx('common.cancel', 'Cancel')}</button>
                  </div>
                </div>
              )}

              <div className="lx-card lx-mb-6" id="lx-procurement-programs">
                <div className="lx-section-header">
                  <h2 className="lx-section-title">{tx('logistics.procurement.programs.title', 'Recurring procurement programs')}</h2>
                  <Link to="/logistics/sourcing" className="lx-link">{tx('logistics.procurement.programs.openSourcing', 'Open sourcing')}</Link>
                </div>
                <div className="lx-table-wrap">
                  <table className="lx-table">
                    <thead>
                      <tr>
                        <th>{tx('logistics.procurement.programs.headers.program', 'Program')}</th>
                        <th>{tx('logistics.procurement.programs.headers.cadence', 'Cadence')}</th>
                        <th>{tx('logistics.procurement.programs.headers.nextRun', 'Next run')}</th>
                        <th>{tx('logistics.procurement.programs.headers.status', 'Status')}</th>
                        <th>{tx('logistics.procurement.programs.headers.linkedRequest', 'Linked request')}</th>
                        <th><span className="lx-visually-hidden">{tx('logistics.tables.actions', 'Actions')}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {programs.map((program) => (
                        <tr key={program.id}>
                          <td><strong>{program.title}</strong><div className="lx-t-xs lx-t-faint">{program.category || tx('logistics.procurement.programs.general', 'General procurement')}</div></td>
                          <td>{tx(`logistics.procurement.cadence.${program.cadence}`, program.cadence)}</td>
                          <td>{program.next_run_date ? new Date(program.next_run_date).toLocaleDateString() : '—'}</td>
                          <td><LogisticsStatusPill status={program.status} /></td>
                          <td>{program.sourcing_reference || '—'}</td>
                          <td>
                            <button
                              type="button"
                              className="lx-action-secondary"
                              style={{ fontSize: '.72rem', padding: '.25rem .65rem', minBlockSize: '2.75rem' }}
                              onClick={() => toggleProgram(program)} data-track="ui.dfab316fe8.4"
                            >
                              {program.status === 'active'
                                ? tx('logistics.procurement.programs.pause', 'Pause')
                                : tx('logistics.procurement.programs.activate', 'Activate')}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!loading && !loadError && programs.length === 0 && (
                        <tr><td colSpan={6} className="lx-table-empty-cell">{tx('logistics.procurement.programs.empty', 'No recurring procurement programs yet.')}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="lx-dashboard-grid">
                <div className="lx-card">
                  <div className="lx-section-header">
                    <h2 className="lx-section-title">{tx('logistics.procurement.linkedRequests.title', 'Business-linked sourcing requests')}</h2>
                    <Link to="/logistics/requests/new" className="lx-link">{tx('logistics.procurement.linkedRequests.new', 'New request')}</Link>
                  </div>
                  <div className="lx-table-wrap">
                    <table className="lx-table">
                      <thead>
                        <tr>
                          <th>{tx('logistics.procurement.linkedRequests.headers.reference', 'Reference')}</th>
                          <th>{tx('logistics.procurement.linkedRequests.headers.request', 'Request')}</th>
                          <th>{tx('logistics.procurement.linkedRequests.headers.status', 'Status')}</th>
                          <th>{tx('logistics.procurement.linkedRequests.headers.converted', 'Converted')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {procurementEligible.slice(0, 10).map((request) => (
                          <tr key={request.id}>
                            <td><Link to={`/logistics/requests/${request.id}`} className="lx-link">{request.reference}</Link></td>
                            <td>{request.title}</td>
                            <td><LogisticsStatusPill status={request.status} /></td>
                            <td>{request.converted_to || '—'}</td>
                          </tr>
                        ))}
                        {!loading && !loadError && procurementEligible.length === 0 && (
                          <tr><td colSpan={4} className="lx-table-empty-cell">{tx('logistics.procurement.linkedRequests.empty', 'No business-linked procurement requests yet.')}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="lx-card">
                  <div className="lx-section-header">
                    <h2 className="lx-section-title">{tx('logistics.procurement.guidance.title', 'Procurement operating guidance')}</h2>
                    <Link to="/business-hub" className="lx-link">{tx('logistics.procurement.guidance.businessHub', 'Business Hub')}</Link>
                  </div>
                  <div className="lx-mini-list">
                    <div className="lx-mini-list-item">
                      <strong>{tx('logistics.procurement.guidance.authority.title', 'Build around real business authority')}</strong>
                      <span>{tx('logistics.procurement.guidance.authority.body', 'This workspace only works when demand is tied to an actual business you can act for, not just a personal sourcing idea.')}</span>
                    </div>
                    <div className="lx-mini-list-item">
                      <strong>{tx('logistics.procurement.guidance.laneAware.title', 'Use lane-aware planning')}</strong>
                      <span>{tx('logistics.procurement.guidance.laneAware.body', 'Choose lanes early for recurring programs when pricing, compliance, and destination restrictions materially affect landed cost.')}</span>
                    </div>
                    <div className="lx-mini-list-item">
                      <strong>{tx('logistics.procurement.guidance.restock.title', 'Restock before the rush')}</strong>
                      <span>{tx('logistics.procurement.guidance.restock.body', 'Programs with soon-coming run dates should be checked before warehouses, teams, or field crews feel the shortage.')}</span>
                    </div>
                  </div>
                  <div className="lx-insight-chip-row">
                    <span className="lx-insight-chip">{tx('logistics.procurement.chips.recurring', 'Recurring demand planning')}</span>
                    <span className="lx-insight-chip">{tx('logistics.procurement.chips.businessScoped', 'Business-scoped sourcing only')}</span>
                    <span className="lx-insight-chip">{tx('logistics.procurement.chips.laneAware', 'Lane-aware purchasing')}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
