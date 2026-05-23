import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../../components/PageShell';
import { useAuth } from '../../context/AuthContext';
import { adminGetStats, adminListMarkupRules, adminListFeeRules, adminListRestrictions } from '../../api/logistics';
import '../../styles/logistics/LogisticsHomePage.css';

export default function AdminControlWorkspacePage() {
  const { user } = useAuth();
  const isOperator = user?.role === 'admin' || user?.role === 'super_admin';
  const isSuperAdmin = user?.role === 'super_admin';
  const [stats, setStats] = useState(null);
  const [markupRules, setMarkupRules] = useState([]);
  const [feeRules, setFeeRules] = useState([]);
  const [restrictions, setRestrictions] = useState([]);
  const [loading, setLoading] = useState(isOperator);

  useEffect(() => {
    if (!isOperator) return;
    Promise.all([
      adminGetStats(),
      adminListMarkupRules(),
      adminListFeeRules(),
      adminListRestrictions({ limit: 50 }),
    ])
      .then(([statsRes, markupRes, feeRes, restrictionRes]) => {
        setStats(statsRes.data || null);
        setMarkupRules(markupRes.data || []);
        setFeeRules(feeRes.data || []);
        setRestrictions(restrictionRes.data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOperator]);

  const profitabilitySignals = useMemo(() => ({
    purchaseOrders: (stats?.purchaseOrders || []).reduce((sum, row) => sum + Number(row.count || 0), 0),
    shipments: (stats?.shipments || []).reduce((sum, row) => sum + Number(row.count || 0), 0),
    claims: (stats?.claims || []).reduce((sum, row) => sum + Number(row.count || 0), 0),
  }), [stats]);

  return (
    <PageShell>
      <div className="lx-page">
        <div className="lx-page-header">
          <h1 className="lx-page-title">Admin / Super Admin Control</h1>
          <p className="lx-page-sub">Pricing, risk, approvals, and profitability controls for the full OxSteed Logistics branch.</p>
        </div>

        {!isOperator && (
          <div className="lx-card">
            <h2 style={{ marginTop: 0 }}>Control access is restricted</h2>
            <p style={{ color: '#64748b', lineHeight: 1.7 }}>
              Pricing rules, market restrictions, and logistics-wide overrides are only available to OxSteed admins and super admins.
            </p>
            <Link to="/logistics" className="lx-btn-primary">Return to Logistics hub</Link>
          </div>
        )}

        {isOperator && (
          <>
            <div className="lx-nav-grid" style={{ marginBottom: '1.5rem' }}>
              <Link to="/admin/logistics" className="lx-nav-tile"><span className="lx-nav-icon">⚙️</span><span className="lx-nav-label">Admin dashboard</span></Link>
              <Link to="/admin/logistics/pricing" className="lx-nav-tile"><span className="lx-nav-icon">💰</span><span className="lx-nav-label">Pricing rules</span></Link>
              <Link to="/admin/logistics/restrictions" className="lx-nav-tile"><span className="lx-nav-icon">⛔</span><span className="lx-nav-label">Restrictions</span></Link>
              <Link to="/admin/logistics/suppliers" className="lx-nav-tile"><span className="lx-nav-icon">🏭</span><span className="lx-nav-label">Supplier approvals</span></Link>
              {isSuperAdmin && <Link to="/admin/logistics/control" className="lx-nav-tile"><span className="lx-nav-icon">👑</span><span className="lx-nav-label">Super control</span></Link>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              {[
                ['Markup rules', markupRules.length, '📈'],
                ['Fee rules', feeRules.length, '🧮'],
                ['Restrictions', restrictions.length, '🛡️'],
                ['Tracked POs', profitabilitySignals.purchaseOrders, '📦'],
                ['Tracked shipments', profitabilitySignals.shipments, '🚢'],
                ['Claims posture', profitabilitySignals.claims, '⚖️'],
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
                <h2 style={{ marginTop: 0 }}>Pricing and fee posture</h2>
                <div className="lx-table-wrap">
                  <table className="lx-table">
                    <thead><tr><th>Type</th><th>Name</th><th>Status</th></tr></thead>
                    <tbody>
                      {markupRules.slice(0, 6).map((rule) => (
                        <tr key={`m-${rule.id}`}>
                          <td>Markup</td>
                          <td>{rule.name || rule.scope || `Rule ${rule.id}`}</td>
                          <td>{rule.is_active === false ? 'inactive' : 'active'}</td>
                        </tr>
                      ))}
                      {feeRules.slice(0, 6).map((rule) => (
                        <tr key={`f-${rule.id}`}>
                          <td>Fee</td>
                          <td>{rule.name || rule.scope || `Rule ${rule.id}`}</td>
                          <td>{rule.is_active === false ? 'inactive' : 'active'}</td>
                        </tr>
                      ))}
                      {!loading && markupRules.length === 0 && feeRules.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: '#94a3b8' }}>No pricing rules found.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="lx-card">
                <h2 style={{ marginTop: 0 }}>Restriction and risk controls</h2>
                <div className="lx-table-wrap">
                  <table className="lx-table">
                    <thead><tr><th>Category</th><th>Country</th><th>Risk</th></tr></thead>
                    <tbody>
                      {restrictions.slice(0, 10).map((rule) => (
                        <tr key={rule.id || `${rule.category}-${rule.country_code}`}>
                          <td>{rule.category}</td>
                          <td>{rule.country_code || `${rule.origin_country || '—'} → ${rule.destination_country || '—'}`}</td>
                          <td>{rule.risk_tier}</td>
                        </tr>
                      ))}
                      {!loading && restrictions.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: '#94a3b8' }}>No restrictions configured.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
