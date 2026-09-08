import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { getCampaign, joinCampaign, checkLaneAccess } from '../../api/logistics';
import PageMeta from '../../components/PageMeta';
import toast from 'react-hot-toast';
import '../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLOR = {
  open:'#22c55e', pledging:'#f59e0b', deposit_phase:'#f97316',
  locked:'#8b5cf6', placed:'#3b82f6', in_transit:'#06b6d4',
  completed:'#10b981', cancelled:'#ef4444',
};

const PARTICIPANT_STATUS_COLOR = {
  invited:'#94a3b8', pledged:'#f59e0b', deposit_paid:'#22c55e',
  confirmed:'#3b82f6', locked:'#8b5cf6', final_paid:'#10b981',
  fulfilled:'#059669', refunded:'#f43f5e', disputed:'#ef4444',
};

export default function CampaignDetailPage() {
  const { id }       = useParams();
  const { t }        = useTranslation();
  const { user }     = useAuth();
  const navigate     = useNavigate();

  const [campaign, setCampaign]     = useState(null);
  const [loading, setLoading]       = useState(true);
  const [laneAccess, setLaneAccess] = useState(null);
  const [joining, setJoining]       = useState(false);
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [joinData, setJoinData]     = useState({ committed_qty: 1, delivery_preference: 'warehouse_pickup' });

  useEffect(() => {
    getCampaign(id)
      .then(r => setCampaign(r.data))
      .catch(() => toast.error('Failed to load campaign'))
      .finally(() => setLoading(false));
  }, [id]);

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
      toast.success(t('logistics.campaigns.joinSuccess', 'You\'ve joined the campaign!'));
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
  const canJoin = campaign && ['open','pledging'].includes(campaign.status) && !myParticipation && laneAccess?.allowed !== false;

  if (loading) return <div className="lx-page"><div className="lx-loading">Loading…</div></div>;
  if (!campaign) return <div className="lx-page"><div className="lx-error">Campaign not found.</div></div>;

  return (
    <div className="lx-page">
      <PageMeta
        title={`${campaign.title} | OxSteed Logistics`}
        description={campaign.description || `${campaign.title} pooled buying campaign on OxSteed Logistics.`}
        url={`https://oxsteed.com/logistics/campaigns/${id}`}
      />
      <div style={{ marginBottom:'1rem' }}>
        <Link to="/logistics/campaigns" className="lx-link">← {t('logistics.campaigns.allCampaigns','All Campaigns')}</Link>
      </div>

      {/* Header */}
      <div className="lx-card" style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:'1rem' }}>
          <div style={{ flex:1 }}>
            <div className="lx-campaign-lane">
              {campaign.origin_country} → {campaign.destination_country} · {campaign.lane_name}
            </div>
            <h1 style={{ fontSize:'1.6rem', fontWeight:800, margin:'.25rem 0 .5rem' }}>{campaign.title}</h1>
            <span className="lx-status-pill" style={{ background: STATUS_COLOR[campaign.status]||'#64748b' }}>
              {campaign.status?.replace(/_/g,' ')}
            </span>
            {campaign.description && (
              <p style={{ color:'#64748b', marginTop:'.75rem', lineHeight:1.6 }}>{campaign.description}</p>
            )}
          </div>
          {canJoin && (
            <button className="lx-btn-primary" onClick={() => setShowJoinForm(true)}>
              {t('logistics.campaigns.joinCampaign','Join Campaign')}
            </button>
          )}
          {myParticipation && (
            <div className="lx-status-pill" style={{ background: PARTICIPANT_STATUS_COLOR[myParticipation.status]||'#64748b', padding:'.4rem 1rem' }}>
              {t('logistics.campaigns.myStatus','My status')}: {myParticipation.status}
            </div>
          )}
        </div>

        {/* MOQ progress */}
        <div style={{ marginTop:'1.5rem' }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'.4rem', fontSize:'.85rem', fontWeight:700 }}>
            <span>{campaign.current_committed_qty || 0} / {campaign.target_moq} {t('logistics.campaigns.units','units committed')}</span>
            <span style={{ color: moqPct >= 100 ? '#22c55e' : '#f97316' }}>{moqPct}%</span>
          </div>
          <div className="lx-moq-bar-wrap" style={{ height:'12px' }}>
            <div className="lx-moq-bar" style={{ width:`${moqPct}%` }} />
          </div>
          {moqPct >= 100 && (
            <div style={{ color:'#22c55e', fontWeight:700, fontSize:'.85rem', marginTop:'.35rem' }}>
              ✓ {t('logistics.campaigns.moqReached','MOQ Reached!')}
            </div>
          )}
        </div>
        {(campaign.requires_business_verification || campaign.requires_manual_approval || campaign.requires_reseller_approval || laneAccess?.allowed === false) && (
          <div style={{ marginTop:'1rem', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:'.75rem', padding:'1rem', fontSize:'.85rem', lineHeight:1.7 }}>
            <strong>Lane gating</strong>
            {campaign.requires_business_verification && <div style={{ color:'#c2410c' }}>Verified business context is required for this campaign lane.</div>}
            {campaign.requires_reseller_approval && <div style={{ color:'#7c3aed' }}>Reseller/distributor approval is required for resale participation on this lane.</div>}
            {(campaign.requires_manual_approval || laneAccess?.requiresManualApproval) && <div style={{ color:'#b91c1c' }}>Manual compliance approval is required before the campaign can move through all downstream logistics steps.</div>}
            {laneAccess?.allowed === false && <div style={{ color:'#b91c1c', fontWeight:700 }}>Your current role or destination context is blocked for this lane: {laneAccess.reason}</div>}
          </div>
        )}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem', marginBottom:'1.5rem' }}>
        {/* Economics */}
        <div className="lx-card">
          <h3 style={{ fontWeight:700, marginBottom:1 }}>{t('logistics.campaigns.unitEconomics','Unit Economics')}</h3>
          <table className="lx-table" style={{ fontSize:'.85rem' }}>
            <tbody>
              {[
                ['Product Cost', campaign.unit_product_cost_usd, true],
                ['Freight (est.)', campaign.unit_freight_est_usd, true],
                ['OxSteed Markup', campaign.unit_markup_usd, true],
                ['Fees', campaign.unit_fees_usd, true],
                ['Landed Cost / unit', campaign.unit_landed_cost_usd, true],
                ['Deposit (30%)', campaign.unit_landed_cost_usd ? (parseFloat(campaign.unit_landed_cost_usd)*parseFloat(campaign.deposit_pct||0.3)).toFixed(4) : null, true],
              ].filter(r => r[1]).map(([label, val, _]) => (
                <tr key={label}>
                  <td style={{ color:'#64748b' }}>{label}</td>
                  <td style={{ fontWeight: label.includes('Landed') ? 700 : 400, color: label.includes('Landed') ? '#f97316' : 'inherit' }}>
                    ${parseFloat(val).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Dates & Info */}
        <div className="lx-card">
          <h3 style={{ fontWeight:700, marginBottom:1 }}>{t('logistics.campaigns.timeline','Timeline')}</h3>
          <div style={{ display:'grid', gap:'.6rem', fontSize:'.85rem' }}>
            {[
              [t('logistics.campaigns.openDate','Open Date'), campaign.open_date],
              [t('logistics.campaigns.closeDate','Close Date'), campaign.close_date],
              [t('logistics.campaigns.lockDate','Lock Date'), campaign.lock_date],
              [t('logistics.campaigns.expectedShip','Expected Ship'), campaign.expected_ship_date],
              [t('logistics.campaigns.expectedArrival','Expected Arrival'), campaign.expected_arrival_date],
            ].map(([label, val]) => val ? (
              <div key={label} style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:'#64748b' }}>{label}</span>
                <span style={{ fontWeight:600 }}>{new Date(val).toLocaleDateString()}</span>
              </div>
            ) : null)}
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <span style={{ color:'#64748b' }}>{t('logistics.campaigns.organizer','Organizer')}</span>
              <span style={{ fontWeight:600 }}>{campaign.organizer_name}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Join form */}
      {showJoinForm && (
        <div className="lx-card" style={{ marginBottom:'1.5rem', border:'2px solid #f97316' }}>
          <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>{t('logistics.campaigns.joinForm','Join This Campaign')}</h3>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
            <div className="lx-form-group">
              <label className="lx-label">{t('logistics.campaigns.committedQty','Quantity to commit')}</label>
              <input type="number" min="1" className="lx-input"
                value={joinData.committed_qty}
                onChange={e => setJoinData(d => ({...d, committed_qty: parseInt(e.target.value)||1}))}
              />
              {campaign.unit_landed_cost_usd && (
                <div style={{ fontSize:'.78rem', color:'#f97316', marginTop:'.3rem', fontWeight:600 }}>
                  Subtotal: ${(joinData.committed_qty * parseFloat(campaign.unit_landed_cost_usd)).toFixed(2)}
                  {' '}· Deposit: ${(joinData.committed_qty * parseFloat(campaign.unit_landed_cost_usd) * parseFloat(campaign.deposit_pct||0.3)).toFixed(2)}
                </div>
              )}
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t('logistics.campaigns.deliveryPreference','Delivery Preference')}</label>
              <select className="lx-select" value={joinData.delivery_preference}
                onChange={e => setJoinData(d => ({...d, delivery_preference: e.target.value}))}>
                <option value="warehouse_pickup">Warehouse Pickup</option>
                <option value="ship_to_buyer">Ship to Me</option>
                <option value="freight_forward">Freight Forward</option>
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">Destination country</label>
              <input className="lx-input" maxLength={2} value={joinData.destination_country || ''}
                onChange={e => setJoinData(d => ({ ...d, destination_country: e.target.value.toUpperCase() }))} placeholder={campaign.destination_country || 'Country code'} />
            </div>
          </div>
          {campaign.cancellation_policy && (
            <div style={{ background:'#fef3c7', borderRadius:'.5rem', padding:'.75rem', fontSize:'.82rem', marginBottom:'1rem', color:'#92400e' }}>
              <strong>Cancellation Policy:</strong> {campaign.cancellation_policy}
            </div>
          )}
          <div style={{ display:'flex', gap:'.75rem' }}>
            <button className="lx-btn-primary" onClick={handleJoin} disabled={joining}>
              {joining ? t('common.loading','Loading…') : t('logistics.campaigns.confirmJoin','Confirm Commitment')}
            </button>
            <button className="lx-btn-secondary" onClick={() => setShowJoinForm(false)}>
              {t('common.cancel','Cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Participants table (admin / organizer) */}
      {campaign.participants?.length > 0 && (
        <div className="lx-card">
          <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>
            {t('logistics.campaigns.participants','Participants')} ({campaign.participants.length})
          </h3>
          <div className="lx-table-wrap">
            <table className="lx-table" style={{ fontSize:'.82rem' }}>
              <thead>
                <tr>
                  <th>User</th><th>Qty</th><th>Status</th><th>Deposit</th><th>Delivery</th>
                </tr>
              </thead>
              <tbody>
                {campaign.participants.map(p => (
                  <tr key={p.id}>
                    <td>{t('logistics.campaigns.participant','Participant')}</td>
                    <td>{p.committed_qty}</td>
                    <td>
                      <span className="lx-status-pill" style={{ background: PARTICIPANT_STATUS_COLOR[p.status]||'#64748b' }}>
                        {p.status}
                      </span>
                    </td>
                    <td>—</td>
                    <td>{p.delivery_preference?.replace(/_/g,' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
