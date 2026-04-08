import { useState, useEffect, useCallback } from 'react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import api from '../api/axios';
import QuickAddTemplates from '../components/QuickAddTemplates';
import PlannedNeedHoldStatus from '../components/PlannedNeedHoldStatus';
import '../styles/PlannedNeedsPage.css';

// ── constants ──────────────────────────────────────────────────────────────
const WINDOWS = ['1w','2w','1m','3m','6m','1y','5y','10y'];
const WINDOW_LABELS = {
  '1w':'1 Week','2w':'2 Weeks','1m':'1 Month','3m':'3 Months',
  '6m':'6 Months','1y':'1 Year','5y':'5 Years','10y':'10 Years',
};

const CATEGORY_LABELS = { car_care:'Car Care', personal_care:'Personal Care', other:'Other' };
const STATUS_LABELS = {
  planned:'Planned', funding:'Funding', activating_soon:'Activating Soon',
  published:'Published', completed:'Completed', cancelled:'Cancelled', regenerated:'Regenerated',
};

const ACTIVE_STATUSES   = ['planned','funding','activating_soon'];
const INACTIVE_STATUSES = ['published','completed','cancelled','regenerated'];

const PREF_HELPER_LABELS = {
  pending:  'Awaiting Confirmation',
  accepted: 'Confirmed',
  declined: 'Declined',
  expired:  'No Response — Broadcast',
};

const DEFAULT_FORM = {
  title:'', description:'', category:'other', due_date:'',
  estimated_cost:'', lead_time_days:7, recurrence_type:'none',
  recurrence_interval_days:'', preferred_helper_id:'', notes:'',
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
function daysLabel(days) {
  if (days === null || days === undefined) return '';
  const d = parseInt(days);
  if (d < 0)  return 'Overdue';
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d < 7)  return `${d} days`;
  if (d < 30) return `${Math.round(d/7)} wk`;
  if (d < 365) return `${Math.round(d/30)} mo`;
  return `${(d/365).toFixed(1)} yr`;
}
function helperDisplayName(need) {
  if (!need.preferred_helper_first_name) return null;
  return `${need.preferred_helper_first_name} ${(need.preferred_helper_last_name||'').charAt(0)}.`.trim();
}

