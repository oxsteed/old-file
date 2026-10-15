import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import { useAuth } from '../../context/AuthContext';
import { adminGetStats } from '../../api/logistics';
import { canAccessOperationsWorkspace } from '../../utils/logisticsWorkspaces';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

const OPS_LINKS = [
  { labelKey: 'sourcingOps', path: '/logistics/operations/sourcing-ops', icon: '🔍' },
  { labelKey: 'organizerApprovals', path: '/logistics/operations/organizer-approvals', icon: '🧭' },
  { labelKey: 'shipmentOps', path: '/logistics/operations/shipment-ops', icon: '🚦' },
  { labelKey: 'warehouseOps', path: '/logistics/operations/warehouse-ops', icon: '🏬' },
  { labelKey: 'allocations', path: '/logistics/operations/allocations', icon: '📊' },
  { labelKey: 'disputes', path: '/logistics/operations/disputes', icon: '⚖️' },
];

/**
 * OperationsWorkspacePage - internal operations command surface (Phase 2).
 *
 * Shared LogisticsLayout for navigation; the ops sub-route tiles become a
 * compact keyboard-operable button row; KPI cards use token classes.
 * Non-operators see the shared workspace nav instead of a tile grid.
 */
export default function OperationsWorkspacePage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const { user } = useAuth();
  const isOperator = canAccessOperationsWorkspace(user);
  const isAdminOperator = user?.role === 'admin' || user?.role === 'super_admin';
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(isOperator);
  const [error, setError] = useState(false);

  const load = () => {
    if (!isOperator) return;
    setLoading(true);
    setError(false);
    adminGetStats()
      .then((res) => setStats(res.data || null))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [isOperator]);

  const summary = useMemo(() => ({
    sourcing: (stats?.sourcingRequests || []).reduce((sum, row) => sum + Number(row.count || 0), 0),
    campaigns: (stats?.pooledOrders || []).reduce((sum, row) => sum + Number(row.count || 0), 0),
    shipments: (stats?.shipments || []).reduce((sum, row) => sum + Number(row.count || 0), 0),
    claims: (stats?.claims || []).reduce((sum, row) => sum + Number(row.count || 0), 0),
    customsHold: (stats?.shipments || []).filter((row) => ['customs_hold', 'exception'].includes(row.status)).reduce((sum, row) => sum + Number(row.count || 0), 0),
    openClaims: (stats?.claims || []).filter((row) => ['open', 'under_review', 'escalated'].includes(row.status)).reduce((sum, row) => sum + Number(row.count || 0), 0),
  }), [stats]);

  return (
    <PageShell>
      <LogisticsLayout
        title={tx('logistics.operations.title', 'Operations Workspace')}
        subtitle={tx('logistics.operations.subtitle', 'One internal command surface for sourcing intake, active freight movement, warehouse flow, and logistics exceptions.')}
      >
        <div className="lx-workspaces">
          {!isOperator && (
            <div className="lx-card">
              <h2 className="lx-card-title">{tx('logistics.operations.internalOnly.title', 'Operations access is internal')}</h2>
              <p className="lx-t-small lx-t-muted" style={{ lineHeight: 1.7 }}>
                {tx('logistics.operations.internalOnly.body', 'This workspace is reserved for OxSteed logistics operators. Signed-in buyers and organizers can still use the Buyer, Organizer, Business Procurement, and Distributor workspaces to manage their own logistics activity.')}
              </p>
            </div>
          )}

          {isOperator && (
            <>
              <div className="lx-compact-links" role="navigation" aria-label={tx('logistics.operations.routesLabel', 'Operations routes')}>
                {OPS_LINKS.map((link) => (
                  <Link key={link.path} to={link.path} className="lx-action-secondary">
                    <span aria-hidden="true">{link.icon}</span> {tx(`logistics.operations.routes.${link.labelKey}`, link.labelKey)}
                  </Link>
                ))}
              </div>

              {loading && (
                <div className="lx-loading" role="status" aria-live="polite">
                  <span className="lx-spinner" aria-hidden="true" />
                  {tx('logistics.operations.loading', 'Loading operations metrics…')}
                </div>
              )}

              {!loading && error && (
                <div className="lx-data-error-banner" role="alert">
                  <div>
                    <h2>{tx('logistics.workspace.dataError.title', 'Data unavailable')}</h2>
                    <p>{tx('logistics.operations.error', "We couldn't load operations metrics right now. Please try again.")}</p>
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
                      { label: tx('logistics.operations.kpis.sourcingQueue', 'Sourcing queue'), value: summary.sourcing, icon: '🔍' },
                      { label: tx('logistics.operations.kpis.campaigns', 'Campaigns'), value: summary.campaigns, icon: '🤝' },
                      { label: tx('logistics.operations.kpis.trackedShipments', 'Tracked shipments'), value: summary.shipments, icon: '🚢' },
                      { label: tx('logistics.operations.kpis.claimsDisputes', 'Claims & disputes'), value: summary.claims, icon: '⚖️' },
                    ].map((k) => (
                      <div key={k.label} className="lx-kpi-card">
                        <div className="lx-kpi-icon" aria-hidden="true">{k.icon}</div>
                        <div className="lx-kpi-value">{k.value}</div>
                        <div className="lx-kpi-label">{k.label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="lx-card">
                    <div className="lx-section-header">
                      <h2 className="lx-section-title">{tx('logistics.operations.priorities.title', 'Operations priorities')}</h2>
                      {isAdminOperator && <Link to="/admin/logistics" className="lx-link">{tx('logistics.operations.priorities.fullAdmin', 'Full admin dashboard')}</Link>}
                    </div>
                    <div className="lx-two-col">
                      <div>
                        <h3 className="lx-t-semibold lx-t-small lx-mb-4">{tx('logistics.operations.priorities.queues', 'Immediate queues')}</h3>
                        <ul className="lx-t-small lx-t-muted" style={{ margin: 0, paddingInlineStart: '1.1rem', lineHeight: 1.8 }}>
                          <li>{tx('logistics.operations.priorities.sourcingTouch', '{{count}} sourcing requests require routing, quoting, or operator touch.', { count: summary.sourcing })}</li>
                          <li>{tx('logistics.operations.priorities.customsHold', '{{count}} shipments are in customs hold or exception posture.', { count: summary.customsHold })}</li>
                          <li>{tx('logistics.operations.priorities.openClaims', '{{count}} claims remain open for review.', { count: summary.openClaims })}</li>
                        </ul>
                      </div>
                      <div>
                        <h3 className="lx-t-semibold lx-t-small lx-mb-4">{tx('logistics.operations.priorities.operatorRoutes', 'Operator routes')}</h3>
                        <div className="lx-compact-stack">
                          <Link to="/logistics/operations/sourcing-ops" className="lx-link">{tx('logistics.operations.priorities.openSourcing', 'Open sourcing intake queue →')}</Link>
                          <Link to="/logistics/operations/shipment-ops" className="lx-link">{tx('logistics.operations.priorities.openFreight', 'Open freight and milestone queue →')}</Link>
                          <Link to="/logistics/operations/warehouse-ops" className="lx-link">{tx('logistics.operations.priorities.openWarehouse', 'Open warehouse receipt queue →')}</Link>
                          <Link to="/logistics/operations/disputes" className="lx-link">{tx('logistics.operations.priorities.openDisputes', 'Open disputes and refund review →')}</Link>
                        </div>
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
