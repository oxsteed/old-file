import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  listCampaigns,
  getBusinessProcurementAccess,
} from '../../api/logistics';
import PageShell from '../../components/PageShell';
import {
  recommendedLogisticsWorkspace,
  isBusinessProcurementEligibleMembership,
} from '../../utils/logisticsWorkspaces';
import '../../styles/logistics/LogisticsHomePage.css';

const WHY_CARDS = [
  {
    key: 'moq',
    accent: '#f97316',
    heading: 'The minimum order problem',
    body: 'Manufacturers set minimums for factories, not individuals. Most buyers are locked out — not because of price, but because of volume. Campaigns pool demand until the math works for everyone.',
  },
  {
    key: 'compliance',
    accent: '#8b5cf6',
    heading: 'Compliance isn\'t optional',
    body: 'Every shipment crosses regulations: trade rules, duties, restricted categories, import licenses. OxSteed surfaces restrictions before you commit — not after your goods are held at customs.',
  },
  {
    key: 'lastmile',
    accent: '#06b6d4',
    heading: 'The last mile is its own problem',
    body: 'Goods arrive at port. Then what? Warehousing, allocation, delivery orders — each one is its own handoff. OxSteed coordinates the chain so every step knows what the next one needs.',
  },
];

const STATUS_COLOR = {
  draft: '#94a3b8',
  open: '#22c55e',
  pledging: '#f59e0b',
  deposit_phase: '#f97316',
  locked: '#8b5cf6',
  placed: '#3b82f6',
  in_transit: '#06b6d4',
  completed: '#10b981',
};

export default function LogisticsHomePage() {
  const { user } = useAuth();
  const [openCampaigns, setOpenCampaigns] = useState([]);
  const [businessAccess, setBusinessAccess] = useState({ eligibleBusinesses: [], businesses: [] });

  const recommendedWorkspace = useMemo(
    () => recommendedLogisticsWorkspace(user, businessAccess),
    [user, businessAccess],
  );

  useEffect(() => {
    const campaignFetch = listCampaigns({ open: true, limit: 4 })
      .then((r) => setOpenCampaigns(r.orders || []))
      .catch(() => {});

    if (!user) return;

    Promise.all([campaignFetch, getBusinessProcurementAccess()])
      .then(([, res]) => {
        const businesses = Array.isArray(res?.businesses) ? res.businesses : [];
        setBusinessAccess({
          businesses,
          eligibleBusinesses: businesses.filter(isBusinessProcurementEligibleMembership),
        });
      })
      .catch(() => {});
  }, [user]);

  return (
    <PageShell>
      <div className="lx-home">

        {/* ── Hero ───────────────────────────────────────────── */}
        <div className="lxh-hero">
          <p className="lxh-eyebrow">OxSteed Logistics</p>
          <h1 className="lxh-title">
            Global supply chains were built for corporations.
          </h1>
          <p className="lxh-sub">
            We built one for the buyer who needs 200 units, the organizer who
            ships to Haiti, and the business that can't afford a freight broker.
          </p>
          <div className="lxh-actions">
            {user ? (
              <Link to={recommendedWorkspace} className="lx-btn-primary">
                Open your workspace →
              </Link>
            ) : (
              <>
                <Link to="/register" className="lx-btn-primary">Get started</Link>
                <Link to="/logistics/campaigns" className="lx-btn-ghost">
                  Browse open campaigns
                </Link>
              </>
            )}
          </div>
        </div>

        {/* ── Why this exists ────────────────────────────────── */}
        <section className="lxh-why">
          {WHY_CARDS.map((card) => (
            <div key={card.key} className="lxh-why-card">
              <div className="lxh-why-accent" style={{ background: card.accent }} />
              <h2 className="lxh-why-heading">{card.heading}</h2>
              <p className="lxh-why-body">{card.body}</p>
            </div>
          ))}
        </section>

        {/* ── Open campaigns ─────────────────────────────────── */}
        {openCampaigns.length > 0 && (
          <section className="lxh-campaigns">
            <div className="lxh-campaigns-header">
              <span className="lxh-campaigns-label">Open campaigns</span>
              <Link to="/logistics/campaigns?open=true" className="lx-link">
                View all
              </Link>
            </div>
            <div className="lxh-campaigns-grid">
              {openCampaigns.map((c) => (
                <Link
                  key={c.id}
                  to={`/logistics/campaigns/${c.id}`}
                  className="lxh-campaign-tile"
                >
                  <span className="lxh-campaign-route">
                    {c.origin_country} → {c.destination_country}
                  </span>
                  <span className="lxh-campaign-name">{c.title}</span>
                  <div className="lxh-campaign-bar-wrap">
                    <div
                      className="lxh-campaign-bar"
                      style={{ width: `${Math.min(c.moq_pct || 0, 100)}%` }}
                    />
                  </div>
                  <div className="lxh-campaign-foot">
                    <span>{c.current_committed_qty || 0} / {c.target_moq} units</span>
                    <span
                      className="lx-status-pill"
                      style={{ background: STATUS_COLOR[c.status] || '#64748b' }}
                    >
                      {c.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── CTA (non-auth only) ────────────────────────────── */}
        {!user && (
          <div className="lxh-cta">
            <h2 className="lxh-cta-heading">Ready to start?</h2>
            <p className="lxh-cta-body">
              Join to access sourcing, pooled buying, and full supply-chain
              visibility — from first supplier contact to last-mile delivery.
            </p>
            <Link to="/register" className="lx-btn-primary">Create an account</Link>
          </div>
        )}

      </div>
    </PageShell>
  );
}
