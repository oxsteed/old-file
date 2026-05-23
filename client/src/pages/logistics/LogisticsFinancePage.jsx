import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listOrders, previewLandedCost, listLanes, listRefundCases, createRefundCase } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import '../../styles/logistics/LogisticsHomePage.css';

export default function LogisticsFinancePage() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState([]);
  const [lanes, setLanes]   = useState([]);
  const [refundCases, setRefundCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [refundForm, setRefundForm] = useState({ purchase_order_id: '', refund_reason: '', requested_amount_usd: '', notes: '' });

  // Price simulator state
  const [simData, setSimData] = useState({ unit_product_cost_usd: '', qty: '', lane_id: '', freight_est_usd: '' });
  const [simResult, setSimResult] = useState(null);
  const [simLoading, setSimLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      listOrders({ limit: 100 }),
      listLanes(),
      listRefundCases(),
    ]).then(([oRes, lRes, refundRes]) => {
      setOrders(oRes.orders || []);
      setLanes(lRes.data || []);
      setRefundCases(refundRes.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const totalSpent = orders.reduce((s, o) => s + parseFloat(o.total_landed_usd||0), 0);
  const byStatus = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status]||0) + parseFloat(o.total_landed_usd||0);
    return acc;
  }, {});
  const depositPaid = orders.reduce((s, o) => s + parseFloat(o.deposit_paid_usd||0), 0);

  const runSimulator = async () => {
    if (!simData.unit_product_cost_usd || !simData.qty || !simData.lane_id) return;
    setSimLoading(true);
    try {
      const r = await previewLandedCost({ ...simData });
      setSimResult(r.data);
    } catch (err) {
      console.error(err);
    } finally {
      setSimLoading(false);
    }
  };

  const submitRefund = async () => {
    if (!refundForm.purchase_order_id || !refundForm.refund_reason || !refundForm.requested_amount_usd) return;
    setRefundSubmitting(true);
    try {
      await createRefundCase(refundForm);
      const refreshed = await listRefundCases();
      setRefundCases(refreshed.data || []);
      setRefundForm({ purchase_order_id: '', refund_reason: '', requested_amount_usd: '', notes: '' });
    } catch (err) {
      console.error(err);
    } finally {
      setRefundSubmitting(false);
    }
  };

  return (
    <PageShell>
      <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">{t('logistics.finance.title','Logistics Finance')}</h1>
        <p className="lx-page-sub">{t('logistics.finance.subtitle','Landed cost breakdown, deposit tracking, and profitability overview.')}</p>
      </div>

      {/* KPI strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:'1rem', marginBottom:'2rem' }}>
        {[
          { label: t('logistics.finance.totalSpent','Total Committed'), value: `$${totalSpent.toLocaleString()}`, icon:'💰' },
          { label: t('logistics.finance.depositPaid','Deposits Paid'), value: `$${depositPaid.toLocaleString()}`, icon:'✅' },
          { label: t('logistics.finance.orderCount','Orders'), value: orders.length, icon:'📦' },
          { label: t('logistics.finance.inTransit','In Transit'), value: orders.filter(o=>o.status==='in_transit').length, icon:'🚢' },
        ].map(k => (
          <div key={k.label} className="lx-card" style={{ textAlign:'center' }}>
            <div style={{ fontSize:'1.75rem' }}>{k.icon}</div>
            <div style={{ fontSize:'1.35rem', fontWeight:800, color:'#f97316', margin:'.25rem 0' }}>{k.value}</div>
            <div style={{ fontSize:'.78rem', color:'#64748b', fontWeight:600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem', marginBottom:'2rem' }}>
        {/* Spending by status */}
        <div className="lx-card">
          <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>{t('logistics.finance.byStatus','Value by Order Status')}</h3>
          {Object.entries(byStatus).sort((a,b) => b[1]-a[1]).map(([status, val]) => (
            <div key={status} style={{ display:'flex', justifyContent:'space-between', padding:'.4rem 0', borderBottom:'1px solid #f1f5f9', fontSize:'.85rem' }}>
              <span style={{ textTransform:'capitalize' }}>{status.replace(/_/g,' ')}</span>
              <span style={{ fontWeight:700 }}>${val.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* Landed Cost Simulator */}
        <div className="lx-card">
          <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>🧮 {t('logistics.finance.simulator','Landed Cost Simulator')}</h3>
          <div className="lx-form-group">
            <label className="lx-label">Product Cost / Unit (USD)</label>
            <input type="number" className="lx-input" value={simData.unit_product_cost_usd}
              onChange={e => setSimData(d=>({...d,unit_product_cost_usd:e.target.value}))} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
            <div className="lx-form-group">
              <label className="lx-label">Quantity</label>
              <input type="number" className="lx-input" value={simData.qty}
                onChange={e => setSimData(d=>({...d,qty:e.target.value}))} />
            </div>
            <div className="lx-form-group">
              <label className="lx-label">Freight Est / Unit (USD)</label>
              <input type="number" className="lx-input" value={simData.freight_est_usd}
                onChange={e => setSimData(d=>({...d,freight_est_usd:e.target.value}))} />
            </div>
          </div>
          <div className="lx-form-group">
            <label className="lx-label">Lane</label>
            <select className="lx-select" value={simData.lane_id} onChange={e => setSimData(d=>({...d,lane_id:e.target.value}))}>
              <option value="">— Select Lane —</option>
              {lanes.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <button className="lx-btn-primary" onClick={runSimulator} disabled={simLoading} style={{ width:'100%' }}>
            {simLoading ? 'Calculating…' : 'Calculate Landed Cost'}
          </button>

          {simResult && (
            <div style={{ marginTop:'1rem', background:'#f8fafc', borderRadius:'.625rem', padding:'1rem' }}>
              <div style={{ fontWeight:800, fontSize:'1.15rem', color:'#f97316', marginBottom:'.75rem', textAlign:'center' }}>
                ${simResult.unitCost?.landed?.toFixed(2)} / unit landed
              </div>
              {Object.entries(simResult.unitCost||{}).filter(([k])=>k!=='landed').map(([k,v]) => (
                <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:'.82rem', padding:'.2rem 0' }}>
                  <span style={{ color:'#64748b', textTransform:'capitalize' }}>{k.replace(/([A-Z])/g,' $1').trim()}</span>
                  <span style={{ fontWeight:600 }}>${parseFloat(v).toFixed(4)}</span>
                </div>
              ))}
              <div style={{ display:'flex', justifyContent:'space-between', fontWeight:800, marginTop:'.5rem', paddingTop:'.5rem', borderTop:'2px solid #e2e8f0' }}>
                <span>Total for {simResult.qty} units</span>
                <span style={{ color:'#f97316' }}>${simResult.totals?.landed?.toLocaleString()}</span>
              </div>
              <div style={{ fontSize:'.78rem', color:'#94a3b8', marginTop:'.5rem', textAlign:'center' }}>
                Markup applied: {((simResult.markupPct||0)*100).toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent orders table */}
      {orders.length > 0 && (
        <div className="lx-card">
          <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>{t('logistics.finance.recentOrders','Recent Orders')}</h3>
          <div className="lx-table-wrap">
            <table className="lx-table" style={{ fontSize:'.82rem' }}>
              <thead>
                <tr>
                  <th>Reference</th><th>Product</th><th>Qty</th>
                  <th>Total Landed</th><th>Deposit Paid</th><th>Remaining</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0,15).map(o => {
                  const remaining = parseFloat(o.total_landed_usd||0) - parseFloat(o.deposit_paid_usd||0);
                  return (
                    <tr key={o.id}>
                      <td><code>{o.reference}</code></td>
                      <td>{o.product_title||'—'}</td>
                      <td>{o.qty_ordered}</td>
                      <td style={{ fontWeight:700 }}>${parseFloat(o.total_landed_usd||0).toLocaleString()}</td>
                      <td style={{ color:'#22c55e' }}>${parseFloat(o.deposit_paid_usd||0).toLocaleString()}</td>
                      <td style={{ color: remaining > 0 ? '#f97316' : '#22c55e' }}>${remaining.toLocaleString()}</td>
                      <td>
                        <span className="lx-status-pill" style={{ background:'#64748b', fontSize:'.65rem' }}>
                          {o.status?.replace(/_/g,' ')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem', marginTop:'1.5rem' }}>
        <div className="lx-card">
          <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>Refund Requests</h3>
          <div style={{ display:'grid', gap:'.75rem' }}>
            {refundCases.slice(0, 10).map((refund) => (
              <div key={refund.id} style={{ border:'1px solid #e2e8f0', borderRadius:'.85rem', padding:'.9rem' }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:'.75rem' }}>
                  <div>
                    <div style={{ fontWeight:700 }}>{refund.reference}</div>
                    <div style={{ fontSize:'.8rem', color:'#64748b' }}>{refund.refund_reason}</div>
                  </div>
                  <span className="lx-status-pill" style={{ background: refund.status === 'approved' ? '#22c55e' : refund.status === 'rejected' ? '#ef4444' : '#64748b' }}>
                    {refund.status}
                  </span>
                </div>
                <div style={{ fontSize:'.82rem', marginTop:'.45rem' }}>
                  Requested: <strong>${parseFloat(refund.requested_amount_usd || 0).toFixed(2)}</strong>
                </div>
              </div>
            ))}
            {!refundCases.length && !loading && (
              <div className="lx-empty"><div className="lx-empty-icon">↩️</div><p>No refund cases submitted yet.</p></div>
            )}
          </div>
        </div>

        <div className="lx-card">
          <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>Request a Refund Review</h3>
          <div className="lx-form-group">
            <label className="lx-label">Purchase Order</label>
            <select className="lx-select" value={refundForm.purchase_order_id} onChange={e => setRefundForm((f) => ({ ...f, purchase_order_id: e.target.value }))}>
              <option value="">— Select order —</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.reference} · {o.product_title || 'PO'}</option>)}
            </select>
          </div>
          <div className="lx-form-group">
            <label className="lx-label">Refund Reason</label>
            <input className="lx-input" value={refundForm.refund_reason} onChange={e => setRefundForm((f) => ({ ...f, refund_reason: e.target.value }))} />
          </div>
          <div className="lx-form-group">
            <label className="lx-label">Requested Amount (USD)</label>
            <input type="number" className="lx-input" value={refundForm.requested_amount_usd} onChange={e => setRefundForm((f) => ({ ...f, requested_amount_usd: e.target.value }))} />
          </div>
          <div className="lx-form-group">
            <label className="lx-label">Notes</label>
            <textarea className="lx-textarea" value={refundForm.notes} onChange={e => setRefundForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <button className="lx-btn-primary" onClick={submitRefund} disabled={refundSubmitting}>
            {refundSubmitting ? 'Submitting…' : 'Submit Refund Case'}
          </button>
        </div>
      </div>
      </div>
    </PageShell>
  );
}
