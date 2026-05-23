import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
  const [allocations, setAllocations] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      listAllocations({ limit: 100 }),
      listDeliveries({ limit: 100 }),
      listOrders({ limit: 40 }),
    ])
      .then(([allocationRes, deliveryRes, orderRes]) => {
        setAllocations(allocationRes.data || []);
        setDeliveries(deliveryRes.data || []);
        setOrders(orderRes.orders || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
                  {!loading && allocations.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8' }}>No allocation lots assigned yet.</td></tr>}
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
                  {!loading && deliveries.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8' }}>No delivery orders yet.</td></tr>}
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
