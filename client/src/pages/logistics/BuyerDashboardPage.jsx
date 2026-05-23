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

  const activeRequests = state.requests.filter((request) => !['fulfilled', 'closed', 'cancelled'].includes(request.status)).length;
  const atRiskShipments = state.shipments.filter((shipment) => ['customs_review', 'exception', 'customs_hold'].includes(shipment.status)).length;
  const pendingAllocations = state.allocations.filter((allocation) => allocation.status !== 'released').length;
  const openIssues = state.claims.length + state.refunds.length;
  const latestDeliveryDate = state.deliveries
    .map((delivery) => delivery.scheduled_date || delivery.created_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  const metrics = [
    ['Active requests', activeRequests, '🔍', `${state.requests.length} total buyer requests in motion`],
    ['Watch shipments', state.shipments.length, '🚢', atRiskShipments ? `${atRiskShipments} need exception follow-up` : 'No shipment exceptions flagged right now'],
    ['Pending allocations', pendingAllocations, '📦', pendingAllocations ? 'Stock is assigned but not fully released yet' : 'Allocation queue is clear'],
    ['Claims & refunds', openIssues, '🛟', openIssues ? 'Operator review may be needed on open issues' : 'No active buyer issues'],
  ];

  return (
    <PageShell>
      <div className="lx-page">
      <LogisticsWorkspaceSwitcher
        currentKey="buyer"
        availability={{ buyer: true, organizer: true, business_procurement: true, distributor: true }}
      />

      <div className="lx-dashboard-hero">
        <div className="lx-card lx-dashboard-hero-main">
          <div className="lx-dashboard-kicker">Buyer workspace</div>
          <h1 className="lx-page-title">Buyer Dashboard</h1>
          <p className="lx-page-sub">Source product demand, watch freight movement, and stay ahead of claims, refunds, and delivery release risk from one buyer control center.</p>
          <div className="lx-dashboard-actions">
            <Link to="/logistics/requests/new" className="lx-btn-primary">Start a sourcing request</Link>
            <Link to="/logistics/shipments" className="lx-btn-ghost">Watch shipment timeline</Link>
          </div>
          <div className="lx-dashboard-stat-grid">
            <div className="lx-dashboard-stat">
              <div className="lx-dashboard-stat-value">{activeRequests}</div>
              <div className="lx-dashboard-stat-label">Open buyer requests</div>
              <div className="lx-dashboard-stat-meta">Across sourcing, quoting, and procurement conversion.</div>
            </div>
            <div className="lx-dashboard-stat">
              <div className="lx-dashboard-stat-value">{atRiskShipments}</div>
              <div className="lx-dashboard-stat-label">Shipments needing attention</div>
              <div className="lx-dashboard-stat-meta">Customs or exception-stage movement to review.</div>
            </div>
            <div className="lx-dashboard-stat">
              <div className="lx-dashboard-stat-value">{openIssues}</div>
              <div className="lx-dashboard-stat-label">Claims / refunds open</div>
              <div className="lx-dashboard-stat-meta">Keep buyer protection and resolution posture visible.</div>
            </div>
          </div>
        </div>

        <div className="lx-dashboard-side">
          <div className="lx-card">
            <h2 className="lx-dashboard-panel-title">Attention now</h2>
            <p className="lx-dashboard-panel-copy">Use this queue to decide whether to push new sourcing, chase delivery release, or escalate a finance issue.</p>
            <div className="lx-alert-list">
              <div className="lx-alert-item">
                <div>
                  <strong>Shipment risk</strong>
                  <span>Customs review, exception states, or delayed freight should get buyer follow-up first.</span>
                </div>
                <div className="lx-alert-count">{atRiskShipments}</div>
              </div>
              <div className="lx-alert-item">
                <div>
                  <strong>Allocation release</strong>
                  <span>Assigned stock still needs pickup, forwarder handoff, or final release planning.</span>
                </div>
                <div className="lx-alert-count">{pendingAllocations}</div>
              </div>
              <div className="lx-alert-item">
                <div>
                  <strong>Issue posture</strong>
                  <span>Claims and refund cases tell you where buyer trust or fulfillment quality is slipping.</span>
                </div>
                <div className="lx-alert-count">{openIssues}</div>
              </div>
            </div>
          </div>

          <div className="lx-card">
            <h2 className="lx-dashboard-panel-title">Buyer rhythm</h2>
            <div className="lx-checklist">
              <div className="lx-checklist-item">
                <div>
                  <strong>Latest delivery signal</strong>
                  <span>{latestDeliveryDate ? `Most recent delivery activity is scheduled around ${new Date(latestDeliveryDate).toLocaleDateString()}.` : 'No delivery dates have been scheduled yet.'}</span>
                </div>
              </div>
              <div className="lx-checklist-item">
                <div>
                  <strong>Best next move</strong>
                  <span>{activeRequests === 0 ? 'Open a sourcing request to get supplier quoting started.' : 'Review quote and shipment posture before opening more demand.'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="lx-key-metrics">
        {metrics.map(([label, value, icon, note]) => (
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

      <div className="lx-nav-grid" style={{ marginBottom:'1.5rem' }}>
        <Link to="/logistics/requests/new" className="lx-nav-tile"><span className="lx-nav-icon">➕</span><span className="lx-nav-label">New Request</span></Link>
        <Link to="/logistics/orders" className="lx-nav-tile"><span className="lx-nav-icon">📦</span><span className="lx-nav-label">Orders</span></Link>
        <Link to="/logistics/shipments" className="lx-nav-tile"><span className="lx-nav-icon">🚢</span><span className="lx-nav-label">Shipments</span></Link>
        <Link to="/logistics/finance" className="lx-nav-tile"><span className="lx-nav-icon">💰</span><span className="lx-nav-label">Claims & Refunds</span></Link>
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

      <div className="lx-dashboard-grid">
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
          <div className="lx-section-header"><h2>Claims and resolution posture</h2><Link to="/logistics/finance">Finance workspace</Link></div>
          <div className="lx-compact-stack">
            <div className="lx-mini-list-item">
              <strong>{state.claims.length} active claims</strong>
              <span>Use claims when a shipment, order, or inventory outcome needs operator intervention or evidence review.</span>
            </div>
            <div className="lx-mini-list-item">
              <strong>{state.refunds.length} refund cases</strong>
              <span>Refund queues show where buyer recovery is still waiting on finance or operations confirmation.</span>
            </div>
            <div className="lx-mini-list-item">
              <strong>{state.deliveries.length} delivery records tracked</strong>
              <span>Keep delivery status close to claims so you can connect failed fulfillment with actual release history.</span>
            </div>
          </div>
          <div className="lx-insight-chip-row">
            <span className="lx-insight-chip">Buyer-first workspace</span>
            <span className="lx-insight-chip">Claims tied to shipment outcomes</span>
            <span className="lx-insight-chip">Refund posture stays visible</span>
          </div>
        </div>
      </div>
      </div>
    </PageShell>
  );
}
