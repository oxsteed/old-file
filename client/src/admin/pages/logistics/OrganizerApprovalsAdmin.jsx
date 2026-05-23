import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminListPendingOrganizerApprovals, adminUpdateCampaignStatus } from '../../../api/logistics';
import '../../../styles/logistics/LogisticsHomePage.css';

export default function OrganizerApprovalsAdmin() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    adminListPendingOrganizerApprovals()
      .then((res) => setCampaigns(res.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const review = async (campaign, status) => {
    try {
      await adminUpdateCampaignStatus(campaign.id, status, `Organizer review: ${status}`);
      toast.success(`Campaign ${status}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">Organizer Approvals</h1>
        <p className="lx-page-sub">Review draft pooled-order campaigns before they become public organizer-led campaigns on OxSteed Logistics.</p>
      </div>
      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead><tr><th>Reference</th><th>Campaign</th><th>Organizer</th><th>Lane</th><th>MOQ</th><th>Actions</th></tr></thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id}>
                <td>{campaign.reference}</td>
                <td>{campaign.title}</td>
                <td>{campaign.organizer_name}<div style={{ fontSize:'.75rem', color:'#64748b' }}>{campaign.organizer_email}</div></td>
                <td>{campaign.lane_id || '—'}</td>
                <td>{campaign.target_moq || '—'}</td>
                <td style={{ display:'flex', gap:'.5rem' }}>
                  <button className="lx-btn-primary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }} onClick={() => review(campaign, 'open')}>Approve</button>
                  <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }} onClick={() => review(campaign, 'cancelled')}>Reject</button>
                </td>
              </tr>
            ))}
            {!loading && campaigns.length === 0 && <tr><td colSpan={6} style={{ textAlign:'center', color:'#94a3b8' }}>No pending organizer approvals.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
