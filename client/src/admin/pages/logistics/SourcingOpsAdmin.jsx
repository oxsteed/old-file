import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminListSourcingRequests, adminListQuotes, adminAssignSourcingOperator, adminUpdateSourcingRequestStatus, adminListRecurringPrograms } from '../../../api/logistics';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';

const REQUEST_STATUSES = ['draft', 'quoted', 'pooled', 'procurement', 'private_label', 'cancelled', 'closed'];

export default function SourcingOpsAdmin() {
  const [requests, setRequests] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ operator_user_id: '', status: '', notes: '' });

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      adminListSourcingRequests({ limit: 100 }),
      adminListQuotes({ limit: 50 }),
      adminListRecurringPrograms({ status: 'active' }),
    ])
      .then(([requestRes, quoteRes, programRes]) => {
        setRequests(requestRes.requests || []);
        setQuotes(quoteRes.data || []);
        setPrograms(programRes.data || []);
      })
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const apply = async () => {
    if (!selected) return;
    try {
      if (form.operator_user_id) {
        await adminAssignSourcingOperator(selected.id, form.operator_user_id);
      }
      if (form.status) {
        await adminUpdateSourcingRequestStatus(selected.id, { status: form.status, notes: form.notes });
      }
      toast.success('Sourcing request updated');
      setSelected(null);
      setForm({ operator_user_id: '', status: '', notes: '' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">Sourcing Ops Workspace</h1>
        <p className="lx-page-sub">Run sourcing intake, manage quote-ready requests, and monitor recurring procurement demand from the operator side.</p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'1rem', marginBottom:'1.5rem' }}>
        {[
          ['Open requests', requests.filter((row) => !['closed', 'cancelled'].includes(row.status)).length, '🔍'],
          ['Submitted quotes', quotes.filter((row) => row.status === 'submitted').length, '💬'],
          ['Active recurring programs', programs.length, '🔁'],
        ].map(([label, value, icon]) => (
          <div key={label} className="lx-card" style={{ textAlign:'center' }}>
            <div style={{ fontSize:'1.4rem' }}>{icon}</div>
            <div style={{ fontSize:'1.4rem', fontWeight:800, color:'#f97316' }}>{value}</div>
            <div style={{ color:'#64748b', fontSize:'.8rem', fontWeight:600 }}>{label}</div>
          </div>
        ))}
      </div>

      {!loading && loadError && <AdminErrorState onRetry={load} />}

      <div className="lx-card" style={{ marginBottom:'1.5rem' }}>
        <div className="lx-section-header"><h2>Sourcing request queue</h2></div>
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead><tr><th>Reference</th><th>Request</th><th>Status</th><th>Quotes</th><th>Operator</th><th></th></tr></thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td>{request.reference}</td>
                  <td>{request.title}</td>
                  <td><span className="lx-status-pill" style={{ background:'#64748b' }}>{request.status}</span></td>
                  <td>{request.quote_count || 0}</td>
                  <td>{request.assigned_operator || '—'}</td>
                  <td><button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }} onClick={() => setSelected(request)}>Manage</button></td>
                </tr>
              ))}
              {!loading && !loadError && requests.length === 0 && <tr><td colSpan={6} style={{ textAlign:'center', color:'#94a3b8' }}>No sourcing requests found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="lx-card">
        <div className="lx-section-header"><h2>Recurring procurement programs</h2></div>
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead><tr><th>Program</th><th>Cadence</th><th>Next run</th><th>Lane</th><th>Status</th></tr></thead>
            <tbody>
              {programs.slice(0, 12).map((program) => (
                <tr key={program.id}>
                  <td>{program.title}</td>
                  <td>{program.cadence}</td>
                  <td>{program.next_run_date ? new Date(program.next_run_date).toLocaleDateString() : '—'}</td>
                  <td>{program.lane_name || 'Unassigned'}</td>
                  <td><span className="lx-status-pill" style={{ background: program.status === 'active' ? '#22c55e' : '#64748b' }}>{program.status}</span></td>
                </tr>
              ))}
              {!loading && !loadError && programs.length === 0 && <tr><td colSpan={5} style={{ textAlign:'center', color:'#94a3b8' }}>No recurring procurement programs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div style={{ background:'var(--card-bg,#fff)', borderRadius:'1rem', padding:'1.5rem', width:440, maxWidth:'90vw' }}>
            <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>Manage {selected.reference}</h3>
            <div className="lx-form-group">
              <label className="lx-label">Assign operator UUID</label>
              <input className="lx-input" value={form.operator_user_id} onChange={(e) => setForm((f) => ({ ...f, operator_user_id: e.target.value }))} placeholder="Internal operator user id" />
            </div>
            <div className="lx-form-group">
              <label className="lx-label">Update status</label>
              <select className="lx-select" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="">No status change</option>
                {REQUEST_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">Notes</label>
              <textarea className="lx-textarea" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div style={{ display:'flex', gap:'.75rem' }}>
              <button className="lx-btn-primary" onClick={apply}>Apply</button>
              <button className="lx-btn-secondary" onClick={() => setSelected(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
