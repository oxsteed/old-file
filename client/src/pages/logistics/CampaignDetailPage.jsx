import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { getCampaign, joinCampaign, checkLaneAccess, submitCampaignForReview, reviewCampaign } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import PageMeta from '../../components/PageMeta';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import { APPROVAL_BLOCKER_KEYS, APPROVAL_DECISION_KEYS, REVIEW_OPS_LOGISTICS_ROLES } from '../../components/logistics/approvalLabels';
import toast from 'react-hot-toast';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

/**
 * CampaignDetailPage - pooled campaign detail (Phase 2 refactor).
 *
 * Now renders inside PageShell + the shared LogisticsLayout (previously it
 * skipped the site chrome entirely). MOQ progress, lane-gating callouts,
 * unit economics, and the join form use token-based classes and pills.
 */
export default function CampaignDetailPage() {
  const { id }       = useParams();
  const { t }        = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const { user }     = useAuth();
  const navigate     = useNavigate();

  const [campaign, setCampaign]     = useState(null);
  const [loading, setLoading]       = useState(true);
  const [laneAccess, setLaneAccess] = useState(null);
  const [joining, setJoining]       = useState(false);
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [joinData, setJoinData]     = useState({ committed_qty: 1, delivery_preference: 'warehouse_pickup' });
  // Phase 2 draft approval lifecycle
  const [submitting, setSubmitting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewError, setReviewError] = useState(null);

  const reload = () => getCampaign(id).then((r) => setCampaign(r.data));

  const load = () => {
    setLoading(true);
    getCampaign(id)
      .then((r) => setCampaign(r.data))
      .catch(() => toast.error(tx('logistics.campaignDetail.loadError', 'Failed to load campaign')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (!campaign?.lane_id || !user) {
      setLaneAccess(null);
      return;
    }
    checkLaneAccess(campaign.lane_id, {
      role: user.role,
      country: joinData.destination_country || user.country_code || campaign.destination_country,
      business_verified: String(Boolean(user.business_verified || user.is_business_verified)),
    }).then((res) => setLaneAccess(res.data || null)).catch(() => setLaneAccess(null));
  }, [campaign?.lane_id, joinData.destination_country, user]);

  const handleJoin = async () => {
    if (!user) { navigate('/login'); return; }
    setJoining(true);
    try {
      await joinCampaign(id, joinData);
      toast.success(tx('logistics.campaigns.joinSuccess', "You've joined the campaign!"));
      const r = await getCampaign(id);
      setCampaign(r.data);
      setShowJoinForm(false);
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      toast.error(msg);
    } finally {
      setJoining(false);
    }
  };

  const myParticipation = campaign?.my_participation || null;
  const moqPct = campaign ? Math.min(
    Math.round((campaign.current_committed_qty / campaign.target_moq) * 100), 100
  ) : 0;
  const canJoin = campaign && ['open', 'pledging'].includes(campaign.status) && !myParticipation && laneAccess?.allowed !== false;

  // Phase 2 approval lifecycle (approval state is separate from fulfillment status)
  const approvalState = campaign?.approval_state || 'draft';
  const isOwner = Boolean(user && campaign && String(campaign.organizer_user_id) === String(user.id));
  const isOpsReviewer = Boolean(user && !isOwner && (
    ['admin', 'super_admin'].includes(user.role) ||
    REVIEW_OPS_LOGISTICS_ROLES.includes(user.logistics_role)
  ));
  const availableActions = campaign?.available_actions?.actions || [];
  const submitBlockers = campaign?.available_actions?.blockers || [];
  const approvalHistory = campaign?.approval_history || [];

  const handleSubmitForReview = async () => {
    setSubmitting(true);
    try {
      await submitCampaignForReview(id);
      toast.success(tx('logistics.campaigns.approval.submitted', 'Submitted for review.'));
      await reload();
    } catch (err) {
      const data = err.response?.data;
      const blockers = data?.fields?.blockers || [];
      if (blockers.length) {
        toast.error(tx('logistics.campaigns.approval.blockersTitle', 'Fix these before submitting'), { duration: 6000 });
      } else {
        toast.error(data?.error || tx('logistics.campaigns.approval.submitFailed', 'Submission failed. Please try again.'));
      }
      await reload(); // refresh server-computed blockers
    } finally {
      setSubmitting(false);
    }
  };

  const handleReview = async (decision) => {
    const reason = reviewReason.trim();
    if (decision === 'request_changes' && !reason) {
      setReviewError(tx('logistics.campaigns.approval.reasonRequired', 'A reason is required when requesting revisions.'));
      return;
    }
    setReviewing(true);
    setReviewError(null);
    try {
      await reviewCampaign(id, { decision, reason: reason || undefined });
      toast.success(decision === 'approve'
        ? tx('logistics.campaigns.approval.approvedToast', 'Campaign approved and published.')
        : tx('logistics.campaigns.approval.revisionsToast', 'Revision request sent to the organizer.'));
      setReviewReason('');
      await reload();
    } catch (err) {
      const data = err.response?.data;
      setReviewError(data?.error || tx('logistics.campaigns.approval.reviewFailed', 'Review failed. Please try again.'));
    } finally {
      setReviewing(false);
    }
  };

  const renderBody = () => {
    if (loading) {
      return (
        <div className="lx-loading" role="status" aria-live="polite">
          <span className="lx-spinner" aria-hidden="true" />
          {tx('logistics.modal.loading', 'Loading…')}
        </div>
      );
    }
    if (!campaign) {
      return (
        <div className="lx-empty" role="alert">
          <p>{tx('logistics.campaignDetail.notFound', 'Campaign not found.')}</p>
          <Link to="/logistics/campaigns" className="lx-link">{tx('logistics.campaigns.allCampaigns', 'All Campaigns')}</Link>
        </div>
      );
    }

    const economics = [
      [tx('logistics.campaignDetail.economics.productCost', 'Product Cost'), campaign.unit_product_cost_usd],
      [tx('logistics.campaignDetail.economics.freightEst', 'Freight (est.)'), campaign.unit_freight_est_usd],
      [tx('logistics.campaignDetail.economics.markup', 'OxSteed Markup'), campaign.unit_markup_usd],
      [tx('logistics.campaignDetail.economics.fees', 'Fees'), campaign.unit_fees_usd],
      [tx('logistics.campaignDetail.economics.landedCost', 'Landed Cost / unit'), campaign.unit_landed_cost_usd, true],
      [tx('logistics.campaignDetail.economics.deposit', 'Deposit (30%)'), campaign.unit_landed_cost_usd ? (parseFloat(campaign.unit_landed_cost_usd) * parseFloat(campaign.deposit_pct || 0.3)).toFixed(4) : null],
    ].filter(([, val]) => val);

    const timeline = [
      [tx('logistics.campaignDetail.timeline.openDate', 'Open Date'), campaign.open_date],
      [tx('logistics.campaignDetail.timeline.closeDate', 'Close Date'), campaign.close_date],
      [tx('logistics.campaignDetail.timeline.lockDate', 'Lock Date'), campaign.lock_date],
      [tx('logistics.campaignDetail.timeline.expectedShip', 'Expected Ship'), campaign.expected_ship_date],
      [tx('logistics.campaignDetail.timeline.expectedArrival', 'Expected Arrival'), campaign.expected_arrival_date],
    ].filter(([, val]) => val);

    return (
      <>
        <div className="lx-card lx-mb-6">
          <div className="lx-detail-head">
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="lx-detail-kicker">
                {campaign.origin_country} → {campaign.destination_country} · {campaign.lane_name}
              </p>
              <h2 className="lx-detail-title" style={{ fontSize: 'var(--text-2xl)' }}>{campaign.title}</h2>
              <div className="lx-btn-row" style={{ marginBlock: 'var(--space-2)' }}>
                <LogisticsStatusPill status={campaign.status} />
                {/* Approval state stays separate from the fulfillment status */}
                <LogisticsStatusPill status={approvalState} />
                {myParticipation && (
                  <span className="lx-tag">
                    {tx('logistics.campaigns.myStatus', 'My status')}: {myParticipation.status?.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              {campaign.description && (
                <p className="lx-detail-sub" style={{ marginTop: 'var(--space-3)', lineHeight: 1.6 }}>{campaign.description}</p>
              )}
            </div>
            {canJoin && (
              <button type="button" className="lx-btn-primary lx-next-step-action" onClick={() => setShowJoinForm(true)}>
                {tx('logistics.campaigns.joinCampaign', 'Join Campaign')}
              </button>
            )}
          </div>

          {/* MOQ progress */}
          <div className="lx-mt-6">
            <div className="lx-kv-row lx-t-small lx-t-bold lx-mb-4">
              <span>{tx('logistics.campaignDetail.moq.units', '{{committed}} / {{target}} units committed', { committed: campaign.current_committed_qty || 0, target: campaign.target_moq })}</span>
              <span className="lx-kv-total">{moqPct}%</span>
            </div>
            <div className="lx-progress-wrap" role="img" aria-label={tx('logistics.campaignDetail.moq.progressLabel', 'MOQ progress: {{pct}} percent', { pct: moqPct })}>
              <div className="lx-progress-bar" style={{ width: `${moqPct}%` }} />
            </div>
            {moqPct >= 100 && (
              <div className="lx-t-small lx-t-bold lx-mt-6" style={{ color: 'var(--color-success)' }}>
                ✓ {tx('logistics.campaigns.moqReached', 'MOQ Reached!')}
              </div>
            )}
          </div>

          {(campaign.requires_business_verification || campaign.requires_manual_approval || campaign.requires_reseller_approval || laneAccess?.allowed === false) && (
            <div className="lx-callout lx-mt-6">
              <strong>{tx('logistics.campaignDetail.laneGating.title', 'Lane gating')}</strong>
              <div className="lx-callout-row">
                {campaign.requires_business_verification && <div style={{ color: 'var(--color-warning)' }}>{tx('logistics.campaignDetail.laneGating.businessVerification', 'Verified business context is required for this campaign lane.')}</div>}
                {campaign.requires_reseller_approval && <div style={{ color: 'var(--color-info)' }}>{tx('logistics.campaignDetail.laneGating.resellerApproval', 'Reseller/distributor approval is required for resale participation on this lane.')}</div>}
                {(campaign.requires_manual_approval || laneAccess?.requiresManualApproval) && <div style={{ color: 'var(--color-error)' }}>{tx('logistics.campaignDetail.laneGating.manualApproval', 'Manual compliance approval is required before the campaign can move through all downstream logistics steps.')}</div>}
                {laneAccess?.allowed === false && <div style={{ color: 'var(--color-error)', fontWeight: 700 }}>{tx('logistics.campaignDetail.laneGating.blocked', 'Your current role or destination context is blocked for this lane: {{reason}}', { reason: laneAccess.reason })}</div>}
              </div>
            </div>
          )}
        </div>

        {/* ── Phase 2: approval lifecycle ─────────────────────────── */}
        {(isOwner || isOpsReviewer || approvalState !== 'approved') && (
          <div className="lx-card lx-mb-6">
            <div className="lx-btn-row lx-mb-4">
              <h3 className="lx-card-title">{tx('logistics.campaigns.approval.title', 'Approval')}</h3>
              <LogisticsStatusPill status={approvalState} />
            </div>

            {approvalState === 'approved' && (
              <p className="lx-t-small" style={{ color: 'var(--color-success)' }}>
                {tx('logistics.campaigns.approval.publishedNote', 'Approved and published. Buyers can now pledge.')}
              </p>
            )}

            {/* Organizer: submit a draft / revised draft for review */}
            {isOwner && availableActions.includes('submit_for_review') && (
              <div>
                {submitBlockers.length > 0 && (
                  <div className="lx-callout lx-callout--warning lx-mb-4" role="alert">
                    <strong>{tx('logistics.campaigns.approval.blockersTitle', 'Fix these before submitting')}</strong>
                    <ul style={{ margin: '.4rem 0 0', paddingLeft: '1.2rem' }}>
                      {submitBlockers.map((b) => (
                        <li key={b.code}>
                          {APPROVAL_BLOCKER_KEYS[b.code]
                            ? tx(APPROVAL_BLOCKER_KEYS[b.code], b.message || b.code)
                            : (b.message || b.code)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button type="button" className="lx-btn-primary" onClick={handleSubmitForReview} disabled={submitting}>
                  {submitting
                    ? tx('logistics.campaigns.approval.submitting', 'Submitting…')
                    : tx('logistics.campaigns.approval.submitForReview', 'Submit for review')}
                </button>
              </div>
            )}
            {isOwner && approvalState === 'pending_review' && (
              <p className="lx-t-small" style={{ color: 'var(--color-warning)' }}>
                {tx('logistics.campaigns.approval.awaitingReview', 'Awaiting Operations review. You will be notified when a decision is made.')}
              </p>
            )}

            {/* Operations: approve or request revisions */}
            {isOpsReviewer && approvalState === 'pending_review' && (
              <div className="lx-mt-6">
                <div className="lx-form-group">
                  <label className="lx-label" htmlFor="lx-review-reason">{tx('logistics.campaigns.approval.reasonLabel', 'Review note')}</label>
                  <textarea id="lx-review-reason" className="lx-textarea" rows={3} value={reviewReason}
                    placeholder={tx('logistics.campaigns.approval.reasonPlaceholder', 'Explain what needs to change before this campaign can be published.')}
                    onChange={(e) => { setReviewReason(e.target.value); setReviewError(null); }} />
                </div>
                {reviewError && (
                  <div className="lx-t-small lx-t-bold lx-mb-4" role="alert" style={{ color: 'var(--color-error)' }}>
                    {reviewError}
                  </div>
                )}
                <div className="lx-btn-row">
                  <button type="button" className="lx-btn-primary" onClick={() => handleReview('approve')} disabled={reviewing}>
                    {reviewing
                      ? tx('logistics.campaigns.approval.reviewing', 'Reviewing…')
                      : tx('logistics.campaigns.approval.approve', 'Approve and publish')}
                  </button>
                  <button type="button" className="lx-btn-secondary" onClick={() => handleReview('request_changes')} disabled={reviewing}>
                    {tx('logistics.campaigns.approval.requestRevisions', 'Request revisions')}
                  </button>
                </div>
              </div>
            )}

            {/* Approval history: every decision with who / when / reason */}
            {approvalHistory.length > 0 && (
              <div className="lx-mt-6">
                <h4 className="lx-card-title lx-mb-4" style={{ fontSize: 'var(--text-sm)' }}>
                  {tx('logistics.campaigns.approval.historyTitle', 'Approval history')}
                </h4>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '.5rem' }}>
                  {approvalHistory.map((d) => (
                    <li key={d.id} className="lx-t-small" style={{ borderLeft: '3px solid var(--border-subtle, #e2e8f0)', paddingLeft: '.75rem' }}>
                      <strong>
                        {APPROVAL_DECISION_KEYS[d.decision]
                          ? tx(APPROVAL_DECISION_KEYS[d.decision], d.decision?.replace(/_/g, ' '))
                          : (d.decision?.replace(/_/g, ' '))}
                      </strong>
                      <span className="lx-t-faint">
                        {' · '}{d.reviewer_name?.trim() || tx('logistics.campaigns.approval.unknownReviewer', 'Unknown reviewer')}
                        {' · '}{d.created_at ? new Date(d.created_at).toLocaleString() : ''}
                      </span>
                      {d.reason && <div className="lx-mt-4">{d.reason}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="lx-two-col lx-mb-6">
          {/* Economics */}
          <div className="lx-card">
            <h3 className="lx-card-title lx-mb-4">{tx('logistics.campaignDetail.economics.title', 'Unit Economics')}</h3>
            <div className="lx-kv-list">
              {economics.map(([label, val, highlight]) => (
                <div key={label} className="lx-kv-row">
                  <span className="lx-kv-label">{label}</span>
                  <span className={highlight ? 'lx-kv-value lx-kv-total' : 'lx-kv-value'}>
                    ${parseFloat(val).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Dates & Info */}
          <div className="lx-card">
            <h3 className="lx-card-title lx-mb-4">{tx('logistics.campaignDetail.timeline.title', 'Timeline')}</h3>
            <div className="lx-kv-list">
              {timeline.map(([label, val]) => (
                <div key={label} className="lx-kv-row">
                  <span className="lx-kv-label">{label}</span>
                  <span className="lx-kv-value">{new Date(val).toLocaleDateString()}</span>
                </div>
              ))}
              <div className="lx-kv-row">
                <span className="lx-kv-label">{tx('logistics.campaignDetail.timeline.organizer', 'Organizer')}</span>
                <span className="lx-kv-value">{campaign.organizer_name}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Join form */}
        {showJoinForm && (
          <div className="lx-card lx-login-accent lx-mb-6">
            <h3 className="lx-card-title lx-mb-4">{tx('logistics.campaignDetail.join.title', 'Join This Campaign')}</h3>
            <div className="lx-form-grid-2">
              <div className="lx-form-group">
                <label className="lx-label" htmlFor="lx-join-qty">{tx('logistics.campaignDetail.join.committedQty', 'Quantity to commit')}</label>
                <input id="lx-join-qty" type="number" min="1" className="lx-input"
                  value={joinData.committed_qty}
                  onChange={(e) => setJoinData((d) => ({ ...d, committed_qty: parseInt(e.target.value) || 1 }))}
                />
                {campaign.unit_landed_cost_usd && (
                  <div className="lx-t-xs lx-t-bold lx-mt-6" style={{ color: 'var(--color-primary)' }}>
                    {tx('logistics.campaignDetail.join.subtotal', 'Subtotal')}: ${(joinData.committed_qty * parseFloat(campaign.unit_landed_cost_usd)).toFixed(2)}
                    {' '}· {tx('logistics.campaignDetail.join.deposit', 'Deposit')}: ${(joinData.committed_qty * parseFloat(campaign.unit_landed_cost_usd) * parseFloat(campaign.deposit_pct || 0.3)).toFixed(2)}
                  </div>
                )}
              </div>
              <div className="lx-form-group">
                <label className="lx-label" htmlFor="lx-join-delivery">{tx('logistics.campaignDetail.join.deliveryPreference', 'Delivery Preference')}</label>
                <select id="lx-join-delivery" className="lx-select" value={joinData.delivery_preference}
                  onChange={(e) => setJoinData((d) => ({ ...d, delivery_preference: e.target.value }))}>
                  <option value="warehouse_pickup">{tx('logistics.campaignDetail.delivery.warehousePickup', 'Warehouse Pickup')}</option>
                  <option value="ship_to_buyer">{tx('logistics.campaignDetail.delivery.shipToBuyer', 'Ship to Me')}</option>
                  <option value="freight_forward">{tx('logistics.campaignDetail.delivery.freightForward', 'Freight Forward')}</option>
                </select>
              </div>
              <div className="lx-form-group lx-form-group--full">
                <label className="lx-label" htmlFor="lx-join-country">{tx('logistics.campaignDetail.join.destCountry', 'Destination country')}</label>
                <input id="lx-join-country" className="lx-input" maxLength={2} value={joinData.destination_country || ''}
                  onChange={(e) => setJoinData((d) => ({ ...d, destination_country: e.target.value.toUpperCase() }))} placeholder={campaign.destination_country || tx('logistics.campaignDetail.join.countryCode', 'Country code')} />
              </div>
            </div>
            {campaign.cancellation_policy && (
              <div className="lx-callout lx-callout--warning lx-mb-4">
                <strong>{tx('logistics.campaignDetail.join.cancellationPolicy', 'Cancellation Policy')}:</strong> {campaign.cancellation_policy}
              </div>
            )}
            <div className="lx-btn-row">
              <button type="button" className="lx-btn-primary" onClick={handleJoin} disabled={joining}>
                {joining ? tx('common.loading', 'Loading…') : tx('logistics.campaignDetail.join.confirm', 'Confirm Commitment')}
              </button>
              <button type="button" className="lx-btn-secondary" onClick={() => setShowJoinForm(false)}>
                {tx('common.cancel', 'Cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Participants table (admin / organizer) */}
        {campaign.participants?.length > 0 && (
          <div className="lx-card">
            <h3 className="lx-card-title lx-mb-4">
              {tx('logistics.campaignDetail.participants.title', 'Participants ({{count}})', { count: campaign.participants.length })}
            </h3>
            <div className="lx-table-wrap">
              <table className="lx-table lx-t-small">
                <thead>
                  <tr>
                    <th>{tx('logistics.campaignDetail.participants.headers.user', 'User')}</th>
                    <th>{tx('logistics.campaignDetail.participants.headers.qty', 'Qty')}</th>
                    <th>{tx('logistics.campaignDetail.participants.headers.status', 'Status')}</th>
                    <th>{tx('logistics.campaignDetail.participants.headers.deposit', 'Deposit')}</th>
                    <th>{tx('logistics.campaignDetail.participants.headers.delivery', 'Delivery')}</th>
                  </tr>
                </thead>
                <tbody>
                  {campaign.participants.map((p) => (
                    <tr key={p.id}>
                      <td>{tx('logistics.campaignDetail.participants.participant', 'Participant')}</td>
                      <td>{p.committed_qty}</td>
                      <td><LogisticsStatusPill status={p.status} /></td>
                      <td>—</td>
                      <td>{p.delivery_preference?.replace(/_/g, ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <PageShell>
      <PageMeta
        title={`${campaign?.title || tx('logistics.campaignDetail.meta.fallbackTitle', 'Campaign')} | OxSteed Logistics`}
        description={campaign?.description || tx('logistics.campaignDetail.meta.fallbackDescription', 'Pooled buying campaign on OxSteed Logistics.')}
        url={`https://oxsteed.com/logistics/campaigns/${id}`}
      />
      <LogisticsLayout showNav={false}>
        <div className="lx-workspaces">
          <div className="lx-back-row">
            <Link to="/logistics/campaigns" className="lx-link">← {tx('logistics.campaigns.allCampaigns', 'All Campaigns')}</Link>
          </div>
          {renderBody()}
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
