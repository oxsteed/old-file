import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listAllocations, listDeliveries } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import '../../styles/logistics/LogisticsHomePage.css';

export default function DistributionPage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [allocations, setAllocations] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listAllocations({ limit: 100 }), listDeliveries({ limit: 100 })])
      .then(([aRes, dRes]) => {
        setAllocations(aRes.data || []);
        setDeliveries(dRes.data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => ({
    allocations: allocations.length,
    released: allocations.filter((a) => a.status === 'released').length,
    deliveries: deliveries.length,
    inTransit: deliveries.filter((d) => d.status === 'in_transit').length,
  }), [allocations, deliveries]);

  return (
    <PageShell>
      <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">{tx('distributionPage.title', 'Distribution')}</h1>
        <p className="lx-page-sub">
          {tx('distributionPage.subtitle', 'Final-mile visibility across allocations, delivery orders, release methods, and recipient fulfillment.')}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          [tx('distributionPage.stats.allocations', 'Allocations'), stats.allocations, '📊'],
          [tx('distributionPage.stats.released', 'Released'), stats.released, '📦'],
          [tx('distributionPage.stats.deliveryOrders', 'Delivery Orders'), stats.deliveries, '🚚'],
          [tx('distributionPage.stats.inTransit', 'In Transit'), stats.inTransit, '🕐'],
        ].map(([label, value, icon]) => (
          <div key={label} className="lx-card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem' }}>{icon}</div>
            <div style={{ fontWeight: 800, fontSize: '1.4rem', color: '#f97316' }}>{value}</div>
            <div style={{ color: '#64748b', fontSize: '.8rem', fontWeight: 600 }}>{label}</div>
          </div>
        ))}
      </div>

      {loading && <div className="lx-loading">{tx('distributionPage.loading', 'Loading…')}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div className="lx-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h3 style={{ fontWeight: 700, margin: 0 }}>{tx('distributionPage.sections.allocationQueue', 'Allocation queue')}</h3>
            <Link to="/logistics/warehousing" className="lx-link">
              {tx('distributionPage.sections.openWarehousing', 'Open warehousing →')}
            </Link>
          </div>
          <div style={{ display: 'grid', gap: '.75rem' }}>
            {allocations.slice(0, 12).map((a) => (
              <div key={a.id} style={{ border: '1px solid #e2e8f0', borderRadius: '.85rem', padding: '.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.75rem' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{a.buyer_name || tx('distributionPage.defaults.buyerAllocation', 'Buyer allocation')}</div>
                    <div style={{ fontSize: '.8rem', color: '#64748b' }}>
                      {a.warehouse_name || tx('distributionPage.defaults.warehouse', 'Warehouse')} · {a.release_method?.replace(/_/g, ' ') || tx('distributionPage.defaults.releasePending', 'release pending')}
                    </div>
                  </div>
                  <span className="lx-status-pill" style={{ background: '#475569' }}>{a.status}</span>
                </div>
                <div style={{ marginTop: '.55rem', fontSize: '.82rem' }}>
                  <strong>{tx('distributionPage.labels.allocatedQty', 'Allocated qty')}:</strong> {a.allocated_qty || a.qty || '—'}
                </div>
              </div>
            ))}
            {!allocations.length && !loading && (
              <div className="lx-empty"><div className="lx-empty-icon">📊</div><p>{tx('distributionPage.empty.allocations', 'No allocations available.')}</p></div>
            )}
          </div>
        </div>

        <div className="lx-card">
          <h3 style={{ fontWeight: 700, marginBottom: '1rem' }}>{tx('distributionPage.sections.deliveryExecution', 'Delivery execution')}</h3>
          <div style={{ display: 'grid', gap: '.75rem' }}>
            {deliveries.slice(0, 12).map((d) => (
              <div key={d.id} style={{ border: '1px solid #e2e8f0', borderRadius: '.85rem', padding: '.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.75rem' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{d.recipient_name || tx('distributionPage.defaults.recipient', 'Recipient')}</div>
                    <div style={{ fontSize: '.8rem', color: '#64748b' }}>{d.delivery_city || '—'} {d.delivery_country ? `· ${d.delivery_country}` : ''}</div>
                  </div>
                  <span className="lx-status-pill" style={{ background: d.status === 'delivered' ? '#22c55e' : d.status === 'in_transit' ? '#f59e0b' : '#64748b' }}>
                    {d.status}
                  </span>
                </div>
                <div style={{ marginTop: '.55rem', fontSize: '.82rem' }}>
                  <strong>{tx('distributionPage.labels.mode', 'Mode')}:</strong> {d.method?.replace(/_/g, ' ') || '—'}
                  {d.tracking_number ? <> · <strong>{tx('distributionPage.labels.tracking', 'Tracking')}:</strong> {d.tracking_number}</> : null}
                </div>
              </div>
            ))}
            {!deliveries.length && !loading && (
              <div className="lx-empty"><div className="lx-empty-icon">🚚</div><p>{tx('distributionPage.empty.deliveries', 'No delivery orders available.')}</p></div>
            )}
          </div>
        </div>
      </div>
      </div>
    </PageShell>
  );
}
