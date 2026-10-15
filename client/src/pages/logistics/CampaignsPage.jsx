import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/PageShell';
import PageMeta from '../../components/PageMeta';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import CampaignBrowser from '../../components/logistics/CampaignBrowser';
import '../../styles/logistics/LogisticsHomePage.css';

/**
 * CampaignsPage - the /logistics/campaigns page (Phase 1 refactor).
 *
 * Browsing UI is shared with the /logistics hub through CampaignBrowser.
 * Filter state (search, lane, status, open, page) lives in the URL search
 * params, so filters, pagination, and scroll position are preserved when
 * moving between the hub and this page.
 */
export default function CampaignsPage() {
  const { t } = useTranslation();

  return (
    <PageShell>
      <PageMeta
        title={t('logistics.campaigns.title', 'Pooled Campaigns')}
        description={t('logistics.campaigns.subtitle', 'Join group buying campaigns to unlock MOQ pricing across lanes.')}
        url="https://oxsteed.com/logistics/campaigns"
        noIndex
      />
      <LogisticsLayout>
        <div className="lx-hub">
          <p className="lx-hub-eyebrow">{t('logistics.hub.eyebrow')}</p>
          <h1 className="lx-hub-title">{t('logistics.campaigns.title', 'Pooled Campaigns')}</h1>
          <p className="lx-hub-intro">{t('logistics.campaigns.subtitle')}</p>
          <div className="lx-hub-actions">
            <Link to="/logistics/campaigns/new" className="lx-cb-btn-primary">
              {t('logistics.hub.organizeCta')}
            </Link>
            <Link to="/logistics/requests/new" className="lx-cb-btn-ghost">
              {t('logistics.campaigns.startRequest', 'Start a Request')}
            </Link>
          </div>

          <CampaignBrowser />
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
