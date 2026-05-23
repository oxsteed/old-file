import React, { useEffect, useState } from 'react';
import { adminListQuotes, adminReviewQuote } from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLOR = {
  submitted:'#f59e0b', under_review:'#3b82f6', accepted:'#22c55e', rejected:'#ef4444', expired:'#94a3b8',
};

export default function QuotesManagement() {
  const [quotes, setQuotes]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [status, setStatus]     = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm]         = useState({ action:'', admin_notes:'' });

  const load = () => {
    setLoading(true);
    adminListQuotes({ status: status||undefined })
      .then(r => setQuotes(r.data||[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [status]);

  const review = async () => {
    if (!form.action) { toast.error('Select accept or reject'); return; }
    try {
      await adminReviewQuote(selected.id, form);
      toast.success(`Quote ${form.action}ed`);
      setSelected(null);
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">💬 Quotes Management</h1>
        <p className="lx-page-sub">Review supplier quotes submitted for sourcing requests.</p>
      </div>

      <div className="lx-filter-bar">
        <select className="lx-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {Object.keys(STATUS_COLOR).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading && <div className="lx-loading">Loading…</div>}

      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>Reference</th><th>Sourcing Request</th><th>Supplier</th>
              <th>Unit Price</th><th>MOQ</th><th>Lead Days</th><th>Status</th><th>Submitted</th><th></th>
            </tr>
          </thead>
          <tbody>
            {quotes.map(q => (
              <tr key={q.id}>
                <td><code style={{ fontSize:'.78rem' }}>{q.reference || `QT-${q.id}`}</code></td>
                <td style={{ fontSize:'.82rem', color:'#64748b' }}>{q.sourcing_ref || q.sourcing_request_id}</td>
                <td style={{ fontWeight:600 }}>{q.supplier_name || '—'}</td>
                <td style={{ fontWeight:700, color:'#f97316' }}>
                  {q.unit_price_usd ? `$${parseFloat(q.unit_price_usd).toFixed(2)}` : '—'}
                </td>
                <td>{q.moq ? q.moq.toLocaleString() : '—'}</td>
                <td>{q.lead_time_days ? `${q.lead_time_days}d` : '—'}</td>
                <td>
                  <span className="lx-status-pill" style={{ background: STATUS_COLOR[q.status]||'#64748b' }}>
                    {q.status}
                  </span>
                </td>
                <td style={{ fontSize:'.8rem' }}>{q.created_at ? new Date(q.created_at).toLocaleDateString() : '—'}</td>
                <td>
                  {q.status === 'submitted' && (
                    <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                      onClick={() => { setSelected(q); setForm({ action:'', admin_notes:'' }); }}>
                      Review
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {quotes.length === 0 && !loading && (
              <tr><td colSpan={9} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>No quotes found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div style={{ background:'var(--card-bg,#fff)', borderRadius:'1rem', padding:'1.5rem', width:480, maxWidth:'90vw' }}>
            <h3 style={{ fontWeight:700, marginBottom:'.5rem' }}>Review Quote</h3>
            <div style={{ fontSize:'.82rem', color:'#64748b', marginBottom:'1rem' }}>
              <strong>Supplier:</strong> {selected.supplier_name}<br/>
              <strong>Unit Price:</strong> ${parseFloat(selected.unit_price_usd||0).toFixed(2)}<br/>
              <strong>MOQ:</strong> {selected.moq?.toLocaleString()}<br/>
              <strong>Lead Time:</strong> {selected.lead_time_days} days<br/>
              {selected.freight_included && <><strong>Freight Included:</strong> Yes<br/></>}
              {selected.notes && <><strong>Supplier Notes:</strong> {selected.notes}</>}
            </div>
            {selected.sample_price_usd && (
              <div style={{ background:'#f0fdf4', borderRadius:'.5rem', padding:'.75rem', marginBottom:'1rem', fontSize:'.82rem' }}>
                Sample available: <strong>${parseFloat(selected.sample_price_usd).toFixed(2)}</strong>
                {selected.sample_lead_days && ` (${selected.sample_lead_days}d lead)`}
              </div>
            )}
            <div className="lx-form-group">
              <label className="lx-label">Decision</label>
              <select className="lx-select" value={form.action} onChange={e => setForm(f=>({...f,action:e.target.value}))}>
                <option value="">— Choose —</option>
                <option value="accepted">Accept</option>
                <option value="rejected">Reject</option>
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">Admin Notes (shared with buyer)</label>
              <textarea className="lx-textarea" value={form.admin_notes}
                onChange={e => setForm(f=>({...f,admin_notes:e.target.value}))} />
            </div>
            <div style={{ display:'flex', gap:'.75rem' }}>
              <button className="lx-btn-primary" onClick={review}>Submit Decision</button>
              <button className="lx-btn-secondary" onClick={() => setSelected(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
