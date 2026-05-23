import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listSourcingRequests, listOrders, listShipments, listAllocations, listDeliveries, listMyClaims, listRefundCases } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import LogisticsWorkspaceSwitcher from '../../components/logistics/LogisticsWorkspaceSwitcher';
import '../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLOR = {
  draft:'#94a3b8', open:'#22c55e', quoted:'#f59e0b', procurement:'#10b981',
  in_transit:'#06b6d4', customs_review:'#ef4444', warehoused:'#0ea5e9', fulfilled:'#15803d',
};

export default function BuyerDashboardPage() {
  const [state, setState] = useState({
    requests: [], orders: [], shipments: [], allocations: [], deliveries: [], claims: [], refunds: [], loading: true,
  });

  useEffect(() => {
    Promise.all([
      listSourcingRequests({ limit: 12 }),
      listOrders({ limit: 8 }),
      listShipments({ limit: 8 }),
      listAllocations({ limit: 8 }),
      listDeliveries({ limit: 8 }),
      listMyClaims(),
      listRefundCases(),
    ])
      .then(([requests, orders, shipments, allocations, deliveries, claims, refunds]) => {
        setState({
          requests: requests.requests || [],
          orders: orders.orders || [],
          shipments: shipments.shipments || [],
          allocations: allocations.data || [],
          deliveries: deliveries.data || [],
          claims: claims.data || [],
          refunds: refunds.data || [],
          loading: false,
        });
      })
      .catch(() => setState((s) => ({ ...s, loading: false })));
  }, []);

  const stats = [
    ['Requests', state.requests.length, '🔍'],
    ['Orders', state.orders.length, '📦'],
    ['Shipments', state.shipments.length, '🚢'],
    ['Deliveries', state.deliveries.length, '🚚'],
  ];

  return (
    <PageShell>
      <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">Buyer Dashboard</h1>
        <p className="lx-page-sub">Run sourcing requests, monitor shipments, and track fulfillment issues from one buyer workspace.</p>
      </div>

      <LogisticsWorkspaceSwitcher
        currentKey="buyer"
        availability={{ buyer: true, organizer: true, business_procurement: true, distributor: true }}
      />

      <div className="lx-nav-grid" style={{ marginBottom:'1.5rem' }}>
        <Link to="/logistics/requests/new" className="lx-nav-tile"><span className="lx-nav-icon">➕</span><span className="lx-nav-label">New Request</span></Link>
        <Link to="/logistics/orders" className="lx-nav-tile"><span className="lx-nav-icon">📦</span><span className="lx-nav-label">Orders</span></Link>
        <Link to="/logistics/shipments" className="lx-nav-tile"><span className="lx-nav-icon">🚢</span><span className="lx-nav-label">Shipments</span></Link>
        <Link to="/logistics/finance" className="lx-nav-tile"><span className="lx-nav-icon">💰</span><span className="lx-nav-label">Claims & Refunds</span></Link>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'1rem', marginBottom:'1.5rem' }}>
        {stats.map(([label, value, icon]) => (
          <div key={label} className="lx-card" style={{ textAlign:'center' }}>
            <div style={{ fontSize:'1.4rem' }}>{icon}</div>
            <div style={{ fontSize:'1.4rem', fontWeight:800, color:'#f97316' }}>{value}</div>
            <div style={{ color:'#64748b', fontSize:'.8rem', fontWeight:600 }}>{label}</div>
          </div>
        ))}
      </div>

      <div className="lx-card" style={{ marginBottom:'1.5rem' }}>
        <div className="lx-section-header"><h2>My sourcing requests</h2><Link to="/logistics/sourcing">View all</Link></div>
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead><tr><th>Request</th><th>Category</th><th>Status</th><th>Quotes</th><th></th></tr></thead>
            <tbody>
              {state.requests.slice(0, 8).map((request) => (
                <tr key={request.id}>
                  <td>{request.title}</td>
                  <td>{request.category || '—'}</td>
                  <td><span className="lx-status-pill" style={{ background: STATUS_COLOR[request.status] || '#64748b' }}>{request.status}</span></td>
                  <td>{request.quote_count || 0}</td>
                  <td><Link to={`/logistics/requests/${request.id}`} className="lx-link">View</Link></td>
                </tr>
              ))}
              {!state.loading && state.requests.length === 0 && <tr><td colSpan={5} style={{ textAlign:'center', color:'#94a3b8' }}>No sourcing requests yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1.1fr .9fr', gap:'1.5rem' }}>
        <div className="lx-card">
          <div className="lx-section-header"><h2>Shipment and allocation flow</h2><Link to="/logistics/distribution">Distribution</Link></div>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead><tr><th>Reference</th><th>Status</th><th>ETA / Delivery</th></tr></thead>
              <tbody>
                {state.shipments.slice(0, 4).map((shipment) => (
                  <tr key={`s-${shipment.id}`}>
                    <td><Link to={`/logistics/shipments/${shipment.id}`} className="lx-link">{shipment.reference}</Link></td>
                    <td><span className="lx-status-pill" style={{ background: STATUS_COLOR[shipment.status] || '#64748b' }}>{shipment.status}</span></td>
                    <td>{shipment.eta ? new Date(shipment.eta).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
                {state.allocations.slice(0, 4).map((allocation) => (
                  <tr key={`a-${allocation.id}`}>
                    <td>{allocation.reference || `ALC-${allocation.id}`}</td>
                    <td><span className="lx-status-pill" style={{ background: allocation.status === 'released' ? '#22c55e' : '#f59e0b' }}>{allocation.status}</span></td>
                    <td>{allocation.recipient_name || allocation.warehouse_name || 'Awaiting release'}</td>
                  </tr>
                ))}
                {!state.loading && state.shipments.length === 0 && state.allocations.length === 0 && <tr><td colSpan={3} style={{ textAlign:'center', color:'#94a3b8' }}>No shipment or allocation records yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lx-card">
          <h2 style={{ marginTop:0 }}>Claims and refund posture</h2>
          <div style={{ display:'grid', gap:'.75rem' }}>
            <div style={{ padding:'1rem', border:'1px solid #e2e8f0', borderRadius:'.75rem' }}>
              <div style={{ color:'#64748b', fontSize:'.8rem', fontWeight:700 }}>Claims</div>
              <div style={{ fontSize:'1.6rem', fontWeight:800, color:'#f97316' }}>{state.claims.length}</div>
            </div>
            <div style={{ padding:'1rem', border:'1px solid #e2e8f0', borderRadius:'.75rem' }}>
              <div style={{ color:'#64748b', fontSize:'.8rem', fontWeight:700 }}>Refund cases</div>
              <div style={{ fontSize:'1.6rem', fontWeight:800, color:'#f97316' }}>{state.refunds.length}</div>
            </div>
            <div style={{ fontSize:'.85rem', color:'#64748b', lineHeight:1.7 }}>
              Buyers can open disputes and refund cases from the finance workspace whenever a pooled order, purchase order, or shipment exception needs operator review.
            </div>
          </div>
        </div>
      </div>
      </div>
    </PageShell>
  );
}
