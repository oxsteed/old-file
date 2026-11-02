import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import { useAuth } from '../../context/AuthContext';
import { adminGetStats } from '../../api/logistics';
import {
  listInternalDriverPayouts,
  approveInternalDriverPayout,
  markInternalDriverPayoutPaid,
  voidInternalDriverPayout,
} from '../../api/delivery';
import { canAccessOperationsWorkspace } from '../../utils/logisticsWorkspaces';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

const PAYOUT_STATUSES = ['all', 'accrued', 'approved', 'paid', 'voided'];

/**
 * DriverPayoutsSection - ops UI for the localDelivery driver-payouts endpoints.
 * Transitions are honored exactly: accrued can be approved or voided, approved
 * can be marked paid (payment reference required) or voided, paid/voided are
 * terminal. The server enforces separation of duties (the approver cannot mark
 * paid) and fails closed on legacy rows with no recorded approver; both errors
 * surface verbatim instead of being papered over.
 */
function DriverPayoutsSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('all');
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [references, setReferences] = useState({});
  const [notes, setNotes] = useState({});

  const load = (nextStatus) => {
    setLoading(true);
    setError('');
    listInternalDriverPayouts(nextStatus === 'all' ? null : nextStatus)
      .then((data) => setPayouts(data?.payouts || []))
      .catch((err) => setError(err?.response?.data?.message || err?.message || t('logistics.operations.driverPayouts.loadFailed')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(status); }, [status]);

  const runAction = async (payout, action) => {
    const reference = (references[payout.id] || '').trim();
    if (action === 'markPaid' && !reference) {
      setError(t('logistics.operations.driverPayouts.referenceRequired'));
      return;
    }
    if (action === 'void' && !window.confirm(t('logistics.operations.driverPayouts.confirmVoid'))) {
      return;
    }
    setBusyId(payout.id);
    setError('');
    setNotice('');
    try {
      const note = (notes[payout.id] || '').trim() || undefined;
      if (action === 'approve') await approveInternalDriverPayout(payout.id, note);
      if (action === 'markPaid') await markInternalDriverPayoutPaid(payout.id, reference, note);
      if (action === 'void') await voidInternalDriverPayout(payout.id, note);
      setNotice(t(`logistics.operations.driverPayouts.${action}Done`));
      load(status);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || t('logistics.operations.driverPayouts.actionFailed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="lx-card">
      <div className="lx-section-header">
        <h2 className="lx-section-title">{t('logistics.operations.driverPayouts.title')}</h2>
        <button type="button" className="lx-btn-secondary" onClick={() => load(status)} disabled={loading} data-track="ui.4b5626a282.2">
          {t('logistics.operations.driverPayouts.refresh')}
        </button>
      </div>
      <p className="lx-t-small lx-t-muted lx-driver-payout-copy">{t('logistics.operations.driverPayouts.copy')}</p>
      <div className="lx-compact-stack" role="group" aria-label={t('logistics.operations.driverPayouts.filterLabel')}>
        {PAYOUT_STATUSES.map((value) => (
          <button
            key={value}
            type="button"
            className={status === value ? 'lx-btn-primary' : 'lx-btn-secondary'}
            onClick={() => setStatus(value)} data-track="ui.4b5626a282.3"
          >
            {t(`logistics.operations.driverPayouts.filter${value[0].toUpperCase()}${value.slice(1)}`)}
          </button>
        ))}
      </div>
      {notice && <p className="lx-t-small lx-driver-payout-notice" role="status">{notice}</p>}
      {error && <p className="lx-t-small lx-driver-payout-error" role="alert">{error}</p>}
      {loading && <p className="lx-t-small lx-t-muted">{t('logistics.operations.driverPayouts.loading')}</p>}
      {!loading && !error && payouts.length === 0 && (
        <p className="lx-t-small lx-t-muted">{t('logistics.operations.driverPayouts.empty')}</p>
      )}
      {!loading && payouts.length > 0 && (
        <div className="lx-compact-stack">
          {payouts.map((payout) => {
            const driver = [payout.first_name, payout.last_name].filter(Boolean).join(' ') || payout.driver_email || t('logistics.operations.driverPayouts.unknownDriver');
            const busy = busyId === payout.id;
            return (
              <div key={payout.id} className="lx-card lx-driver-payout-card">
                <div className="lx-section-header">
                  <strong>{driver}</strong>
                  <span className="lx-t-small lx-t-muted">{t(`logistics.operations.driverPayouts.status${payout.status[0].toUpperCase()}${payout.status.slice(1)}`)}</span>
                </div>
                <p className="lx-t-small lx-t-muted lx-driver-payout-meta">
                  {t('logistics.operations.driverPayouts.amount', { amount: (Number(payout.payout_cents || 0) / 100).toFixed(2) })}
                  {payout.job_reference ? ` · ${t('logistics.operations.driverPayouts.job', { reference: payout.job_reference })}` : ''}
                  {payout.payment_reference ? ` · ${t('logistics.operations.driverPayouts.reference', { reference: payout.payment_reference })}` : ''}
                </p>
                {(payout.status === 'approved') && (
                  <label className="lx-t-small lx-driver-payout-field">
                    {t('logistics.operations.driverPayouts.paymentReferenceLabel')}
                    <input
                      value={references[payout.id] || ''}
                      onChange={(event) => setReferences((prev) => ({ ...prev, [payout.id]: event.target.value }))}
                      placeholder={t('logistics.operations.driverPayouts.paymentReferencePlaceholder')}
                      className="lx-driver-payout-input"
                    />
                  </label>
                )}
                {(payout.status === 'accrued' || payout.status === 'approved') && (
                  <label className="lx-t-small lx-driver-payout-field">
                    {t('logistics.operations.driverPayouts.noteLabel')}
                    <input
                      value={notes[payout.id] || ''}
                      onChange={(event) => setNotes((prev) => ({ ...prev, [payout.id]: event.target.value }))}
                      placeholder={t('logistics.operations.driverPayouts.notePlaceholder')}
                      className="lx-driver-payout-input"
                    />
                  </label>
                )}
                <div className="lx-compact-stack lx-driver-payout-actions">
                  {payout.status === 'accrued' && (
                    <>
                      <button type="button" className="lx-btn-primary" onClick={() => runAction(payout, 'approve')} disabled={busy} data-track="ui.4b5626a282.4">
                        {t('logistics.operations.driverPayouts.approve')}
                      </button>
                      <button type="button" className="lx-btn-secondary" onClick={() => runAction(payout, 'void')} disabled={busy} data-track="ui.4b5626a282.5">
                        {t('logistics.operations.driverPayouts.void')}
                      </button>
                    </>
                  )}
                  {payout.status === 'approved' && (
                    <>
                      <button type="button" className="lx-btn-primary" onClick={() => runAction(payout, 'markPaid')} disabled={busy} data-track="ui.4b5626a282.6">
                        {t('logistics.operations.driverPayouts.markPaid')}
                      </button>
                      <button type="button" className="lx-btn-secondary" onClick={() => runAction(payout, 'void')} disabled={busy} data-track="ui.4b5626a282.7">
                        {t('logistics.operations.driverPayouts.void')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const OPS_LINKS = [
  {labelKey:'finance',path:'/logistics/operations/finance',icon:'📋'},
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
                  <button type="button" className="lx-btn-secondary" onClick={load} data-track="ui.4b5626a282.1">
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

                  <DriverPayoutsSection />
                </>
              )}
            </>
          )}
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
