import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { listCampaigns, listOrders, getMyParticipation, listSourcingRequests, listShipments, listAllocations, listDeliveries, listMyClaims, listRefundCases } from '../../api/logistics';
import '../../styles/logistics/LogisticsHomePage.css';

const MENU_ITEMS = [
  { key: 'sourcing',      icon: '🔍', path: '/logistics/sourcing',      roles: ['all'] },
  { key: 'campaigns',     icon: '🤝', path: '/logistics/campaigns',     roles: ['all'] },
  { key: 'orders',        icon: '📦', path: '/logistics/orders',        roles: ['all'] },
  { key: 'shipments',     icon: '🚢', path: '/logistics/shipments',     roles: ['all'] },
  { key: 'warehousing',   icon: '🏭', path: '/logistics/warehousing',   roles: ['all'] },
  { key: 'distribution',  icon: '🚚', path: '/logistics/distribution',  roles: ['all'] },
  { key: 'compliance',    icon: '📋', path: '/logistics/compliance',    roles: ['all'] },
  { key: 'finance',       icon: '💰', path: '/logistics/finance',       roles: ['all'] },
];

export default function LogisticsHomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [openCampaigns, setOpenCampaigns]   = useState([]);
  const [myOrders, setMyOrders]             = useState([]);
  const [myParticipation, setMyParticipation] = useState([]);
  const [myRequests, setMyRequests]         = useState([]);
  const [myShipments, setMyShipments]       = useState([]);
  const [myAllocations, setMyAllocations]   = useState([]);
  const [myDeliveries, setMyDeliveries]     = useState([]);
  const [myClaims, setMyClaims]             = useState([]);
  const [myRefunds, setMyRefunds]           = useState([]);
  const [organizerCampaigns, setOrganizerCampaigns] = useState([]);
  const [loading, setLoading]               = useState(true);

  useEffect(() => {
    if (!user) {
      listCampaigns({ open: true, limit: 6 })
        .then((cRes) => setOpenCampaigns(cRes.orders || []))
        .catch(() => {})
        .finally(() => setLoading(false));
      return;
    }
    Promise.all([
      listCampaigns({ open: true, limit: 6 }),
      listOrders({ limit: 5 }),
      getMyParticipation(),
      listSourcingRequests({ limit: 12 }),
      listShipments({ limit: 8 }),
      listAllocations({ limit: 8 }),
      listDeliveries({ limit: 8 }),
      listMyClaims(),
      listRefundCases(),
      listCampaigns({ limit: 100 }),
    ])
      .then(([cRes, oRes, pRes, rRes, sRes, aRes, dRes, claimRes, refundRes, campaignRes]) => {
        setOpenCampaigns(cRes.orders || []);
        setMyOrders(oRes.orders || []);
        setMyParticipation(pRes.data || []);
        setMyRequests(rRes.requests || []);
        setMyShipments(sRes.shipments || []);
        setMyAllocations(aRes.data || []);
        setMyDeliveries(dRes.data || []);
        setMyClaims(claimRes.data || []);
        setMyRefunds(refundRes.data || []);
        setOrganizerCampaigns((campaignRes.orders || []).filter((campaign) => campaign.organizer_user_id === user.id));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const STATUS_COLOR = {
    draft:'#94a3b8', open:'#22c55e', pledging:'#f59e0b', deposit_phase:'#f97316',
    locked:'#8b5cf6', placed:'#3b82f6', in_transit:'#06b6d4', completed:'#10b981',
  };

  return (
    <div className="lx-home">
      {/* Hero */}
      <div className="lx-hero">
        <div className="lx-hero-inner">
          <div className="lx-badge">{t('logistics.home.badge','OxSteed Logistics')}</div>
          <h1 className="lx-hero-title">{t('logistics.home.title','Source. Ship. Distribute.')}</h1>
          <p className="lx-hero-sub">
            {t('logistics.home.subtitle','A complete logistics operating system — from supplier sourcing to last-mile delivery, across borders and communities.')}
          </p>
          <div className="lx-hero-actions">
            <Link to="/logistics/requests/new" className="lx-btn-primary">
              {t('logistics.home.newRequest','Start a Sourcing Request')}
            </Link>
            <Link to="/logistics/campaigns" className="lx-btn-ghost">
              {t('logistics.home.browseCampaigns','Browse Open Campaigns')}
            </Link>
          </div>
        </div>
      </div>

      {/* Navigation tiles */}
      <div className="lx-nav-grid">
        {MENU_ITEMS.map(item => (
          <Link key={item.key} to={item.path} className="lx-nav-tile">
            <span className="lx-nav-icon">{item.icon}</span>
            <span className="lx-nav-label">{t(`logistics.nav.${item.key}`, item.key)}</span>
          </Link>
        ))}
        {user && (
          <>
            <Link to="/logistics/buyer" className="lx-nav-tile">
              <span className="lx-nav-icon">🧾</span>
              <span className="lx-nav-label">Buyer Dashboard</span>
            </Link>
            <Link to="/logistics/organizer" className="lx-nav-tile">
              <span className="lx-nav-icon">🧭</span>
              <span className="lx-nav-label">Organizer Dashboard</span>
            </Link>
            <Link to="/logistics/business-procurement" className="lx-nav-tile">
              <span className="lx-nav-icon">🏢</span>
              <span className="lx-nav-label">Business Procurement</span>
            </Link>
          </>
        )}
      </div>

      {/* Open campaigns strip */}
      {openCampaigns.length > 0 && (
        <section className="lx-section">
          <div className="lx-section-header">
            <h2>{t('logistics.home.openCampaigns','Open Campaigns')}</h2>
            <Link to="/logistics/campaigns?open=true">{t('common.viewAll','View All')}</Link>
          </div>
          <div className="lx-campaign-grid">
            {openCampaigns.map(c => (
              <div key={c.id} className="lx-campaign-card" onClick={() => navigate(`/logistics/campaigns/${c.id}`)}>
                <div className="lx-campaign-lane">
                  {c.origin_country} → {c.destination_country} · {c.lane_name}
                </div>
                <h3 className="lx-campaign-title">{c.title}</h3>
                {c.product_title && <div className="lx-campaign-product">{c.product_category} · {c.product_title}</div>}
                <div className="lx-moq-bar-wrap">
                  <div className="lx-moq-bar" style={{ width: `${Math.min(c.moq_pct || 0, 100)}%` }} />
                </div>
                <div className="lx-campaign-meta">
                  <span>{c.current_committed_qty || 0} / {c.target_moq} {t('logistics.campaigns.units','units')}</span>
                  <span
                    className="lx-status-pill"
                    style={{ background: STATUS_COLOR[c.status] || '#64748b' }}
                  >{c.status}</span>
                </div>
                {c.close_date && (
                  <div className="lx-campaign-close">
                    {t('logistics.campaigns.closes','Closes')} {new Date(c.close_date).toLocaleDateString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="lx-section">
        <div className="lx-section-header">
          <h2>Cross-mode integrations</h2>
        </div>
        <div className="lx-nav-grid">
          {[
            ['Business Launch', '/consulting-intake', '🚀'],
            ['Franchise', '/franchise/apply', '🏪'],
            ['Tools', '/tool-rentals', '🧰'],
            ['Learn', '/learn', '🎓'],
            ['Business Hub', '/business-hub', '🏢'],
            ['Post Job', '/post-job', '📝'],
          ].map(([label, path, icon]) => (
            <Link key={path} to={path} className="lx-nav-tile">
              <span className="lx-nav-icon">{icon}</span>
              <span className="lx-nav-label">{label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* My participation */}
      {user && myParticipation.length > 0 && (
        <section className="lx-section">
          <div className="lx-section-header">
            <h2>{t('logistics.home.myParticipation','My Campaign Commitments')}</h2>
          </div>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead>
                <tr>
                  <th>{t('logistics.campaigns.campaign','Campaign')}</th>
                  <th>{t('logistics.campaigns.qty','Qty')}</th>
                  <th>{t('logistics.campaigns.status','Status')}</th>
                  <th>{t('logistics.campaigns.deposit','Deposit')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {myParticipation.slice(0, 5).map(p => (
                  <tr key={p.id}>
                    <td>{p.order_title}</td>
                    <td>{p.committed_qty}</td>
                    <td>
                      <span className="lx-status-pill" style={{ background: STATUS_COLOR[p.status] || '#64748b' }}>
                        {p.status}
                      </span>
                    </td>
                    <td>{p.deposit_amount_usd ? `$${parseFloat(p.deposit_amount_usd).toFixed(2)}` : '—'}</td>
                    <td>
                      <Link to={`/logistics/campaigns/${p.pooled_order_id}`} className="lx-link">
                        {t('common.view','View')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {user && myRequests.length > 0 && (
        <section className="lx-section">
          <div className="lx-section-header">
            <h2>Buyer Workspace</h2>
            <Link to="/logistics/buyer">Open dashboard →</Link>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'1rem', marginBottom:'1rem' }}>
            {[
              ['Requests', myRequests.length, '🔍'],
              ['Shipments', myShipments.length, '🚢'],
              ['Claims', myClaims.length, '⚖️'],
              ['Refunds', myRefunds.length, '↩️'],
            ].map(([label, value, icon]) => (
              <div key={label} className="lx-card" style={{ textAlign:'center' }}>
                <div style={{ fontSize:'1.5rem' }}>{icon}</div>
                <div style={{ fontSize:'1.3rem', fontWeight:800, color:'#f97316' }}>{value}</div>
                <div style={{ color:'#64748b', fontSize:'.8rem', fontWeight:600 }}>{label}</div>
              </div>
            ))}
          </div>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead>
                <tr>
                  <th>Request</th><th>Category</th><th>Status</th><th>Quotes</th><th></th>
                </tr>
              </thead>
              <tbody>
                {myRequests.slice(0, 5).map((request) => (
                  <tr key={request.id}>
                    <td>{request.title}</td>
                    <td>{request.category}</td>
                    <td><span className="lx-status-pill" style={{ background: STATUS_COLOR[request.status] || '#64748b' }}>{request.status}</span></td>
                    <td>{request.quote_count || 0}</td>
                    <td><Link to={`/logistics/requests/${request.id}`} className="lx-link">View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {user && organizerCampaigns.length > 0 && (
        <section className="lx-section">
          <div className="lx-section-header">
            <h2>Organizer Workspace</h2>
            <Link to="/logistics/organizer">Open dashboard →</Link>
          </div>
          <div className="lx-campaign-grid">
            {organizerCampaigns.slice(0, 4).map((campaign) => (
              <div key={campaign.id} className="lx-campaign-card" onClick={() => navigate(`/logistics/campaigns/${campaign.id}`)}>
                <div className="lx-campaign-lane">{campaign.lane_name} · {campaign.origin_country} → {campaign.destination_country}</div>
                <h3 className="lx-campaign-title">{campaign.title}</h3>
                <div className="lx-campaign-meta">
                  <span>{campaign.participant_count || 0} participants</span>
                  <span className="lx-status-pill" style={{ background: STATUS_COLOR[campaign.status] || '#64748b' }}>{campaign.status}</span>
                </div>
                <div className="lx-moq-bar-wrap"><div className="lx-moq-bar" style={{ width: `${Math.min(campaign.moq_pct || 0, 100)}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* My recent orders */}
      {user && myOrders.length > 0 && (
        <section className="lx-section">
          <div className="lx-section-header">
            <h2>{t('logistics.home.myOrders','Recent Orders')}</h2>
            <Link to="/logistics/orders">{t('common.viewAll','View All')}</Link>
          </div>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead>
                <tr>
                  <th>{t('logistics.orders.reference','Reference')}</th>
                  <th>{t('logistics.orders.product','Product')}</th>
                  <th>{t('logistics.orders.lane','Lane')}</th>
                  <th>{t('logistics.orders.qty','Qty')}</th>
                  <th>{t('logistics.orders.landed','Landed Cost')}</th>
                  <th>{t('logistics.orders.status','Status')}</th>
                </tr>
              </thead>
              <tbody>
                {myOrders.map(o => (
                  <tr key={o.id} onClick={() => navigate(`/logistics/orders/${o.id}`)} style={{ cursor:'pointer' }}>
                    <td><code>{o.reference}</code></td>
                    <td>{o.product_title || '—'}</td>
                    <td>{o.origin_country} → {o.destination_country}</td>
                    <td>{o.qty_ordered}</td>
                    <td>${parseFloat(o.total_landed_usd||0).toLocaleString()}</td>
                    <td>
                      <span className="lx-status-pill" style={{ background: STATUS_COLOR[o.status] || '#64748b' }}>
                        {o.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {user && (myRequests.some((r) => r.business_id) || myOrders.some((o) => o.business_name)) && (
        <section className="lx-section">
          <div className="lx-section-header">
            <h2>Business Procurement Workspace</h2>
            <Link to="/logistics/business-procurement">Open dashboard →</Link>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem' }}>
            <div className="lx-card">
              <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>Business-linked sourcing requests</h3>
              <div style={{ display:'grid', gap:'.6rem' }}>
                {myRequests.filter((r) => r.business_id).slice(0, 5).map((request) => (
                  <div key={request.id} style={{ display:'flex', justifyContent:'space-between', gap:'.75rem', borderBottom:'1px solid #e2e8f0', paddingBottom:'.5rem' }}>
                    <div>
                      <div style={{ fontWeight:700 }}>{request.title}</div>
                      <div style={{ fontSize:'.8rem', color:'#64748b' }}>{request.business_name || 'Business request'}</div>
                    </div>
                    <Link to={`/logistics/requests/${request.id}`} className="lx-link">View</Link>
                  </div>
                ))}
              </div>
            </div>
            <div className="lx-card">
              <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>Distribution & receipt readiness</h3>
              <div style={{ display:'grid', gap:'.6rem', fontSize:'.88rem' }}>
                <div><strong>Allocations:</strong> {myAllocations.length}</div>
                <div><strong>Delivery orders:</strong> {myDeliveries.length}</div>
                <div><strong>Orders with expected arrival dates:</strong> {myOrders.filter((o) => o.expected_arrival_date).length}</div>
                <div><strong>Lane restrictions surface:</strong> Use Compliance to review country and product restrictions before restocking.</div>
                <div style={{ marginTop:'.5rem' }}><Link to="/logistics/distribution" className="lx-link">Open distribution workspace →</Link></div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* CTA block */}
      {!user && (
        <div className="lx-cta-block">
          <h2>{t('logistics.home.ctaTitle','Ready to source smarter?')}</h2>
          <p>{t('logistics.home.ctaBody','Join OxSteed Logistics to access global suppliers, pooled buying campaigns, and full supply-chain visibility.')}</p>
          <Link to="/register" className="lx-btn-primary">{t('common.getStarted','Get Started')}</Link>
        </div>
      )}
    </div>
  );
}
