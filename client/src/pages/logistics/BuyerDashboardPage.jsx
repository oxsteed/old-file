import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listSourcingRequests, listOrders, listShipments, listAllocations, listDeliveries, listMyClaims, listRefundCases, getDashboardCounts } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import WorkspaceOverviewStrip, { WorkspaceDataErrorBanner } from '../../components/logistics/LogisticsWorkspacePanels';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

/**
 * BuyerDashboardPage - buyer workspace overview (Phase 2 refactor).
 *
 * Uses the shared LogisticsLayout (compact permission-aware nav) instead of
 * the old workspace tile grid, the shared overview strip (one clear next
 * step + recent activity), and theme-token status pills. Data errors render
 * a retryable banner; zero activity renders an explicit empty state.
 */
export default function BuyerDashboardPage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [state, setState] = useState({
    requests: [], orders: [], shipments: [], allocations: [], deliveries: [], claims: [], refunds: [],
    loading: true, loadError: false,
  });
  // Authoritative workspace metrics. Headline counts must never be derived
  // from the `limit: N` list responses above: those undercount as soon as
  // the user has more rows than the page size.
  const [counts, setCounts] = useState(null);
  const [countsError, setCountsError] = useState(false);

  const load = () => {
    setState((s) => ({ ...s, loading: true, loadError: false }));
    setCountsError(false);
    // Counts resolve independently of the row lists so that a list-level
    // failure (e.g. a capability-gated endpoint) never turns the headline
    // metrics into misleading zeros.
    getDashboardCounts('buyer')
      .then((r) => {
        if (r && r.counts) setCounts(r.counts);
        else setCountsError(true);
      })
      .catch(() => setCountsError(true));
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
          loadError: false,
        });
      })
      .catch(() => setState((s) => ({ ...s, loading: false, loadError: true })));
  };

  useEffect(() => { load(); }, []);

  // Authoritative metrics come from the counts endpoint. The list-derived
  // values below are only a transient fallback while counts load; once
  // counts resolve they always win, and on a counts error the metrics
  // render as unavailable ('—'), never as misleading zeros.
  const listActiveRequests = state.requests.filter((request) => !['fulfilled', 'closed', 'cancelled'].includes(request.status)).length;
  const listAtRiskShipments = state.shipments.filter((shipment) => ['customs_review', 'exception', 'customs_hold'].includes(shipment.status)).length;
  const listPendingAllocations = state.allocations.filter((allocation) => allocation.status !== 'released').length;
  const listOpenIssues = state.claims.length + state.refunds.length;

  const activeRequests = counts ? counts.activeRequests : listActiveRequests;
  const atRiskShipments = counts ? counts.atRiskShipments : listAtRiskShipments;
  const pendingAllocations = counts ? counts.pendingAllocations : listPendingAllocations;
  const openIssues = counts ? (counts.activeClaims + counts.refundCases) : listOpenIssues;
  const totalRequests = counts ? counts.totalRequests : state.requests.length;
  const totalShipments = counts ? counts.totalShipments : state.shipments.length;
  const metricValue = (value) => (counts ? value : '—');
  const latestDeliveryDate = state.deliveries
    .map((delivery) => delivery.scheduled_date || delivery.created_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  // While counts are loading or unavailable, notes say so instead of
  // describing possibly-capped list derivations.
  const unavailableNote = t('logistics.buyer.metrics.unavailableNote');
  const metrics = [
    {
      label: tx('logistics.buyer.metrics.activeRequests.label', 'Active requests'),
      value: metricValue(activeRequests),
      icon: '🔍',
      note: counts
        ? tx('logistics.buyer.metrics.activeRequests.note', '{{total}} total buyer requests in motion', { total: totalRequests })
        : unavailableNote,
    },
    {
      label: tx('logistics.buyer.metrics.watchShipments.label', 'Watch shipments'),
      value: metricValue(totalShipments),
      icon: '🚢',
      note: !counts
        ? unavailableNote
        : atRiskShipments
          ? tx('logistics.buyer.metrics.watchShipments.noteRisk', '{{count}} need exception follow-up', { count: atRiskShipments })
          : tx('logistics.buyer.metrics.watchShipments.noteClear', 'No shipment exceptions flagged right now'),
    },
    {
      label: tx('logistics.buyer.metrics.pendingAllocations.label', 'Pending allocations'),
      value: metricValue(pendingAllocations),
      icon: '📦',
      note: !counts
        ? unavailableNote
        : pendingAllocations
          ? tx('logistics.buyer.metrics.pendingAllocations.notePending', 'Stock is assigned but not fully released yet')
          : tx('logistics.buyer.metrics.pendingAllocations.noteClear', 'Allocation queue is clear'),
    },
    {
      label: tx('logistics.buyer.metrics.claimsRefunds.label', 'Claims & refunds'),
      value: metricValue(openIssues),
      icon: '🛟',
      note: !counts
        ? unavailableNote
        : openIssues
          ? tx('logistics.buyer.metrics.claimsRefunds.noteOpen', 'Operator review may be needed on open issues')
          : tx('logistics.buyer.metrics.claimsRefunds.noteClear', 'No active buyer issues'),
    },
  ];

  // One clear next step, driven by workspace state. Suppressed while any
  // data source failed: the banner explains, and we never advise from
  // misleading numbers.
  const nextStep = (state.loadError || countsError)
    ? null
    : activeRequests === 0
      ? {
          kind: 'link',
          href: '/logistics/campaigns',
          label: tx('logistics.workspace.buyer.nextStep.browseCampaigns.label', 'Browse campaigns'),
          hint: tx(
            'logistics.workspace.buyer.nextStep.browseCampaigns.hint',
            'No active buyer requests. Find a pooled campaign to join or watch.'
          ),
        }
      : atRiskShipments > 0
        ? {
            kind: 'link',
            href: '/logistics/shipments',
            label: tx('logistics.workspace.buyer.nextStep.reviewShipments.label', 'Review at-risk shipments'),
            hint: tx(
              'logistics.workspace.buyer.nextStep.reviewShipments.hint',
              '{{count}} shipments need buyer follow-up.',
              { count: atRiskShipments }
            ),
          }
        : {
            kind: 'link',
            href: '/logistics/requests/new',
            label: tx('logistics.workspace.buyer.nextStep.startRequest.label', 'Start a sourcing request'),
            hint: tx(
              'logistics.workspace.buyer.nextStep.startRequest.hint',
              'Everything is moving. Open new demand when you are ready.'
            ),
          };

  const recentActivity = [
    ...state.requests.map((row) => ({
      key: `request-${row.id}`,
      label: row.title,
      href: `/logistics/requests/${row.id}`,
      date: row.created_at || row.updated_at,
    })),
    ...state.shipments.map((row) => ({
      key: `shipment-${row.id}`,
      label: row.reference,
      href: `/logistics/shipments/${row.id}`,
      date: row.updated_at || row.created_at,
    })),
    ...state.claims.map((row) => ({
      key: `claim-${row.id}`,
      label: row.reference || tx('logistics.buyer.activity.claimFallback', 'Claim #{{id}}', { id: row.id }),
      href: '/logistics/finance',
      date: row.created_at || row.updated_at,
    })),
  ]
    .filter((item) => item.date && !Number.isNaN(new Date(item.date).getTime()))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  return (
    <PageShell>
      <LogisticsLayout
        title={tx('logistics.buyer.title', 'Buyer Dashboard')}
        subtitle={tx('logistics.buyer.subtitle', 'Source product demand, watch freight movement, and stay ahead of claims, refunds, and delivery release risk from one buyer control center.')}
        actions={
          <>
            <Link to="/logistics/requests/new" className="lx-btn-primary lx-next-step-action">
              {tx('logistics.buyer.actions.startRequest', 'Start a sourcing request')}
            </Link>
            <Link to="/logistics/shipments" className="lx-action-ghost">
              {tx('logistics.buyer.actions.watchShipments', 'Watch shipment timeline')}
            </Link>
          </>
        }
      >
        <div className="lx-workspaces">
          <div className="lx-dashboard-hero">
            <div className="lx-card lx-dashboard-hero-main">
              <div className="lx-dashboard-kicker">{tx('logistics.buyer.kicker', 'Buyer workspace')}</div>
              <h2 className="lx-page-title">{tx('logistics.buyer.title', 'Buyer Dashboard')}</h2>
              <p className="lx-page-sub">{tx('logistics.buyer.subtitle', 'Source product demand, watch freight movement, and stay ahead of claims, refunds, and delivery release risk from one buyer control center.')}</p>
              <div className="lx-dashboard-stat-grid">
                <div className="lx-dashboard-stat">
                  <div className="lx-dashboard-stat-value">{metricValue(activeRequests)}</div>
                  <div className="lx-dashboard-stat-label">{tx('logistics.buyer.stats.openRequests.label', 'Open buyer requests')}</div>
                  <div className="lx-dashboard-stat-meta">{tx('logistics.buyer.stats.openRequests.meta', 'Across sourcing, quoting, and procurement conversion.')}</div>
                </div>
                <div className="lx-dashboard-stat">
                  <div className="lx-dashboard-stat-value">{metricValue(atRiskShipments)}</div>
                  <div className="lx-dashboard-stat-label">{tx('logistics.buyer.stats.attentionShipments.label', 'Shipments needing attention')}</div>
                  <div className="lx-dashboard-stat-meta">{tx('logistics.buyer.stats.attentionShipments.meta', 'Customs or exception-stage movement to review.')}</div>
                </div>
                <div className="lx-dashboard-stat">
                  <div className="lx-dashboard-stat-value">{metricValue(openIssues)}</div>
                  <div className="lx-dashboard-stat-label">{tx('logistics.buyer.stats.issues.label', 'Claims / refunds open')}</div>
                  <div className="lx-dashboard-stat-meta">{tx('logistics.buyer.stats.issues.meta', 'Keep buyer protection and resolution posture visible.')}</div>
                </div>
              </div>
            </div>

            <div className="lx-dashboard-side">
              <div className="lx-card">
                <h2 className="lx-dashboard-panel-title">{tx('logistics.buyer.attention.title', 'Attention now')}</h2>
                <p className="lx-dashboard-panel-copy">{tx('logistics.buyer.attention.copy', 'Use this queue to decide whether to push new sourcing, chase delivery release, or escalate a finance issue.')}</p>
                <div className="lx-alert-list">
                  <div className="lx-alert-item">
                    <div>
                      <strong>{tx('logistics.buyer.attention.shipmentRisk.label', 'Shipment risk')}</strong>
                      <span>{tx('logistics.buyer.attention.shipmentRisk.hint', 'Customs review, exception states, or delayed freight should get buyer follow-up first.')}</span>
                    </div>
                    <div className="lx-alert-count">{metricValue(atRiskShipments)}</div>
                  </div>
                  <div className="lx-alert-item">
                    <div>
                      <strong>{tx('logistics.buyer.attention.allocationRelease.label', 'Allocation release')}</strong>
                      <span>{tx('logistics.buyer.attention.allocationRelease.hint', 'Assigned stock still needs pickup, forwarder handoff, or final release planning.')}</span>
                    </div>
                    <div className="lx-alert-count">{metricValue(pendingAllocations)}</div>
                  </div>
                  <div className="lx-alert-item">
                    <div>
                      <strong>{tx('logistics.buyer.attention.issuePosture.label', 'Issue posture')}</strong>
                      <span>{tx('logistics.buyer.attention.issuePosture.hint', 'Claims and refund cases tell you where buyer trust or fulfillment quality is slipping.')}</span>
                    </div>
                    <div className="lx-alert-count">{metricValue(openIssues)}</div>
                  </div>
                </div>
              </div>

              <div className="lx-card">
                <h2 className="lx-dashboard-panel-title">{tx('logistics.buyer.rhythm.title', 'Buyer rhythm')}</h2>
                <div className="lx-checklist">
                  <div className="lx-checklist-item">
                    <div>
                      <strong>{tx('logistics.buyer.rhythm.latestDelivery.label', 'Latest delivery signal')}</strong>
                      <span>
                        {latestDeliveryDate
                          ? tx('logistics.buyer.rhythm.latestDelivery.withDate', 'Most recent delivery activity is scheduled around {{date}}.', { date: new Date(latestDeliveryDate).toLocaleDateString() })
                          : tx('logistics.buyer.rhythm.latestDelivery.noDate', 'No delivery dates have been scheduled yet.')}
                      </span>
                    </div>
                  </div>
                  <div className="lx-checklist-item">
                    <div>
                      <strong>{tx('logistics.buyer.rhythm.bestMove.label', 'Best next move')}</strong>
                      <span>
                        {activeRequests === 0
                          ? tx('logistics.buyer.rhythm.bestMove.noRequests', 'Open a sourcing request to get supplier quoting started.')
                          : tx('logistics.buyer.rhythm.bestMove.hasRequests', 'Review quote and shipment posture before opening more demand.')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {(state.loadError || countsError) && !state.loading && <WorkspaceDataErrorBanner onRetry={load} />}

          <WorkspaceOverviewStrip
            loading={state.loading}
            loadError={state.loadError}
            nextStep={nextStep}
            recentActivity={recentActivity}
            emptyActivityText={t('logistics.workspace.buyer.recentActivity.empty')}
          />

          <div className="lx-key-metrics">
            {metrics.map((metric) => (
              <div key={metric.label} className="lx-key-metric-card">
                <div className="lx-key-metric-top">
                  <div className="lx-key-metric-value">{metric.value}</div>
                  <div className="lx-key-metric-icon" aria-hidden="true">{metric.icon}</div>
                </div>
                <div className="lx-key-metric-label">{metric.label}</div>
                <div className="lx-key-metric-note">{metric.note}</div>
              </div>
            ))}
          </div>

          <div className="lx-card lx-mb-6">
            <div className="lx-section-header">
              <h2 className="lx-section-title">{tx('logistics.buyer.requests.title', 'My sourcing requests')}</h2>
              <Link to="/logistics/sourcing" className="lx-link">{tx('logistics.buyer.requests.viewAll', 'View all')}</Link>
            </div>
            <div className="lx-table-wrap">
              <table className="lx-table">
                <thead>
                  <tr>
                    <th>{tx('logistics.buyer.requests.headers.request', 'Request')}</th>
                    <th>{tx('logistics.buyer.requests.headers.category', 'Category')}</th>
                    <th>{tx('logistics.buyer.requests.headers.status', 'Status')}</th>
                    <th>{tx('logistics.buyer.requests.headers.quotes', 'Quotes')}</th>
                    <th><span className="lx-visually-hidden">{tx('logistics.tables.actions', 'Actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {state.requests.slice(0, 8).map((request) => (
                    <tr key={request.id}>
                      <td className="lx-t-semibold">{request.title}</td>
                      <td>{request.category || '—'}</td>
                      <td><LogisticsStatusPill status={request.status} /></td>
                      <td>{request.quote_count || 0}</td>
                      <td><Link to={`/logistics/requests/${request.id}`} className="lx-link">{tx('logistics.tables.view', 'View')}</Link></td>
                    </tr>
                  ))}
                  {!state.loading && !state.loadError && state.requests.length === 0 && (
                    <tr><td colSpan={5} className="lx-table-empty-cell">{tx('logistics.buyer.requests.empty', 'No sourcing requests yet.')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lx-dashboard-grid">
            <div className="lx-card">
              <div className="lx-section-header">
                <h2 className="lx-section-title">{tx('logistics.buyer.flow.title', 'Shipment and allocation flow')}</h2>
                <Link to="/logistics/distribution" className="lx-link">{tx('logistics.buyer.flow.openDistribution', 'Distribution')}</Link>
              </div>
              <div className="lx-table-wrap">
                <table className="lx-table">
                  <thead>
                    <tr>
                      <th>{tx('logistics.buyer.flow.headers.reference', 'Reference')}</th>
                      <th>{tx('logistics.buyer.flow.headers.status', 'Status')}</th>
                      <th>{tx('logistics.buyer.flow.headers.eta', 'ETA / Delivery')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.shipments.slice(0, 4).map((shipment) => (
                      <tr key={`s-${shipment.id}`}>
                        <td><Link to={`/logistics/shipments/${shipment.id}`} className="lx-link">{shipment.reference}</Link></td>
                        <td><LogisticsStatusPill status={shipment.status} /></td>
                        <td className="lx-t-small">{shipment.eta ? new Date(shipment.eta).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                    {state.allocations.slice(0, 4).map((allocation) => (
                      <tr key={`a-${allocation.id}`}>
                        <td>{allocation.reference || tx('logistics.buyer.flow.allocationFallback', 'ALC-{{id}}', { id: allocation.id })}</td>
                        <td><LogisticsStatusPill status={allocation.status} /></td>
                        <td className="lx-t-small">{allocation.recipient_name || allocation.warehouse_name || tx('logistics.buyer.flow.awaitingRelease', 'Awaiting release')}</td>
                      </tr>
                    ))}
                    {!state.loading && !state.loadError && state.shipments.length === 0 && state.allocations.length === 0 && (
                      <tr><td colSpan={3} className="lx-table-empty-cell">{tx('logistics.buyer.flow.empty', 'No shipment or allocation records yet.')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="lx-card">
              <div className="lx-section-header">
                <h2 className="lx-section-title">{tx('logistics.buyer.claims.title', 'Claims and resolution posture')}</h2>
                <Link to="/logistics/finance" className="lx-link">{tx('logistics.buyer.claims.openFinance', 'Finance workspace')}</Link>
              </div>
              <div className="lx-compact-stack">
                <div className="lx-mini-list-item">
                  <strong>{tx('logistics.buyer.claims.activeClaims', '{{count}} active claims', { count: state.claims.length })}</strong>
                  <span>{tx('logistics.buyer.claims.activeClaimsHint', 'Use claims when a shipment, order, or inventory outcome needs operator intervention or evidence review.')}</span>
                </div>
                <div className="lx-mini-list-item">
                  <strong>{tx('logistics.buyer.claims.refundCases', '{{count}} refund cases', { count: state.refunds.length })}</strong>
                  <span>{tx('logistics.buyer.claims.refundCasesHint', 'Refund queues show where buyer recovery is still waiting on finance or operations confirmation.')}</span>
                </div>
                <div className="lx-mini-list-item">
                  <strong>{tx('logistics.buyer.claims.deliveriesTracked', '{{count}} delivery records tracked', { count: state.deliveries.length })}</strong>
                  <span>{tx('logistics.buyer.claims.deliveriesHint', 'Keep delivery status close to claims so you can connect failed fulfillment with actual release history.')}</span>
                </div>
              </div>
              <div className="lx-insight-chip-row">
                <span className="lx-insight-chip">{tx('logistics.buyer.chips.buyerFirst', 'Buyer-first workspace')}</span>
                <span className="lx-insight-chip">{tx('logistics.buyer.chips.claimsTied', 'Claims tied to shipment outcomes')}</span>
                <span className="lx-insight-chip">{tx('logistics.buyer.chips.refundVisible', 'Refund posture stays visible')}</span>
              </div>
            </div>
          </div>
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
