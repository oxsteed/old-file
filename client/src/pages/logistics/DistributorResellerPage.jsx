import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/PageShell';
import { listAllocations, listDeliveries, listOrders } from '../../api/logistics';
import LogisticsWorkspaceSwitcher from '../../components/logistics/LogisticsWorkspaceSwitcher';
import '../../styles/logistics/LogisticsHomePage.css';

const DELIVERY_COLOR = {
  pending: '#94a3b8',
  scheduled: '#3b82f6',
  in_transit: '#06b6d4',
  delivered: '#22c55e',
  failed: '#ef4444',
  cancelled: '#64748b',
};

export default function DistributorResellerPage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [allocations, setAllocations] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(false);
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

  const stats = useMemo(() => ({
    allocations: allocations.length,
    released: allocations.filter((row) => row.status === 'released').length,
    pendingRelease: allocations.filter((row) => row.status !== 'released').length,
    deliveries: deliveries.length,
    scheduled: deliveries.filter((row) => row.status === 'scheduled').length,
    inTransit: deliveries.filter((row) => row.status === 'in_transit').length,
    failed: deliveries.filter((row) => ['failed', 'cancelled'].includes(row.status)).length,
    warehousedOrders: orders.filter((row) => row.status === 'warehoused').length,
  }), [allocations, deliveries, orders]);

  // One clear next step, driven by workspace state.
  const nextStep = loadError
    ? null
    : stats.failed > 0
      ? {
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
            href: '/logistics/distribution',
            label: tx('logistics.workspace.distributor.nextStep.releaseLots.label', 'Release waiting lots'),
            hint: tx(
              'logistics.workspace.distributor.nextStep.releaseLots.hint',
              '{{count}} lots are assigned but not fully released yet.',
              { count: stats.pendingRelease }
            ),
          }
        : {
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
      label: row.recipient_name || `Delivery #${row.id}`,
      href: '/logistics/distribution',
      date: row.updated_at || row.created_at || row.scheduled_date,
    })),
    ...allocations.map((row) => ({
      key: `allocation-${row.id}`,
      label: row.reference || `ALC-${row.id}`,
      href: '/logistics/distribution',
      date: row.updated_at || row.created_at,
    })),
  ]
    .filter((item) => item.date && !Number.isNaN(new Date(item.date).getTime()))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  return (
    <PageShell>
      <div className="lx-page">
        <LogisticsWorkspaceSwitcher
          currentKey="distributor"
          availability={{ buyer: true, organizer: true, business_procurement: true, distributor: true }}
        />

        <div className="lx-dashboard-hero">
          <div className="lx-card lx-dashboard-hero-main">
            <div className="lx-dashboard-kicker">Distributor / reseller</div>
            <h1 className="lx-page-title">Distributor / Reseller Workspace</h1>
            <p className="lx-page-sub">Track allocated inventory, manage release methods, and keep final-mile handoff execution clean across resale or community distribution.</p>
            <div className="lx-dashboard-actions">
              <Link to="/logistics/distribution" className="lx-btn-primary">Open distribution board</Link>
              <Link to="/logistics/warehousing" className="lx-btn-ghost">Check warehouse readiness</Link>
            </div>
            <div className="lx-dashboard-stat-grid">
              <div className="lx-dashboard-stat">
                <div className="lx-dashboard-stat-value">{stats.pendingRelease}</div>
                <div className="lx-dashboard-stat-label">Pending release lots</div>
                <div className="lx-dashboard-stat-meta">Assigned inventory not fully handed off yet.</div>
              </div>
              <div className="lx-dashboard-stat">
                <div className="lx-dashboard-stat-value">{stats.inTransit}</div>
                <div className="lx-dashboard-stat-label">Deliveries in motion</div>
                <div className="lx-dashboard-stat-meta">Outbound movement you should actively watch.</div>
              </div>
              <div className="lx-dashboard-stat">
                <div className="lx-dashboard-stat-value">{stats.failed}</div>
                <div className="lx-dashboard-stat-label">Failed or cancelled drops</div>
                <div className="lx-dashboard-stat-meta">These often need rerouting or direct recipient follow-up.</div>
              </div>
            </div>
          </div>

          <div className="lx-dashboard-side">
            <div className="lx-card">
              <h2 className="lx-dashboard-panel-title">Distribution pressure points</h2>
              <p className="lx-dashboard-panel-copy">Use this view to decide whether the next bottleneck is warehouse release, scheduling, or failed final-mile execution.</p>
              <div className="lx-alert-list">
                <div className="lx-alert-item">
                  <div>
                    <strong>Lots waiting on release</strong>
                    <span>Inventory is assigned, but pickup method, forwarder handoff, or recipient readiness is still incomplete.</span>
                  </div>
                  <div className="lx-alert-count">{stats.pendingRelease}</div>
                </div>
                <div className="lx-alert-item">
                  <div>
                    <strong>Scheduled deliveries</strong>
                    <span>These are the next likely touchpoints where communication and timing matter.</span>
                  </div>
                  <div className="lx-alert-count">{stats.scheduled}</div>
                </div>
                <div className="lx-alert-item">
                  <div>
                    <strong>Delivery exceptions</strong>
                    <span>Failed or cancelled deliveries should get attention before customer confidence drops further.</span>
                  </div>
                  <div className="lx-alert-count">{stats.failed}</div>
                </div>
              </div>
            </div>

            <div className="lx-card">
              <h2 className="lx-dashboard-panel-title">Operational posture</h2>
              <div className="lx-checklist">
                <div className="lx-checklist-item">
                  <div>
                    <strong>Release before routing</strong>
                    <span>Check that allocations are truly released before pushing recipients into delivery scheduling.</span>
                  </div>
                </div>
                <div className="lx-checklist-item">
                  <div>
                    <strong>Keep warehoused stock visible</strong>
                    <span>{stats.warehousedOrders} purchase orders are already warehoused, so the bottleneck may be downstream, not upstream.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {loadError && !loading && (
          <div className="lx-data-error-banner" role="alert">
            <div>
              <h2>{tx('logistics.workspace.dataError.title', 'Data unavailable')}</h2>
              <p>{tx('logistics.workspace.dataError.body', "We couldn't load your distributor workspace right now. Please try again.")}</p>
            </div>
            <button type="button" className="lx-btn-secondary" onClick={load}>
              {tx('logistics.workspace.dataError.retry', 'Try again')}
            </button>
          </div>
        )}

        <div className="lx-overview-strip">
          <div className="lx-card">
            <h2 className="lx-dashboard-panel-title">{tx('logistics.workspace.nextStep.title', 'Your next step')}</h2>
            <div className="lx-next-step-body">
              {loading && (
                <p className="lx-overview-empty">{tx('logistics.modal.loading', 'Loading…')}</p>
              )}
              {!loading && loadError && (
                <p className="lx-overview-empty">{tx('logistics.workspace.dataError.body', "We couldn't load your distributor workspace right now. Please try again.")}</p>
              )}
              {!loading && !loadError && nextStep && (
                <>
                  <p className="lx-next-step-hint">{nextStep.hint}</p>
                  <Link to={nextStep.href} className="lx-btn-primary lx-next-step-action">{nextStep.label}</Link>
                </>
              )}
            </div>
          </div>
          <div className="lx-card">
            <h2 className="lx-dashboard-panel-title">{tx('logistics.workspace.recentActivity.title', 'Recent activity')}</h2>
            {loading ? (
              <p className="lx-overview-empty">{tx('logistics.modal.loading', 'Loading…')}</p>
            ) : loadError ? (
              <p className="lx-overview-empty">{tx('logistics.workspace.dataError.body', "We couldn't load your distributor workspace right now. Please try again.")}</p>
            ) : recentActivity.length > 0 ? (
              <div className="lx-activity-list">
                {recentActivity.map((item) => (
                  <div key={item.key} className="lx-activity-item">
                    <span className="lx-activity-label"><Link to={item.href} className="lx-link">{item.label}</Link></span>
                    <span className="lx-activity-date">{new Date(item.date).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="lx-overview-empty">{tx('logistics.workspace.recentActivity.empty', 'Nothing here yet. Allocations and deliveries will appear here.')}</p>
            )}
          </div>
        </div>

        <div className="lx-nav-grid" style={{ marginBottom: '1.5rem' }}>
          <Link to="/logistics/distribution" className="lx-nav-tile"><span className="lx-nav-icon">🚚</span><span className="lx-nav-label">Distribution board</span></Link>
          <Link to="/logistics/warehousing" className="lx-nav-tile"><span className="lx-nav-icon">🏭</span><span className="lx-nav-label">Warehousing</span></Link>
          <Link to="/logistics/orders" className="lx-nav-tile"><span className="lx-nav-icon">📦</span><span className="lx-nav-label">Purchase orders</span></Link>
          <Link to="/logistics/finance" className="lx-nav-tile"><span className="lx-nav-icon">💰</span><span className="lx-nav-label">Finance</span></Link>
        </div>

        <div className="lx-key-metrics">
          {[
            ['Allocated lots', stats.allocations, '📊', 'Assigned inventory across distribution recipients.'],
            ['Released lots', stats.released, '📦', 'Lots already cleared for pickup or delivery execution.'],
            ['Delivery orders', stats.deliveries, '🚚', 'Outbound legs currently being tracked.'],
            ['In transit', stats.inTransit, '🕐', 'Deliveries that still need final-mile monitoring.'],
            ['Warehoused orders', stats.warehousedOrders, '🏬', 'Upstream inventory already in storage and ready to allocate.'],
          ].map(([label, value, icon, note]) => (
            <div key={label} className="lx-key-metric-card">
              <div className="lx-key-metric-top">
                <div className="lx-key-metric-value">{value}</div>
                <div className="lx-key-metric-icon">{icon}</div>
              </div>
              <div className="lx-key-metric-label">{label}</div>
              <div className="lx-key-metric-note">{note}</div>
            </div>
          ))}
        </div>

        <div className="lx-dashboard-grid">
          <div className="lx-card">
            <div className="lx-section-header">
              <h2>Allocation handoff queue</h2>
              <Link to="/logistics/distribution">Open workspace</Link>
            </div>
            <div className="lx-table-wrap">
              <table className="lx-table">
                <thead><tr><th>Recipient</th><th>Warehouse</th><th>Method</th><th>Status</th></tr></thead>
                <tbody>
                  {allocations.slice(0, 10).map((allocation) => (
                    <tr key={allocation.id}>
                      <td>{allocation.recipient_name || allocation.buyer_name || 'Assigned buyer'}</td>
                      <td>{allocation.warehouse_name || 'Warehouse pending'}</td>
                      <td>{allocation.release_method?.replace(/_/g, ' ') || 'pending'}</td>
                      <td><span className="lx-status-pill" style={{ background: allocation.status === 'released' ? '#22c55e' : '#64748b' }}>{allocation.status}</span></td>
                    </tr>
                  ))}
                  {!loading && !loadError && allocations.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8' }}>No allocation lots assigned yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lx-card">
            <div className="lx-section-header">
              <h2>Delivery execution</h2>
              <Link to="/logistics/distribution">See all</Link>
            </div>
            <div className="lx-table-wrap">
              <table className="lx-table">
                <thead><tr><th>Recipient</th><th>Method</th><th>Scheduled</th><th>Status</th></tr></thead>
                <tbody>
                  {deliveries.slice(0, 10).map((delivery) => (
                    <tr key={delivery.id}>
                      <td>{delivery.recipient_name || 'Delivery recipient'}</td>
                      <td>{delivery.method?.replace(/_/g, ' ') || '—'}</td>
                      <td>{delivery.scheduled_date ? new Date(delivery.scheduled_date).toLocaleDateString() : '—'}</td>
                      <td><span className="lx-status-pill" style={{ background: DELIVERY_COLOR[delivery.status] || '#64748b' }}>{delivery.status}</span></td>
                    </tr>
                  ))}
                  {!loading && !loadError && deliveries.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8' }}>No delivery orders yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="lx-insight-chip-row">
              <span className="lx-insight-chip">Release discipline matters</span>
              <span className="lx-insight-chip">Track failed drops early</span>
              <span className="lx-insight-chip">Keep warehouse and delivery in sync</span>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
