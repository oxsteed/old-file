import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import { useAuth } from '../../context/AuthContext';
import { adminGetStats, adminListMarkupRules, adminListFeeRules, adminListRestrictions } from '../../api/logistics';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

/**
 * AdminControlWorkspacePage - admin/super-admin control surface (Phase 2).
 *
 * Shared LogisticsLayout for navigation; the admin sub-route tiles become
 * a compact keyboard-operable button row; KPI cards and tables use token
 * classes. All copy is localized under logistics.adminControl.*.
 */
export default function AdminControlWorkspacePage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const { user } = useAuth();
  const isOperator = user?.role === 'admin' || user?.role === 'super_admin';
  const isSuperAdmin = user?.role === 'super_admin';
  const [stats, setStats] = useState(null);
  const [markupRules, setMarkupRules] = useState([]);
  const [feeRules, setFeeRules] = useState([]);
  const [restrictions, setRestrictions] = useState([]);
  const [loading, setLoading] = useState(isOperator);
  const [error, setError] = useState(false);

  const load = () => {
    if (!isOperator) return;
    setLoading(true);
    setError(false);
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
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [isOperator]);

  const profitabilitySignals = useMemo(() => ({
    purchaseOrders: (stats?.purchaseOrders || []).reduce((sum, row) => sum + Number(row.count || 0), 0),
    shipments: (stats?.shipments || []).reduce((sum, row) => sum + Number(row.count || 0), 0),
    claims: (stats?.claims || []).reduce((sum, row) => sum + Number(row.count || 0), 0),
  }), [stats]);

  return (
    <PageShell>
      <LogisticsLayout
        title={tx('logistics.adminControl.title', 'Admin / Super Admin Control')}
        subtitle={tx('logistics.adminControl.subtitle', 'Pricing, risk, approvals, and profitability controls for the full OxSteed Logistics branch.')}
      >
        <div className="lx-workspaces">
          {!isOperator && (
            <div className="lx-card">
              <h2 className="lx-card-title">{tx('logistics.adminControl.restricted.title', 'Control access is restricted')}</h2>
              <p className="lx-t-small lx-t-muted" style={{ lineHeight: 1.7 }}>
                {tx('logistics.adminControl.restricted.body', 'Pricing rules, market restrictions, and logistics-wide overrides are only available to OxSteed admins and super admins.')}
              </p>
              <div className="lx-btn-row">
                <Link to="/logistics" className="lx-btn-primary lx-next-step-action">
                  {tx('logistics.adminControl.restricted.returnToHub', 'Return to Logistics hub')}
                </Link>
              </div>
            </div>
          )}

          {isOperator && (
            <>
              <div className="lx-compact-links" role="navigation" aria-label={tx('logistics.adminControl.routesLabel', 'Admin control routes')}>
                <Link to="/admin/logistics" className="lx-action-secondary"><span aria-hidden="true">⚙️</span> {tx('logistics.adminControl.routes.adminDashboard', 'Admin dashboard')}</Link>
                <Link to="/admin/logistics/pricing" className="lx-action-secondary"><span aria-hidden="true">💰</span> {tx('logistics.adminControl.routes.pricingRules', 'Pricing rules')}</Link>
                <Link to="/admin/logistics/restrictions" className="lx-action-secondary"><span aria-hidden="true">⛔</span> {tx('logistics.adminControl.routes.restrictions', 'Restrictions')}</Link>
                <Link to="/admin/logistics/suppliers" className="lx-action-secondary"><span aria-hidden="true">🏭</span> {tx('logistics.adminControl.routes.supplierApprovals', 'Supplier approvals')}</Link>
                {isSuperAdmin && (
                  <Link to="/admin/logistics/control" className="lx-action-secondary"><span aria-hidden="true">👑</span> {tx('logistics.adminControl.routes.superControl', 'Super control')}</Link>
                )}
              </div>

              {loading && (
                <div className="lx-loading" role="status" aria-live="polite">
                  <span className="lx-spinner" aria-hidden="true" />
                  {tx('logistics.modal.loading', 'Loading…')}
                </div>
              )}

              {!loading && error && (
                <div className="lx-data-error-banner" role="alert">
                  <div>
                    <h2>{tx('logistics.workspace.dataError.title', 'Data unavailable')}</h2>
                    <p>{tx('logistics.adminControl.error', "We couldn't load control metrics right now. Please try again.")}</p>
                  </div>
                  <button type="button" className="lx-btn-secondary" onClick={load}>
                    {tx('logistics.workspace.dataError.retry', 'Try again')}
                  </button>
                </div>
              )}

              {!loading && !error && (
                <>
                  <div className="lx-kpi-grid">
                    {[
                      { label: tx('logistics.adminControl.kpis.markupRules', 'Markup rules'), value: markupRules.length, icon: '📈' },
                      { label: tx('logistics.adminControl.kpis.feeRules', 'Fee rules'), value: feeRules.length, icon: '🧮' },
                      { label: tx('logistics.adminControl.kpis.restrictions', 'Restrictions'), value: restrictions.length, icon: '🛡️' },
                      { label: tx('logistics.adminControl.kpis.trackedPOs', 'Tracked POs'), value: profitabilitySignals.purchaseOrders, icon: '📦' },
                      { label: tx('logistics.adminControl.kpis.trackedShipments', 'Tracked shipments'), value: profitabilitySignals.shipments, icon: '🚢' },
                      { label: tx('logistics.adminControl.kpis.claimsPosture', 'Claims posture'), value: profitabilitySignals.claims, icon: '⚖️' },
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
                      <h2 className="lx-card-title lx-mb-4">{tx('logistics.adminControl.pricing.title', 'Pricing and fee posture')}</h2>
                      <div className="lx-table-wrap">
                        <table className="lx-table">
                          <thead>
                            <tr>
                              <th>{tx('logistics.adminControl.pricing.headers.type', 'Type')}</th>
                              <th>{tx('logistics.adminControl.pricing.headers.name', 'Name')}</th>
                              <th>{tx('logistics.adminControl.pricing.headers.status', 'Status')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {markupRules.slice(0, 6).map((rule) => (
                              <tr key={`m-${rule.id}`}>
                                <td>{tx('logistics.adminControl.pricing.markup', 'Markup')}</td>
                                <td>{rule.name || rule.scope || tx('logistics.adminControl.pricing.ruleFallback', 'Rule {{id}}', { id: rule.id })}</td>
                                <td><LogisticsStatusPill status={rule.is_active === false ? 'paused' : 'active'} label={rule.is_active === false ? tx('logistics.adminControl.pricing.inactive', 'inactive') : tx('logistics.adminControl.pricing.active', 'active')} /></td>
                              </tr>
                            ))}
                            {feeRules.slice(0, 6).map((rule) => (
                              <tr key={`f-${rule.id}`}>
                                <td>{tx('logistics.adminControl.pricing.fee', 'Fee')}</td>
                                <td>{rule.name || rule.scope || tx('logistics.adminControl.pricing.ruleFallback', 'Rule {{id}}', { id: rule.id })}</td>
                                <td><LogisticsStatusPill status={rule.is_active === false ? 'paused' : 'active'} label={rule.is_active === false ? tx('logistics.adminControl.pricing.inactive', 'inactive') : tx('logistics.adminControl.pricing.active', 'active')} /></td>
                              </tr>
                            ))}
                            {markupRules.length === 0 && feeRules.length === 0 && (
                              <tr><td colSpan={3} className="lx-table-empty-cell">{tx('logistics.adminControl.pricing.empty', 'No pricing rules found.')}</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="lx-card">
                      <h2 className="lx-card-title lx-mb-4">{tx('logistics.adminControl.restrictions.title', 'Restriction and risk controls')}</h2>
                      <div className="lx-table-wrap">
                        <table className="lx-table">
                          <thead>
                            <tr>
                              <th>{tx('logistics.adminControl.restrictions.headers.category', 'Category')}</th>
                              <th>{tx('logistics.adminControl.restrictions.headers.country', 'Country')}</th>
                              <th>{tx('logistics.adminControl.restrictions.headers.risk', 'Risk')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {restrictions.slice(0, 10).map((rule) => (
                              <tr key={rule.id || `${rule.category}-${rule.country_code}`}>
                                <td>{rule.category}</td>
                                <td>{rule.country_code || `${rule.origin_country || '—'} → ${rule.destination_country || '—'}`}</td>
                                <td><LogisticsStatusPill status={rule.risk_tier} /></td>
                              </tr>
                            ))}
                            {restrictions.length === 0 && (
                              <tr><td colSpan={3} className="lx-table-empty-cell">{tx('logistics.adminControl.restrictions.empty', 'No restrictions configured.')}</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
