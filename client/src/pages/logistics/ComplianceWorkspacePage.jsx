import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import { useAuth } from '../../context/AuthContext';
import { listLanes, listTradeRules, adminListRestrictions, adminListShipments } from '../../api/logistics';
import { canAccessComplianceWorkspace } from '../../utils/logisticsWorkspaces';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

/**
 * ComplianceWorkspacePage - internal compliance command surface (Phase 2).
 *
 * Shared LogisticsLayout for navigation (the sub-route tiles become a
 * compact button row); KPI cards and tables use token classes; risk pills
 * use the shared theme-token component. Copy keeps the existing
 * logistics.complianceWorkspace.* keys.
 */
export default function ComplianceWorkspacePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isOperator = canAccessComplianceWorkspace(user);
  const [lanes, setLanes] = useState([]);
  const [rules, setRules] = useState([]);
  const [restrictions, setRestrictions] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
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
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [isOperator]);

  const riskSummary = useMemo(() => lanes.reduce((acc, lane) => {
    acc[lane.risk_tier] = (acc[lane.risk_tier] || 0) + 1;
    return acc;
  }, {}), [lanes]);

  const reviewQueueCount = shipments.filter((row) => ['arrived_destination', 'customs_hold', 'exception'].includes(row.status)).length;

  return (
    <PageShell>
      <LogisticsLayout
        title={t('logistics.complianceWorkspace.title')}
        subtitle={t('logistics.complianceWorkspace.subtitle')}
      >
        <div className="lx-workspaces">
          <div className="lx-compact-links" role="navigation" aria-label={t('logistics.complianceWorkspace.navLabel', 'Compliance sections')}>
            <Link to="/logistics/compliance" className="lx-action-secondary">
              <span aria-hidden="true">📋</span> {t('logistics.complianceWorkspace.nav.tradeRules')}
            </Link>
            {isOperator && (
              <>
                <Link to="/logistics/compliance-workspace/review" className="lx-action-secondary">
                  <span aria-hidden="true">🧪</span> {t('logistics.complianceWorkspace.nav.reviewQueue')}
                </Link>
                <Link to="/logistics/compliance-workspace/customs" className="lx-action-secondary">
                  <span aria-hidden="true">🛃</span> {t('logistics.complianceWorkspace.nav.customsOps')}
                </Link>
                <Link to="/logistics/compliance-workspace/restrictions" className="lx-action-secondary">
                  <span aria-hidden="true">⛔</span> {t('logistics.complianceWorkspace.nav.restrictions')}
                </Link>
              </>
            )}
          </div>

          {loading && (
            <div className="lx-loading" role="status" aria-live="polite">
              <span className="lx-spinner" aria-hidden="true" />
              {t('logistics.modal.loading')}
            </div>
          )}

          {!loading && error && (
            <div className="lx-data-error-banner" role="alert">
              <div>
                <h2>{t('logistics.workspace.dataError.title')}</h2>
                <p>{t('logistics.workspace.dataError.body')}</p>
              </div>
              <button type="button" className="lx-btn-secondary" onClick={load}>
                {t('logistics.workspace.dataError.retry')}
              </button>
            </div>
          )}

          {!loading && !error && (
            <>
              <div className="lx-kpi-grid">
                {[
                  { label: t('logistics.complianceWorkspace.kpis.lowRisk'), value: riskSummary.low || 0, icon: '🟢' },
                  { label: t('logistics.complianceWorkspace.kpis.managed'), value: riskSummary.managed || 0, icon: '🟠' },
                  { label: t('logistics.complianceWorkspace.kpis.restricted'), value: riskSummary.restricted || 0, icon: '🔴' },
                  { label: t('logistics.complianceWorkspace.kpis.prohibited'), value: riskSummary.prohibited || 0, icon: '⛔' },
                ].map((k) => (
                  <div key={k.label} className="lx-kpi-card">
                    <div className="lx-kpi-icon" aria-hidden="true">{k.icon}</div>
                    <div className="lx-kpi-value">{k.value}</div>
                    <div className="lx-kpi-label">{k.label}</div>
                  </div>
                ))}
              </div>

              <div className="lx-two-col">
                <div className="lx-card">
                  <h2 className="lx-card-title lx-mb-4">{t('logistics.complianceWorkspace.cardTitleLaneMarketRules')}</h2>
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
                            <td><LogisticsStatusPill status={lane.risk_tier} /></td>
                            <td>
                              {[lane.requires_business_verification && t('logistics.complianceWorkspace.flags.businessVerification'), lane.requires_manual_approval && t('logistics.complianceWorkspace.flags.manualApproval')].filter(Boolean).join(` ${t('logistics.complianceWorkspace.separator')} `) || t('logistics.complianceWorkspace.flags.open')}
                            </td>
                          </tr>
                        ))}
                        {lanes.length === 0 && <tr><td colSpan={4} className="lx-table-empty-cell">{t('logistics.complianceWorkspace.empty.noLanes')}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="lx-card">
                  <h2 className="lx-card-title lx-mb-4">{isOperator ? t('logistics.complianceWorkspace.cardTitleOperator') : t('logistics.complianceWorkspace.cardTitleCategoryRestrictions')}</h2>
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
                              <td><LogisticsStatusPill status={rule.risk_tier} /></td>
                            </tr>
                          ))
                          : rules.slice(0, 12).map((rule) => (
                            <tr key={`t-${rule.id || `${rule.category}-${rule.country_code}`}`}>
                              <td>{rule.category}</td>
                              <td>{rule.country_code}</td>
                              <td>{rule.requires_approval ? t('logistics.complianceWorkspace.status.approvalRequired') : t('logistics.complianceWorkspace.flags.open')}</td>
                              <td><LogisticsStatusPill status={rule.risk_tier} /></td>
                            </tr>
                          ))}
                        {((isOperator && restrictions.length === 0) || (!isOperator && rules.length === 0)) && <tr><td colSpan={4} className="lx-table-empty-cell">{t('logistics.complianceWorkspace.empty.noRestrictions')}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  {isOperator && (
                    <div className="lx-t-small lx-t-muted lx-mt-6">
                      {t('logistics.complianceWorkspace.queueLabel')}
                      : <strong>{reviewQueueCount}</strong>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
