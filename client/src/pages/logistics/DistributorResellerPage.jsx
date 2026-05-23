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
    deliveries: deliveries.length,
    inTransit: deliveries.filter((row) => row.status === 'in_transit').length,
    warehousedOrders: orders.filter((row) => row.status === 'warehoused').length,
  }), [allocations, deliveries, orders]);

  return (
    <PageShell>
      <div className="lx-page">
        <div className="lx-page-header">
          <h1 className="lx-page-title">Distributor / Reseller Workspace</h1>
          <p className="lx-page-sub">Track assigned stock, release methods, and outbound delivery execution for resale and community distribution.</p>
        </div>

        <LogisticsWorkspaceSwitcher
          currentKey="distributor"
          availability={{ buyer: true, organizer: true, business_procurement: true, distributor: true }}
        />

        <div className="lx-nav-grid" style={{ marginBottom: '1.5rem' }}>
          <Link to="/logistics/distribution" className="lx-nav-tile"><span className="lx-nav-icon">🚚</span><span className="lx-nav-label">Distribution board</span></Link>
          <Link to="/logistics/warehousing" className="lx-nav-tile"><span className="lx-nav-icon">🏭</span><span className="lx-nav-label">Warehousing</span></Link>
          <Link to="/logistics/orders" className="lx-nav-tile"><span className="lx-nav-icon">📦</span><span className="lx-nav-label">Purchase orders</span></Link>
          <Link to="/logistics/finance" className="lx-nav-tile"><span className="lx-nav-icon">💰</span><span className="lx-nav-label">Finance</span></Link>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          {[
            ['Allocated lots', stats.allocations, '📊'],
            ['Released lots', stats.released, '📦'],
            ['Delivery orders', stats.deliveries, '🚚'],
            ['In transit', stats.inTransit, '🕐'],
            ['Warehoused orders', stats.warehousedOrders, '🏬'],
          ].map(([label, value, icon]) => (
            <div key={label} className="lx-card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.4rem' }}>{icon}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f97316' }}>{value}</div>
              <div style={{ color: '#64748b', fontSize: '.8rem', fontWeight: 600 }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
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
          </div>
        </div>
      </div>
    </PageShell>
  );
}
