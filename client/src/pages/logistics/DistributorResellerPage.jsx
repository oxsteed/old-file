import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import WorkspaceOverviewStrip, { WorkspaceDataErrorBanner } from '../../components/logistics/LogisticsWorkspacePanels';
import { listAllocations, listDeliveries, listOrders, getDashboardCounts } from '../../api/logistics';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

/**
 * DistributorResellerPage - distributor/reseller workspace overview (Phase 2).
 *
 * Shared LogisticsLayout replaces the workspace tile grid; overview strip
 * carries the one clear next step and recent activity; status pills use
 * theme tokens instead of hardcoded delivery colors.
 */
export default function DistributorResellerPage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [allocations, setAllocations] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Authoritative workspace metrics (see BuyerDashboardPage): headline
  // counts must not be derived from `limit: N` list responses.
  const [counts, setCounts] = useState(null);
  const [countsError, setCountsError] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(false);
    setCountsError(false);
    getDashboardCounts('distributor')
      .then((r) => {
        if (r && r.counts) setCounts(r.counts);
        else setCountsError(true);
      })
      .catch(() => setCountsError(true));
    Promise.all([
      listAllocations({ limit: 100 }),
      listDeliveries({ limit: 100 }),
      listOrders({ limit: 40 }),
    ])
      .then(([allocationRes, deliveryRes, orderRes]) => {
        setAllocations(allocationRes.data || []);
        setDeliveries(deliveryRes.data || []);
        setOrders(orderRes.orders || []);
        setLoading(false);
      })
      .catch(() => {
        setLoadError(true);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  const listStats = useMemo(() => ({
    allocations: allocations.length,
    released: allocations.filter((row) => row.status === 'released').length,
    pendingRelease: allocations.filter((row) => row.status !== 'released').length,
    deliveries: deliveries.length,
    scheduled: deliveries.filter((row) => row.status === 'scheduled').length,
    inTransit: deliveries.filter((row) => row.status === 'in_transit').length,
    failed: deliveries.filter((row) => ['failed', 'cancelled'].includes(row.status)).length,
    warehousedOrders: orders.filter((row) => row.status === 'warehoused').length,
  }), [allocations, deliveries, orders]);

  // Authoritative counts win once loaded; the list derivations are only a
  // transient fallback. On a counts error the metrics render '—', never zeros.
  const stats = {
    allocations: counts ? counts.totalAllocations : listStats.allocations,
    released: counts ? counts.releasedAllocations : listStats.released,
    pendingRelease: counts ? counts.pendingAllocations : listStats.pendingRelease,
    deliveries: counts ? counts.totalDeliveries : listStats.deliveries,
    scheduled: counts ? counts.scheduledDeliveries : listStats.scheduled,
    inTransit: counts ? counts.inTransitDeliveries : listStats.inTransit,
    failed: counts ? counts.failedDeliveries : listStats.failed,
    warehousedOrders: counts ? counts.warehousedOrders : listStats.warehousedOrders,
  };
  const metricValue = (value) => (counts ? value : '—');

  // One clear next step, driven by workspace state. Suppressed while any
  // data source failed.
  const nextStep = (loadError || countsError)
    ? null
    : stats.failed > 0
      ? {
          kind: 'link',
          href: '/logistics/distribution',
          label: tx('logistics.workspace.distributor.nextStep.failedDeliveries.label', 'Review failed deliveries'),
          hint: tx(
            'logistics.workspace.distributor.nextStep.failedDeliveries.hint',
            '{{count}} drops failed or were cancelled and may need rerouting or recipient follow-up.',
            { count: stats.failed }
          ),
        }
      : stats.pendingRelease > 0
        ? {
            kind: 'link',
            href: '/logistics/distribution',
            label: tx('logistics.workspace.distributor.nextStep.releaseLots.label', 'Release waiting lots'),
            hint: tx(
              'logistics.workspace.distributor.nextStep.releaseLots.hint',
              '{{count}} lots are assigned but not fully released yet.',
              { count: stats.pendingRelease }
            ),
          }
        : {
            kind: 'link',
            href: '/logistics/warehousing',
            label: tx('logistics.workspace.distributor.nextStep.warehouse.label', 'Check warehouse readiness'),
            hint: tx(
              'logistics.workspace.distributor.nextStep.warehouse.hint',
              'The handoff queue is clear. Make sure upstream stock is ready to allocate.'
            ),
          };

  const recentActivity = [
    ...deliveries.map((row) => ({
      key: `delivery-${row.id}`,
      label: row.recipient_name || tx('logistics.distributor.activity.deliveryFallback', 'Delivery #{{id}}', { id: row.id }),
      href: '/logistics/distribution',
      date: row.updated_at || row.created_at || row.scheduled_date,
    })),
    ...allocations.map((row) => ({
      key: `allocation-${row.id}`,
      label: row.reference || tx('logistics.distributor.activity.allocationFallback', 'ALC-{{id}}', { id: row.id }),
      href: '/logistics/distribution',
      date: row.updated_at || row.created_at,
    })),
  ]
    .filter((item) => item.date && !Number.isNaN(new Date(item.date).getTime()))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  return (
    <PageShell>
      <LogisticsLayout
        title={tx('logistics.distributor.title', 'Distributor / Reseller Workspace')}
        subtitle={tx('logistics.distributor.subtitle', 'Track allocated inventory, manage release methods, and keep final-mile handoff execution clean across resale or community distribution.')}
        actions={
          <>
            <Link to="/logistics/distribution" className="lx-btn-primary lx-next-step-action">
              {tx('logistics.distributor.actions.openBoard', 'Open distribution board')}
            </Link>
            <Link to="/logistics/warehousing" className="lx-action-ghost">
              {tx('logistics.distributor.actions.warehouseReadiness', 'Check warehouse readiness')}
            </Link>
          </>
        }
      >
        <div className="lx-workspaces">
          <div className="lx-dashboard-hero">
            <div className="lx-card lx-dashboard-hero-main">
              <div className="lx-dashboard-kicker">{tx('logistics.distributor.kicker', 'Distributor / reseller')}</div>
              <h2 className="lx-page-title">{tx('logistics.distributor.title', 'Distributor / Reseller Workspace')}</h2>
              <p className="lx-page-sub">{tx('logistics.distributor.subtitle', 'Track allocated inventory, manage release methods, and keep final-mile handoff execution clean across resale or community distribution.')}</p>
              <div className="lx-dashboard-stat-grid">
                <div className="lx-dashboard-stat">
                  <div className="lx-dashboard-stat-value">{metricValue(stats.pendingRelease)}</div>
                  <div className="lx-dashboard-stat-label">{tx('logistics.distributor.stats.pendingRelease.label', 'Pending release lots')}</div>
                  <div className="lx-dashboard-stat-meta">{tx('logistics.distributor.stats.pendingRelease.meta', 'Assigned inventory not fully handed off yet.')}</div>
                </div>
                <div className="lx-dashboard-stat">
                  <div className="lx-dashboard-stat-value">{metricValue(stats.inTransit)}</div>
                  <div className="lx-dashboard-stat-label">{tx('logistics.distributor.stats.inTransit.label', 'Deliveries in motion')}</div>
                  <div className="lx-dashboard-stat-meta">{tx('logistics.distributor.stats.inTransit.meta', 'Outbound movement you should actively watch.')}</div>
                </div>
                <div className="lx-dashboard-stat">
                  <div className="lx-dashboard-stat-value">{metricValue(stats.failed)}</div>
                  <div className="lx-dashboard-stat-label">{tx('logistics.distributor.stats.failed.label', 'Failed or cancelled drops')}</div>
                  <div className="lx-dashboard-stat-meta">{tx('logistics.distributor.stats.failed.meta', 'These often need rerouting or direct recipient follow-up.')}</div>
                </div>
              </div>
            </div>

            <div className="lx-dashboard-side">
              <div className="lx-card">
                <h2 className="lx-dashboard-panel-title">{tx('logistics.distributor.pressure.title', 'Distribution pressure points')}</h2>
                <p className="lx-dashboard-panel-copy">{tx('logistics.distributor.pressure.copy', 'Use this view to decide whether the next bottleneck is warehouse release, scheduling, or failed final-mile execution.')}</p>
                <div className="lx-alert-list">
                  <div className="lx-alert-item">
                    <div>
                      <strong>{tx('logistics.distributor.pressure.release.label', 'Lots waiting on release')}</strong>
                      <span>{tx('logistics.distributor.pressure.release.hint', 'Inventory is assigned, but pickup method, forwarder handoff, or recipient readiness is still incomplete.')}</span>
                    </div>
                    <div className="lx-alert-count">{metricValue(stats.pendingRelease)}</div>
                  </div>
                  <div className="lx-alert-item">
                    <div>
                      <strong>{tx('logistics.distributor.pressure.scheduled.label', 'Scheduled deliveries')}</strong>
                      <span>{tx('logistics.distributor.pressure.scheduled.hint', 'These are the next likely touchpoints where communication and timing matter.')}</span>
                    </div>
                    <div className="lx-alert-count">{metricValue(stats.scheduled)}</div>
                  </div>
                  <div className="lx-alert-item">
                    <div>
                      <strong>{tx('logistics.distributor.pressure.exceptions.label', 'Delivery exceptions')}</strong>
                      <span>{tx('logistics.distributor.pressure.exceptions.hint', 'Failed or cancelled deliveries should get attention before customer confidence drops further.')}</span>
                    </div>
                    <div className="lx-alert-count">{metricValue(stats.failed)}</div>
                  </div>
                </div>
              </div>

              <div className="lx-card">
                <h2 className="lx-dashboard-panel-title">{tx('logistics.distributor.posture.title', 'Operational posture')}</h2>
                <div className="lx-checklist">
                  <div className="lx-checklist-item">
                    <div>
                      <strong>{tx('logistics.distributor.posture.releaseFirst.label', 'Release before routing')}</strong>
                      <span>{tx('logistics.distributor.posture.releaseFirst.hint', 'Check that allocations are truly released before pushing recipients into delivery scheduling.')}</span>
                    </div>
                  </div>
                  <div className="lx-checklist-item">
                    <div>
                      <strong>{tx('logistics.distributor.posture.warehousedVisible.label', 'Keep warehoused stock visible')}</strong>
                      <span>{tx('logistics.distributor.posture.warehousedVisible.hint', '{{count}} purchase orders are already warehoused, so the bottleneck may be downstream, not upstream.', { count: metricValue(stats.warehousedOrders) })}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {(loadError || countsError) && !loading && <WorkspaceDataErrorBanner onRetry={load} />}

          <WorkspaceOverviewStrip
            loading={loading}
            loadError={loadError}
            nextStep={nextStep}
            recentActivity={recentActivity}
            emptyActivityText={t('logistics.workspace.distributor.recentActivity.empty')}
          />

          <div className="lx-key-metrics">
            {[
              {
                label: tx('logistics.distributor.metrics.allocatedLots.label', 'Allocated lots'),
                value: metricValue(stats.allocations),
                icon: '📊',
                note: tx('logistics.distributor.metrics.allocatedLots.note', 'Assigned inventory across distribution recipients.'),
              },
              {
                label: tx('logistics.distributor.metrics.releasedLots.label', 'Released lots'),
                value: metricValue(stats.released),
                icon: '📦',
                note: tx('logistics.distributor.metrics.releasedLots.note', 'Lots already cleared for pickup or delivery execution.'),
              },
              {
                label: tx('logistics.distributor.metrics.deliveryOrders.label', 'Delivery orders'),
                value: metricValue(stats.deliveries),
                icon: '🚚',
                note: tx('logistics.distributor.metrics.deliveryOrders.note', 'Outbound legs currently being tracked.'),
              },
              {
                label: tx('logistics.distributor.metrics.inTransit.label', 'In transit'),
                value: metricValue(stats.inTransit),
                icon: '🕐',
                note: tx('logistics.distributor.metrics.inTransit.note', 'Deliveries that still need final-mile monitoring.'),
              },
              {
                label: tx('logistics.distributor.metrics.warehousedOrders.label', 'Warehoused orders'),
                value: metricValue(stats.warehousedOrders),
                icon: '🏬',
                note: tx('logistics.distributor.metrics.warehousedOrders.note', 'Upstream inventory already in storage and ready to allocate.'),
              },
            ].map((metric) => (
              <div key={metric.label} className="lx-key-metric-card">
                <div className="lx-key-metric-top">
                  <div className="lx-key-metric-value">{metric.value}</div>
                  <div className="lx-key-metric-icon" aria-hidden="true">{metric.icon}</div>
                </div>
                <div className="lx-key-metric-label">{metric.label}</div>
                <div className="lx-key-metric-note">{metric.note}</div>
              </div>
            ))}
          </div>

          <div className="lx-dashboard-grid">
            <div className="lx-card">
              <div className="lx-section-header">
                <h2 className="lx-section-title">{tx('logistics.distributor.queue.title', 'Allocation handoff queue')}</h2>
                <Link to="/logistics/distribution" className="lx-link">{tx('logistics.distributor.queue.open', 'Open workspace')}</Link>
              </div>
              <div className="lx-table-wrap">
                <table className="lx-table">
                  <thead>
                    <tr>
                      <th>{tx('logistics.distributor.queue.headers.recipient', 'Recipient')}</th>
                      <th>{tx('logistics.distributor.queue.headers.warehouse', 'Warehouse')}</th>
                      <th>{tx('logistics.distributor.queue.headers.method', 'Method')}</th>
                      <th>{tx('logistics.distributor.queue.headers.status', 'Status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocations.slice(0, 10).map((allocation) => (
                      <tr key={allocation.id}>
                        <td>{allocation.recipient_name || allocation.buyer_name || tx('logistics.distributor.queue.assignedBuyer', 'Assigned buyer')}</td>
                        <td>{allocation.warehouse_name || tx('logistics.distributor.queue.warehousePending', 'Warehouse pending')}</td>
                        <td>{allocation.release_method?.replace(/_/g, ' ') || tx('logistics.distributor.queue.methodPending', 'pending')}</td>
                        <td><LogisticsStatusPill status={allocation.status} /></td>
                      </tr>
                    ))}
                    {!loading && !loadError && allocations.length === 0 && (
                      <tr><td colSpan={4} className="lx-table-empty-cell">{tx('logistics.distributor.queue.empty', 'No allocation lots assigned yet.')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="lx-card">
              <div className="lx-section-header">
                <h2 className="lx-section-title">{tx('logistics.distributor.execution.title', 'Delivery execution')}</h2>
                <Link to="/logistics/distribution" className="lx-link">{tx('logistics.distributor.execution.seeAll', 'See all')}</Link>
              </div>
              <div className="lx-table-wrap">
                <table className="lx-table">
                  <thead>
                    <tr>
                      <th>{tx('logistics.distributor.execution.headers.recipient', 'Recipient')}</th>
                      <th>{tx('logistics.distributor.execution.headers.method', 'Method')}</th>
                      <th>{tx('logistics.distributor.execution.headers.scheduled', 'Scheduled')}</th>
                      <th>{tx('logistics.distributor.execution.headers.status', 'Status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.slice(0, 10).map((delivery) => (
                      <tr key={delivery.id}>
                        <td>{delivery.recipient_name || tx('logistics.distributor.execution.recipientFallback', 'Delivery recipient')}</td>
                        <td>{delivery.method?.replace(/_/g, ' ') || '—'}</td>
                        <td>{delivery.scheduled_date ? new Date(delivery.scheduled_date).toLocaleDateString() : '—'}</td>
                        <td><LogisticsStatusPill status={delivery.status} /></td>
                      </tr>
                    ))}
                    {!loading && !loadError && deliveries.length === 0 && (
                      <tr><td colSpan={4} className="lx-table-empty-cell">{tx('logistics.distributor.execution.empty', 'No delivery orders yet.')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="lx-insight-chip-row">
                <span className="lx-insight-chip">{tx('logistics.distributor.chips.releaseDiscipline', 'Release discipline matters')}</span>
                <span className="lx-insight-chip">{tx('logistics.distributor.chips.failedDrops', 'Track failed drops early')}</span>
                <span className="lx-insight-chip">{tx('logistics.distributor.chips.sync', 'Keep warehouse and delivery in sync')}</span>
              </div>
            </div>
          </div>
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
