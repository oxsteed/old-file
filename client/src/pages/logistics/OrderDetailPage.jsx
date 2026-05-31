import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getOrder } from '../../api/logistics';
import { useTranslation } from 'react-i18next';
import '../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLOR = {
  draft:'#94a3b8', quoted:'#f59e0b', approved:'#22c55e', awaiting_deposit:'#fb923c',
  deposit_collected:'#8b5cf6', placed_with_supplier:'#3b82f6', in_production:'#06b6d4',
  production_complete:'#10b981', ready_for_pickup:'#22d3ee', in_transit:'#0284c7',
  customs_review:'#dc2626', cleared:'#16a34a', warehoused:'#7c3aed',
  allocated:'#0891b2', fulfilled:'#059669', closed:'#475569', cancelled:'#ef4444',
};

export default function OrderDetailPage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOrder(id)
      .then((r) => setOrder(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="lx-page"><div className="lx-loading">{tx('orderDetailPage.loading', 'Loading…')}</div></div>;
  if (!order) return <div className="lx-page"><div className="lx-error">{tx('orderDetailPage.notFound', 'Purchase order not found.')}</div></div>;

  const remaining = Math.max(0, parseFloat(order.final_due_usd || 0) - parseFloat(order.final_paid_usd || 0));

  return (
    <div className="lx-page">
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/logistics/orders" className="lx-link">
          {tx('orderDetailPage.backToOrders', '← Back to Orders')}
        </Link>
      </div>

      <div className="lx-card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '.78rem', color: '#64748b', fontWeight: 700 }}>{order.reference}</div>
            <h1 style={{ fontSize: '1.65rem', fontWeight: 800, margin: '.35rem 0' }}>{order.product_title || tx('orderDetailPage.defaults.purchaseOrder', 'Purchase Order')}</h1>
            <p style={{ color: '#64748b', margin: 0 }}>{order.lane_name} · {order.origin_country} → {order.destination_country}</p>
          </div>
          <span className="lx-status-pill" style={{ background: STATUS_COLOR[order.status] || '#64748b', alignSelf: 'flex-start' }}>
            {tx(`orderDetailPage.statuses.${order.status}`, order.status?.replace(/_/g, ' '))}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div className="lx-card">
          <h3 style={{ fontWeight: 700, marginBottom: '1rem' }}>{tx('orderDetailPage.sections.overview', 'Order overview')}</h3>
          <div style={{ display: 'grid', gap: '.55rem', fontSize: '.88rem' }}>
            <div><strong>{tx('orderDetailPage.labels.supplier', 'Supplier')}:</strong> {order.supplier_name || '—'}</div>
            <div><strong>{tx('orderDetailPage.labels.buyer', 'Buyer')}:</strong> {order.business_name || order.buyer_name || '—'}</div>
            <div><strong>{tx('orderDetailPage.labels.quantity', 'Quantity')}:</strong> {order.qty_ordered}</div>
            <div><strong>{tx('orderDetailPage.labels.freightOption', 'Freight option')}:</strong> {order.freight_option?.replace(/_/g, ' ') || '—'}</div>
            <div><strong>{tx('orderDetailPage.labels.incoterms', 'Incoterms')}:</strong> {order.incoterms || '—'}</div>
            <div><strong>{tx('orderDetailPage.labels.expectedProductionComplete', 'Expected production complete')}:</strong> {order.expected_production_complete ? new Date(order.expected_production_complete).toLocaleDateString() : '—'}</div>
            <div><strong>{tx('orderDetailPage.labels.expectedShipDate', 'Expected ship date')}:</strong> {order.expected_ship_date ? new Date(order.expected_ship_date).toLocaleDateString() : '—'}</div>
            <div><strong>{tx('orderDetailPage.labels.expectedArrival', 'Expected arrival')}:</strong> {order.expected_arrival_date ? new Date(order.expected_arrival_date).toLocaleDateString() : '—'}</div>
            <div><strong>{tx('orderDetailPage.labels.destination', 'Destination')}:</strong> {order.destination_address || order.destination_country || '—'}</div>
          </div>
        </div>

        <div className="lx-card">
          <h3 style={{ fontWeight: 700, marginBottom: '1rem' }}>{tx('orderDetailPage.sections.financial', 'Financial stack')}</h3>
          <div style={{ display: 'grid', gap: '.45rem', fontSize: '.88rem' }}>
            {[
              [tx('orderDetailPage.finance.productTotal', 'Product total'), order.total_product_usd],
              [tx('orderDetailPage.finance.originHandling', 'Origin handling'), order.origin_handling_usd],
              [tx('orderDetailPage.finance.sourcingFee', 'Sourcing fee'), order.sourcing_fee_usd],
              [tx('orderDetailPage.finance.oxsteedMarkup', 'OxSteed markup'), order.oxsteed_markup_usd],
              [tx('orderDetailPage.finance.freightEstimate', 'Freight estimate'), order.freight_est_usd],
              [tx('orderDetailPage.finance.customsAdmin', 'Customs/admin'), order.customs_admin_usd],
              [tx('orderDetailPage.finance.warehouseFee', 'Warehouse fee'), order.warehouse_fee_usd],
              [tx('orderDetailPage.finance.lastMile', 'Last mile'), order.last_mile_usd],
              [tx('orderDetailPage.finance.riskSurcharge', 'Risk surcharge'), order.risk_surcharge_usd],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>{label}</span>
                <strong>{value ? `$${parseFloat(value).toFixed(2)}` : '—'}</strong>
              </div>
            ))}
          </div>
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '2px solid #e2e8f0', display: 'grid', gap: '.45rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{tx('orderDetailPage.totals.totalLanded', 'Total landed')}</span>
              <strong style={{ color: '#f97316' }}>${parseFloat(order.total_landed_usd || 0).toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{tx('orderDetailPage.totals.depositDue', 'Deposit due')}</span>
              <strong>${parseFloat(order.deposit_due_usd || 0).toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{tx('orderDetailPage.totals.finalDue', 'Final due')}</span>
              <strong>${parseFloat(order.final_due_usd || 0).toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{tx('orderDetailPage.totals.remaining', 'Remaining')}</span>
              <strong>{remaining ? `$${remaining.toFixed(2)}` : '$0.00'}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
