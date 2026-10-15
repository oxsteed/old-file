import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { listOrganizerCampaigns, getMyParticipation, listShipments, listDeliveries, submitCampaignForReview, getCampaignApprovalHistory } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import WorkspaceOverviewStrip, { WorkspaceDataErrorBanner } from '../../components/logistics/LogisticsWorkspacePanels';
import toast from 'react-hot-toast';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

/**
 * OrganizerDashboardPage - organizer workspace overview (Phase 2 refactor).
 *
 * Shared LogisticsLayout replaces the workspace tile grid; the overview
 * strip carries the one clear next step and recent activity; status pills
 * use theme tokens. Data errors and zero-activity states stay distinct.
 */
export default function OrganizerDashboardPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [campaigns, setCampaigns] = useState([]);
  const [participation, setParticipation] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // campaignId -> latest review reason (for revisions_requested campaigns)
  const [revisionNotes, setRevisionNotes] = useState({});
  const [submitting, setSubmitting] = useState(null); // campaign id being submitted

  const load = () => {
    setLoading(true);
    setLoadError(false);
    Promise.all([
      // Organizer-scoped endpoint: own campaigns including drafts. The public
      // /campaigns board never returns drafts.
      listOrganizerCampaigns({ limit: 100 }),
      getMyParticipation(),
      listShipments({ limit: 20 }),
      listDeliveries({ limit: 20 }),
    ])
      .then(([campaignRes, partRes, shipmentRes, deliveryRes]) => {
        const rows = (campaignRes.orders || campaignRes.data || []);
        setCampaigns(rows);
        setParticipation(partRes.data || []);
        setShipments(shipmentRes.shipments || []);
        setDeliveries(deliveryRes.data || []);
        setLoading(false);
        // Pull the latest review note for campaigns sent back for revisions.
        const needingNotes = rows.filter((row) => row.approval_state === 'revisions_requested');
        if (needingNotes.length) {
          Promise.all(
            needingNotes.map((row) =>
              getCampaignApprovalHistory(row.id)
                .then((h) => ({ id: row.id, history: h.data || [] }))
                .catch(() => ({ id: row.id, history: [] }))
            )
          ).then((results) => {
            const notes = {};
            results.forEach(({ id, history }) => {
              const latest = [...history].reverse().find((d) => d.reason);
              if (latest) notes[id] = { reason: latest.reason, by: latest.reviewer_name };
            });
            setRevisionNotes(notes);
          });
        }
      })
      .catch(() => {
        setLoadError(true);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, [user?.id]);

  // Submit a draft for Operations review. Server returns 422 + blockers when
  // the draft is not ready; each blocker is localized by its code.
  const handleSubmitForReview = async (campaign) => {
    setSubmitting(campaign.id);
    try {
      await submitCampaignForReview(campaign.id);
      toast.success(tx('logistics.campaigns.approval.submitted', 'Submitted for review.'));
      load();
    } catch (err) {
      const data = err.response?.data;
      const blockers = data?.fields?.blockers || [];
      if (blockers.length) {
        const lines = blockers.map((b) =>
          tx(`logistics.campaigns.approval.blocker_${b.code}`, b.message || b.code)
        );
        toast.error(`${tx('logistics.campaigns.approval.blockersTitle', 'Fix these before submitting')}: ${lines.join(' ')}`, { duration: 6000 });
      } else {
        toast.error(data?.error || tx('logistics.campaigns.approval.submitFailed', 'Submission failed. Please try again.'));
      }
    } finally {
      setSubmitting(null);
    }
  };

  const committedUnits = campaigns.reduce((sum, row) => sum + Number(row.current_committed_qty || 0), 0);
  const activeCampaigns = campaigns.filter((row) => ['open', 'pledging', 'deposit_phase', 'locked', 'placed'].includes(row.status)).length;
  const campaignsNeedingMomentum = campaigns.filter((row) => Number(row.moq_pct || 0) < 50 && row.status === 'open').length;
  const handoffDeliveries = deliveries.filter((row) => ['pending', 'scheduled', 'in_transit'].includes(row.status)).length;
  const participantCommitments = participation.filter((row) => row.status !== 'fulfilled').length;

  // One clear next step, driven by workspace state.
  const nextStep = loadError
    ? null
    : campaignsNeedingMomentum > 0
      ? {
          kind: 'link',
          href: '/logistics/campaigns',
          label: tx('logistics.workspace.organizer.nextStep.momentum.label', 'Push MOQ momentum'),
          hint: tx(
            'logistics.workspace.organizer.nextStep.momentum.hint',
            '{{count}} campaigns are below half of MOQ and need another recruiting push.',
            { count: campaignsNeedingMomentum }
          ),
        }
      : campaigns.length === 0
        ? {
            kind: 'link',
            href: '/logistics/campaigns/new',
            label: tx('logistics.campaigns.new.nextStepLabel', 'Start a campaign'),
            hint: tx(
              'logistics.campaigns.new.nextStepHint',
              'Draft your first pooled campaign and submit it for Operations approval.'
            ),
          }
        : {
            kind: 'link',
            href: '/logistics/distribution',
            label: tx('logistics.workspace.organizer.nextStep.handoffs.label', 'Coordinate handoffs'),
            hint: tx(
              'logistics.workspace.organizer.nextStep.handoffs.hint',
              'Demand is captured. Keep delivery handoffs moving toward recipients.'
            ),
          };

  const recentActivity = [
    ...campaigns.map((row) => ({
      key: `campaign-${row.id}`,
      label: row.title,
      href: `/logistics/campaigns/${row.id}`,
      date: row.created_at || row.updated_at,
    })),
    ...deliveries.map((row) => ({
      key: `delivery-${row.id}`,
      label: row.recipient_name || tx('logistics.organizer.activity.deliveryFallback', 'Delivery #{{id}}', { id: row.id }),
      href: '/logistics/distribution',
      date: row.created_at || row.updated_at || row.scheduled_date,
    })),
    ...participation.map((row) => ({
      key: `participation-${row.id}`,
      label: row.order_title || tx('logistics.organizer.activity.campaignFallback', 'Campaign #{{id}}', { id: row.pooled_order_id }),
      href: `/logistics/campaigns/${row.pooled_order_id}`,
      date: row.created_at || row.updated_at,
    })),
  ]
    .filter((item) => item.date && !Number.isNaN(new Date(item.date).getTime()))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  return (
    <PageShell>
      <LogisticsLayout
        title={tx('logistics.organizer.title', 'Organizer Dashboard')}
        subtitle={tx('logistics.organizer.subtitle', 'Run pooled campaigns like a coordinator, keep MOQ momentum visible, and move locked orders cleanly into shipping and community handoff.')}
        actions={
          <>
            <Link to="/logistics/campaigns/new" className="lx-btn-primary lx-next-step-action">
              {tx('logistics.campaigns.newCampaign', 'Start a new campaign')}
            </Link>
            <Link to="/logistics/campaigns" className="lx-action-ghost">
              {tx('logistics.organizer.actions.openBoard', 'Open campaign board')}
            </Link>
            <Link to="/logistics/distribution" className="lx-action-ghost">
              {tx('logistics.organizer.actions.coordinateHandoffs', 'Coordinate handoffs')}
            </Link>
          </>
        }
      >
        <div className="lx-workspaces">
          <div className="lx-dashboard-hero">
            <div className="lx-card lx-dashboard-hero-main">
              <div className="lx-dashboard-kicker">{tx('logistics.organizer.kicker', 'Organizer workspace')}</div>
              <h2 className="lx-page-title">{tx('logistics.organizer.title', 'Organizer Dashboard')}</h2>
              <p className="lx-page-sub">{tx('logistics.organizer.subtitle', 'Run pooled campaigns like a coordinator, keep MOQ momentum visible, and move locked orders cleanly into shipping and community handoff.')}</p>
              <div className="lx-dashboard-stat-grid">
                <div className="lx-dashboard-stat">
                  <div className="lx-dashboard-stat-value">{activeCampaigns}</div>
                  <div className="lx-dashboard-stat-label">{tx('logistics.organizer.stats.inMotion.label', 'Campaigns still in motion')}</div>
                  <div className="lx-dashboard-stat-meta">{tx('logistics.organizer.stats.inMotion.meta', 'Across open, deposit, lock, and placement phases.')}</div>
                </div>
                <div className="lx-dashboard-stat">
                  <div className="lx-dashboard-stat-value">{committedUnits}</div>
                  <div className="lx-dashboard-stat-label">{tx('logistics.organizer.stats.committedUnits.label', 'Committed units')}</div>
                  <div className="lx-dashboard-stat-meta">{tx('logistics.organizer.stats.committedUnits.meta', 'Demand already captured from your pooled network.')}</div>
                </div>
                <div className="lx-dashboard-stat">
                  <div className="lx-dashboard-stat-value">{handoffDeliveries}</div>
                  <div className="lx-dashboard-stat-label">{tx('logistics.organizer.stats.handoffs.label', 'Handoffs to coordinate')}</div>
                  <div className="lx-dashboard-stat-meta">{tx('logistics.organizer.stats.handoffs.meta', 'Delivery legs still moving toward community recipients.')}</div>
                </div>
              </div>
            </div>

            <div className="lx-dashboard-side">
              <div className="lx-card">
                <h2 className="lx-dashboard-panel-title">{tx('logistics.organizer.pressure.title', 'Organizer pressure points')}</h2>
                <p className="lx-dashboard-panel-copy">{tx('logistics.organizer.pressure.copy', 'This is the fast read on where organizer energy should go next: recruiting, deposits, or handoff execution.')}</p>
                <div className="lx-alert-list">
                  <div className="lx-alert-item">
                    <div>
                      <strong>{tx('logistics.organizer.pressure.momentum.label', 'MOQ momentum gaps')}</strong>
                      <span>{tx('logistics.organizer.pressure.momentum.hint', 'Campaigns below halfway to MOQ usually need another recruitment push or a lane/pricing rethink.')}</span>
                    </div>
                    <div className="lx-alert-count">{campaignsNeedingMomentum}</div>
                  </div>
                  <div className="lx-alert-item">
                    <div>
                      <strong>{tx('logistics.organizer.pressure.commitments.label', 'Participant commitments open')}</strong>
                      <span>{tx('logistics.organizer.pressure.commitments.hint', 'These are your own live commitments inside pooled orders that still need watching.')}</span>
                    </div>
                    <div className="lx-alert-count">{participantCommitments}</div>
                  </div>
                  <div className="lx-alert-item">
                    <div>
                      <strong>{tx('logistics.organizer.pressure.shipments.label', 'Shipments tied to campaigns')}</strong>
                      <span>{tx('logistics.organizer.pressure.shipments.hint', 'Keep organizer messaging aligned with freight movement so downstream buyers know what is next.')}</span>
                    </div>
                    <div className="lx-alert-count">{shipments.length}</div>
                  </div>
                </div>
              </div>

              <div className="lx-card">
                <h2 className="lx-dashboard-panel-title">{tx('logistics.organizer.rhythm.title', 'Organizer operating rhythm')}</h2>
                <div className="lx-checklist">
                  <div className="lx-checklist-item">
                    <div>
                      <strong>{tx('logistics.organizer.rhythm.recruit.label', 'Recruit before lock')}</strong>
                      <span>{tx('logistics.organizer.rhythm.recruit.hint', 'If MOQ is low, spend time recruiting participants before pushing operational complexity downstream.')}</span>
                    </div>
                  </div>
                  <div className="lx-checklist-item">
                    <div>
                      <strong>{tx('logistics.organizer.rhythm.communicate.label', 'Communicate after placement')}</strong>
                      <span>{tx('logistics.organizer.rhythm.communicate.hint', 'Once orders place, switch from demand building to shipment visibility and delivery expectations.')}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {loadError && !loading && <WorkspaceDataErrorBanner onRetry={load} />}

          <WorkspaceOverviewStrip
            loading={loading}
            loadError={loadError}
            nextStep={nextStep}
            recentActivity={recentActivity}
            emptyActivityText={t('logistics.workspace.organizer.recentActivity.empty')}
          />

          <div className="lx-key-metrics">
            {[
              {
                label: tx('logistics.organizer.metrics.campaigns.label', 'Organizer campaigns'),
                value: campaigns.length,
                icon: '🤝',
                note: tx('logistics.organizer.metrics.campaigns.note', 'Total campaigns you currently own or coordinate.'),
              },
              {
                label: tx('logistics.organizer.metrics.committedUnits.label', 'Committed units'),
                value: committedUnits,
                icon: '📦',
                note: tx('logistics.organizer.metrics.committedUnits.note', 'Useful for judging network buying power across all campaigns.'),
              },
              {
                label: tx('logistics.organizer.metrics.shipments.label', 'Tracked shipments'),
                value: shipments.length,
                icon: '🚢',
                note: tx('logistics.organizer.metrics.shipments.note', 'Movement that now affects organizer updates and handoffs.'),
              },
              {
                label: tx('logistics.organizer.metrics.deliveries.label', 'Delivery handoffs'),
                value: deliveries.length,
                icon: '🚚',
                note: tx('logistics.organizer.metrics.deliveries.note', 'Final-mile coordination you may need to message around.'),
              },
            ].map((metric) => (
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
              <h2 className="lx-section-title">{tx('logistics.organizer.campaigns.title', 'Organizer campaigns')}</h2>
              <Link to="/logistics/campaigns" className="lx-link">{tx('logistics.organizer.campaigns.browse', 'Browse campaigns')}</Link>
            </div>
            <div className="lx-campaign-grid">
              {campaigns.slice(0, 6).map((campaign) => {
                const approvalState = campaign.approval_state || 'draft';
                const canSubmit = ['draft', 'revisions_requested'].includes(approvalState);
                const note = revisionNotes[campaign.id];
                return (
                  <div key={campaign.id} className="lx-campaign-card">
                    <div className="lx-campaign-lane">{campaign.origin_country} → {campaign.destination_country} · {campaign.lane_name}</div>
                    <h3 className="lx-campaign-title">
                      <Link to={`/logistics/campaigns/${campaign.id}`} className="lx-link">{campaign.title}</Link>
                    </h3>
                    <div className="lx-progress-wrap" role="img" aria-label={tx('logistics.organizer.campaigns.moqProgress', 'MOQ progress: {{pct}} percent', { pct: Math.min(campaign.moq_pct || 0, 100) })}>
                      <div className="lx-progress-bar" style={{ width: `${Math.min(campaign.moq_pct || 0, 100)}%` }} />
                    </div>
                    <div className="lx-campaign-meta">
                      <span>{tx('logistics.organizer.campaigns.participants', '{{count}} participants', { count: campaign.participant_count || 0 })}</span>
                      <LogisticsStatusPill status={campaign.status} />
                    </div>
                    <div className="lx-campaign-meta" style={{ marginTop: '.5rem' }}>
                      <LogisticsStatusPill status={approvalState} />
                      {canSubmit && (
                        <button
                          type="button"
                          className="lx-action-secondary"
                          style={{ fontSize: '.78rem', padding: '.35rem .8rem' }}
                          disabled={submitting === campaign.id}
                          onClick={() => handleSubmitForReview(campaign)}
                        >
                          {submitting === campaign.id
                            ? tx('logistics.campaigns.approval.submitting', 'Submitting…')
                            : tx('logistics.campaigns.approval.submitForReview', 'Submit for review')}
                        </button>
                      )}
                      {canSubmit && (
                        <Link
                          to={`/logistics/campaigns/${campaign.id}/edit`}
                          className="lx-link"
                          style={{ fontSize: '.78rem' }}
                        >
                          {tx('logistics.campaigns.edit.editDraft', 'Edit draft')}
                        </Link>
                      )}
                    </div>
                    {note && (
                      <div style={{ marginTop: '.5rem', fontSize: '.8rem', color: '#b91c1c', background: '#fef2f2', borderRadius: '.5rem', padding: '.5rem .75rem' }}>
                        <strong>{tx('logistics.campaigns.approval.latestRevisionNote', 'Latest review note')}</strong>
                        {note.by ? ` (${note.by})` : ''}: {note.reason}
                      </div>
                    )}
                  </div>
                );
              })}
              {!loading && !loadError && campaigns.length === 0 && (
                <div className="lx-card lx-t-faint">{tx('logistics.organizer.campaigns.empty', 'No organizer campaigns yet. Start one from the campaigns workspace.')}</div>
              )}
            </div>
          </div>

          <div className="lx-dashboard-grid">
            <div className="lx-card">
              <div className="lx-section-header">
                <h2 className="lx-section-title">{tx('logistics.organizer.commitments.title', 'My commitments as participant')}</h2>
                <Link to="/logistics/campaigns" className="lx-link">{tx('logistics.organizer.commitments.open', 'Open participation')}</Link>
              </div>
              <div className="lx-table-wrap">
                <table className="lx-table">
                  <thead>
                    <tr>
                      <th>{tx('logistics.organizer.commitments.headers.campaign', 'Campaign')}</th>
                      <th>{tx('logistics.organizer.commitments.headers.qty', 'Qty')}</th>
                      <th>{tx('logistics.organizer.commitments.headers.status', 'Status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {participation.slice(0, 5).map((row) => (
                      <tr key={row.id}>
                        <td><Link to={`/logistics/campaigns/${row.pooled_order_id}`} className="lx-link">{row.order_title}</Link></td>
                        <td>{row.committed_qty}</td>
                        <td><LogisticsStatusPill status={row.order_status || row.status} /></td>
                      </tr>
                    ))}
                    {!loading && !loadError && participation.length === 0 && (
                      <tr><td colSpan={3} className="lx-table-empty-cell">{tx('logistics.organizer.commitments.empty', 'No campaign commitments yet.')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="lx-card">
              <div className="lx-section-header">
                <h2 className="lx-section-title">{tx('logistics.organizer.readiness.title', 'Distribution readiness')}</h2>
                <Link to="/logistics/shipments" className="lx-link">{tx('logistics.organizer.readiness.shipments', 'Shipment timeline')}</Link>
              </div>
              <div className="lx-mini-list">
                <div className="lx-mini-list-item">
                  <strong>{tx('logistics.organizer.readiness.posture', '{{count}} campaigns can still change participant posture', { count: activeCampaigns })}</strong>
                  <span>{tx('logistics.organizer.readiness.postureHint', 'Use this to decide whether to keep recruiting demand or start preparing buyer-facing distribution expectations.')}</span>
                </div>
                <div className="lx-mini-list-item">
                  <strong>{tx('logistics.organizer.readiness.handoffs', '{{count}} delivery handoffs are still active', { count: handoffDeliveries })}</strong>
                  <span>{tx('logistics.organizer.readiness.handoffsHint', 'These are the legs where organizer communication often matters most to avoid confusion at pickup or last-mile release.')}</span>
                </div>
              </div>
              <div className="lx-btn-row lx-mt-6">
                <Link to="/logistics/shipments" className="lx-action-secondary">{tx('logistics.organizer.readiness.openShipments', 'Open shipment timeline')}</Link>
                <Link to="/logistics/distribution" className="lx-action-secondary">{tx('logistics.organizer.readiness.openDistribution', 'Open distribution workspace')}</Link>
              </div>
            </div>
          </div>
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
