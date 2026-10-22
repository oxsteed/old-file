import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { adminListPendingOrganizerApprovals, reviewCampaign, getCampaignApprovalHistory } from '../../../api/logistics';
import '../../../styles/logistics/LogisticsHomePage.css';
import '../../../styles/logistics/LogisticsWorkspaces.css';
import AdminErrorState from '../../lib/AdminErrorState';
import ConfirmDialog from '../../lib/ConfirmDialog';

/**
 * Organizer approvals (Phase 2 review queue).
 *
 * Lists campaigns the organizer submitted for review
 * (approval_state = pending_review). Approving publishes the campaign
 * (fulfillment draft → open); requesting revisions returns it to the
 * organizer with a required reason. Every decision is recorded in the
 * campaign's approval history with reviewer, timestamp, and reason.
 */
export default function OrganizerApprovalsAdmin() {
  const { t } = useTranslation();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null); // { campaign, decision }
  const [expanded, setExpanded] = useState(null); // campaign id with visible history
  const [histories, setHistories] = useState({});

  const load = () => {
    setLoading(true);
    setLoadError(null);
    adminListPendingOrganizerApprovals()
      .then((res) => setCampaigns(res.data || []))
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggleHistory = (campaign) => {
    if (expanded === campaign.id) { setExpanded(null); return; }
    setExpanded(campaign.id);
    if (!histories[campaign.id]) {
      getCampaignApprovalHistory(campaign.id)
        .then((res) => setHistories((h) => ({ ...h, [campaign.id]: res.data || [] })))
        .catch(() => setHistories((h) => ({ ...h, [campaign.id]: [] })));
    }
  };

  const doReview = async (dialogReason) => {
    const { campaign, decision } = reviewTarget;
    const reason = String(dialogReason || '').trim();
    if (decision === 'request_changes' && !reason) {
      throw new Error(t('logistics.campaigns.approval.reasonRequired', 'A reason is required when requesting revisions.'));
    }
    if (decision === 'reject' && !reason) {
      throw new Error(t('logistics.campaigns.approval.rejectReasonRequired', 'A reason is required when rejecting a campaign.'));
    }
    try {
      await reviewCampaign(campaign.id, { decision, reason: reason || undefined });
      toast.success(decision === 'approve'
        ? t('logistics.campaigns.approval.approvedToast', 'Campaign approved and published.')
        : decision === 'reject'
          ? t('logistics.campaigns.approval.rejectToast', 'Campaign rejected. The organizer has been notified.')
          : t('logistics.campaigns.approval.revisionsToast', 'Revision request sent to the organizer.'));
      setReviewTarget(null);
      load();
    } catch (err) {
      throw new Error(err.response?.data?.error || err.message || t('adminOrganizerApprovals.reviewFailed'));
    }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">{t('adminOrganizerApprovals.title')}</h1>
        <p className="lx-page-sub">{t('adminOrganizerApprovals.subtitle')}</p>
      </div>
      {!loading && loadError && <AdminErrorState onRetry={load} />}
      {loading && <div className="lx-loading">{t('common.loading')}</div>}
      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead><tr><th>{t('adminOrganizerApprovals.table.reference')}</th><th>{t('adminOrganizerApprovals.table.campaign')}</th><th>{t('adminOrganizerApprovals.table.organizer')}</th><th>{t('adminOrganizerApprovals.table.lane')}</th><th>{t('adminOrganizerApprovals.table.moq')}</th><th>{t('adminOrganizerApprovals.table.submitted', 'Submitted')}</th><th>{t('adminOrganizerApprovals.table.actions')}</th></tr></thead>
          <tbody>
            {campaigns.map((campaign) => (
              <React.Fragment key={campaign.id}>
                <tr>
                  <td>{campaign.reference}</td>
                  <td>
                    <button type="button" className="lx-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                      onClick={() => toggleHistory(campaign)} data-track-private>
                      {campaign.title}
                    </button>
                  </td>
                  <td>{campaign.organizer_name}<div style={{ fontSize: '.75rem', color: 'var(--color-text-muted)' }}>{campaign.organizer_email}</div></td>
                  <td>{campaign.lane_id || '—'}</td>
                  <td>{campaign.target_moq || '—'}</td>
                  <td>{campaign.submitted_at ? new Date(campaign.submitted_at).toLocaleDateString() : '—'}</td>
                  <td style={{ display: 'flex', gap: '.5rem' }}>
                    <button className="lx-btn-primary" style={{ fontSize: '.72rem', padding: '.25rem .65rem' }}
                      onClick={() => setReviewTarget({ campaign, decision: 'approve' })} data-track-private>
                      {t('common.approve')}
                    </button>
                    <button className="lx-btn-secondary" style={{ fontSize: '.72rem', padding: '.25rem .65rem' }}
                      onClick={() => setReviewTarget({ campaign, decision: 'request_changes' })} data-track-private>
                      {t('logistics.campaigns.approval.requestRevisions', 'Request revisions')}
                    </button>
                    <button className="lx-btn-secondary" style={{ fontSize: '.72rem', padding: '.25rem .65rem', color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
                      onClick={() => setReviewTarget({ campaign, decision: 'reject' })} data-track-private>
                      {t('logistics.campaigns.approval.reject', 'Reject')}
                    </button>
                  </td>
                </tr>
                {expanded === campaign.id && (
                  <tr>
                    <td colSpan={7} style={{ background: 'var(--color-surface)' }}>
                      <strong style={{ fontSize: '.8rem' }}>{t('logistics.campaigns.approval.historyTitle', 'Approval history')}</strong>
                      {(histories[campaign.id] || []).length === 0 && (
                        <div style={{ fontSize: '.8rem', color: 'var(--color-text-muted)' }}>{t('logistics.campaigns.approval.noHistory', 'No review decisions yet.')}</div>
                      )}
                      <ul style={{ listStyle: 'none', margin: '.4rem 0 0', padding: 0, display: 'grid', gap: '.35rem', fontSize: '.8rem' }}>
                        {(histories[campaign.id] || []).map((d) => (
                          <li key={d.id}>
                            <strong>{String(d.decision || '').replace(/_/g, ' ')}</strong>
                            <span style={{ color: 'var(--color-text-muted)' }}>
                              {' · '}{(d.reviewer_name || '').trim() || '—'}
                              {' · '}{d.created_at ? new Date(d.created_at).toLocaleString() : ''}
                            </span>
                            {d.reason && <div>{d.reason}</div>}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {!loading && !loadError && campaigns.length === 0 && <tr><td colSpan={7} className="lx-table-empty-cell">{t('adminOrganizerApprovals.noApprovals')}</td></tr>}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={reviewTarget != null}
        title={reviewTarget?.decision === 'request_changes'
          ? t('logistics.campaigns.approval.requestRevisions', 'Request revisions')
          : reviewTarget?.decision === 'reject'
            ? t('logistics.campaigns.approval.reject', 'Reject')
            : t('adminOrganizerApprovals.approveTitle')}
        message={reviewTarget?.decision === 'request_changes'
          ? t('logistics.campaigns.approval.revisionsAdminMessage', 'Send "{{title}}" back to the organizer with a revision note.', { title: reviewTarget?.campaign?.title || '' })
          : reviewTarget?.decision === 'reject'
            ? t('logistics.campaigns.approval.rejectConfirmMessage', 'Reject "{{title}}"? The organizer will be notified with your reason.', { title: reviewTarget?.campaign?.title || '' })
            : t('adminOrganizerApprovals.approveMessage', { title: reviewTarget?.campaign?.title || '' })}
        danger={reviewTarget?.decision === 'request_changes' || reviewTarget?.decision === 'reject'}
        requireReason={reviewTarget?.decision === 'request_changes' || reviewTarget?.decision === 'reject'}
        reasonLabel={t('logistics.campaigns.approval.reasonLabel', 'Review note')}
        reasonPlaceholder={t('logistics.campaigns.approval.reasonPlaceholder', 'Explain what needs to change before this campaign can be published.')}
        confirmLabel={reviewTarget?.decision === 'request_changes'
          ? t('logistics.campaigns.approval.requestRevisions', 'Request revisions')
          : reviewTarget?.decision === 'reject'
            ? t('logistics.campaigns.approval.reject', 'Reject')
            : t('common.approve')}
        onConfirm={doReview}
        onClose={() => setReviewTarget(null)}
      />
    </div>
  );
}
