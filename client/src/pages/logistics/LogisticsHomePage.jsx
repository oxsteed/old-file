import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { getBusinessProcurementAccess } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import PageMeta from '../../components/PageMeta';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import CampaignBrowser from '../../components/logistics/CampaignBrowser';
import {
  isBusinessProcurementEligibleMembership,
} from '../../utils/logisticsWorkspaces';
import '../../styles/logistics/LogisticsHomePage.css';

/**
 * LogisticsHomePage - the /logistics browsing hub (Phase 1 refactor).
 *
 * Layout order per the refactor spec:
 *   1. Compact intro (1-2 lines) + the two primary actions
 *      (Organize a campaign, Business procurement)
 *   2. CampaignBrowser (search, lane/status filters, results)
 *   3. Explanatory/marketing content, collapsed, below the actions
 *
 * Guests see only public campaigns; the /logistics/campaigns endpoint is
 * public-safe server-side. No simulated campaigns in empty states.
 */
export default function LogisticsHomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [businessAccess, setBusinessAccess] = useState({
    eligibleBusinesses: [],
    businesses: [],
  });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getBusinessProcurementAccess()
      .then((res) => {
        if (cancelled) return;
        const businesses = Array.isArray(res?.businesses) ? res.businesses : [];
        setBusinessAccess({
          businesses,
          eligibleBusinesses: businesses.filter(isBusinessProcurementEligibleMembership),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <PageShell>
      <PageMeta
        title={t('logistics.hub.title')}
        description={t('logistics.hub.intro')}
        url="https://oxsteed.com/logistics"
        noIndex
      />
      <LogisticsLayout businessAccess={businessAccess}>
        <div className="lx-hub">
          {/* ── Compact intro + primary actions ── */}
          <p className="lx-hub-eyebrow">{t('logistics.hub.eyebrow')}</p>
          <h1 className="lx-hub-title">{t('logistics.hub.title')}</h1>
          <p className="lx-hub-intro">{t('logistics.hub.intro')}</p>
          <div className="lx-hub-actions">
            <Link
              to={user ? '/logistics/campaigns/new' : '/join'}
              className="lx-cb-btn-primary"
            >
              {t('logistics.hub.organizeCta')}
            </Link>
            <Link to="/logistics/business-procurement" className="lx-cb-btn-ghost">
              {t('logistics.hub.procurementCta')}
            </Link>
          </div>

          {/* ── Campaign browsing ── */}
          <CampaignBrowser />

          {/* ── Explainer, collapsed below the useful actions ── */}
          <details className="lx-hub-about">
            <summary className="lx-hub-about-summary">
              {t('logistics.hub.aboutToggle')}
            </summary>
            <div className="lx-hub-about-body">
              <h2 className="lx-hub-about-heading">{t('logistics.hub.aboutTitle')}</h2>
              <p>{t('logistics.hub.aboutBody')}</p>
              {!user && (
                <Link to="/join" className="lx-cb-btn-secondary">
                  {t('logistics.home.createAccount', 'Create an account')}
                </Link>
              )}
            </div>
          </details>
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
