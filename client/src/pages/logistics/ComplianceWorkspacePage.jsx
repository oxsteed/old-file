import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/PageShell';
import { useAuth } from '../../context/AuthContext';
import { listLanes, listTradeRules, adminListRestrictions, adminListShipments } from '../../api/logistics';
import { canAccessComplianceWorkspace } from '../../utils/logisticsWorkspaces';
import '../../styles/logistics/LogisticsHomePage.css';

const RISK_COLOR = { low: '#22c55e', managed: '#f59e0b', restricted: '#ef4444', prohibited: '#7f1d1d' };

export default function ComplianceWorkspacePage() {
  const { t } = useTranslation();
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
          <h1 className="lx-page-title">{t('logistics.complianceWorkspace.title')}</h1>
          <p className="lx-page-sub">{t('logistics.complianceWorkspace.subtitle')}</p>
        </div>

        <div className="lx-nav-grid" style={{ marginBottom: '1.5rem' }}>
          <Link to="/logistics/compliance" className="lx-nav-tile"><span className="lx-nav-icon">📋</span><span className="lx-nav-label">{t('logistics.complianceWorkspace.nav.tradeRules')}</span></Link>
          {isOperator && <Link to="/logistics/compliance-workspace/review" className="lx-nav-tile"><span className="lx-nav-icon">🧪</span><span className="lx-nav-label">{t('logistics.complianceWorkspace.nav.reviewQueue')}</span></Link>}
          {isOperator && <Link to="/logistics/compliance-workspace/customs" className="lx-nav-tile"><span className="lx-nav-icon">🛃</span><span className="lx-nav-label">{t('logistics.complianceWorkspace.nav.customsOps')}</span></Link>}
          {isOperator && <Link to="/logistics/compliance-workspace/restrictions" className="lx-nav-tile"><span className="lx-nav-icon">⛔</span><span className="lx-nav-label">{t('logistics.complianceWorkspace.nav.restrictions')}</span></Link>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          {[
            [t('logistics.complianceWorkspace.kpis.lowRisk'), riskSummary.low || 0, '🟢'],
            [t('logistics.complianceWorkspace.kpis.managed'), riskSummary.managed || 0, '🟠'],
            [t('logistics.complianceWorkspace.kpis.restricted'), riskSummary.restricted || 0, '🔴'],
            [t('logistics.complianceWorkspace.kpis.prohibited'), riskSummary.prohibited || 0, '⛔'],
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
            <h2 style={{ marginTop: 0 }}>{t('logistics.complianceWorkspace.cardTitleLaneMarketRules')}</h2>
            <div className="lx-table-wrap">
              <table className="lx-table">
                <thead>
                  <tr>
                    <th>{t('logistics.complianceWorkspace.tableHeaders.lane')}</th>
                    <th>{t('logistics.complianceWorkspace.tableHeaders.countries')}</th>
                    <th>{t('logistics.complianceWorkspace.tableHeaders.risk')}</th>
                    <th>{t('logistics.complianceWorkspace.tableHeaders.flags')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lanes.slice(0, 12).map((lane) => (
                    <tr key={lane.id}>
                      <td>{lane.name}</td>
                      <td>{lane.origin_country} → {lane.destination_country}</td>
                      <td>
                        <span className="lx-status-pill" style={{ background: RISK_COLOR[lane.risk_tier] || '#64748b' }}>
                          {t(`logistics.complianceWorkspace.risk.${lane.risk_tier}`, { defaultValue: lane.risk_tier })}
                        </span>
                      </td>
                      <td>
                        {[lane.requires_business_verification && t('logistics.complianceWorkspace.flags.businessVerification'), lane.requires_manual_approval && t('logistics.complianceWorkspace.flags.manualApproval')].filter(Boolean).join(` ${t('logistics.complianceWorkspace.separator')} `) || t('logistics.complianceWorkspace.flags.open')}
                      </td>
                    </tr>
                  ))}
                  {!loading && lanes.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8' }}>{t('logistics.complianceWorkspace.empty.noLanes')}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lx-card">
            <h2 style={{ marginTop: 0 }}>{isOperator ? t('logistics.complianceWorkspace.cardTitleOperator') : t('logistics.complianceWorkspace.cardTitleCategoryRestrictions')}</h2>
            <div className="lx-table-wrap">
              <table className="lx-table">
                <thead>
                  <tr>
                    <th>{isOperator ? t('logistics.complianceWorkspace.tableHeaders.item') : t('logistics.complianceWorkspace.tableHeaders.category')}</th>
                    <th>{isOperator ? t('logistics.complianceWorkspace.tableHeaders.routeOrCountry') : t('logistics.complianceWorkspace.tableHeaders.country')}</th>
                    <th>{t('logistics.complianceWorkspace.tableHeaders.status')}</th>
                    <th>{t('logistics.complianceWorkspace.tableHeaders.risk')}</th>
                  </tr>
                </thead>
                <tbody>
                  {isOperator
                    ? restrictions.slice(0, 12).map((rule) => (
                        <tr key={`r-${rule.id || `${rule.category}-${rule.country_code}`}`}>
                          <td>{rule.category}</td>
                          <td>{rule.country_code || `${rule.origin_country || '—'} → ${rule.destination_country || '—'}`}</td>
                          <td>{rule.requires_approval ? t('logistics.complianceWorkspace.status.approvalRequired') : t('logistics.complianceWorkspace.flags.open')}</td>
                          <td><span className="lx-status-pill" style={{ background: RISK_COLOR[rule.risk_tier] || '#64748b' }}>{t(`logistics.complianceWorkspace.risk.${rule.risk_tier}`, { defaultValue: rule.risk_tier })}</span></td>
                        </tr>
                      ))
                    : rules.slice(0, 12).map((rule) => (
                        <tr key={`t-${rule.id || `${rule.category}-${rule.country_code}`}`}>
                          <td>{rule.category}</td>
                          <td>{rule.country_code}</td>
                          <td>{rule.requires_approval ? t('logistics.complianceWorkspace.status.approvalRequired') : t('logistics.complianceWorkspace.flags.open')}</td>
                          <td><span className="lx-status-pill" style={{ background: RISK_COLOR[rule.risk_tier] || '#64748b' }}>{t(`logistics.complianceWorkspace.risk.${rule.risk_tier}`, { defaultValue: rule.risk_tier })}</span></td>
                        </tr>
                      ))}
                  {!loading && ((isOperator && restrictions.length === 0) || (!isOperator && rules.length === 0)) && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8' }}>{t('logistics.complianceWorkspace.empty.noRestrictions')}</td></tr>}
                </tbody>
              </table>
            </div>
            {isOperator && (
              <div style={{ marginTop: '1rem', color: '#475569', fontSize: '.9rem' }}>
                {t('logistics.complianceWorkspace.queueLabel')}
                : <strong>{shipments.filter((row) => ['arrived_destination', 'customs_hold', 'exception'].includes(row.status)).length}</strong>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
