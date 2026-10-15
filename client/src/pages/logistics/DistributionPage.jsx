import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listAllocations, listDeliveries } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

/**
 * DistributionPage - final-mile visibility (Phase 2 refactor).
 *
 * Shared LogisticsLayout for navigation; KPI strip uses token classes;
 * allocation/delivery cards and status pills are theme-token based.
 */
export default function DistributionPage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [allocations, setAllocations] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    Promise.all([listAllocations({ limit: 100 }), listDeliveries({ limit: 100 })])
      .then(([aRes, dRes]) => {
        setAllocations(aRes.data || []);
        setDeliveries(dRes.data || []);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => ({
    allocations: allocations.length,
    released: allocations.filter((a) => a.status === 'released').length,
    deliveries: deliveries.length,
    inTransit: deliveries.filter((d) => d.status === 'in_transit').length,
  }), [allocations, deliveries]);

  return (
    <PageShell>
      <LogisticsLayout
        title={tx('logistics.distribution.title', 'Distribution')}
        subtitle={tx('logistics.distribution.subtitle', 'Final-mile visibility across allocations, delivery orders, release methods, and recipient fulfillment.')}
      >
        <div className="lx-workspaces">
          <div className="lx-kpi-grid">
            {[
              { label: tx('logistics.distribution.stats.allocations', 'Allocations'), value: stats.allocations, icon: '📊' },
              { label: tx('logistics.distribution.stats.released', 'Released'), value: stats.released, icon: '📦' },
              { label: tx('logistics.distribution.stats.deliveryOrders', 'Delivery Orders'), value: stats.deliveries, icon: '🚚' },
              { label: tx('logistics.distribution.stats.inTransit', 'In Transit'), value: stats.inTransit, icon: '🕐' },
            ].map((k) => (
              <div key={k.label} className="lx-kpi-card">
                <div className="lx-kpi-icon" aria-hidden="true">{k.icon}</div>
                <div className="lx-kpi-value">{k.value}</div>
                <div className="lx-kpi-label">{k.label}</div>
              </div>
            ))}
          </div>

          {loading && (
            <div className="lx-loading" role="status" aria-live="polite">
              <span className="lx-spinner" aria-hidden="true" />
              {tx('logistics.distribution.loading', 'Loading…')}
            </div>
          )}

          {!loading && error && (
            <div className="lx-data-error-banner" role="alert">
              <div>
                <h2>{tx('logistics.workspace.dataError.title', 'Data unavailable')}</h2>
                <p>{tx('logistics.distribution.error', "We couldn't load distribution data right now. Please try again.")}</p>
              </div>
              <button type="button" className="lx-btn-secondary" onClick={load}>
                {tx('logistics.workspace.dataError.retry', 'Try again')}
              </button>
            </div>
          )}

          {!loading && !error && (
            <div className="lx-two-col">
              <div className="lx-card">
                <div className="lx-section-header">
                  <h2 className="lx-section-title">{tx('logistics.distribution.sections.allocationQueue', 'Allocation queue')}</h2>
                  <Link to="/logistics/warehousing" className="lx-link">
                    {tx('logistics.distribution.sections.openWarehousing', 'Open warehousing →')}
                  </Link>
                </div>
                <div className="lx-compact-stack">
                  {allocations.slice(0, 12).map((a) => (
                    <div key={a.id} className="lx-item-card">
                      <div className="lx-item-card-head">
                        <div>
                          <div className="lx-t-bold lx-t-small">{a.buyer_name || tx('logistics.distribution.defaults.buyerAllocation', 'Buyer allocation')}</div>
                          <div className="lx-t-xs lx-t-faint">
                            {a.warehouse_name || tx('logistics.distribution.defaults.warehouse', 'Warehouse')} · {a.release_method?.replace(/_/g, ' ') || tx('logistics.distribution.defaults.releasePending', 'release pending')}
                          </div>
                        </div>
                        <LogisticsStatusPill status={a.status} />
                      </div>
                      <div className="lx-t-small lx-mt-6">
                        <strong>{tx('logistics.distribution.labels.allocatedQty', 'Allocated qty')}:</strong> {a.allocated_qty || a.qty || '—'}
                      </div>
                    </div>
                  ))}
                  {allocations.length === 0 && (
                    <div className="lx-empty"><div className="lx-empty-icon" aria-hidden="true">📊</div><p>{tx('logistics.distribution.empty.allocations', 'No allocations available.')}</p></div>
                  )}
                </div>
              </div>

              <div className="lx-card">
                <h2 className="lx-section-title lx-mb-4">{tx('logistics.distribution.sections.deliveryExecution', 'Delivery execution')}</h2>
                <div className="lx-compact-stack">
                  {deliveries.slice(0, 12).map((d) => (
                    <div key={d.id} className="lx-item-card">
                      <div className="lx-item-card-head">
                        <div>
                          <div className="lx-t-bold lx-t-small">{d.recipient_name || tx('logistics.distribution.defaults.recipient', 'Recipient')}</div>
                          <div className="lx-t-xs lx-t-faint">{d.delivery_city || '—'} {d.delivery_country ? `· ${d.delivery_country}` : ''}</div>
                        </div>
                        <LogisticsStatusPill status={d.status} />
                      </div>
                      <div className="lx-t-small lx-mt-6">
                        <strong>{tx('logistics.distribution.labels.mode', 'Mode')}:</strong> {d.method?.replace(/_/g, ' ') || '—'}
                        {d.tracking_number ? <> · <strong>{tx('logistics.distribution.labels.tracking', 'Tracking')}:</strong> {d.tracking_number}</> : null}
                      </div>
                    </div>
                  ))}
                  {deliveries.length === 0 && (
                    <div className="lx-empty"><div className="lx-empty-icon" aria-hidden="true">🚚</div><p>{tx('logistics.distribution.empty.deliveries', 'No delivery orders available.')}</p></div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
