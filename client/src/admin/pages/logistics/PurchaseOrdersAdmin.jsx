import React, { useState } from 'react';
import { adminTransitionPOStatus } from '../../../api/logistics';
import axios from '../../../api/axios';
import toast from 'react-hot-toast';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import '../../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLOR = {
  draft:'#94a3b8', quoted:'#f59e0b', approved:'#22c55e', awaiting_deposit:'#fb923c',
  deposit_collected:'#06b6d4', placed_with_supplier:'#3b82f6', in_production:'#8b5cf6',
  production_complete:'#a855f7', ready_for_pickup:'#f97316', in_transit:'#0ea5e9',
  customs_review:'#dc2626', cleared:'#16a34a', warehoused:'#0891b2',
  allocated:'#14b8a6', fulfilled:'#10b981', closed:'#475569', cancelled:'#ef4444',
};

const VALID_TRANSITIONS = {
  draft: ['quoted','cancelled'],
  quoted: ['approved','draft','cancelled'],
  approved: ['awaiting_deposit','cancelled'],
  awaiting_deposit: ['deposit_collected','cancelled'],
  deposit_collected: ['placed_with_supplier','cancelled'],
  placed_with_supplier: ['in_production','cancelled'],
  in_production: ['production_complete','cancelled'],
  production_complete: ['ready_for_pickup'],
  ready_for_pickup: ['in_transit'],
  in_transit: ['customs_review','cleared'],
  customs_review: ['cleared'],
  cleared: ['warehoused'],
  warehoused: ['allocated'],
  allocated: ['fulfilled'],
  fulfilled: ['closed'],
};

export default function PurchaseOrdersAdmin() {
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [toStatus, setToStatus] = useState('');
  const [notes, setNotes]       = useState('');
  const [saving, setSaving]     = useState(false);

  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    // Direct request (not the api wrapper) so the abort signal reaches the network call.
    const { data: payload } = await axios.get('/logistics/orders', {
      params: { status: statusFilter || undefined, limit: 200 },
      signal,
    });
    return payload.data || [];
  }, [statusFilter]);
  const orders = data || [];

  const doTransition = async () => {
    if (!toStatus) { toast.error('Select a target status'); return; }
    setSaving(true);
    try {
      await adminTransitionPOStatus(selected.id, { to_status: toStatus, notes });
      toast.success(`PO moved to ${toStatus}`);
      setSelected(null);
      reload();
    } catch (err) { toast.error(err.response?.data?.message || err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">📦 Purchase Orders</h1>
        <p className="lx-page-sub">Full lifecycle management of all purchase orders across lanes and suppliers.</p>
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
      {!loading && error && <AdminErrorState onRetry={reload} />}

      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>Reference</th><th>Buyer</th><th>Supplier</th><th>Lane</th>
              <th>Product</th><th>Qty</th><th>Landed Total</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <td><code style={{ fontSize:'.78rem' }}>{o.reference}</code></td>
                <td style={{ fontSize:'.82rem' }}>{o.buyer_name || o.buyer_user_id}</td>
                <td style={{ fontSize:'.82rem' }}>{o.supplier_name || '—'}</td>
                <td style={{ fontSize:'.78rem', color:'#64748b' }}>{o.lane_code || o.lane_id}</td>
                <td style={{ fontSize:'.82rem' }}>{o.product_name || '—'}</td>
                <td>{o.quantity?.toLocaleString()}</td>
                <td style={{ fontWeight:700, color:'#f97316' }}>
                  {o.total_landed_cost_usd ? `$${parseFloat(o.total_landed_cost_usd).toLocaleString()}` : '—'}
                </td>
                <td>
                  <span className="lx-status-pill" style={{ background: STATUS_COLOR[o.status]||'#64748b' }}>
                    {o.status?.replace(/_/g,' ')}
                  </span>
                </td>
                <td>
                  <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                    onClick={() => { setSelected(o); setToStatus(''); setNotes(''); }}>
                    Manage
                  </button>
                </td>
              </tr>
            ))}
            {orders.length === 0 && !loading && !error && (
              <tr><td colSpan={9} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>No purchase orders found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div style={{ background:'var(--card-bg,#fff)', borderRadius:'1rem', padding:'1.5rem', width:520, maxWidth:'90vw' }}>
            <h3 style={{ fontWeight:700, marginBottom:'.25rem' }}>{selected.reference}</h3>
            <div style={{ fontSize:'.82rem', color:'#64748b', marginBottom:'1rem' }}>
              <strong>Buyer:</strong> {selected.buyer_name} &nbsp;|&nbsp;
              <strong>Supplier:</strong> {selected.supplier_name || '—'} &nbsp;|&nbsp;
              <strong>Qty:</strong> {selected.quantity?.toLocaleString()}
            </div>

            {/* Cost breakdown */}
            <div style={{ background:'#f8fafc', borderRadius:'.5rem', padding:'.75rem', marginBottom:'1rem', fontSize:'.8rem' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'.25rem' }}>
                {[
                  ['Product Cost', selected.product_cost_usd],
                  ['Sourcing Fee', selected.sourcing_fee_usd],
                  ['OxSteed Markup', selected.oxsteed_markup_usd],
                  ['Freight Est.', selected.freight_est_usd],
                  ['Customs/Admin', selected.customs_admin_fee_usd],
                  ['Warehouse Fee', selected.warehouse_fee_usd],
                  ['Last Mile', selected.last_mile_fee_usd],
                  ['Risk Surcharge', selected.risk_surcharge_usd],
                ].map(([label, val]) => val ? (
                  <div key={label} style={{ display:'flex', justifyContent:'space-between', padding:'.15rem 0' }}>
                    <span style={{ color:'#64748b' }}>{label}</span>
                    <span style={{ fontWeight:600 }}>${parseFloat(val).toFixed(2)}</span>
                  </div>
                ) : null)}
              </div>
              <div style={{ borderTop:'1px solid #e2e8f0', marginTop:'.5rem', paddingTop:'.5rem', display:'flex', justifyContent:'space-between', fontWeight:700 }}>
                <span>Total Landed</span>
                <span style={{ color:'#f97316' }}>${parseFloat(selected.total_landed_cost_usd||0).toLocaleString()}</span>
              </div>
            </div>

            <div className="lx-form-group">
              <label className="lx-label">Current Status: <strong>{selected.status?.replace(/_/g,' ')}</strong></label>
            </div>

            {VALID_TRANSITIONS[selected.status]?.length > 0 ? (
              <>
                <div className="lx-form-group">
                  <label className="lx-label">Transition To</label>
                  <select className="lx-select" value={toStatus} onChange={e => setToStatus(e.target.value)}>
                    <option value="">— Select —</option>
                    {VALID_TRANSITIONS[selected.status].map(s => (
                      <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
                    ))}
                  </select>
                </div>
                <div className="lx-form-group">
                  <label className="lx-label">Notes (optional)</label>
                  <textarea className="lx-textarea" rows={2} value={notes}
                    onChange={e => setNotes(e.target.value)} />
                </div>
                <div style={{ display:'flex', gap:'.75rem' }}>
                  <button className="lx-btn-primary" onClick={doTransition} disabled={saving}>
                    {saving ? 'Saving…' : 'Apply Transition'}
                  </button>
                  <button className="lx-btn-secondary" onClick={() => setSelected(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <div style={{ display:'flex', gap:'.75rem' }}>
                <div style={{ color:'#94a3b8', fontSize:'.85rem', flex:1 }}>
                  No transitions available for <strong>{selected.status}</strong>.
                </div>
                <button className="lx-btn-secondary" onClick={() => setSelected(null)}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
