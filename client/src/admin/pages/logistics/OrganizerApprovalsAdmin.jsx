import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { adminListPendingOrganizerApprovals, adminUpdateCampaignStatus } from '../../../api/logistics';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';
import ConfirmDialog from '../../lib/ConfirmDialog';

export default function OrganizerApprovalsAdmin() {
  const { t } = useTranslation();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    adminListPendingOrganizerApprovals()
      .then((res) => setCampaigns(res.data || []))
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const [reviewTarget, setReviewTarget] = useState(null); // { campaign, status }

  const doReview = async () => {
    const { campaign, status } = reviewTarget;
    try {
      await adminUpdateCampaignStatus(campaign.id, status, `Organizer review: ${status}`);
      toast.success(t('adminOrganizerApprovals.campaignStatus', { status }));
      setReviewTarget(null);
      load();
    } catch (err) {
      throw new Error(err.response?.data?.message || err.message || t('adminOrganizerApprovals.reviewFailed'));
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
          <thead><tr><th>{t('adminOrganizerApprovals.table.reference')}</th><th>{t('adminOrganizerApprovals.table.campaign')}</th><th>{t('adminOrganizerApprovals.table.organizer')}</th><th>{t('adminOrganizerApprovals.table.lane')}</th><th>{t('adminOrganizerApprovals.table.moq')}</th><th>{t('adminOrganizerApprovals.table.actions')}</th></tr></thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id}>
                <td>{campaign.reference}</td>
                <td>{campaign.title}</td>
                <td>{campaign.organizer_name}<div style={{ fontSize:'.75rem', color:'#64748b' }}>{campaign.organizer_email}</div></td>
                <td>{campaign.lane_id || '—'}</td>
                <td>{campaign.target_moq || '—'}</td>
                <td style={{ display:'flex', gap:'.5rem' }}>
                  <button className="lx-btn-primary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }} onClick={() => setReviewTarget({ campaign, status:'open' })}>{t('common.approve')}</button>
                  <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }} onClick={() => setReviewTarget({ campaign, status:'cancelled' })}>{t('adminOrganizerApprovals.reject')}</button>
                </td>
              </tr>
            ))}
            {!loading && !loadError && campaigns.length === 0 && <tr><td colSpan={6} style={{ textAlign:'center', color:'#94a3b8' }}>{t('adminOrganizerApprovals.noApprovals')}</td></tr>}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={reviewTarget != null}
        title={reviewTarget?.status === 'cancelled' ? t('adminOrganizerApprovals.rejectTitle') : t('adminOrganizerApprovals.approveTitle')}
        message={
          reviewTarget?.status === 'cancelled'
            ? t('adminOrganizerApprovals.rejectMessage', { title: reviewTarget?.campaign?.title || '' })
            : t('adminOrganizerApprovals.approveMessage', { title: reviewTarget?.campaign?.title || '' })
        }
        danger={reviewTarget?.status === 'cancelled'}
        confirmLabel={reviewTarget?.status === 'cancelled' ? t('adminOrganizerApprovals.reject') : t('common.approve')}
        onConfirm={doReview}
        onClose={() => setReviewTarget(null)}
      />
    </div>
  );
}
