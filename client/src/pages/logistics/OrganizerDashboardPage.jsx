import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { listCampaigns, getMyParticipation, listShipments, listDeliveries } from '../../api/logistics';
import '../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLOR = {
  draft:'#94a3b8', open:'#22c55e', pledging:'#f59e0b', deposit_phase:'#f97316',
  locked:'#8b5cf6', placed:'#3b82f6', in_transit:'#06b6d4', receiving:'#0ea5e9', distributing:'#10b981', completed:'#15803d',
};

export default function OrganizerDashboardPage() {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [participation, setParticipation] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      listCampaigns({ limit: 100 }),
      getMyParticipation(),
      listShipments({ limit: 20 }),
      listDeliveries({ limit: 20 }),
    ])
      .then(([campaignRes, partRes, shipmentRes, deliveryRes]) => {
        setCampaigns((campaignRes.orders || []).filter((row) => row.organizer_user_id === user?.id));
        setParticipation(partRes.data || []);
        setShipments(shipmentRes.shipments || []);
        setDeliveries(deliveryRes.data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  const committedUnits = campaigns.reduce((sum, row) => sum + Number(row.current_committed_qty || 0), 0);

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">Organizer Dashboard</h1>
        <p className="lx-page-sub">Launch pooled orders, monitor MOQ momentum, and coordinate downstream distribution for your communities and buyer groups.</p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(190px, 1fr))', gap:'1rem', marginBottom:'1.5rem' }}>
        {[
          ['Campaigns', campaigns.length, '🤝'],
          ['Committed units', committedUnits, '📦'],
          ['Tracked shipments', shipments.length, '🚢'],
          ['Delivery handoffs', deliveries.length, '🚚'],
        ].map(([label, value, icon]) => (
          <div key={label} className="lx-card" style={{ textAlign:'center' }}>
            <div style={{ fontSize:'1.4rem' }}>{icon}</div>
            <div style={{ fontSize:'1.4rem', fontWeight:800, color:'#f97316' }}>{value}</div>
            <div style={{ color:'#64748b', fontSize:'.8rem', fontWeight:600 }}>{label}</div>
          </div>
        ))}
      </div>

      <div className="lx-card" style={{ marginBottom:'1.5rem' }}>
        <div className="lx-section-header"><h2>Organizer campaigns</h2><Link to="/logistics/campaigns">Browse campaigns</Link></div>
        <div className="lx-campaign-grid">
          {campaigns.slice(0, 6).map((campaign) => (
            <Link key={campaign.id} to={`/logistics/campaigns/${campaign.id}`} className="lx-campaign-card" style={{ textDecoration:'none' }}>
              <div className="lx-campaign-lane">{campaign.origin_country} → {campaign.destination_country} · {campaign.lane_name}</div>
              <h3 className="lx-campaign-title">{campaign.title}</h3>
              <div className="lx-moq-bar-wrap"><div className="lx-moq-bar" style={{ width: `${Math.min(campaign.moq_pct || 0, 100)}%` }} /></div>
              <div className="lx-campaign-meta">
                <span>{campaign.participant_count || 0} participants</span>
                <span className="lx-status-pill" style={{ background: STATUS_COLOR[campaign.status] || '#64748b' }}>{campaign.status}</span>
              </div>
            </Link>
          ))}
          {!loading && campaigns.length === 0 && <div className="lx-card" style={{ color:'#94a3b8' }}>No organizer campaigns yet. Start one from the campaigns workspace.</div>}
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem' }}>
        <div className="lx-card">
          <div className="lx-section-header"><h2>My commitments as participant</h2><Link to="/logistics/campaigns">Open participation</Link></div>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead><tr><th>Campaign</th><th>Qty</th><th>Status</th></tr></thead>
              <tbody>
                {participation.slice(0, 5).map((row) => (
                  <tr key={row.id}>
                    <td><Link to={`/logistics/campaigns/${row.pooled_order_id}`} className="lx-link">{row.order_title}</Link></td>
                    <td>{row.committed_qty}</td>
                    <td><span className="lx-status-pill" style={{ background: STATUS_COLOR[row.order_status] || '#64748b' }}>{row.status}</span></td>
                  </tr>
                ))}
                {!loading && participation.length === 0 && <tr><td colSpan={3} style={{ textAlign:'center', color:'#94a3b8' }}>No campaign commitments yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lx-card">
          <h2 style={{ marginTop:0 }}>Distribution readiness</h2>
          <p style={{ color:'#64748b', fontSize:'.9rem', lineHeight:1.7 }}>
            Once a campaign locks, organizers can coordinate warehouse pickup, freight forward handoff, and final distribution from the shipment and distribution workspaces. OxSteed operators can also step in for customs, receiving, and split allocation.
          </p>
          <div style={{ display:'grid', gap:'.75rem' }}>
            <Link to="/logistics/shipments" className="lx-btn-secondary" style={{ textAlign:'center' }}>Open shipment timeline</Link>
            <Link to="/logistics/distribution" className="lx-btn-secondary" style={{ textAlign:'center' }}>Open distribution workspace</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
