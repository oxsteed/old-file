import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../../components/PageShell';
import { useAuth } from '../../context/AuthContext';
import { listLanes, listTradeRules, adminListRestrictions, adminListShipments } from '../../api/logistics';
import { canAccessComplianceWorkspace } from '../../utils/logisticsWorkspaces';
import '../../styles/logistics/LogisticsHomePage.css';

const RISK_COLOR = { low: '#22c55e', managed: '#f59e0b', restricted: '#ef4444', prohibited: '#7f1d1d' };

export default function ComplianceWorkspacePage() {
  const { user } = useAuth();
  const isOperator = canAccessComplianceWorkspace(user);
  const [lanes, setLanes] = useState([]);
  const [rules, setRules] = useState([]);
  const [restrictions, setRestrictions] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tasks = [listLanes(), listTradeRules()];
    if (isOperator) {
      tasks.push(adminListRestrictions({ limit: 50 }), adminListShipments({ limit: 100 }));
    }
    Promise.all(tasks)
      .then((results) => {
        setLanes(results[0].data || []);
        setRules(results[1].data || []);
        if (isOperator) {
          setRestrictions(results[2].data || []);
          setShipments(results[3].data || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOperator]);

  const riskSummary = useMemo(() => lanes.reduce((acc, lane) => {
    acc[lane.risk_tier] = (acc[lane.risk_tier] || 0) + 1;
    return acc;
  }, {}), [lanes]);

  return (
    <PageShell>
      <div className="lx-page">
        <div className="lx-page-header">
          <h1 className="lx-page-title">Compliance Workspace</h1>
          <p className="lx-page-sub">See the trade rules that gate markets, plus the internal customs-sensitive queue when you hold operator access.</p>
        </div>

        <div className="lx-nav-grid" style={{ marginBottom: '1.5rem' }}>
          <Link to="/logistics/compliance" className="lx-nav-tile"><span className="lx-nav-icon">📋</span><span className="lx-nav-label">Trade rules</span></Link>
          {isOperator && <Link to="/logistics/compliance-workspace/review" className="lx-nav-tile"><span className="lx-nav-icon">🧪</span><span className="lx-nav-label">Review queue</span></Link>}
          {isOperator && <Link to="/logistics/compliance-workspace/customs" className="lx-nav-tile"><span className="lx-nav-icon">🛃</span><span className="lx-nav-label">Customs ops</span></Link>}
          {isOperator && <Link to="/logistics/compliance-workspace/restrictions" className="lx-nav-tile"><span className="lx-nav-icon">⛔</span><span className="lx-nav-label">Restrictions</span></Link>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          {[
            ['Low-risk lanes', riskSummary.low || 0, '🟢'],
            ['Managed lanes', riskSummary.managed || 0, '🟠'],
            ['Restricted lanes', riskSummary.restricted || 0, '🔴'],
            ['Prohibited lanes', riskSummary.prohibited || 0, '⛔'],
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
            <h2 style={{ marginTop: 0 }}>Lane and market rules</h2>
            <div className="lx-table-wrap">
              <table className="lx-table">
                <thead><tr><th>Lane</th><th>Countries</th><th>Risk</th><th>Flags</th></tr></thead>
                <tbody>
                  {lanes.slice(0, 12).map((lane) => (
                    <tr key={lane.id}>
                      <td>{lane.name}</td>
                      <td>{lane.origin_country} → {lane.destination_country}</td>
                      <td><span className="lx-status-pill" style={{ background: RISK_COLOR[lane.risk_tier] || '#64748b' }}>{lane.risk_tier}</span></td>
                      <td>{[lane.requires_business_verification && 'business verification', lane.requires_manual_approval && 'manual approval'].filter(Boolean).join(' · ') || 'open'}</td>
                    </tr>
                  ))}
                  {!loading && lanes.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8' }}>No lanes available yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lx-card">
            <h2 style={{ marginTop: 0 }}>{isOperator ? 'Operator review posture' : 'Category restrictions snapshot'}</h2>
            <div className="lx-table-wrap">
              <table className="lx-table">
                <thead><tr><th>{isOperator ? 'Item' : 'Category'}</th><th>{isOperator ? 'Route / Country' : 'Country'}</th><th>Status</th><th>Risk</th></tr></thead>
                <tbody>
                  {isOperator
                    ? restrictions.slice(0, 12).map((rule) => (
                        <tr key={`r-${rule.id || `${rule.category}-${rule.country_code}`}`}>
                          <td>{rule.category}</td>
                          <td>{rule.country_code || `${rule.origin_country || '—'} → ${rule.destination_country || '—'}`}</td>
                          <td>{rule.requires_approval ? 'approval required' : 'open'}</td>
                          <td><span className="lx-status-pill" style={{ background: RISK_COLOR[rule.risk_tier] || '#64748b' }}>{rule.risk_tier}</span></td>
                        </tr>
                      ))
                    : rules.slice(0, 12).map((rule) => (
                        <tr key={`t-${rule.id || `${rule.category}-${rule.country_code}`}`}>
                          <td>{rule.category}</td>
                          <td>{rule.country_code}</td>
                          <td>{rule.requires_approval ? 'approval required' : 'open'}</td>
                          <td><span className="lx-status-pill" style={{ background: RISK_COLOR[rule.risk_tier] || '#64748b' }}>{rule.risk_tier}</span></td>
                        </tr>
                      ))}
                  {!loading && ((isOperator && restrictions.length === 0) || (!isOperator && rules.length === 0)) && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8' }}>No restrictions available.</td></tr>}
                </tbody>
              </table>
            </div>
            {isOperator && (
              <div style={{ marginTop: '1rem', color: '#475569', fontSize: '.9rem' }}>
                Customs-sensitive shipments in queue: <strong>{shipments.filter((row) => ['arrived_destination', 'customs_hold', 'exception'].includes(row.status)).length}</strong>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
