import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listOrders, previewLandedCost, listLanes, listRefundCases, createRefundCase } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import toast from 'react-hot-toast';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

/**
 * LogisticsFinancePage - landed cost, deposits, refund cases (Phase 2).
 *
 * Shared LogisticsLayout for navigation; KPI strip, simulator, and refund
 * panels use token-based classes; status pills use theme tones. The refund
 * form labels are htmlFor-linked; submission surfaces success/error toasts.
 */
export default function LogisticsFinancePage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [orders, setOrders] = useState([]);
  const [lanes, setLanes]   = useState([]);
  const [refundCases, setRefundCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [refundForm, setRefundForm] = useState({ purchase_order_id: '', refund_reason: '', requested_amount_usd: '', notes: '' });

  // Price simulator state
  const [simData, setSimData] = useState({ unit_product_cost_usd: '', qty: '', lane_id: '', freight_est_usd: '' });
  const [simResult, setSimResult] = useState(null);
  const [simLoading, setSimLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    Promise.all([
      listOrders({ limit: 100 }),
      listLanes(),
      listRefundCases(),
    ]).then(([oRes, lRes, refundRes]) => {
      setOrders(oRes.orders || []);
      setLanes(lRes.data || []);
      setRefundCases(refundRes.data || []);
    }).catch(() => setError(true)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const totalSpent = orders.reduce((s, o) => s + parseFloat(o.total_landed_usd || 0), 0);
  const byStatus = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + parseFloat(o.total_landed_usd || 0);
    return acc;
  }, {});
  const depositPaid = orders.reduce((s, o) => s + parseFloat(o.deposit_paid_usd || 0), 0);

  const runSimulator = async () => {
    if (!simData.unit_product_cost_usd || !simData.qty || !simData.lane_id) return;
    setSimLoading(true);
    try {
      const r = await previewLandedCost({ ...simData });
      setSimResult(r.data);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
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
      toast.success(tx('logistics.finance.refund.submitted', 'Refund case submitted for review.'));
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    } finally {
      setRefundSubmitting(false);
    }
  };

  return (
    <PageShell>
      <LogisticsLayout
        title={tx('logistics.finance.title', 'Logistics Finance')}
        subtitle={tx('logistics.finance.subtitle', 'Landed cost breakdown, deposit tracking, and profitability overview.')}
      >
        <div className="lx-workspaces">
          {loading && (
            <div className="lx-loading" role="status" aria-live="polite">
              <span className="lx-spinner" aria-hidden="true" />
              {tx('logistics.modal.loading', 'Loading…')}
            </div>
          )}

          {!loading && error && (
            <div className="lx-data-error-banner" role="alert">
              <div>
                <h2>{tx('logistics.workspace.dataError.title', 'Data unavailable')}</h2>
                <p>{tx('logistics.finance.error', "We couldn't load finance data right now. Please try again.")}</p>
              </div>
              <button type="button" className="lx-btn-secondary" onClick={load} data-track="ui.9356869936.1">
                {tx('logistics.workspace.dataError.retry', 'Try again')}
              </button>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* KPI strip */}
              <div className="lx-kpi-grid">
                {[
                  { label: tx('logistics.finance.kpis.totalCommitted', 'Total Committed'), value: `$${totalSpent.toLocaleString()}`, icon: '💰' },
                  { label: tx('logistics.finance.kpis.depositsPaid', 'Deposits Paid'), value: `$${depositPaid.toLocaleString()}`, icon: '✅' },
                  { label: tx('logistics.finance.kpis.orders', 'Orders'), value: orders.length, icon: '📦' },
                  { label: tx('logistics.finance.kpis.inTransit', 'In Transit'), value: orders.filter((o) => o.status === 'in_transit').length, icon: '🚢' },
                ].map((k) => (
                  <div key={k.label} className="lx-kpi-card">
                    <div className="lx-kpi-icon" aria-hidden="true">{k.icon}</div>
                    <div className="lx-kpi-value">{k.value}</div>
                    <div className="lx-kpi-label">{k.label}</div>
                  </div>
                ))}
              </div>

              <div className="lx-two-col lx-mb-6">
                {/* Spending by status */}
                <div className="lx-card">
                  <h3 className="lx-card-title lx-mb-4">{tx('logistics.finance.byStatus', 'Value by Order Status')}</h3>
                  <div className="lx-kv-list">
                    {Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([status, val]) => (
                      <div key={status} className="lx-kv-row">
                        <LogisticsStatusPill status={status} />
                        <span className="lx-kv-value">${val.toLocaleString()}</span>
                      </div>
                    ))}
                    {Object.keys(byStatus).length === 0 && (
                      <p className="lx-overview-empty">{tx('logistics.finance.noSpend', 'No order spend recorded yet.')}</p>
                    )}
                  </div>
                </div>

                {/* Landed Cost Simulator */}
                <div className="lx-card">
                  <h3 className="lx-card-title lx-mb-4">🧮 {tx('logistics.finance.simulator.title', 'Landed Cost Simulator')}</h3>
                  <div className="lx-form-group">
                    <label className="lx-label" htmlFor="lx-sim-cost">{tx('logistics.finance.simulator.productCost', 'Product Cost / Unit (USD)')}</label>
                    <input id="lx-sim-cost" type="number" className="lx-input" value={simData.unit_product_cost_usd}
                      onChange={(e) => setSimData((d) => ({ ...d, unit_product_cost_usd: e.target.value }))} />
                  </div>
                  <div className="lx-form-grid-2">
                    <div className="lx-form-group">
                      <label className="lx-label" htmlFor="lx-sim-qty">{tx('logistics.finance.simulator.quantity', 'Quantity')}</label>
                      <input id="lx-sim-qty" type="number" className="lx-input" value={simData.qty}
                        onChange={(e) => setSimData((d) => ({ ...d, qty: e.target.value }))} />
                    </div>
                    <div className="lx-form-group">
                      <label className="lx-label" htmlFor="lx-sim-freight">{tx('logistics.finance.simulator.freight', 'Freight Est / Unit (USD)')}</label>
                      <input id="lx-sim-freight" type="number" className="lx-input" value={simData.freight_est_usd}
                        onChange={(e) => setSimData((d) => ({ ...d, freight_est_usd: e.target.value }))} />
                    </div>
                  </div>
                  <div className="lx-form-group">
                    <label className="lx-label" htmlFor="lx-sim-lane">{tx('logistics.finance.simulator.lane', 'Lane')}</label>
                    <select id="lx-sim-lane" className="lx-select" value={simData.lane_id} onChange={(e) => setSimData((d) => ({ ...d, lane_id: e.target.value }))}>
                      <option value="">{tx('logistics.finance.simulator.selectLane', '— Select Lane —')}</option>
                      {lanes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                  <button type="button" className="lx-btn-primary lx-btn-block" onClick={runSimulator} disabled={simLoading} data-track="ui.9356869936.2">
                    {simLoading ? tx('logistics.finance.simulator.calculating', 'Calculating…') : tx('logistics.finance.simulator.calculate', 'Calculate Landed Cost')}
                  </button>

                  {simResult && (
                    <div className="lx-review-box lx-mt-6" role="status">
                      <div className="lx-t-bold lx-mb-4" style={{ fontSize: '1.15rem', color: 'var(--color-primary)', textAlign: 'center' }}>
                        ${simResult.unitCost?.landed?.toFixed(2)} {tx('logistics.finance.simulator.perUnit', '/ unit landed')}
                      </div>
                      {Object.entries(simResult.unitCost || {}).filter(([k]) => k !== 'landed').map(([k, v]) => (
                        <div key={k} className="lx-review-row">
                          <span className="lx-kv-label" style={{ textTransform: 'capitalize' }}>{k.replace(/([A-Z])/g, ' $1').trim()}</span>
                          <span className="lx-kv-value">${parseFloat(v).toFixed(4)}</span>
                        </div>
                      ))}
                      <div className="lx-kv-divider">
                        <div className="lx-kv-row">
                          <span className="lx-kv-label lx-t-bold">{tx('logistics.finance.simulator.totalFor', 'Total for {{qty}} units', { qty: simResult.qty })}</span>
                          <span className="lx-kv-value lx-kv-total">${simResult.totals?.landed?.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="lx-t-xs lx-t-faint lx-mt-6" style={{ textAlign: 'center' }}>
                        {tx('logistics.finance.simulator.markupApplied', 'Markup applied')}: {((simResult.markupPct || 0) * 100).toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Recent orders table */}
              {orders.length > 0 && (
                <div className="lx-card lx-mb-6">
                  <h3 className="lx-card-title lx-mb-4">{tx('logistics.finance.recentOrders', 'Recent Orders')}</h3>
                  <div className="lx-table-wrap">
                    <table className="lx-table lx-t-small">
                      <thead>
                        <tr>
                          <th>{tx('logistics.finance.headers.reference', 'Reference')}</th>
                          <th>{tx('logistics.finance.headers.product', 'Product')}</th>
                          <th>{tx('logistics.finance.headers.qty', 'Qty')}</th>
                          <th>{tx('logistics.finance.headers.totalLanded', 'Total Landed')}</th>
                          <th>{tx('logistics.finance.headers.depositPaid', 'Deposit Paid')}</th>
                          <th>{tx('logistics.finance.headers.remaining', 'Remaining')}</th>
                          <th>{tx('logistics.finance.headers.status', 'Status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.slice(0, 15).map((o) => {
                          const remaining = parseFloat(o.total_landed_usd || 0) - parseFloat(o.deposit_paid_usd || 0);
                          return (
                            <tr key={o.id}>
                              <td><span className="lx-code">{o.reference}</span></td>
                              <td>{o.product_title || '—'}</td>
                              <td>{o.qty_ordered}</td>
                              <td className="lx-t-bold">${parseFloat(o.total_landed_usd || 0).toLocaleString()}</td>
                              <td style={{ color: 'var(--color-success)' }}>${parseFloat(o.deposit_paid_usd || 0).toLocaleString()}</td>
                              <td style={{ color: remaining > 0 ? 'var(--color-primary)' : 'var(--color-success)' }}>${remaining.toLocaleString()}</td>
                              <td><LogisticsStatusPill status={o.status} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="lx-two-col">
                <div className="lx-card">
                  <h3 className="lx-card-title lx-mb-4">{tx('logistics.finance.refund.title', 'Refund Requests')}</h3>
                  <div className="lx-compact-stack">
                    {refundCases.slice(0, 10).map((refund) => (
                      <div key={refund.id} className="lx-item-card">
                        <div className="lx-item-card-head">
                          <div>
                            <div className="lx-t-bold lx-t-small">{refund.reference}</div>
                            <div className="lx-t-xs lx-t-faint">{refund.refund_reason}</div>
                          </div>
                          <LogisticsStatusPill status={refund.status} />
                        </div>
                        <div className="lx-t-small lx-mt-6">
                          {tx('logistics.finance.refund.requested', 'Requested')}: <strong>${parseFloat(refund.requested_amount_usd || 0).toFixed(2)}</strong>
                        </div>
                      </div>
                    ))}
                    {refundCases.length === 0 && (
                      <div className="lx-empty"><div className="lx-empty-icon" aria-hidden="true">↩️</div><p>{tx('logistics.finance.refund.empty', 'No refund cases submitted yet.')}</p></div>
                    )}
                  </div>
                </div>

                <div className="lx-card">
                  <h3 className="lx-card-title lx-mb-4">{tx('logistics.finance.refundForm.title', 'Request a Refund Review')}</h3>
                  <div className="lx-form-group">
                    <label className="lx-label" htmlFor="lx-refund-order">{tx('logistics.finance.refundForm.purchaseOrder', 'Purchase Order')}</label>
                    <select id="lx-refund-order" className="lx-select" value={refundForm.purchase_order_id} onChange={(e) => setRefundForm((f) => ({ ...f, purchase_order_id: e.target.value }))}>
                      <option value="">{tx('logistics.finance.refundForm.selectOrder', '— Select order —')}</option>
                      {orders.map((o) => <option key={o.id} value={o.id}>{o.reference} · {o.product_title || tx('logistics.finance.refundForm.poFallback', 'PO')}</option>)}
                    </select>
                  </div>
                  <div className="lx-form-group">
                    <label className="lx-label" htmlFor="lx-refund-reason">{tx('logistics.finance.refundForm.reason', 'Refund Reason')}</label>
                    <input id="lx-refund-reason" className="lx-input" value={refundForm.refund_reason} onChange={(e) => setRefundForm((f) => ({ ...f, refund_reason: e.target.value }))} />
                  </div>
                  <div className="lx-form-group">
                    <label className="lx-label" htmlFor="lx-refund-amount">{tx('logistics.finance.refundForm.amount', 'Requested Amount (USD)')}</label>
                    <input id="lx-refund-amount" type="number" className="lx-input" value={refundForm.requested_amount_usd} onChange={(e) => setRefundForm((f) => ({ ...f, requested_amount_usd: e.target.value }))} />
                  </div>
                  <div className="lx-form-group">
                    <label className="lx-label" htmlFor="lx-refund-notes">{tx('logistics.finance.refundForm.notes', 'Notes')}</label>
                    <textarea id="lx-refund-notes" className="lx-textarea" value={refundForm.notes} onChange={(e) => setRefundForm((f) => ({ ...f, notes: e.target.value }))} />
                  </div>
                  <button type="button" className="lx-btn-primary" onClick={submitRefund} disabled={refundSubmitting} data-track="ui.9356869936.3">
                    {refundSubmitting ? tx('logistics.finance.refundForm.submitting', 'Submitting…') : tx('logistics.finance.refundForm.submit', 'Submit Refund Case')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
