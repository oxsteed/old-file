import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import api from '../api/axios';
import QuickAddTemplates from '../components/QuickAddTemplates';
import PlannedNeedHoldStatus from '../components/PlannedNeedHoldStatus';
import PulseScoreSettings from '../components/PulseScoreSettings';
import '../styles/PlannedNeedsPage.css';

// ── constants ──────────────────────────────────────────────────────────────
const WINDOWS = ['1w','2w','1m','3m','6m','1y','5y','10y'];
const DEFAULT_WINDOW = '3m';

const ACTIVE_STATUSES   = ['planned','funding','activating_soon'];
const INACTIVE_STATUSES = ['published','completed','cancelled','regenerated'];

const DEFAULT_FORM = {
  title:'', description:'', category:'other', due_date:'',
  estimated_cost:'', lead_time_days:7, recurrence_type:'none',
  recurrence_interval_days:'', preferred_helper_id:'', notes:'',
  vehicle_id:'', home_id:'',
};

// ── helpers ────────────────────────────────────────────────────────────────
function fmt$(n) {
  if (!n && n !== 0) return '—';
  return '$' + parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}
function daysLabel(days, t) {
  if (days === null || days === undefined) return '';
  const d = parseInt(days);
  if (d < 0)   return t('plannedNeeds.daysOverdue');
  if (d === 0)  return t('plannedNeeds.daysToday');
  if (d === 1)  return t('plannedNeeds.daysTomorrow');
  if (d < 7)   return t('plannedNeeds.daysCount', { count: d });
  if (d < 30)  return t('plannedNeeds.daysWeeks', { count: Math.round(d/7) });
  if (d < 365) return t('plannedNeeds.daysMonths', { count: Math.round(d/30) });
  return t('plannedNeeds.daysYears', { count: (d/365).toFixed(1) });
}
function helperDisplayName(need) {
  if (!need.preferred_helper_first_name) return null;
  return `${need.preferred_helper_first_name} ${(need.preferred_helper_last_name||'').charAt(0)}.`.trim();
}

