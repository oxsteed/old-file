import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminListClaims, adminUpdateClaim, adminListRefundCases, adminUpdateRefundCase } from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';

const STATUS_COLOR = {
  open:'#f59e0b', under_review:'#f97316', approved:'#22c55e',
  rejected:'#ef4444', resolved:'#10b981', escalated:'#8b5cf6',
};

export default function DisputesAdmin() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('claims');
  const [claims, setClaims]   = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus]   = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm]         = useState({});

  const load = () => {
    setLoading(true);
    setLoadError(null);
    adminListClaims({ status: status||undefined })
      .then(r => setClaims(r.data||[]))
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
    adminListRefundCases({ status: status||undefined })
      .then(r => setRefunds(r.data||[]))
      .catch((err) => setLoadError(err));
  };
  useEffect(() => { load(); }, [status]);

  const save = async () => {
    try {
      if (tab === 'claims') {
        await adminUpdateClaim(selected.id, form);
        toast.success('Claim updated');
      } else {
        await adminUpdateRefundCase(selected.id, form);
        toast.success('Refund case updated');
      }
      setSelected(null);
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">⚖️ Claims & Disputes</h1>
        <p className="lx-page-sub">Review shortages, damage, delays, customs rejections, and other claims.</p>
      </div>

      <div className="lx-filter-bar">
        <select className="lx-select" value={tab} onChange={e => setTab(e.target.value)}>
          <option value="claims">Claims</option>
          <option value="refunds">Refunds</option>
        </select>
        <select className="lx-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {(tab === 'claims' ? Object.keys(STATUS_COLOR) : ['pending','reviewing','approved','processed','rejected']).map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
        </select>
      </div>

      {loading && <div className="lx-loading">Loading…</div>}
      {!loading && loadError && <AdminErrorState onRetry={load} />}

      {tab === 'claims' && <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>Reference</th><th>Type</th><th>Claimant</th>
              <th>Amount</th><th>Status</th><th>Created</th><th></th>
            </tr>
          </thead>
          <tbody>
            {claims.map(c => (
              <tr key={c.id}>
                <td><code style={{ fontSize:'.78rem' }}>{c.reference}</code></td>
                <td>
                  <span style={{ background:'#f1f5f9', borderRadius:'.375rem', padding:'.15rem .5rem', fontSize:'.72rem', fontWeight:700 }}>
                    {c.claim_type?.replace(/_/g,' ')}
                  </span>
                </td>
                <td style={{ fontSize:'.82rem' }}>{c.claimant_name || '—'}</td>
                <td style={{ fontWeight:700, color:'#f97316' }}>
                  {c.claimed_amount_usd ? `$${parseFloat(c.claimed_amount_usd).toLocaleString()}` : '—'}
                </td>
                <td>
                  <span className="lx-status-pill" style={{ background: STATUS_COLOR[c.status]||'#64748b' }}>
                    {c.status?.replace(/_/g,' ')}
                  </span>
                </td>
                <td style={{ fontSize:'.8rem' }}>{new Date(c.created_at).toLocaleDateString()}</td>
                <td>
                  <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                    onClick={() => { setSelected(c); setForm({ status: c.status, approved_amount_usd: c.approved_amount_usd || c.claimed_amount_usd, resolution_notes: c.resolution_notes||'' }); }}>
                    Review
                  </button>
                </td>
              </tr>
            ))}
            {claims.length === 0 && !loading && !loadError && (
              <tr><td colSpan={7} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>No claims found.</td></tr>
            )}
          </tbody>
        </table>
      </div>}

      {tab === 'refunds' && (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr>
                <th>Reference</th><th>Reason</th><th>Requester</th><th>Requested</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {refunds.map((r) => (
                <tr key={r.id}>
                  <td><code style={{ fontSize:'.78rem' }}>{r.reference}</code></td>
                  <td>{r.refund_reason}</td>
                  <td style={{ fontSize:'.82rem' }}>{r.requester_name || '—'}</td>
                  <td style={{ fontWeight:700, color:'#f97316' }}>${parseFloat(r.requested_amount_usd || 0).toLocaleString()}</td>
                  <td><span className="lx-status-pill" style={{ background: r.status === 'approved' ? '#22c55e' : r.status === 'rejected' ? '#ef4444' : '#64748b' }}>{r.status}</span></td>
                  <td>
                    <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                      onClick={() => { setSelected(r); setForm({ status: r.status, approved_amount_usd: r.approved_amount_usd || r.requested_amount_usd, notes: r.notes || '', stripe_refund_id: r.stripe_refund_id || '' }); }}>
                      Review
                    </button>
                  </td>
                </tr>
              ))}
              {refunds.length === 0 && !loading && !loadError && (
                <tr><td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>No refund cases found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div style={{ background:'var(--card-bg,#fff)', borderRadius:'1rem', padding:'1.5rem', width:480, maxWidth:'90vw' }}>
            <h3 style={{ fontWeight:700, marginBottom:'.5rem' }}>{selected.reference}</h3>
            <div style={{ fontSize:'.82rem', color:'#64748b', marginBottom:'1rem' }}>
              {tab === 'claims' ? (
                <>
                  <strong>Claim Type:</strong> {selected.claim_type?.replace(/_/g,' ')}<br/>
                  <strong>Description:</strong> {selected.description}
                </>
              ) : (
                <>
                  <strong>Refund Reason:</strong> {selected.refund_reason}<br/>
                  <strong>Requested:</strong> ${parseFloat(selected.requested_amount_usd || 0).toFixed(2)}
                </>
              )}
            </div>
            <div className="lx-form-group">
              <label className="lx-label">Update Status</label>
              <select className="lx-select" value={form.status} onChange={e => setForm(f=>({...f,status:e.target.value}))}>
                {(tab === 'claims' ? Object.keys(STATUS_COLOR) : ['pending','reviewing','approved','processed','rejected']).map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">Approved Amount (USD)</label>
              <input type="number" className="lx-input" value={form.approved_amount_usd||''}
                onChange={e => setForm(f=>({...f,approved_amount_usd:e.target.value}))} />
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{tab === 'claims' ? 'Resolution Notes' : 'Notes'}</label>
              <textarea className="lx-textarea" value={(tab === 'claims' ? form.resolution_notes : form.notes)||''}
                onChange={e => setForm(f=>({...f,[tab === 'claims' ? 'resolution_notes' : 'notes']:e.target.value}))} />
            </div>
            {tab === 'refunds' && (
              <div className="lx-form-group">
                <label className="lx-label">Stripe Refund ID</label>
                <input className="lx-input" value={form.stripe_refund_id||''}
                  onChange={e => setForm(f=>({...f,stripe_refund_id:e.target.value}))} />
              </div>
            )}
            <div style={{ display:'flex', gap:'.75rem' }}>
              <button className="lx-btn-primary" onClick={save}>Save Decision</button>
              <button className="lx-btn-secondary" onClick={() => setSelected(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
