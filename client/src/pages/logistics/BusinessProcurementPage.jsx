import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { listSourcingRequests, listRecurringPrograms, createRecurringProgram, updateRecurringProgramStatus, listLanes, getBusinessProcurementAccess } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import { useAuth } from '../../context/AuthContext';
import { canAccessBusinessProcurementWorkspace, isBusinessProcurementEligibleMembership } from '../../utils/logisticsWorkspaces';
import LogisticsWorkspaceSwitcher from '../../components/logistics/LogisticsWorkspaceSwitcher';
import '../../styles/logistics/LogisticsHomePage.css';

const CADENCE_OPTIONS = ['weekly', 'biweekly', 'monthly', 'quarterly', 'custom'];

export default function BusinessProcurementPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [lanes, setLanes] = useState([]);
  const [businessAccess, setBusinessAccess] = useState({ businesses: [], eligibleBusinesses: [] });
  const [loading, setLoading] = useState(true);
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
      .catch(() => {})
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

  const createProgramFromForm = async () => {
    if (!form.title) {
      toast.error('Program title is required');
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
      toast.success('Recurring procurement program created');
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
      toast.success(`Program ${nextStatus}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  return (
    <PageShell>
      <div className="lx-page">
      {!loading && !hasAccess && (
        <div className="lx-card" style={{ marginBottom:'1.5rem', border:'1px solid #f97316' }}>
          <h2 style={{ marginTop:0 }}>Business Procurement is not enabled for this account</h2>
          <p style={{ color:'#64748b', lineHeight:1.7 }}>
            This workspace is reserved for users who can act on behalf of a business in procurement and operations. Right now, OxSteed enables it for business owners, active managers, and memberships that hold operations-style permissions.
          </p>
          <div style={{ display:'grid', gap:'.5rem', color:'#475569', fontSize:'.9rem' }}>
            <div><strong>Your eligible business workspaces:</strong> {businessAccess.eligibleBusinesses.length}</div>
            <div><strong>How access is determined:</strong> ownership, active manager membership, or a non-owner membership with operations/procurement-style permissions.</div>
          </div>
          <div style={{ display:'flex', gap:'.75rem', marginTop:'1rem', flexWrap:'wrap' }}>
            <Link to="/logistics" className="lx-btn-secondary">Back to Logistics</Link>
            <Link to="/business-hub" className="lx-btn-primary">Open Business Hub</Link>
          </div>
        </div>
      )}

      {hasAccess && (
        <>
      <LogisticsWorkspaceSwitcher
        currentKey="business_procurement"
        availability={{ buyer: true, organizer: true, business_procurement: hasAccess, distributor: true }}
      />
      <div className="lx-dashboard-hero">
        <div className="lx-card lx-dashboard-hero-main">
          <div className="lx-dashboard-kicker">Business procurement</div>
          <h1 className="lx-page-title">Business Procurement Dashboard</h1>
          <p className="lx-page-sub">Manage restock rhythm, recurring sourcing lanes, and business-approved demand without losing sight of which company the order is for.</p>
          <div className="lx-dashboard-actions">
            <button className="lx-btn-primary" onClick={() => setShowForm((current) => !current)}>
              {showForm ? 'Close planner' : 'New recurring program'}
            </button>
            <Link to="/logistics/requests/new" className="lx-btn-ghost">Open business-linked request</Link>
          </div>
          <div className="lx-dashboard-stat-grid">
            <div className="lx-dashboard-stat">
              <div className="lx-dashboard-stat-value">{activePrograms}</div>
              <div className="lx-dashboard-stat-label">Active restock programs</div>
              <div className="lx-dashboard-stat-meta">Cadences already driving repeat sourcing demand.</div>
            </div>
            <div className="lx-dashboard-stat">
              <div className="lx-dashboard-stat-value">{businessAccess.eligibleBusinesses.length}</div>
              <div className="lx-dashboard-stat-label">Eligible businesses</div>
              <div className="lx-dashboard-stat-meta">Companies this account can legitimately buy for.</div>
            </div>
            <div className="lx-dashboard-stat">
              <div className="lx-dashboard-stat-value">{upcomingRuns}</div>
              <div className="lx-dashboard-stat-label">Runs within 21 days</div>
              <div className="lx-dashboard-stat-meta">Upcoming procurement cycles that need readiness checks.</div>
            </div>
          </div>
        </div>

        <div className="lx-dashboard-side">
          <div className="lx-card">
            <h2 className="lx-dashboard-panel-title">Procurement pressure points</h2>
            <p className="lx-dashboard-panel-copy">This workspace is strongest when it tells you what to reorder, what to lane-match, and which business needs action first.</p>
            <div className="lx-alert-list">
              <div className="lx-alert-item">
                <div>
                  <strong>Upcoming runs</strong>
                  <span>Programs that execute soon should be checked for quantity, lane fit, and destination readiness.</span>
                </div>
                <div className="lx-alert-count">{upcomingRuns}</div>
              </div>
              <div className="lx-alert-item">
                <div>
                  <strong>Lane-bound programs</strong>
                  <span>These already have a defined lane, so pricing and compliance planning can be more deliberate.</span>
                </div>
                <div className="lx-alert-count">{laneBoundPrograms}</div>
              </div>
              <div className="lx-alert-item">
                <div>
                  <strong>Business-linked requests</strong>
                  <span>Demand already tied to a qualified business should be prioritized before generic sourcing.</span>
                </div>
                <div className="lx-alert-count">{procurementEligible.length}</div>
              </div>
            </div>
          </div>

          <div className="lx-card">
            <h2 className="lx-dashboard-panel-title">Eligible business lanes</h2>
            {businessAccess.eligibleBusinesses.length > 0 ? (
              <div className="lx-mini-list">
                {businessAccess.eligibleBusinesses.slice(0, 3).map((entry) => (
                  <div key={entry.business_id} className="lx-mini-list-item">
                    <strong>{entry.business_name}</strong>
                    <span>{entry.is_owner ? 'Owner access' : `${entry.role} access`} with procurement-style authority.</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="lx-empty-state">No eligible businesses are attached to this account yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className="lx-key-metrics">
        {[
          ['Recurring programs', programs.length, '🔁', 'Saved cadences for repeat inventory and supply demand.'],
          ['Business-linked requests', procurementEligible.length, '🏢', 'Requests already tied to a qualified business context.'],
          ['Active programs', activePrograms, '✅', 'Programs that should currently influence sourcing planning.'],
          ['Eligible businesses', businessAccess.eligibleBusinesses.length, '🏬', 'Separate business contexts you can operate procurement for.'],
        ].map(([label, value, icon, note]) => (
          <div key={label} className="lx-key-metric-card">
            <div className="lx-key-metric-top">
              <div className="lx-key-metric-value">{value}</div>
              <div className="lx-key-metric-icon">{icon}</div>
            </div>
            <div className="lx-key-metric-label">{label}</div>
            <div className="lx-key-metric-note">{note}</div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="lx-card" style={{ marginBottom:'1.5rem', border:'2px solid #f97316' }}>
          <h2 style={{ marginTop:0 }}>Recurring procurement planner</h2>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
            <div className="lx-form-group"><label className="lx-label">Program title</label><input className="lx-input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
            <div className="lx-form-group"><label className="lx-label">Category</label><input className="lx-input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} /></div>
            <div className="lx-form-group"><label className="lx-label">Cadence</label><select className="lx-select" value={form.cadence} onChange={(e) => setForm((f) => ({ ...f, cadence: e.target.value }))}>{CADENCE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
            <div className="lx-form-group"><label className="lx-label">Lane</label><select className="lx-select" value={form.lane_id} onChange={(e) => setForm((f) => ({ ...f, lane_id: e.target.value }))}><option value="">Any approved lane</option>{lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.name} ({lane.origin_country} → {lane.destination_country})</option>)}</select></div>
            <div className="lx-form-group"><label className="lx-label">Target quantity</label><input className="lx-input" type="number" value={form.target_qty} onChange={(e) => setForm((f) => ({ ...f, target_qty: e.target.value }))} /></div>
            <div className="lx-form-group"><label className="lx-label">Unit</label><input className="lx-input" value={form.target_unit} onChange={(e) => setForm((f) => ({ ...f, target_unit: e.target.value }))} /></div>
            <div className="lx-form-group"><label className="lx-label">Destination country</label><input className="lx-input" maxLength={2} value={form.destination_country} onChange={(e) => setForm((f) => ({ ...f, destination_country: e.target.value.toUpperCase() }))} /></div>
            <div className="lx-form-group"><label className="lx-label">Destination city</label><input className="lx-input" value={form.destination_city} onChange={(e) => setForm((f) => ({ ...f, destination_city: e.target.value }))} /></div>
            <div className="lx-form-group"><label className="lx-label">Budget max (USD)</label><input className="lx-input" type="number" value={form.budget_max_usd} onChange={(e) => setForm((f) => ({ ...f, budget_max_usd: e.target.value }))} /></div>
            <div className="lx-form-group"><label className="lx-label">Next run date</label><input className="lx-input" type="date" value={form.next_run_date} onChange={(e) => setForm((f) => ({ ...f, next_run_date: e.target.value }))} /></div>
            <div className="lx-form-group" style={{ gridColumn:'1 / -1' }}>
              <label className="lx-label">Linked sourcing request (optional)</label>
              <select className="lx-select" value={form.sourcing_request_id} onChange={(e) => setForm((f) => ({ ...f, sourcing_request_id: e.target.value }))}>
                <option value="">No linked request</option>
                {procurementEligible.map((request) => <option key={request.id} value={request.id}>{request.reference} · {request.title}</option>)}
              </select>
            </div>
            <div className="lx-form-group" style={{ gridColumn:'1 / -1' }}><label className="lx-label">Notes</label><textarea className="lx-textarea" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <div style={{ display:'flex', gap:'.75rem' }}>
            <button className="lx-btn-primary" disabled={saving} onClick={createProgramFromForm}>{saving ? 'Saving…' : 'Create program'}</button>
            <button className="lx-btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="lx-card" style={{ marginBottom:'1.5rem' }}>
        <div className="lx-section-header"><h2>Recurring procurement programs</h2><Link to="/logistics/sourcing">Open sourcing</Link></div>
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead><tr><th>Program</th><th>Cadence</th><th>Next run</th><th>Status</th><th>Linked request</th><th></th></tr></thead>
            <tbody>
              {programs.map((program) => (
                <tr key={program.id}>
                  <td><strong>{program.title}</strong><div style={{ fontSize:'.75rem', color:'#64748b' }}>{program.category || 'General procurement'}</div></td>
                  <td>{program.cadence}</td>
                  <td>{program.next_run_date ? new Date(program.next_run_date).toLocaleDateString() : '—'}</td>
                  <td><span className="lx-status-pill" style={{ background: program.status === 'active' ? '#22c55e' : program.status === 'paused' ? '#f59e0b' : '#64748b' }}>{program.status}</span></td>
                  <td>{program.sourcing_reference || '—'}</td>
                  <td><button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }} onClick={() => toggleProgram(program)}>{program.status === 'active' ? 'Pause' : 'Activate'}</button></td>
                </tr>
              ))}
              {!loading && programs.length === 0 && <tr><td colSpan={6} style={{ textAlign:'center', color:'#94a3b8' }}>No recurring procurement programs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="lx-dashboard-grid">
        <div className="lx-card">
          <div className="lx-section-header"><h2>Business-linked sourcing requests</h2><Link to="/logistics/requests/new">New request</Link></div>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead><tr><th>Reference</th><th>Request</th><th>Status</th><th>Converted</th></tr></thead>
              <tbody>
                {procurementEligible.slice(0, 10).map((request) => (
                  <tr key={request.id}>
                    <td><Link to={`/logistics/requests/${request.id}`} className="lx-link">{request.reference}</Link></td>
                    <td>{request.title}</td>
                    <td><span className="lx-status-pill" style={{ background:'#64748b' }}>{request.status}</span></td>
                    <td>{request.converted_to || '—'}</td>
                  </tr>
                ))}
                {!loading && procurementEligible.length === 0 && <tr><td colSpan={4} style={{ textAlign:'center', color:'#94a3b8' }}>No business-linked procurement requests yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lx-card">
          <div className="lx-section-header"><h2>Procurement operating guidance</h2><Link to="/business-hub">Business Hub</Link></div>
          <div className="lx-mini-list">
            <div className="lx-mini-list-item">
              <strong>Build around real business authority</strong>
              <span>This workspace only works when demand is tied to an actual business you can act for, not just a personal sourcing idea.</span>
            </div>
            <div className="lx-mini-list-item">
              <strong>Use lane-aware planning</strong>
              <span>Choose lanes early for recurring programs when pricing, compliance, and destination restrictions materially affect landed cost.</span>
            </div>
            <div className="lx-mini-list-item">
              <strong>Restock before the rush</strong>
              <span>Programs with soon-coming run dates should be checked before warehouses, teams, or field crews feel the shortage.</span>
            </div>
          </div>
          <div className="lx-insight-chip-row">
            <span className="lx-insight-chip">Recurring demand planning</span>
            <span className="lx-insight-chip">Business-scoped sourcing only</span>
            <span className="lx-insight-chip">Lane-aware purchasing</span>
          </div>
        </div>
      </div>
        </>
      )}
      </div>
    </PageShell>
  );
}