// ── main component ─────────────────────────────────────────────────────────
export default function PlannedNeedsPage() {
  const { t } = useTranslation();
  const [needs, setNeeds] = useState([]);
  const [projection, setProjection] = useState(null);
  const [savedHelpers, setSavedHelpers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [homes, setHomes] = useState([]);
  const [window_, setWindow] = useState(DEFAULT_WINDOW);
  const [loading, setLoading] = useState(true);
  const [projLoading, setProjLoading] = useState(false);

  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showSrcs, setShowSrcs] = useState(false);

  // ── data loading ──────────────────────────────────────────────────────────
  const loadNeeds = useCallback(async () => {
    try {
      const { data } = await api.get('/planned-needs');
      setNeeds(data.planned_needs || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const loadProjection = useCallback(async (win) => {
    setProjLoading(true);
    try {
      const { data } = await api.get(`/life/pulse?window=${win}`);
      setProjection(data);
    } catch (e) { console.error(e); }
    finally { setProjLoading(false); }
  }, []);

  const loadSavedHelpers = useCallback(async () => {
    try {
      const { data } = await api.get('/life/saved-helpers');
      setSavedHelpers(data.saved_helpers || []);
    } catch { /* non-fatal */ }
  }, []);

  const loadVehiclesAndHomes = useCallback(async () => {
    try {
      const [vRes, hRes] = await Promise.all([
        api.get('/vehicles/my'),
        api.get('/house/my'),
      ]);
      setVehicles(vRes.data.vehicles || []);
      setHomes(hRes.data.homes || []);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadNeeds(); loadSavedHelpers(); loadVehiclesAndHomes(); }, [loadNeeds, loadSavedHelpers, loadVehiclesAndHomes]);
  useEffect(() => { loadProjection(window_); }, [window_, loadProjection]);

  // ── modal helpers ─────────────────────────────────────────────────────────
  function openAdd() { setForm(DEFAULT_FORM); setError(''); setModal('add'); }
  function openEdit(need) {
    setSelected(need);
    setForm({
      title: need.title || '',
      description: need.description || '',
      category: need.category || 'other',
      due_date: need.due_date ? need.due_date.split('T')[0] : '',
      estimated_cost: need.estimated_cost || '',
      lead_time_days: need.lead_time_days ?? 7,
      recurrence_type: need.recurrence_type || 'none',
      recurrence_interval_days: need.recurrence_interval_days || '',
      preferred_helper_id: need.preferred_helper_id || '',
      notes: need.notes || '',
      vehicle_id: need.vehicle_id || '',
      home_id: need.home_id || '',
    });
    setError(''); setModal('edit');
  }
  function openCancel(need)   { setSelected(need); setModal('cancel'); }
  function openComplete(need) {
    setSelected(need);
    setForm({ actual_cost: need.estimated_cost || '' });
    setModal('complete');
  }
  function closeModal() { setModal(null); setSelected(null); setError(''); }
  function handleFormChange(e) {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  }

  // ── save / actions ────────────────────────────────────────────────────────
  async function handleSave() {
    setError('');
    if (!form.title.trim()) { setError(t('plannedNeeds.errTitleRequired')); return; }
    if (!form.due_date)      { setError(t('plannedNeeds.errDueDateRequired')); return; }
    if (form.recurrence_type !== 'none' && !form.recurrence_interval_days) {
      setError(t('plannedNeeds.errRepeatRequired')); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        estimated_cost: form.estimated_cost ? parseFloat(form.estimated_cost) : undefined,
        lead_time_days: parseInt(form.lead_time_days) || 7,
        recurrence_interval_days: form.recurrence_interval_days
          ? parseInt(form.recurrence_interval_days) : undefined,
        preferred_helper_id: form.preferred_helper_id || undefined,
        vehicle_id: form.vehicle_id ? parseInt(form.vehicle_id) : undefined,
        home_id: form.home_id ? parseInt(form.home_id) : undefined,
      };
      if (modal === 'add') await api.post('/planned-needs', payload);
      else                  await api.put(`/planned-needs/${selected.id}`, payload);
      closeModal();
      await loadNeeds();
      await loadProjection(window_);
    } catch (e) {
      setError(e?.response?.data?.error || t('plannedNeeds.errGeneric'));
    } finally { setSaving(false); }
  }

  async function handleCancel() {
    setSaving(true);
    try {
      await api.post(`/planned-needs/${selected.id}/cancel`);
      closeModal(); await loadNeeds(); await loadProjection(window_);
    } catch (e) { setError(e?.response?.data?.error || t('plannedNeeds.failedCancel')); }
    finally { setSaving(false); }
  }

  async function handleComplete() {
    setSaving(true);
    try {
      await api.post(`/planned-needs/${selected.id}/complete`, {
        actual_cost: form.actual_cost ? parseFloat(form.actual_cost) : undefined,
      });
      closeModal(); await loadNeeds(); await loadProjection(window_);
    } catch (e) { setError(e?.response?.data?.error || t('plannedNeeds.failedComplete')); }
    finally { setSaving(false); }
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const activeNeeds    = needs.filter(n => ACTIVE_STATUSES.includes(n.status));
  const inactiveNeeds  = needs.filter(n => INACTIVE_STATUSES.includes(n.status));
  const activatingSoon = activeNeeds.filter(n => n.status === 'activating_soon');

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <PageMeta
        title={`${t('plannedNeeds.title')} — OxSteed`}
        description={t('plannedNeeds.subtitle')}
      />
      <div className="pn-page">

        {/* Header */}
        <div className="pn-header">
          <div>
            <h1>{t('plannedNeeds.title')}</h1>
            <p>{t('plannedNeeds.subtitle')}</p>
          </div>
          <button className="pn-add-btn" onClick={openAdd}>{t('plannedNeeds.addBtn')}</button>
        </div>

        {/* Life Pulse Projection */}
        <div className="pn-projection">
          <div className="pn-projection-header">
            <h2>{t('plannedNeeds.projectionTitle')}</h2>
            <div className="pn-window-tabs">
              {WINDOWS.map(w => (
                <button key={w}
                  className={`pn-window-tab${window_ === w ? ' active' : ''}`}
                  onClick={() => setWindow(w)}>{t(`plannedNeeds.window${w}`)}
                </button>
              ))}
            </div>
          </div>

          {projLoading ? (
            <p style={{ color:'var(--muted-text)', textAlign:'center', padding:'1rem 0' }}>{t('plannedNeeds.projLoading')}</p>
          ) : projection ? (
            <>
              {/* Score badge + settings */}
              {(projection.pulse_score !== undefined || projection.no_data) && (() => {
                if (projection.no_data) return (
                  <div className="pn-pulse-score-row pn-pulse-no-data">
                    {showSettings && (
                      <PulseScoreSettings onClose={() => setShowSettings(false)} onSaved={() => loadProjection(window_)} />
                    )}
                    <div className="pn-pulse-ring">
                      <svg width="56" height="56" viewBox="0 0 56 56" style={{ transform:'rotate(-90deg)' }}>
                        <circle cx="28" cy="28" r="23" fill="none" stroke="var(--border-color)" strokeWidth="4" strokeDasharray="4 4"/>
                      </svg>
                      <span className="pn-pulse-ring-score" style={{ color:'var(--muted-text)' }}>—</span>
                    </div>
                    <div style={{ flex:1 }}>
                      <p style={{ fontWeight:600, color:'var(--app-text)', fontSize:'0.85rem' }}>{t('plannedNeeds.noDataYet')}</p>
                      <p style={{ fontSize:'0.72rem', color:'var(--muted-text)', marginTop:'0.2rem' }}>
                        {t('plannedNeeds.noDataHint')}
                      </p>
                    </div>
                    <button onClick={() => setShowSettings(true)} className="pn-pulse-settings-btn" title={t('plannedNeeds.configSources')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
                      </svg>
                    </button>
                  </div>
                );

                const score = projection.pulse_score;
                const scoreColor = score >= 80 ? '#34d399' : score >= 60 ? '#F97316' : score >= 40 ? '#facc15' : '#f87171';
                const bd      = projection.score_breakdown || {};
                const sources = projection.sources || {};
                const activeCount = projection.settings ? Object.values(projection.settings).filter(Boolean).length : null;
                const totalCount  = projection.settings ? Object.keys(projection.settings).length : null;

                const SRC_LIST = [
                  { key:'manual_income_90d',         label: t('plannedNeeds.srcManualIncome'),       dir:'+' },
                  { key:'recurring_income_monthly',   label: t('plannedNeeds.srcRecurringIncome'),   dir:'+' },
                  { key:'oxsteed_income_90d',         label: t('plannedNeeds.srcOxsteedIncome'),     dir:'+' },
                  { key:'tool_rental_income_90d',     label: t('plannedNeeds.srcToolRentalIncome'),  dir:'+' },
                  { key:'invoice_income_90d',         label: t('plannedNeeds.srcInvoiceIncome'),     dir:'+' },
                  { key:'predicted_jobs',             label: t('plannedNeeds.srcPredictedJobs'),     dir:'+' },
                  { key:'predicted_invoices',         label: t('plannedNeeds.srcPredictedInvoices'), dir:'+' },
                  { key:'manual_expense_90d',         label: t('plannedNeeds.srcManualExpense'),     dir:'−' },
                  { key:'recurring_expense_monthly',  label: t('plannedNeeds.srcRecurringExpense'),  dir:'−' },
                  { key:'debt_monthly',               label: t('plannedNeeds.srcDebt'),              dir:'−' },
                  { key:'home_maintenance_monthly',   label: t('plannedNeeds.srcHomeMaint'),         dir:'−' },
                  { key:'car_care_monthly',           label: t('plannedNeeds.srcCarCare'),           dir:'−' },
                  { key:'personal_care_monthly',      label: t('plannedNeeds.srcPersonalCare'),      dir:'−' },
                  { key:'tax_obligations_window',     label: t('plannedNeeds.srcTax'),               dir:'−' },
                  { key:'sinking_fund_window',        label: t('plannedNeeds.srcSinkingFund'),       dir:'−' },
                ].filter(s => (sources[s.key] ?? 0) !== 0);

                return (
                  <>
                    {showSettings && (
                      <PulseScoreSettings
                        onClose={() => setShowSettings(false)}
                        onSaved={() => loadProjection(window_)}
                      />
                    )}
                    <div className="pn-pulse-score-row">
                      <div className="pn-pulse-ring">
                        <svg width="56" height="56" viewBox="0 0 56 56" style={{ transform:'rotate(-90deg)' }}>
                          <circle cx="28" cy="28" r="23" fill="none" stroke="var(--border-color)" strokeWidth="4"/>
                          <circle cx="28" cy="28" r="23" fill="none" stroke={scoreColor} strokeWidth="4"
                            strokeDasharray={`${(score / 100) * 144.5} 144.5`} strokeLinecap="round"
                            style={{ transition:'stroke-dasharray 0.8s ease' }}/>
                        </svg>
                        <span className="pn-pulse-ring-score" style={{ color: scoreColor }}>{score}</span>
                      </div>
                      <div className="pn-pulse-bd">
                        {[
                          { l: t('plannedNeeds.scoreCoverage'),    v: bd.coverage },
                          { l: t('plannedNeeds.scoreBuffer'),      v: bd.buffer },
                          { l: t('plannedNeeds.scoreReliability'), v: bd.reliability },
                          { l: t('plannedNeeds.scoreObligations'), v: bd.obligations },
                        ].map((d, i) => (
                          <div key={i} className="pn-pulse-bd-item">
                            <span className="pn-pulse-bd-val">{d.v ?? '—'}</span>
                            <span className="pn-pulse-bd-label">{d.l}</span>
                          </div>
                        ))}
                        {projection.runway_months !== null && projection.runway_months !== undefined && (
                          <div className="pn-pulse-bd-item">
                            <span className="pn-pulse-bd-val">{projection.runway_months}mo</span>
                            <span className="pn-pulse-bd-label">{t('plannedNeeds.scoreRunway')}</span>
                          </div>
                        )}
                      </div>
                      {/* Settings gear */}
                      <button
                        onClick={() => setShowSettings(true)}
                        className="pn-pulse-settings-btn"
                        title={t('plannedNeeds.configScoreSourcesTitle')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                             strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3"/>
                          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
                        </svg>
                        {activeCount !== null && <span className="pn-pulse-settings-count">{activeCount}/{totalCount}</span>}
                      </button>
                    </div>
                    {/* Source breakdown toggle */}
                    <button className="pn-sources-toggle" onClick={() => setShowSrcs(v => !v)}>
                      {showSrcs ? t('plannedNeeds.hideSources') : t('plannedNeeds.showSources')}
                    </button>
                    {showSrcs && SRC_LIST.length > 0 && (
                      <div className="pn-sources-grid">
                        {SRC_LIST.map(s => (
                          <div key={s.key} className="pn-source-row">
                            <span className="pn-source-label">{s.label}</span>
                            <span className={`pn-source-val ${s.dir === '+' ? 'positive' : 'negative'}`}>
                              {s.dir}${(sources[s.key] || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Financial metrics grid */}
              <div className="pn-projection-grid">
                <div className="pn-proj-stat">
                  <div className="label">{t('plannedNeeds.projectedIncome')}</div>
                  <div className="value positive">{fmt$(projection.projected_income)}</div>
                </div>
                <div className="pn-proj-stat">
                  <div className="label">{t('plannedNeeds.fixedExpenses')}</div>
                  <div className="value negative">{fmt$(projection.projected_fixed_expenses)}</div>
                </div>
                <div className="pn-proj-stat">
                  <div className="label">{t('plannedNeeds.sinkingFunds')}</div>
                  <div className="value warn">{fmt$(projection.sinking_fund_for_window)}</div>
                </div>
                <div className="pn-proj-stat">
                  <div className="label">{t('plannedNeeds.netAvailable')}</div>
                  <div className={`value ${projection.net_available >= 0 ? 'positive' : 'negative'}`}>
                    {fmt$(projection.net_available)}
                  </div>
                </div>
                <div className="pn-proj-stat">
                  <div className="label">{t('plannedNeeds.coverageRatio')}</div>
                  <div className={`value ${
                    projection.coverage_ratio === null ? 'neutral'
                    : projection.coverage_ratio >= 1.2  ? 'positive'
                    : projection.coverage_ratio >= 0.9  ? 'warn'
                    : 'negative'}`}>
                    {projection.coverage_ratio !== null ? `${projection.coverage_ratio}x` : '—'}
                  </div>
                </div>
                <div className="pn-proj-stat">
                  <div className="label">{t('plannedNeeds.autoPublishing')}</div>
                  <div className={`value ${projection.auto_publishing_in_window > 0 ? 'warn' : 'neutral'}`}>
                    {t('plannedNeeds.autoPublishCount', { count: projection.auto_publishing_in_window })}
                  </div>
                </div>
              </div>

              {/* Alerts */}
              {projection.alerts?.length > 0 && (
                <div className="pn-alerts">
                  {projection.alerts.map((alert, i) => (
                    <div key={i} className="pn-alert-item">
                      <span className="pn-alert-icon">⚠</span>
                      <span>{alert}</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="pn-proj-note">
                {t('plannedNeeds.projectionNote', { window: t(`plannedNeeds.window${window_}`) })}
              </p>
            </>
          ) : (
            <p style={{ color:'var(--muted-text)', textAlign:'center' }}>{t('plannedNeeds.noProjection')}</p>
          )}
        </div>

        {/* Auto-publish queue banner */}
        {activatingSoon.length > 0 && (
          <div className="pn-queue-banner">
            <span>⚡</span>
            <span>{t('plannedNeeds.queueBanner', { count: activatingSoon.length })}</span>
          </div>
        )}

        {/* Active needs */}
        {loading ? (
          <p style={{ color:'var(--muted-text)' }}>{t('plannedNeeds.loading')}</p>
        ) : (
          <>
            <p className="pn-section-title">{t('plannedNeeds.activeSection', { count: activeNeeds.length })}</p>
            {activeNeeds.length === 0 ? (
              <div className="pn-empty">
                <div className="pn-empty-icon">📋</div>
                <p style={{ fontWeight:700 }}>{t('plannedNeeds.emptyTitle')}</p>
                <p>{t('plannedNeeds.emptySubtitle')}</p>
              </div>
            ) : (
              <div className="pn-cards">
                {activeNeeds.map(need => (
                  <NeedCard key={need.id} need={need}
                    onEdit={() => openEdit(need)}
                    onCancel={() => openCancel(need)}
                    onComplete={() => openComplete(need)} onUpdate={loadNeeds}
                  />
                ))}
              </div>
            )}

            {inactiveNeeds.length > 0 && (
              <>
                <p className="pn-section-title" style={{ marginTop:'1rem' }}>
                  {t('plannedNeeds.historySection', { count: inactiveNeeds.length })}
                </p>
                <div className="pn-cards">
                  {inactiveNeeds.map(need => (
                    <NeedCard key={need.id} need={need}
                      onEdit={null} onCancel={null} onComplete={null}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── Add / Edit modal ──────────────────────────────────────── */}
        {(modal === 'add' || modal === 'edit') && (
          <div className="pn-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="pn-modal">
              <h2>{modal === 'add' ? t('plannedNeeds.addTitle') : t('plannedNeeds.editTitle')}</h2>
                {modal === 'add' && <QuickAddTemplates onSelect={(tpl) => setForm(f => ({ ...f, ...tpl }))} />}

              <div className="pn-form-group">
                <label>{t('plannedNeeds.titleRequired')}</label>
                <input name="title" value={form.title} onChange={handleFormChange}
                  placeholder={t('plannedNeeds.titlePlaceholder')} maxLength={200} />
              </div>

              <div className="pn-form-row">
                <div className="pn-form-group">
                  <label>{t('plannedNeeds.categoryLabel')}</label>
                  <select name="category" value={form.category} onChange={handleFormChange}>
                    <option value="car_care">{t('plannedNeeds.catCarCare')}</option>
                    <option value="personal_care">{t('plannedNeeds.catPersonalCare')}</option>
                    <option value="other">{t('plannedNeeds.catOther')}</option>
                  </select>
                </div>
                <div className="pn-form-group">
                  <label>{t('plannedNeeds.dueDateRequired')}</label>
                  <input type="date" name="due_date" value={form.due_date} onChange={handleFormChange} />
                </div>
              </div>

              <div className="pn-form-row">
                <div className="pn-form-group">
                  <label>{t('plannedNeeds.estimatedCost')}</label>
                  <input type="number" name="estimated_cost" value={form.estimated_cost}
                    onChange={handleFormChange} placeholder="0.00" min="0" step="0.01" />
                </div>
                <div className="pn-form-group">
                  <label>{t('plannedNeeds.leadTime')}</label>
                  <input type="number" name="lead_time_days" value={form.lead_time_days}
                    onChange={handleFormChange} min="1" max="90" />
                  <div className="pn-form-hint">{t('plannedNeeds.leadTimeHint')}</div>
                </div>
              </div>

              {/* Vehicle picker — shown when category is car_care */}
              {form.category === 'car_care' && vehicles.length > 0 && (
                <div className="pn-form-group">
                  <label>{t('plannedNeeds.vehicleOpt')} <span style={{ fontWeight:400, color:'var(--muted-text)' }}>({t('common.optional')})</span></label>
                  <select name="vehicle_id" value={form.vehicle_id} onChange={handleFormChange}>
                    <option value="">{t('plannedNeeds.noVehicle')}</option>
                    {vehicles.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.nickname || `${v.year || ''} ${v.make_name || ''} ${v.model_name || ''}`.trim()}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Property picker — shown for all categories */}
              {homes.length > 0 && (
                <div className="pn-form-group">
                  <label>{t('plannedNeeds.propertyOpt')} <span style={{ fontWeight:400, color:'var(--muted-text)' }}>({t('common.optional')})</span></label>
                  <select name="home_id" value={form.home_id} onChange={handleFormChange}>
                    <option value="">{t('plannedNeeds.noProperty')}</option>
                    {homes.map(h => (
                      <option key={h.id} value={h.id}>
                        {h.nickname || h.address}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="pn-form-row">
                <div className="pn-form-group">
                  <label>{t('plannedNeeds.recurrenceLabel')}</label>
                  <select name="recurrence_type" value={form.recurrence_type} onChange={handleFormChange}>
                    <option value="none">{t('plannedNeeds.recurrenceNone')}</option>
                    <option value="fixed">{t('plannedNeeds.recurrenceFixed')}</option>
                    <option value="floating">{t('plannedNeeds.recurrenceFloating')}</option>
                  </select>
                </div>
                {form.recurrence_type !== 'none' && (
                  <div className="pn-form-group">
                    <label>{t('plannedNeeds.repeatEvery')}</label>
                    <input type="number" name="recurrence_interval_days"
                      value={form.recurrence_interval_days} onChange={handleFormChange}
                      placeholder={t('plannedNeeds.repeatPlaceholder')} min="1" />
                  </div>
                )}
              </div>

              {/* Preferred Helper */}
              <div className="pn-form-group">
                <label>{t('plannedNeeds.prefHelperOpt')} <span style={{ fontWeight:400, color:'var(--muted-text)' }}>({t('common.optional')})</span></label>
                {savedHelpers.length === 0 ? (
                  <div className="pn-form-hint" style={{ padding:'0.5rem 0' }}>
                    {t('plannedNeeds.noSavedHelpers')} <a href="/helpers" style={{ color:'#F4A261' }}>{t('plannedNeeds.browseHelpers')}</a> {t('plannedNeeds.noSavedHelpersSuffix')}
                  </div>
                ) : (
                  <>
                    <select name="preferred_helper_id" value={form.preferred_helper_id} onChange={handleFormChange}>
                      <option value="">{t('plannedNeeds.noPreference')}</option>
                      {savedHelpers.map(h => (
                        <option key={h.helper_id} value={h.helper_id}>
                          {h.first_name} {h.last_name}
                          {h.avg_rating ? ` · ★ ${parseFloat(h.avg_rating).toFixed(1)}` : ''}
                          {h.completed_jobs ? ` · ${h.completed_jobs} jobs` : ''}
                        </option>
                      ))}
                    </select>
                    {form.preferred_helper_id && (
                      <div className="pn-form-hint">
                        {t('plannedNeeds.prefHelperHint')}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="pn-form-group">
                <label>{t('plannedNeeds.descriptionLabel')}</label>
                <textarea name="description" value={form.description} onChange={handleFormChange}
                  rows={2} placeholder={t('plannedNeeds.descriptionPlaceholder')} />
              </div>

              <div className="pn-form-group">
                <label>{t('plannedNeeds.notesLabel')}</label>
                <textarea name="notes" value={form.notes} onChange={handleFormChange}
                  rows={2} placeholder={t('plannedNeeds.notesPlaceholder')} />
              </div>

              {error && <p style={{ color:'#f87171', fontSize:'0.85rem', margin:'0 0 0.5rem' }}>{error}</p>}
              <div className="pn-modal-actions">
                <button className="btn-ghost" onClick={closeModal}>{t('plannedNeeds.cancelBtn')}</button>
                <button className="btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? t('plannedNeeds.saving') : modal === 'add' ? t('plannedNeeds.addNeedBtn') : t('plannedNeeds.saveChangesBtn')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Cancel confirmation ───────────────────────────────────── */}
        {modal === 'cancel' && selected && (
          <div className="pn-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="pn-modal">
              <h2>{t('plannedNeeds.cancelNeedTitle')}</h2>
              <p dangerouslySetInnerHTML={{ __html: t('plannedNeeds.cancelNeedConfirm', { name: `<strong>${selected.title}</strong>` }) }} />
              {error && <p style={{ color:'#f87171', fontSize:'0.85rem' }}>{error}</p>}
              <div className="pn-modal-actions">
                <button className="btn-ghost" onClick={closeModal}>{t('plannedNeeds.keepIt')}</button>
                <button className="btn-danger" onClick={handleCancel} disabled={saving}>
                  {saving ? t('plannedNeeds.cancelling') : t('plannedNeeds.yesCancel')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Complete modal ────────────────────────────────────────── */}
        {modal === 'complete' && selected && (
          <div className="pn-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="pn-modal">
              <h2>{t('plannedNeeds.completeTitle')}</h2>
              <p>{t('plannedNeeds.completeSub')}</p>
              <div className="pn-form-group">
                <label>{t('plannedNeeds.actualCost')}</label>
                <input type="number" name="actual_cost" value={form.actual_cost}
                  onChange={handleFormChange} placeholder={t('plannedNeeds.actualCostPlaceholder')}
                  min="0" step="0.01" />
              </div>
              {selected.recurrence_type !== 'none' && (
                <p style={{ fontSize:'0.85rem', color:'var(--muted-text)' }}>
                  {t('plannedNeeds.recurringNote')}
                </p>
              )}
              {error && <p style={{ color:'#f87171', fontSize:'0.85rem' }}>{error}</p>}
              <div className="pn-modal-actions">
                <button className="btn-ghost" onClick={closeModal}>{t('plannedNeeds.goBack')}</button>
                <button className="btn-primary" onClick={handleComplete} disabled={saving}>
                  {saving ? t('plannedNeeds.saving') : t('plannedNeeds.markComplete')}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </PageShell>
  );
}

// ── NeedCard ───────────────────────────────────────────────────────────────
function NeedCard({ need, onEdit, onCancel, onComplete, onUpdate }) {
  const { t } = useTranslation();
  const cost     = parseFloat(need.estimated_cost || 0);
  const reserved = parseFloat(need.reserved_amount || 0);
  const fundPct  = cost > 0 ? Math.min(100, Math.round((reserved / cost) * 100)) : 0;
  const monthly  = parseFloat(need.sinking_fund_per_month || 0);
  const daysLeft = parseInt(need.days_until_due || 0);
  const isActive = ['planned','funding','activating_soon'].includes(need.status);
  const helperName = helperDisplayName(need);

  const CATEGORY_LABELS = {
    car_care: t('plannedNeeds.catCarCare'),
    personal_care: t('plannedNeeds.catPersonalCare'),
    other: t('plannedNeeds.catOther'),
  };
  const STATUS_LABELS = {
    planned: t('plannedNeeds.statusPlanned'),
    funding: t('plannedNeeds.statusFunding'),
    activating_soon: t('plannedNeeds.statusActivatingSoon'),
    published: t('plannedNeeds.statusPublished'),
    completed: t('plannedNeeds.statusCompleted'),
    cancelled: t('plannedNeeds.statusCancelled'),
    regenerated: t('plannedNeeds.statusRegenerated'),
  };
  const PREF_HELPER_LABELS = {
    pending:  t('plannedNeeds.prefStatusPending'),
    accepted: t('plannedNeeds.prefStatusAccepted'),
    declined: t('plannedNeeds.prefStatusDeclined'),
    expired:  t('plannedNeeds.prefStatusExpired'),
  };

  return (
    <div className={`pn-card status-${need.status}`}>
      <div className="pn-card-main">
        <div className="pn-card-title-row">
          <h3 className="pn-card-title">{need.title}</h3>
          <span className={`pn-badge cat-${need.category}`}>
            {CATEGORY_LABELS[need.category] || need.category}
          </span>
          <span className={`pn-badge st-${need.status}`}>
            {STATUS_LABELS[need.status] || need.status}
          </span>
        </div>

        <div className="pn-card-meta">
          <span>{t('plannedNeeds.due', { date: fmtDate(need.due_date) })}</span>
          {isActive && <span>{daysLabel(daysLeft, t)} {t('plannedNeeds.away')}</span>}
          {cost > 0 && <span>{t('plannedNeeds.est', { amount: fmt$(cost) })}</span>}
          {need.actual_cost && <span>{t('plannedNeeds.actual', { amount: fmt$(need.actual_cost) })}</span>}
          {need.recurrence_type !== 'none' && (
            <span>{t('plannedNeeds.recurrenceEvery', { days: need.recurrence_interval_days, type: need.recurrence_type })}</span>
          )}
          {need.lead_time_days && isActive && (
            <span>{t('plannedNeeds.autoPostsIn', { label: daysLabel(daysLeft - need.lead_time_days, t) })}</span>
          )}
          {need.vehicle_name && <span>{t('plannedNeeds.vehicleMeta', { name: need.vehicle_name })}</span>}
          {need.home_name && <span>{t('plannedNeeds.propertyMeta', { name: need.home_name })}</span>}
        </div>

        {/* Preferred helper row */}
        {helperName && (
          <div className="pn-preferred-helper">
            <span className="pn-ph-label">{t('plannedNeeds.preferredHelper')}</span>
            <span className="pn-ph-name">{helperName}</span>
            {need.preferred_helper_status && (
              <span className={`pn-badge pn-ph-status st-${
                need.preferred_helper_status === 'pending'  ? 'activating_soon' :
                need.preferred_helper_status === 'accepted' ? 'published' :
                need.preferred_helper_status === 'expired'  ? 'cancelled' : 'planned'
              }`}>
                {PREF_HELPER_LABELS[need.preferred_helper_status] || need.preferred_helper_status}
              </span>
            )}
          </div>
        )}
            {isActive && need.preferred_helper_id && need.status === 'published' && (
      <PlannedNeedHoldStatus need={need} onUpdate={onUpdate} />
    )}

        {cost > 0 && isActive && (
          <div className="pn-meter-wrap">
            <div className="pn-meter-labels">
              <span>{t('plannedNeeds.reserved', { amount: fmt$(reserved) })}</span>
              <span>{t('plannedNeeds.funded', { pct: fundPct })}</span>
            </div>
            <div className="pn-meter-track">
              <div className="pn-meter-fill" style={{ width:`${fundPct}%` }} />
            </div>
          </div>
        )}

        {monthly > 0 && isActive && (
          <div className="pn-sinking-fund">
            {t('plannedNeeds.sinkingFundHint', { amount: fmt$(monthly) })}
          </div>
        )}

        {need.description && (
          <p style={{ fontSize:'0.83rem', color:'var(--muted-text)', marginTop:'0.5rem', marginBottom:0 }}>
            {need.description}
          </p>
        )}
      </div>

      {isActive && (
        <div className="pn-card-actions">
          {onEdit     && <button className="pn-card-action-btn" onClick={onEdit}>{t('plannedNeeds.editBtn')}</button>}
          {onComplete && <button className="pn-card-action-btn primary" onClick={onComplete}>{t('plannedNeeds.completeBtn')}</button>}
          {onCancel   && <button className="pn-card-action-btn danger" onClick={onCancel}>{t('plannedNeeds.cancelBtn')}</button>}
        </div>
      )}
    </div>
  );
}
