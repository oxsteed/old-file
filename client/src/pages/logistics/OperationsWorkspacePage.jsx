import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../../components/PageShell';
import { useAuth } from '../../context/AuthContext';
import { adminGetStats } from '../../api/logistics';
import '../../styles/logistics/LogisticsHomePage.css';

const OPS_LINKS = [
  { label: 'Sourcing Ops', path: '/admin/logistics/sourcing-ops', icon: '🔍' },
  { label: 'Organizer Approvals', path: '/admin/logistics/organizer-approvals', icon: '🧭' },
  { label: 'Shipment Ops', path: '/admin/logistics/shipment-ops', icon: '🚦' },
  { label: 'Warehouse Ops', path: '/admin/logistics/warehouse-ops', icon: '🏬' },
  { label: 'Allocations', path: '/admin/logistics/allocations', icon: '📊' },
  { label: 'Disputes', path: '/admin/logistics/disputes', icon: '⚖️' },
];

export default function OperationsWorkspacePage() {
  const { user } = useAuth();
  const isOperator = user?.role === 'admin' || user?.role === 'super_admin';
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(isOperator);

  useEffect(() => {
    if (!isOperator) return;
    adminGetStats()
      .then((res) => setStats(res.data || null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOperator]);

  const summary = useMemo(() => ({
    sourcing: (stats?.sourcingRequests || []).reduce((sum, row) => sum + Number(row.count || 0), 0),
    campaigns: (stats?.pooledOrders || []).reduce((sum, row) => sum + Number(row.count || 0), 0),
    shipments: (stats?.shipments || []).reduce((sum, row) => sum + Number(row.count || 0), 0),
    claims: (stats?.claims || []).reduce((sum, row) => sum + Number(row.count || 0), 0),
  }), [stats]);

  return (
    <PageShell>
      <div className="lx-page">
        <div className="lx-page-header">
          <h1 className="lx-page-title">Operations Workspace</h1>
          <p className="lx-page-sub">One internal command surface for sourcing intake, active freight movement, warehouse flow, and logistics exceptions.</p>
        </div>

        {!isOperator && (
          <div className="lx-card">
            <h2 style={{ marginTop: 0 }}>Operations access is internal</h2>
            <p style={{ color: '#64748b', lineHeight: 1.7 }}>
              This workspace is reserved for OxSteed logistics operators. Signed-in buyers and organizers can still use the Buyer, Organizer, Business Procurement, and Distributor workspaces to manage their own logistics activity.
            </p>
            <div className="lx-nav-grid">
              <Link to="/logistics/buyer" className="lx-nav-tile"><span className="lx-nav-icon">🧾</span><span className="lx-nav-label">Buyer</span></Link>
              <Link to="/logistics/organizer" className="lx-nav-tile"><span className="lx-nav-icon">🧭</span><span className="lx-nav-label">Organizer</span></Link>
              <Link to="/logistics/business-procurement" className="lx-nav-tile"><span className="lx-nav-icon">🏢</span><span className="lx-nav-label">Business Procurement</span></Link>
              <Link to="/logistics/distributor" className="lx-nav-tile"><span className="lx-nav-icon">📤</span><span className="lx-nav-label">Distributor</span></Link>
            </div>
          </div>
        )}

        {isOperator && (
          <>
            <div className="lx-nav-grid" style={{ marginBottom: '1.5rem' }}>
              {OPS_LINKS.map((link) => (
                <Link key={link.path} to={link.path} className="lx-nav-tile">
                  <span className="lx-nav-icon">{link.icon}</span>
                  <span className="lx-nav-label">{link.label}</span>
                </Link>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              {[
                ['Sourcing queue', summary.sourcing, '🔍'],
                ['Campaigns', summary.campaigns, '🤝'],
                ['Tracked shipments', summary.shipments, '🚢'],
                ['Claims & disputes', summary.claims, '⚖️'],
              ].map(([label, value, icon]) => (
                <div key={label} className="lx-card" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem' }}>{icon}</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f97316' }}>{value}</div>
                  <div style={{ color: '#64748b', fontSize: '.8rem', fontWeight: 600 }}>{label}</div>
                </div>
              ))}
            </div>

            <div className="lx-card">
              <div className="lx-section-header">
                <h2>Operations priorities</h2>
                <Link to="/admin/logistics">Full admin dashboard</Link>
              </div>
              {loading && <div className="lx-loading">Loading operations metrics…</div>}
              {!loading && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  <div>
                    <h3 style={{ marginTop: 0, fontWeight: 700 }}>Immediate queues</h3>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem', color: '#475569', lineHeight: 1.8 }}>
                      <li>{summary.sourcing} sourcing requests require routing, quoting, or operator touch.</li>
                      <li>{(stats?.shipments || []).filter((row) => ['customs_hold', 'exception'].includes(row.status)).reduce((sum, row) => sum + Number(row.count || 0), 0)} shipments are in customs hold or exception posture.</li>
                      <li>{(stats?.claims || []).filter((row) => ['open', 'under_review', 'escalated'].includes(row.status)).reduce((sum, row) => sum + Number(row.count || 0), 0)} claims remain open for review.</li>
                    </ul>
                  </div>
                  <div>
                    <h3 style={{ marginTop: 0, fontWeight: 700 }}>Operator routes</h3>
                    <div style={{ display: 'grid', gap: '.65rem' }}>
                      <Link to="/admin/logistics/sourcing-ops" className="lx-link">Open sourcing intake queue →</Link>
                      <Link to="/admin/logistics/shipment-ops" className="lx-link">Open freight and milestone queue →</Link>
                      <Link to="/admin/logistics/warehouse-ops" className="lx-link">Open warehouse receipt queue →</Link>
                      <Link to="/admin/logistics/disputes" className="lx-link">Open disputes and refund review →</Link>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}

