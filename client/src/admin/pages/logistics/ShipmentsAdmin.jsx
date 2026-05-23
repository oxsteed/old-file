import React, { useEffect, useState } from 'react';
import { adminListShipments, adminAddMilestone, adminUploadShipmentDoc } from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLOR = {
  planned:'#94a3b8', booked:'#3b82f6', origin_received:'#fbbf24', consolidating:'#fb923c',
  departed_origin:'#f59e0b', transshipment:'#8b5cf6', arrived_destination:'#22c55e',
  customs_hold:'#dc2626', customs_cleared:'#16a34a', delivered_to_warehouse:'#10b981',
  receiving:'#0ea5e9', allocation_ready:'#14b8a6', distributed:'#22c55e',
  completed:'#15803d', exception:'#ef4444',
};

const MILESTONE_OPTS = [
  'booked','origin_received','consolidating','departed_origin','transshipment',
  'arrived_destination','customs_hold','customs_cleared','delivered_to_warehouse',
  'receiving','allocation_ready','distributed','completed','exception',
];

const DOC_TYPES = ['bill_of_lading','commercial_invoice','packing_list','certificate_of_origin',
  'customs_declaration','insurance_cert','other'];

export default function ShipmentsAdmin() {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected]   = useState(null);
  const [view, setView]           = useState('milestone'); // milestone | doc
  const [milestone, setMilestone] = useState({ status:'', location:'', notes:'' });
  const [doc, setDoc]             = useState({ doc_type:'', file:null, notes:'' });
  const [saving, setSaving]       = useState(false);

  const load = () => {
    setLoading(true);
    adminListShipments({ status: statusFilter||undefined, limit:200 })
      .then(r => setShipments(r.data||[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [statusFilter]);

  const addMilestone = async () => {
    if (!milestone.status) { toast.error('Select milestone status'); return; }
    setSaving(true);
    try {
      await adminAddMilestone(selected.id, milestone);
      toast.success('Milestone added');
      setSelected(null);
      load();
    } catch (err) { toast.error(err.response?.data?.message || err.message); }
    finally { setSaving(false); }
  };

  const uploadDoc = async () => {
    if (!doc.doc_type || !doc.file) { toast.error('Select document type and file'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('file', doc.file);
      fd.append('doc_type', doc.doc_type);
      if (doc.notes) fd.append('notes', doc.notes);
      await adminUploadShipmentDoc(selected.id, fd);
      toast.success('Document uploaded');
      setSelected(null);
      load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">🚢 Shipments Management</h1>
        <p className="lx-page-sub">Track shipment milestones and manage shipping documents.</p>
      </div>

      <div className="lx-filter-bar">
        <select className="lx-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {Object.keys(STATUS_COLOR).map(s => (
            <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
          ))}
        </select>
      </div>

      {loading && <div className="lx-loading">Loading…</div>}

      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>Reference</th><th>Route</th><th>Carrier</th><th>Tracking</th>
              <th>Weight/CBM</th><th>ETA</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shipments.map(s => (
              <tr key={s.id}>
                <td><code style={{ fontSize:'.78rem' }}>{s.reference}</code></td>
                <td style={{ fontSize:'.8rem', color:'#64748b' }}>
                  {s.origin_country} → {s.destination_country}
                </td>
                <td style={{ fontSize:'.82rem' }}>{s.carrier_name || '—'}</td>
                <td style={{ fontSize:'.78rem', color:'#64748b' }}>{s.tracking_number || '—'}</td>
                <td style={{ fontSize:'.8rem' }}>
                  {s.weight_kg ? `${s.weight_kg}kg` : '—'}
                  {s.cbm ? ` / ${s.cbm}m³` : ''}
                </td>
                <td style={{ fontSize:'.8rem' }}>
                  {s.eta ? new Date(s.eta).toLocaleDateString() : '—'}
                </td>
                <td>
                  <span className="lx-status-pill" style={{ background: STATUS_COLOR[s.status]||'#64748b' }}>
                    {s.status?.replace(/_/g,' ')}
                  </span>
                </td>
                <td>
                  <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                    onClick={() => { setSelected(s); setView('milestone'); setMilestone({ status:'', location:'', notes:'' }); setDoc({ doc_type:'', file:null, notes:'' }); }}>
                    Update
                  </button>
                </td>
              </tr>
            ))}
            {shipments.length === 0 && !loading && (
              <tr><td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>No shipments found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div style={{ background:'var(--card-bg,#fff)', borderRadius:'1rem', padding:'1.5rem', width:480, maxWidth:'90vw' }}>
            <h3 style={{ fontWeight:700, marginBottom:'.5rem' }}>{selected.reference}</h3>
            <div style={{ fontSize:'.82rem', color:'#64748b', marginBottom:'1rem' }}>
              {selected.origin_country} → {selected.destination_country} &nbsp;|&nbsp; Status: <strong>{selected.status?.replace(/_/g,' ')}</strong>
            </div>

            {/* Tab bar */}
            <div style={{ display:'flex', gap:'.25rem', borderBottom:'2px solid #e2e8f0', marginBottom:'1rem' }}>
              {['milestone','doc'].map(v => (
                <button key={v} onClick={() => setView(v)} style={{
                  padding:'.4rem 1rem', border:'none', background:'none',
                  fontWeight: view===v ? 700 : 500, color: view===v ? '#f97316' : '#64748b',
                  borderBottom: view===v ? '2px solid #f97316' : '2px solid transparent',
                  marginBottom:'-2px', cursor:'pointer',
                }}>{v === 'milestone' ? 'Add Milestone' : 'Upload Document'}</button>
              ))}
            </div>

            {view === 'milestone' && (
              <>
                <div className="lx-form-group">
                  <label className="lx-label">Milestone Status</label>
                  <select className="lx-select" value={milestone.status}
                    onChange={e => setMilestone(m=>({...m,status:e.target.value}))}>
                    <option value="">— Select —</option>
                    {MILESTONE_OPTS.map(m => (
                      <option key={m} value={m}>{m.replace(/_/g,' ')}</option>
                    ))}
                  </select>
                </div>
                <div className="lx-form-group">
                  <label className="lx-label">Location</label>
                  <input className="lx-input" value={milestone.location}
                    placeholder="e.g. Shanghai Port"
                    onChange={e => setMilestone(m=>({...m,location:e.target.value}))} />
                </div>
                <div className="lx-form-group">
                  <label className="lx-label">Notes</label>
                  <textarea className="lx-textarea" rows={2} value={milestone.notes}
                    onChange={e => setMilestone(m=>({...m,notes:e.target.value}))} />
                </div>
                <div style={{ display:'flex', gap:'.75rem' }}>
                  <button className="lx-btn-primary" onClick={addMilestone} disabled={saving}>
                    {saving ? 'Saving…' : 'Add Milestone'}
                  </button>
                  <button className="lx-btn-secondary" onClick={() => setSelected(null)}>Cancel</button>
                </div>
              </>
            )}

            {view === 'doc' && (
              <>
                <div className="lx-form-group">
                  <label className="lx-label">Document Type</label>
                  <select className="lx-select" value={doc.doc_type}
                    onChange={e => setDoc(d=>({...d,doc_type:e.target.value}))}>
                    <option value="">— Select —</option>
                    {DOC_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
                  </select>
                </div>
                <div className="lx-form-group">
                  <label className="lx-label">File</label>
                  <input type="file" style={{ padding:'.5rem 0' }}
                    onChange={e => setDoc(d=>({...d,file:e.target.files[0]}))} />
                </div>
                <div className="lx-form-group">
                  <label className="lx-label">Notes</label>
                  <textarea className="lx-textarea" rows={2} value={doc.notes}
                    onChange={e => setDoc(d=>({...d,notes:e.target.value}))} />
                </div>
                <div style={{ display:'flex', gap:'.75rem' }}>
                  <button className="lx-btn-primary" onClick={uploadDoc} disabled={saving}>
                    {saving ? 'Uploading…' : 'Upload'}
                  </button>
                  <button className="lx-btn-secondary" onClick={() => setSelected(null)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
