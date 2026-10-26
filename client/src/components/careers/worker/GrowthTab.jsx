import { useTranslation } from 'react-i18next';
import { getCareerGrowth, getJobsForYou } from '../../../api/careers';
import { factValueText } from '../../../features/careers/careersModel';
import { Empty, Loading, LoadError, Notice, useLoad } from '../ui';
import OpeningCard from '../OpeningCard';

export default function GrowthTab({ onEditProfile }) {
  const { t, i18n } = useTranslation();
  const jobs = useLoad(() => getJobsForYou(), []);
  const growth = useLoad(() => getCareerGrowth(), []);
  return (
    <div className="ox-careers-grid">
      <section className="ox-careers-section">
        <h2>{t('careers.jobsForYou.title')}</h2>
        <p className="ox-careers-subtle">{t('careers.jobsForYou.intro')}</p>
        {jobs.loading && !jobs.data ? <Loading /> : null}
        <LoadError error={jobs.error} onRetry={jobs.reload} />
        {jobs.data?.needs_postal_code ? (
          <Notice>
            {t('careers.jobsForYou.needsPostal')}{' '}
            <button type="button" className="ox-careers-btn" onClick={onEditProfile}>{t('careers.jobsForYou.editProfile')}</button>
          </Notice>
        ) : null}
        {jobs.data && !jobs.data.needs_postal_code && !jobs.data.openings?.length ? <Empty>{t('careers.jobsForYou.empty')}</Empty> : null}
        <div className="ox-careers-grid">
          {(jobs.data?.openings || []).map((o) => <OpeningCard key={o.id} opening={o} match={o.match} />)}
        </div>
      </section>
      <section className="ox-careers-panel">
        <h2>{t('careers.growth.title')}</h2>
        {growth.loading && !growth.data ? <Loading /> : null}
        <LoadError error={growth.error} onRetry={growth.reload} />
        {growth.data ? (
          <>
            <h3>{t('careers.growth.credentials')}</h3>
            {growth.data.credentials?.length ? (
              <div className="ox-careers-facts">
                {growth.data.credentials.map((f) => <span key={f.id} className="ox-careers-chip">{t(`careers.facts.${f.fact_type}`)}: {factValueText(f, i18n.language)}</span>)}
              </div>
            ) : <Empty>{t('careers.growth.noCredentials')}</Empty>}
            {growth.data.expiring?.length ? <Notice tone="warn">{t('careers.growth.expiring', { count: growth.data.expiring.length })}</Notice> : null}
            <h3>{t('careers.growth.inDemand')}</h3>
            {growth.data.in_demand_near_you?.length ? (
              <ul className="ox-careers-steps">
                {growth.data.in_demand_near_you.map((d) => (
                  <li key={d.code}>
                    <span>{d.code}</span>
                    <span className={`ox-careers-chip ${d.you_have_it ? 'ok' : ''}`}>
                      {t('careers.growth.openingsNear', { count: d.openings, km: d.radius_km })}{d.you_have_it ? ` · ${t('careers.growth.youHaveIt')}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Empty>{t('careers.growth.noDemand')}</Empty>}
          </>
        ) : null}
      </section>
    </div>
  );
}
