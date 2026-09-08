import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import {
  listCampaigns,
  getBusinessProcurementAccess,
} from '../../api/logistics';
import PageShell from '../../components/PageShell';
import PageMeta from '../../components/PageMeta';
import {
  recommendedLogisticsWorkspace,
  isBusinessProcurementEligibleMembership,
} from '../../utils/logisticsWorkspaces';
import '../../styles/logistics/LogisticsHomePage.css';

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
  const { t } = useTranslation();
  const { user } = useAuth();
  const [openCampaigns, setOpenCampaigns] = useState([]);
  const [businessAccess, setBusinessAccess] = useState({ eligibleBusinesses: [], businesses: [] });

  const whyCards = useMemo(
    () => [
      {
        key: 'moq',
        accent: '#f97316',
        heading: t('logistics.home.whyCards.moq.heading'),
        body: t('logistics.home.whyCards.moq.body'),
      },
      {
        key: 'compliance',
        accent: '#8b5cf6',
        heading: t('logistics.home.whyCards.compliance.heading'),
        body: t('logistics.home.whyCards.compliance.body'),
      },
      {
        key: 'lastmile',
        accent: '#06b6d4',
        heading: t('logistics.home.whyCards.lastmile.heading'),
        body: t('logistics.home.whyCards.lastmile.body'),
      },
    ],
    [t],
  );

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
      <PageMeta
        title={t('logistics.home.heroTitle')}
        description={t('logistics.home.heroSubtitle')}
        url="https://oxsteed.com/logistics"
        noIndex
      />
      <div className="lx-home">

        {/* ── Hero ───────────────────────────────────────────── */}
        <div className="lxh-hero">
          <p className="lxh-eyebrow">{t('logistics.home.title')}</p>
          <h1 className="lxh-title">
            {t('logistics.home.heroTitle')}
          </h1>
          <p className="lxh-sub">
            {t('logistics.home.heroSubtitle')}
          </p>
          <div className="lxh-actions">
            {user ? (
              <Link to={recommendedWorkspace} className="lx-btn-primary">
                {t('logistics.home.openWorkspace')}
              </Link>
            ) : (
              <>
                <Link to="/join" className="lx-btn-primary">
                  {t('logistics.home.getStarted')}
                </Link>
                <Link to="/logistics/campaigns" className="lx-btn-ghost">
                  {t('logistics.home.browseOpenCampaigns')}
                </Link>
              </>
            )}
          </div>
        </div>

        {/* ── Why this exists ────────────────────────────────── */}
        <section className="lxh-why">
          {whyCards.map((card) => (
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
              <span className="lxh-campaigns-label">{t('logistics.home.openCampaigns')}</span>
              <Link to="/logistics/campaigns?open=true" className="lx-link">
                {t('logistics.home.viewAll')}
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
                    <span>
                      {t('logistics.home.unitsProgress', {
                        current: c.current_committed_qty || 0,
                        target: c.target_moq,
                        units: t('logistics.campaigns.units'),
                      })}
                    </span>
                    <span
                      className="lx-status-pill"
                      style={{ background: STATUS_COLOR[c.status] || '#64748b' }}
                    >
                      {t(`logistics.status.${c.status}`, { defaultValue: c.status })}
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
            <h2 className="lxh-cta-heading">{t('logistics.home.readyToStart')}</h2>
            <p className="lxh-cta-body">
              {t('logistics.home.readyToStartBody')}
            </p>
            <Link to="/join" className="lx-btn-primary">
              {t('logistics.home.createAccount')}
            </Link>
          </div>
        )}

      </div>
    </PageShell>
  );
}