// ── main component ─────────────────────────────────────────────────────────
export default function PlannedNeedsPage() {
  const [needs, setNeeds] = useState([]);
  const [projection, setProjection] = useState(null);
  const [savedHelpers, setSavedHelpers] = useState([]);
  const [window_, setWindow] = useState('1m');
  const [loading, setLoading] = useState(true);
  const [projLoading, setProjLoading] = useState(false);

  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
      const { data } = await api.get(`/planned-needs/projection?window=${win}`);
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

  useEffect(() => { loadNeeds(); loadSavedHelpers(); }, [loadNeeds, loadSavedHelpers]);
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
    if (!form.title.trim()) { setError('Title is required.'); return; }
    if (!form.due_date)      { setError('Due date is required.'); return; }
    if (form.recurrence_type !== 'none' && !form.recurrence_interval_days) {
      setError('Repeat interval (days) is required when recurrence is enabled.'); return;
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
      };
      if (modal === 'add') await api.post('/planned-needs', payload);
      else                  await api.put(`/planned-needs/${selected.id}`, payload);
      closeModal();
      await loadNeeds();
      await loadProjection(window_);
    } catch (e) {
      setError(e?.response?.data?.error || 'Something went wrong.');
    } finally { setSaving(false); }
  }

  async function handleCancel() {
    setSaving(true);
    try {
      await api.post(`/planned-needs/${selected.id}/cancel`);
      closeModal(); await loadNeeds(); await loadProjection(window_);
    } catch (e) { setError(e?.response?.data?.error || 'Failed to cancel.'); }
    finally { setSaving(false); }
  }

  async function handleComplete() {
    setSaving(true);
    try {
      await api.post(`/planned-needs/${selected.id}/complete`, {
        actual_cost: form.actual_cost ? parseFloat(form.actual_cost) : undefined,
      });
      closeModal(); await loadNeeds(); await loadProjection(window_);
    } catch (e) { setError(e?.response?.data?.error || 'Failed to mark complete.'); }
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
        title="Planned Needs — OxSteed"
        description="Schedule future services, fund them gradually, and auto-publish when the time comes."
      />
      <div className="pn-page">

        {/* Header */}
        <div className="pn-header">
          <div>
            <h1>Planned Needs</h1>
            <p>Schedule future services, save gradually with sinking funds, and auto-post jobs when it's time.</p>
          </div>
          <button className="pn-add-btn" onClick={openAdd}>+ Add Planned Need</button>
        </div>

        {/* Life Pulse Projection */}
        <div className="pn-projection">
          <div className="pn-projection-header">
            <h2>Life Pulse Projection</h2>
            <div className="pn-window-tabs">
              {WINDOWS.map(w => (
                <button key={w}
                  className={`pn-window-tab${window_ === w ? ' active' : ''}`}
                  onClick={() => setWindow(w)}>{w}
                </button>
              ))}
            </div>
          </div>

          {projLoading ? (
            <p style={{ color:'var(--muted-text)', textAlign:'center', padding:'1rem 0' }}>Loading projection…</p>
          ) : projection ? (
            <>
              <div className="pn-projection-grid">
                <div className="pn-proj-stat">
                  <div className="label">Projected Income</div>
                  <div className="value positive">{fmt$(projection.projected_income)}</div>
                </div>
                <div className="pn-proj-stat">
                  <div className="label">Fixed Expenses</div>
                  <div className="value negative">{fmt$(projection.projected_fixed_expenses)}</div>
                </div>
                <div className="pn-proj-stat">
                  <div className="label">Sinking Funds</div>
                  <div className="value warn">{fmt$(projection.sinking_fund_for_window)}</div>
                </div>
                <div className="pn-proj-stat">
                  <div className="label">Net Available</div>
                  <div className={`value ${projection.net_available >= 0 ? 'positive' : 'negative'}`}>
                    {fmt$(projection.net_available)}
                  </div>
                </div>
                <div className="pn-proj-stat">
                  <div className="label">Coverage Ratio</div>
                  <div className={`value ${
                    projection.coverage_ratio === null ? 'neutral'
                    : projection.coverage_ratio >= 1.2  ? 'positive'
                    : projection.coverage_ratio >= 0.9  ? 'warn'
                    : 'negative'}`}>
                    {projection.coverage_ratio !== null ? `${projection.coverage_ratio}x` : '—'}
                  </div>
                </div>
                <div className="pn-proj-stat">
                  <div className="label">Auto-Publishing</div>
                  <div className={`value ${projection.auto_publishing_in_window > 0 ? 'warn' : 'neutral'}`}>
                    {projection.auto_publishing_in_window} job{projection.auto_publishing_in_window !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
              <p className="pn-proj-note">
                Income &amp; expenses based on your last 90 days. Sinking funds:
                <em> (cost − reserved) ÷ days remaining × {WINDOW_LABELS[window_]}</em>.
              </p>
            </>
          ) : (
            <p style={{ color:'var(--muted-text)', textAlign:'center' }}>No projection data yet.</p>
          )}
        </div>

        {/* Auto-publish queue banner */}
        {activatingSoon.length > 0 && (
          <div className="pn-queue-banner">
            <span>⚡</span>
            <span>
              <strong>{activatingSoon.length} need{activatingSoon.length !== 1 ? 's' : ''}</strong>{' '}
              will auto-publish as a job post within the next day. Review below and cancel if needed.
            </span>
          </div>
        )}

        {/* Active needs */}
        {loading ? (
          <p style={{ color:'var(--muted-text)' }}>Loading…</p>
        ) : (
          <>
            <p className="pn-section-title">Active ({activeNeeds.length})</p>
            {activeNeeds.length === 0 ? (
              <div className="pn-empty">
                <div className="pn-empty-icon">📋</div>
                <p style={{ fontWeight:700 }}>No planned needs yet</p>
                <p>Add your first — oil change, dental visit, anything coming up.</p>
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
                  History ({inactiveNeeds.length})
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
              <h2>{modal === 'add' ? 'Add Planned Need' : 'Edit Planned Need'}</h2>
                {modal === 'add' && <QuickAddTemplates onSelect={(t) => setForm(f => ({ ...f, ...t }))} />}

              <div className="pn-form-group">
                <label>Title *</label>
                <input name="title" value={form.title} onChange={handleFormChange}
                  placeholder="e.g. Oil change, Dental checkup" maxLength={200} />
              </div>

              <div className="pn-form-row">
                <div className="pn-form-group">
                  <label>Category</label>
                  <select name="category" value={form.category} onChange={handleFormChange}>
                    <option value="car_care">Car Care</option>
                    <option value="personal_care">Personal Care</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="pn-form-group">
                  <label>Due Date *</label>
                  <input type="date" name="due_date" value={form.due_date} onChange={handleFormChange} />
                </div>
              </div>

              <div className="pn-form-row">
                <div className="pn-form-group">
                  <label>Estimated Cost ($)</label>
                  <input type="number" name="estimated_cost" value={form.estimated_cost}
                    onChange={handleFormChange} placeholder="0.00" min="0" step="0.01" />
                </div>
                <div className="pn-form-group">
                  <label>Lead Time (days)</label>
                  <input type="number" name="lead_time_days" value={form.lead_time_days}
                    onChange={handleFormChange} min="1" max="90" />
                  <div className="pn-form-hint">Job auto-posts this many days before due date.</div>
                </div>
              </div>

              <div className="pn-form-row">
                <div className="pn-form-group">
                  <label>Recurrence</label>
                  <select name="recurrence_type" value={form.recurrence_type} onChange={handleFormChange}>
                    <option value="none">No recurrence</option>
                    <option value="fixed">Fixed (calendar rhythm)</option>
                    <option value="floating">Floating (from completion)</option>
                  </select>
                </div>
                {form.recurrence_type !== 'none' && (
                  <div className="pn-form-group">
                    <label>Repeat every (days) *</label>
                    <input type="number" name="recurrence_interval_days"
                      value={form.recurrence_interval_days} onChange={handleFormChange}
                      placeholder="e.g. 90" min="1" />
                  </div>
                )}
              </div>

              {/* Preferred Helper */}
              <div className="pn-form-group">
                <label>Preferred Helper <span style={{ fontWeight:400, color:'var(--muted-text)' }}>(optional)</span></label>
                {savedHelpers.length === 0 ? (
                  <div className="pn-form-hint" style={{ padding:'0.5rem 0' }}>
                    No saved helpers yet. <a href="/helpers" style={{ color:'#F4A261' }}>Browse helpers</a> and save favorites to use this feature.
                  </div>
                ) : (
                  <>
                    <select name="preferred_helper_id" value={form.preferred_helper_id} onChange={handleFormChange}>
                      <option value="">No preference — post to all</option>
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
                        This helper will get first notice. If they don't confirm within 72 hours,
                        the job automatically broadcasts to all helpers nearby.
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="pn-form-group">
                <label>Description</label>
                <textarea name="description" value={form.description} onChange={handleFormChange}
                  rows={2} placeholder="Optional — appears in the auto-posted job." />
              </div>

              <div className="pn-form-group">
                <label>Notes (private)</label>
                <textarea name="notes" value={form.notes} onChange={handleFormChange}
                  rows={2} placeholder="Reminders just for you." />
              </div>

              {error && <p style={{ color:'#f87171', fontSize:'0.85rem', margin:'0 0 0.5rem' }}>{error}</p>}
              <div className="pn-modal-actions">
                <button className="btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : modal === 'add' ? 'Add Need' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Cancel confirmation ───────────────────────────────────── */}
        {modal === 'cancel' && selected && (
          <div className="pn-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="pn-modal">
              <h2>Cancel Planned Need</h2>
              <p>Are you sure you want to cancel <strong>{selected.title}</strong>?
                Its sinking fund contribution will be removed from Life Pulse projections.</p>
              {error && <p style={{ color:'#f87171', fontSize:'0.85rem' }}>{error}</p>}
              <div className="pn-modal-actions">
                <button className="btn-ghost" onClick={closeModal}>Keep It</button>
                <button className="btn-danger" onClick={handleCancel} disabled={saving}>
                  {saving ? 'Cancelling…' : 'Yes, Cancel'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Complete modal ────────────────────────────────────────── */}
        {modal === 'complete' && selected && (
          <div className="pn-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="pn-modal">
              <h2>Mark as Completed</h2>
              <p>Recording the actual cost helps improve future projections.</p>
              <div className="pn-form-group">
                <label>Actual Cost ($)</label>
                <input type="number" name="actual_cost" value={form.actual_cost}
                  onChange={handleFormChange} placeholder="Leave blank to keep estimate"
                  min="0" step="0.01" />
              </div>
              {selected.recurrence_type !== 'none' && (
                <p style={{ fontSize:'0.85rem', color:'var(--muted-text)' }}>
                  Recurring — the next occurrence will be created automatically.
                </p>
              )}
              {error && <p style={{ color:'#f87171', fontSize:'0.85rem' }}>{error}</p>}
              <div className="pn-modal-actions">
                <button className="btn-ghost" onClick={closeModal}>Go Back</button>
                <button className="btn-primary" onClick={handleComplete} disabled={saving}>
                  {saving ? 'Saving…' : 'Mark Complete'}
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
  const cost     = parseFloat(need.estimated_cost || 0);
  const reserved = parseFloat(need.reserved_amount || 0);
  const fundPct  = cost > 0 ? Math.min(100, Math.round((reserved / cost) * 100)) : 0;
  const monthly  = parseFloat(need.sinking_fund_per_month || 0);
  const daysLeft = parseInt(need.days_until_due || 0);
  const isActive = ['planned','funding','activating_soon'].includes(need.status);
  const helperName = helperDisplayName(need);

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
          <span>Due {fmtDate(need.due_date)}</span>
          {isActive && <span>{daysLabel(daysLeft)} away</span>}
          {cost > 0 && <span>Est. {fmt$(cost)}</span>}
          {need.actual_cost && <span>Actual {fmt$(need.actual_cost)}</span>}
          {need.recurrence_type !== 'none' && (
            <span>Every {need.recurrence_interval_days}d ({need.recurrence_type})</span>
          )}
          {need.lead_time_days && isActive && (
            <span>Auto-posts in {daysLabel(daysLeft - need.lead_time_days)}</span>
          )}
        </div>

        {/* Preferred helper row */}
        {helperName && (
          <div className="pn-preferred-helper">
            <span className="pn-ph-label">Preferred helper:</span>
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
              <span>Reserved {fmt$(reserved)}</span>
              <span>{fundPct}% funded</span>
            </div>
            <div className="pn-meter-track">
              <div className="pn-meter-fill" style={{ width:`${fundPct}%` }} />
            </div>
          </div>
        )}

        {monthly > 0 && isActive && (
          <div className="pn-sinking-fund">
            Save <strong>{fmt$(monthly)}/month</strong> to cover by due date
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
          {onEdit     && <button className="pn-card-action-btn" onClick={onEdit}>Edit</button>}
          {onComplete && <button className="pn-card-action-btn primary" onClick={onComplete}>Complete</button>}
          {onCancel   && <button className="pn-card-action-btn danger" onClick={onCancel}>Cancel</button>}
        </div>
      )}
    </div>
  );
}
