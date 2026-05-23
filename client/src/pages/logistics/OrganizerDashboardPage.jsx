import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { listCampaigns, getMyParticipation, listShipments, listDeliveries } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import LogisticsWorkspaceSwitcher from '../../components/logistics/LogisticsWorkspaceSwitcher';
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
  const activeCampaigns = campaigns.filter((row) => ['open', 'pledging', 'deposit_phase', 'locked', 'placed'].includes(row.status)).length;
  const campaignsNeedingMomentum = campaigns.filter((row) => Number(row.moq_pct || 0) < 50 && row.status === 'open').length;
  const handoffDeliveries = deliveries.filter((row) => ['pending', 'scheduled', 'in_transit'].includes(row.status)).length;
  const participantCommitments = participation.filter((row) => row.status !== 'fulfilled').length;

  return (
    <PageShell>
      <div className="lx-page">
      <LogisticsWorkspaceSwitcher
        currentKey="organizer"
        availability={{ buyer: true, organizer: true, business_procurement: true, distributor: true }}
      />

      <div className="lx-dashboard-hero">
        <div className="lx-card lx-dashboard-hero-main">
          <div className="lx-dashboard-kicker">Organizer workspace</div>
          <h1 className="lx-page-title">Organizer Dashboard</h1>
          <p className="lx-page-sub">Run pooled campaigns like a coordinator, keep MOQ momentum visible, and move locked orders cleanly into shipping and community handoff.</p>
          <div className="lx-dashboard-actions">
            <Link to="/logistics/campaigns" className="lx-btn-primary">Open campaign board</Link>
            <Link to="/logistics/distribution" className="lx-btn-ghost">Coordinate handoffs</Link>
          </div>
          <div className="lx-dashboard-stat-grid">
            <div className="lx-dashboard-stat">
              <div className="lx-dashboard-stat-value">{activeCampaigns}</div>
              <div className="lx-dashboard-stat-label">Campaigns still in motion</div>
              <div className="lx-dashboard-stat-meta">Across open, deposit, lock, and placement phases.</div>
            </div>
            <div className="lx-dashboard-stat">
              <div className="lx-dashboard-stat-value">{committedUnits}</div>
              <div className="lx-dashboard-stat-label">Committed units</div>
              <div className="lx-dashboard-stat-meta">Demand already captured from your pooled network.</div>
            </div>
            <div className="lx-dashboard-stat">
              <div className="lx-dashboard-stat-value">{handoffDeliveries}</div>
              <div className="lx-dashboard-stat-label">Handoffs to coordinate</div>
              <div className="lx-dashboard-stat-meta">Delivery legs still moving toward community recipients.</div>
            </div>
          </div>
        </div>

        <div className="lx-dashboard-side">
          <div className="lx-card">
            <h2 className="lx-dashboard-panel-title">Organizer pressure points</h2>
            <p className="lx-dashboard-panel-copy">This is the fast read on where organizer energy should go next: recruiting, deposits, or handoff execution.</p>
            <div className="lx-alert-list">
              <div className="lx-alert-item">
                <div>
                  <strong>MOQ momentum gaps</strong>
                  <span>Campaigns below halfway to MOQ usually need another recruitment push or a lane/pricing rethink.</span>
                </div>
                <div className="lx-alert-count">{campaignsNeedingMomentum}</div>
              </div>
              <div className="lx-alert-item">
                <div>
                  <strong>Participant commitments open</strong>
                  <span>These are your own live commitments inside pooled orders that still need watching.</span>
                </div>
                <div className="lx-alert-count">{participantCommitments}</div>
              </div>
              <div className="lx-alert-item">
                <div>
                  <strong>Shipments tied to campaigns</strong>
                  <span>Keep organizer messaging aligned with freight movement so downstream buyers know what’s next.</span>
                </div>
                <div className="lx-alert-count">{shipments.length}</div>
              </div>
            </div>
          </div>

          <div className="lx-card">
            <h2 className="lx-dashboard-panel-title">Organizer operating rhythm</h2>
            <div className="lx-checklist">
              <div className="lx-checklist-item">
                <div>
                  <strong>Recruit before lock</strong>
                  <span>If MOQ is low, spend time recruiting participants before pushing operational complexity downstream.</span>
                </div>
              </div>
              <div className="lx-checklist-item">
                <div>
                  <strong>Communicate after placement</strong>
                  <span>Once orders place, switch from demand building to shipment visibility and delivery expectations.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="lx-key-metrics">
        {[
          ['Organizer campaigns', campaigns.length, '🤝', 'Total campaigns you currently own or coordinate.'],
          ['Committed units', committedUnits, '📦', 'Useful for judging network buying power across all campaigns.'],
          ['Tracked shipments', shipments.length, '🚢', 'Movement that now affects organizer updates and handoffs.'],
          ['Delivery handoffs', deliveries.length, '🚚', 'Final-mile coordination you may need to message around.'],
        ].map(([label, value, icon, note]) => (
          <div key={label} className="lx-key-metric-card">
            <div className="lx-key-metric-top">
              <div className="lx-key-metric-value">{value}</div>
              <div className="lx-key-metric-icon">{icon}</div>
            </div>
            <div className="lx-key-metric-label">{label}</div>
            <div className="lx-key-metric-note">{note}</div>
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

      <div className="lx-dashboard-grid">
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
          <div className="lx-section-header"><h2>Distribution readiness</h2><Link to="/logistics/shipments">Shipment timeline</Link></div>
          <div className="lx-mini-list">
            <div className="lx-mini-list-item">
              <strong>{activeCampaigns} campaigns can still change participant posture</strong>
              <span>Use this to decide whether to keep recruiting demand or start preparing buyer-facing distribution expectations.</span>
            </div>
            <div className="lx-mini-list-item">
              <strong>{handoffDeliveries} delivery handoffs are still active</strong>
              <span>These are the legs where organizer communication often matters most to avoid confusion at pickup or last-mile release.</span>
            </div>
          </div>
          <div style={{ display:'grid', gap:'.75rem', marginTop:'1rem' }}>
            <Link to="/logistics/shipments" className="lx-btn-secondary" style={{ textAlign:'center' }}>Open shipment timeline</Link>
            <Link to="/logistics/distribution" className="lx-btn-secondary" style={{ textAlign:'center' }}>Open distribution workspace</Link>
          </div>
        </div>
      </div>
      </div>
    </PageShell>
  );
}
