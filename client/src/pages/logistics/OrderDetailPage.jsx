import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getOrder } from '../../api/logistics';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

/**
 * OrderDetailPage - purchase order detail (Phase 2 refactor).
 *
 * Now renders inside PageShell + the shared LogisticsLayout (previously it
 * skipped the site chrome entirely). Financial stack and overview use
 * token-based key/value rows; the status pill uses theme tokens.
 */
export default function OrderDetailPage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getOrder(id)
      .then((r) => setOrder(r.data))
      .catch((err) => setError(err.response?.data?.error || tx('logistics.orderDetail.loadError', 'Failed to load order.')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  const renderBody = () => {
    if (loading) {
      return (
        <div className="lx-loading" role="status" aria-live="polite">
          <span className="lx-spinner" aria-hidden="true" />
          {tx('logistics.orderDetail.loading', 'Loading…')}
        </div>
      );
    }
    if (error) {
      return (
        <div className="lx-empty" role="alert">
          <p>{error}</p>
          <button type="button" onClick={load} className="lx-action-secondary">
            {tx('logistics.workspace.dataError.retry', 'Try again')}
          </button>
        </div>
      );
    }
    if (!order) {
      return (
        <div className="lx-empty" role="alert">
          <p>{tx('logistics.orderDetail.notFound', 'Purchase order not found.')}</p>
          <Link to="/logistics/orders" className="lx-link">{tx('logistics.orderDetail.backToOrders', '← Back to Orders')}</Link>
        </div>
      );
    }

    const remaining = Math.max(0, parseFloat(order.final_due_usd || 0) - parseFloat(order.final_paid_usd || 0));
    const financeRows = [
      [tx('logistics.orderDetail.finance.productTotal', 'Product total'), order.total_product_usd],
      [tx('logistics.orderDetail.finance.originHandling', 'Origin handling'), order.origin_handling_usd],
      [tx('logistics.orderDetail.finance.sourcingFee', 'Sourcing fee'), order.sourcing_fee_usd],
      [tx('logistics.orderDetail.finance.oxsteedMarkup', 'OxSteed markup'), order.oxsteed_markup_usd],
      [tx('logistics.orderDetail.finance.freightEstimate', 'Freight estimate'), order.freight_est_usd],
      [tx('logistics.orderDetail.finance.customsAdmin', 'Customs/admin'), order.customs_admin_usd],
      [tx('logistics.orderDetail.finance.warehouseFee', 'Warehouse fee'), order.warehouse_fee_usd],
      [tx('logistics.orderDetail.finance.lastMile', 'Last mile'), order.last_mile_usd],
      [tx('logistics.orderDetail.finance.riskSurcharge', 'Risk surcharge'), order.risk_surcharge_usd],
    ];

    return (
      <>
        <div className="lx-card lx-mb-6">
          <div className="lx-detail-head">
            <div>
              <p className="lx-detail-kicker">{order.reference}</p>
              <h2 className="lx-detail-title" style={{ fontSize: 'var(--text-2xl)' }}>
                {order.product_title || tx('logistics.orderDetail.defaults.purchaseOrder', 'Purchase Order')}
              </h2>
              <p className="lx-detail-sub">{order.lane_name} · {order.origin_country} → {order.destination_country}</p>
            </div>
            <LogisticsStatusPill status={order.status} />
          </div>
        </div>

        <div className="lx-two-col">
          <div className="lx-card">
            <h3 className="lx-card-title lx-mb-4">{tx('logistics.orderDetail.sections.overview', 'Order overview')}</h3>
            <div className="lx-kv-list">
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.orderDetail.labels.supplier', 'Supplier')}</span><span className="lx-kv-value">{order.supplier_name || '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.orderDetail.labels.buyer', 'Buyer')}</span><span className="lx-kv-value">{order.business_name || order.buyer_name || '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.orderDetail.labels.quantity', 'Quantity')}</span><span className="lx-kv-value">{order.qty_ordered}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.orderDetail.labels.freightOption', 'Freight option')}</span><span className="lx-kv-value">{order.freight_option?.replace(/_/g, ' ') || '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.orderDetail.labels.incoterms', 'Incoterms')}</span><span className="lx-kv-value">{order.incoterms || '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.orderDetail.labels.expectedProductionComplete', 'Expected production complete')}</span><span className="lx-kv-value">{order.expected_production_complete ? new Date(order.expected_production_complete).toLocaleDateString() : '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.orderDetail.labels.expectedShipDate', 'Expected ship date')}</span><span className="lx-kv-value">{order.expected_ship_date ? new Date(order.expected_ship_date).toLocaleDateString() : '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.orderDetail.labels.expectedArrival', 'Expected arrival')}</span><span className="lx-kv-value">{order.expected_arrival_date ? new Date(order.expected_arrival_date).toLocaleDateString() : '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.orderDetail.labels.destination', 'Destination')}</span><span className="lx-kv-value">{order.destination_address || order.destination_country || '—'}</span></div>
            </div>
          </div>

          <div className="lx-card">
            <h3 className="lx-card-title lx-mb-4">{tx('logistics.orderDetail.sections.financial', 'Financial stack')}</h3>
            <div className="lx-kv-list">
              {financeRows.map(([label, value]) => (
                <div key={label} className="lx-kv-row">
                  <span className="lx-kv-label">{label}</span>
                  <span className="lx-kv-value">{value ? `$${parseFloat(value).toFixed(2)}` : '—'}</span>
                </div>
              ))}
            </div>
            <div className="lx-kv-divider">
              <div className="lx-kv-row">
                <span className="lx-kv-label lx-t-semibold lx-t-muted">{tx('logistics.orderDetail.totals.totalLanded', 'Total landed')}</span>
                <span className="lx-kv-value lx-kv-total">${parseFloat(order.total_landed_usd || 0).toFixed(2)}</span>
              </div>
              <div className="lx-kv-row">
                <span className="lx-kv-label">{tx('logistics.orderDetail.totals.depositDue', 'Deposit due')}</span>
                <span className="lx-kv-value">${parseFloat(order.deposit_due_usd || 0).toFixed(2)}</span>
              </div>
              <div className="lx-kv-row">
                <span className="lx-kv-label">{tx('logistics.orderDetail.totals.finalDue', 'Final due')}</span>
                <span className="lx-kv-value">${parseFloat(order.final_due_usd || 0).toFixed(2)}</span>
              </div>
              <div className="lx-kv-row">
                <span className="lx-kv-label">{tx('logistics.orderDetail.totals.remaining', 'Remaining')}</span>
                <span className="lx-kv-value">{remaining ? `$${remaining.toFixed(2)}` : '$0.00'}</span>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <PageShell>
      <LogisticsLayout showNav={false}>
        <div className="lx-workspaces">
          <div className="lx-back-row">
            <Link to="/logistics/orders" className="lx-link">
              {tx('logistics.orderDetail.backToOrders', '← Back to Orders')}
            </Link>
          </div>
          {renderBody()}
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
