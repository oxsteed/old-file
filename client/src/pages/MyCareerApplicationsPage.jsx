import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { listMyCareerApplications } from '../api/careers';
import { Tabs, useLoad } from '../components/careers/ui';
import ApplicationsTab from '../components/careers/worker/ApplicationsTab';
import InvitationsTab from '../components/careers/worker/InvitationsTab';
import ProfileTab from '../components/careers/worker/ProfileTab';
import PrivacyTab from '../components/careers/worker/PrivacyTab';
import GrowthTab from '../components/careers/worker/GrowthTab';
import '../styles/CareerSystem.css';

const TABS = ['applications', 'jobs', 'invitations', 'profile', 'privacy'];

/** "My careers": applications, offers, invitations, profile and privacy. */
export default function MyCareerApplicationsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'applications';
  const setTab = (next) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', next); return n; }, { replace: true });
  const apps = useLoad(() => listMyCareerApplications().catch(() => []), []);
  const businesses = useMemo(() => {
    const seen = new Map();
    for (const a of apps.data || []) if (a.business_id && !seen.has(a.business_id)) seen.set(a.business_id, { id: a.business_id, name: a.employer_name });
    return [...seen.values()];
  }, [apps.data]);
  const pendingOffers = (apps.data || []).reduce((n, a) => n + (a.offers || []).filter((o) => o.status === 'pending').length, 0);

  return (
    <PageShell>
      <PageMeta title={t('careers.my.metaTitle')} description={t('careers.metaDesc')} />
      <div className="ox-careers">
        <p className="ox-careers-kicker">{t('careers.kicker')}</p>
        <h1>{t('careers.my.title')}</h1>
        <p className="ox-careers-lead">{t('careers.my.subtitle')}</p>
        <div className="ox-careers-actions">
          <Link className="ox-careers-btn" to="/careers">{t('careers.browseRoles')}</Link>
        </div>
        <Tabs
          label={t('careers.my.title')}
          active={tab}
          onChange={setTab}
          tabs={TABS.map((id) => ({ id, label: t(`careers.my.tabs.${id}`), badge: id === 'applications' && pendingOffers ? pendingOffers : null }))}
        />
        {tab === 'applications' ? <ApplicationsTab /> : null}
        {tab === 'jobs' ? <GrowthTab onEditProfile={() => setTab('profile')} /> : null}
        {tab === 'invitations' ? <InvitationsTab /> : null}
        {tab === 'profile' ? <ProfileTab previewBusinesses={businesses} /> : null}
        {tab === 'privacy' ? <PrivacyTab /> : null}
      </div>
    </PageShell>
  );
}
