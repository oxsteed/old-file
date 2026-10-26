import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatPayRange, localizedOpening } from '../../features/careers/careersModel';

export default function OpeningCard({ opening, promoted = false, match = null }) {
  const { t, i18n } = useTranslation();
  const o = localizedOpening(opening, i18n.language);
  const pay = formatPayRange(o, i18n.language);
  return (
    <Link className="ox-careers-card" to={`/careers/${o.id}`}>
      <div className="ox-careers-row">
        <p className="ox-careers-kicker">
          {o.employer_name}
          {o.employer_verified ? ` · ${t('careers.verifiedEmployer')}` : ''}
        </p>
        {promoted ? <span className="ox-careers-chip warn">{t('careers.promoted')}</span> : null}
      </div>
      <h2 className="ox-careers-card-title">{o.title}</h2>
      <div className="ox-careers-meta">
        {pay ? <span className="ox-careers-chip ok">{pay} {t(`careers.period.${o.compensation_period}`)}</span> : null}
        <span className="ox-careers-chip">{t(`careers.workplace.${o.workplace_type}`)}</span>
        {o.path_stage ? <span className="ox-careers-chip">{t(`careers.path.${o.path_stage}`)}</span> : null}
        <span className="ox-careers-chip">{o.city || o.country_code || t('careers.remoteWorldwide')}</span>
        {o.employer_model === 'oxsteed_eor' ? <span className="ox-careers-chip">{t('careers.eorBadge')}</span> : null}
      </div>
      {match?.reasons?.length ? (
        <p className="ox-careers-subtle">{match.reasons.map((r) => t(`careers.match.${r}`)).join(' · ')}</p>
      ) : null}
      <p className="ox-careers-subtle">{t('careers.viewRole')}</p>
    </Link>
  );
}
