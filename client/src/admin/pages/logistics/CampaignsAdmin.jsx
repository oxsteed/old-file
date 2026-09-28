import React, { useEffect, useState } from 'react';
import { adminListCampaigns, adminUpdateCampaignStatus, adminListLanes } from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLOR = {
  draft:'#94a3b8', open:'#22c55e', pledging:'#f59e0b', deposit_phase:'#fb923c',
  locked:'#f97316', placed:'#3b82f6', in_transit:'#06b6d4', receiving:'#8b5cf6',
  distributing:'#14b8a6', completed:'#10b981', refunding:'#a855f7', cancelled:'#ef4444',
};

const NEXT_STATUS = {
  draft: ['open','cancelled'],
  open: ['pledging','deposit_phase','locked','cancelled'],
  pledging: ['deposit_phase','locked','cancelled'],
  deposit_phase: ['locked','cancelled'],
  locked: ['placed','cancelled'],
  placed: ['in_transit'],
  in_transit: ['receiving'],
  receiving: ['distributing'],
  distributing: ['completed'],
  refunding: ['cancelled'],
};

export default function CampaignsAdmin() {
  const [campaigns, setCampaigns] = useState([]);
  const [lanes, setLanes]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected]   = useState(null);
  const [transition, setTransition] = useState('');
  const [saving, setSaving]       = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      adminListCampaigns({ status: statusFilter||undefined }),
      adminListLanes(),
    ]).then(([cRes, lRes]) => {
      setCampaigns(cRes.data||[]);
      setLanes(lRes.data||[]);
    }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [statusFilter]);

  const laneMap = Object.fromEntries(lanes.map(l => [l.id, l.name]));

  const doTransition = async () => {
    if (!transition) { toast.error('Select a status'); return; }
    setSaving(true);
    try {
      await adminUpdateCampaignStatus(selected.id, transition);
      toast.success('Campaign updated');
      setSelected(null);
      load();
    } catch (err) { toast.error(err.response?.data?.message || err.message); }
    finally { setSaving(false); }
  };

  const moqPct = c => c.min_participants > 0
    ? Math.min(100, Math.round((c.current_participants||0) / c.min_participants * 100))
    : 100;

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">🤝 Campaigns Management</h1>
        <p className="lx-page-sub">Manage pooled order campaigns: open, lock, ship, close.</p>
      </div>

      <div className="lx-filter-bar">
        <select className="lx-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {Object.keys(STATUS_COLOR).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading && <div className="lx-loading">Loading…</div>}

      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>Campaign</th><th>Lane</th><th>Product</th>
              <th>MOQ Progress</th><th>Participants</th><th>Close Date</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map(c => {
              const pct = moqPct(c);
              return (
                <tr key={c.id}>
                  <td>
                    <div style={{ fontWeight:700 }}>{c.title}</div>
                    <div style={{ fontSize:'.72rem', color:'#64748b' }}>{c.organizer_name || 'OxSteed'}</div>
                  </td>
                  <td style={{ fontSize:'.8rem' }}>{laneMap[c.lane_id] || c.lane_id}</td>
                  <td style={{ fontSize:'.8rem' }}>{c.product_name || '—'}</td>
                  <td style={{ minWidth:140 }}>
                    <div className="lx-moq-bar-wrap">
                      <div className="lx-moq-bar" style={{ width:`${pct}%` }} />
                    </div>
                    <div style={{ fontSize:'.72rem', color:'#64748b', marginTop:'.2rem' }}>
                      {c.current_committed_qty||0} / {c.moq_quantity} units ({pct}%)
                    </div>
                  </td>
                  <td>{c.current_participants||0}</td>
                  <td style={{ fontSize:'.8rem' }}>
                    {c.closes_at ? new Date(c.closes_at).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    <span className="lx-status-pill" style={{ background: STATUS_COLOR[c.status]||'#64748b' }}>
                      {c.status}
                    </span>
                  </td>
                  <td>
                    <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                      onClick={() => { setSelected(c); setTransition(''); }}>
                      Manage
                    </button>
                  </td>
                </tr>
              );
            })}
            {campaigns.length === 0 && !loading && (
              <tr><td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>No campaigns found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div style={{ background:'var(--card-bg,#fff)', borderRadius:'1rem', padding:'1.5rem', width:460, maxWidth:'90vw' }}>
            <h3 style={{ fontWeight:700, marginBottom:'.5rem' }}>{selected.title}</h3>
            <div style={{ fontSize:'.82rem', color:'#64748b', marginBottom:'1rem' }}>
              <strong>Status:</strong> {selected.status} &nbsp;|&nbsp;
              <strong>Participants:</strong> {selected.current_participants||0} &nbsp;|&nbsp;
              <strong>Committed Qty:</strong> {selected.current_committed_qty||0}
            </div>

            {NEXT_STATUS[selected.status]?.length > 0 ? (
              <>
                <div className="lx-form-group">
                  <label className="lx-label">Transition To</label>
                  <select className="lx-select" value={transition} onChange={e => setTransition(e.target.value)}>
                    <option value="">— Select —</option>
                    {NEXT_STATUS[selected.status].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display:'flex', gap:'.75rem' }}>
                  <button className="lx-btn-primary" onClick={doTransition} disabled={saving}>
                    {saving ? 'Saving…' : 'Apply'}
                  </button>
                  <button className="lx-btn-secondary" onClick={() => setSelected(null)}>Close</button>
                </div>
              </>
            ) : (
              <div style={{ color:'#94a3b8', fontSize:'.85rem', marginBottom:'1rem' }}>
                No further transitions available for status <strong>{selected.status}</strong>.
              </div>
            )}
            {!NEXT_STATUS[selected.status]?.length && (
              <button className="lx-btn-secondary" onClick={() => setSelected(null)}>Close</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
