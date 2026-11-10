import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { INTERVIEW_TIP_SECTIONS } from '../features/careers/marketplaceModel';
import '../styles/CareerSystem.css';

const POINTS = 4;

/** Interview tips: preparation, common questions, STAR, formats, and the candidate's rights. */
export default function CareerInterviewTipsPage() {
  const { t } = useTranslation();
  return (
    <PageShell>
      <PageMeta title={t('careers.mk.tips.metaTitle')} description={t('careers.mk.tips.metaDesc')} />
      <div className="ox-careers">
        <Link className="ox-careers-btn" to="/careers">{t('careers.back')}</Link>
        <h1>{t('careers.mk.tips.title')}</h1>
        <p className="ox-careers-lead">{t('careers.mk.tips.lead')}</p>
        <nav aria-label={t('careers.mk.tips.contents')}>
          <ul className="ox-careers-list">
            {INTERVIEW_TIP_SECTIONS.map((s) => <li key={s}><a href={`#tips-${s}`}>{t(`careers.mk.tips.sections.${s}.title`)}</a></li>)}
          </ul>
        </nav>
        {INTERVIEW_TIP_SECTIONS.map((s) => (
          <section key={s} id={`tips-${s}`} className="ox-careers-section">
            <h2>{t(`careers.mk.tips.sections.${s}.title`)}</h2>
            <ul className="ox-careers-list">
              {Array.from({ length: POINTS }, (_, i) => <li key={i}>{t(`careers.mk.tips.sections.${s}.p${i + 1}`)}</li>)}
            </ul>
          </section>
        ))}
        <div className="ox-careers-actions">
          <Link className="ox-careers-btn primary" to="/careers">{t('careers.browseRoles')}</Link>
          <Link className="ox-careers-btn" to="/careers/me?tab=resume">{t('careers.mk.tips.buildResume')}</Link>
        </div>
      </div>
    </PageShell>
  );
}
