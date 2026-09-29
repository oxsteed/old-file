import React, { useEffect, useState } from 'react';
import {
  adminListAllocations, adminCreateAllocation, adminReleaseAllocation,
  adminListDeliveryOrders, adminCreateDeliveryOrder, adminListWarehouses,
} from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';
import ConfirmDialog from '../../lib/ConfirmDialog';

const ALLOC_STATUS_COLOR = { pending:'#f59e0b', reserved:'#3b82f6', fulfilled:'#22c55e', released:'#94a3b8', expired:'#ef4444' };
const DO_STATUS_COLOR    = { pending:'#f59e0b', dispatched:'#3b82f6', delivered:'#22c55e', failed:'#ef4444', cancelled:'#94a3b8' };
const DELIVERY_MODES     = ['courier','freight','self_pickup','local_delivery'];

export default function AllocationsAdmin() {
  const [tab, setTab]             = useState('allocations');
  const [allocations, setAllocations] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showDoForm, setShowDoForm] = useState(false);
  const [doForm, setDoForm]       = useState({ allocation_id:'', delivery_mode:'courier', recipient_name:'', recipient_address:'', notes:'' });
  const [saving, setSaving]       = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      adminListAllocations({}),
      adminListDeliveryOrders({}),
      adminListWarehouses(),
    ]).then(([aRes, dRes, wRes]) => {
      setAllocations(aRes.data||[]);
      setDeliveries(dRes.data||[]);
      setWarehouses(wRes.data||[]);
    }).catch((err) => setLoadError(err)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const warehouseMap = Object.fromEntries(warehouses.map(w => [w.id, w.name]));

  const [releaseTarget, setReleaseTarget] = useState(null);

  const doRelease = async () => {
    try {
      await adminReleaseAllocation(releaseTarget);
      toast.success('Allocation released');
      setReleaseTarget(null);
      load();
    } catch (err) { throw new Error(err.message || 'Release failed'); }
  };

  const createDO = async () => {
    if (!doForm.allocation_id || !doForm.recipient_name) {
      toast.error('Allocation and recipient name required');
      return;
    }
    setSaving(true);
    try {
      await adminCreateDeliveryOrder(doForm);
      toast.success('Delivery order created');
      setShowDoForm(false);
      load();
    } catch (err) { toast.error(err.response?.data?.message || err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'1rem' }}>
          <div>
            <h1 className="lx-page-title">📊 Allocations & Delivery</h1>
            <p className="lx-page-sub">Manage inventory allocations and create delivery orders.</p>
          </div>
          {tab === 'deliveries' && (
            <button className="lx-btn-primary" onClick={() => setShowDoForm(s=>!s)}>+ New Delivery Order</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:'.25rem', borderBottom:'2px solid #e2e8f0', marginBottom:'1.5rem' }}>
        {[['allocations','Allocations'],['deliveries','Delivery Orders']].map(([t,label]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding:'.6rem 1.25rem', border:'none', background:'none',
            fontWeight: tab===t ? 700 : 500, color: tab===t ? '#f97316' : '#64748b',
            borderBottom: tab===t ? '2px solid #f97316' : '2px solid transparent',
            marginBottom:'-2px', cursor:'pointer',
          }}>{label}</button>
        ))}
      </div>

      {loading && <div className="lx-loading">Loading…</div>}
      {!loading && loadError && <AdminErrorState onRetry={load} />}

      {/* New delivery order form */}
      {showDoForm && tab === 'deliveries' && (
        <div className="lx-card" style={{ marginBottom:'1.5rem', border:'2px solid #f97316' }}>
          <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>Create Delivery Order</h3>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
            <div className="lx-form-group">
              <label className="lx-label">Allocation *</label>
              <select className="lx-select" value={doForm.allocation_id}
                onChange={e => setDoForm(f=>({...f,allocation_id:e.target.value}))}>
                <option value="">— Select allocation —</option>
                {allocations.filter(a => a.status === 'reserved').map(a => (
                  <option key={a.id} value={a.id}>
                    #{a.id}: {a.qty} units @ {warehouseMap[a.warehouse_id]||a.warehouse_id}
                  </option>
                ))}
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">Delivery Mode</label>
              <select className="lx-select" value={doForm.delivery_mode}
                onChange={e => setDoForm(f=>({...f,delivery_mode:e.target.value}))}>
                {DELIVERY_MODES.map(m => <option key={m} value={m}>{m.replace(/_/g,' ')}</option>)}
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">Recipient Name *</label>
              <input className="lx-input" value={doForm.recipient_name}
                onChange={e => setDoForm(f=>({...f,recipient_name:e.target.value}))} />
            </div>
            <div className="lx-form-group">
              <label className="lx-label">Recipient Address</label>
              <input className="lx-input" value={doForm.recipient_address}
                onChange={e => setDoForm(f=>({...f,recipient_address:e.target.value}))} />
            </div>
          </div>
          <div className="lx-form-group">
            <label className="lx-label">Notes</label>
            <textarea className="lx-textarea" value={doForm.notes}
              onChange={e => setDoForm(f=>({...f,notes:e.target.value}))} />
          </div>
          <div style={{ display:'flex', gap:'.75rem' }}>
            <button className="lx-btn-primary" onClick={createDO} disabled={saving}>
              {saving ? 'Creating…' : 'Create Delivery Order'}
            </button>
            <button className="lx-btn-secondary" onClick={() => setShowDoForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {tab === 'allocations' && (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr>
                <th>ID</th><th>Warehouse</th><th>Buyer</th><th>Qty</th>
                <th>Reserved Until</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map(a => (
                <tr key={a.id}>
                  <td style={{ color:'#64748b', fontSize:'.8rem' }}>#{a.id}</td>
                  <td style={{ fontSize:'.82rem' }}>{warehouseMap[a.warehouse_id] || a.warehouse_id}</td>
                  <td style={{ fontSize:'.82rem' }}>{a.buyer_name || a.buyer_user_id}</td>
                  <td style={{ fontWeight:700 }}>{a.qty?.toLocaleString()}</td>
                  <td style={{ fontSize:'.8rem' }}>
                    {a.reserved_until ? new Date(a.reserved_until).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    <span className="lx-status-pill" style={{ background: ALLOC_STATUS_COLOR[a.status]||'#64748b' }}>
                      {a.status}
                    </span>
                  </td>
                  <td>
                    {a.status === 'reserved' && (
                      <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .5rem' }}
                        onClick={() => setReleaseTarget(a.id)}>
                        Release
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {allocations.length === 0 && !loading && !loadError && (
                <tr><td colSpan={7} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>No allocations found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'deliveries' && (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr>
                <th>Reference</th><th>Recipient</th><th>Mode</th>
                <th>Tracking</th><th>Dispatched</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map(d => (
                <tr key={d.id}>
                  <td><code style={{ fontSize:'.78rem' }}>{d.reference}</code></td>
                  <td style={{ fontSize:'.82rem' }}>
                    <div style={{ fontWeight:600 }}>{d.recipient_name}</div>
                    <div style={{ color:'#94a3b8', fontSize:'.72rem' }}>{d.recipient_address}</div>
                  </td>
                  <td>
                    <span style={{ background:'#f1f5f9', borderRadius:'.375rem', padding:'.15rem .4rem', fontSize:'.72rem', fontWeight:700 }}>
                      {d.delivery_mode?.replace(/_/g,' ')}
                    </span>
                  </td>
                  <td style={{ fontSize:'.78rem', color:'#64748b' }}>{d.tracking_number || '—'}</td>
                  <td style={{ fontSize:'.8rem' }}>
                    {d.dispatched_at ? new Date(d.dispatched_at).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    <span className="lx-status-pill" style={{ background: DO_STATUS_COLOR[d.status]||'#64748b' }}>
                      {d.status}
                    </span>
                  </td>
                </tr>
              ))}
              {deliveries.length === 0 && !loading && !loadError && (
                <tr><td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>No delivery orders found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={releaseTarget != null}
        title="Release allocation"
        message="Release this reserved allocation back to available inventory?"
        confirmLabel="Release"
        onConfirm={doRelease}
        onClose={() => setReleaseTarget(null)}
      />
    </div>
  );
}
