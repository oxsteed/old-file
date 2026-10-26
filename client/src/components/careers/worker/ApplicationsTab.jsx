import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getCareerEeo, listMyCareerApplications, saveCareerEeo, withdrawCareerApplication } from '../../../api/careers';
import { ACTIVE_STAGES, eeoPayload, formatDate, formatWhen } from '../../../features/careers/careersModel';
import { ActionButton, Empty, ErrorNotice, Loading, LoadError, Notice, StageChip, useLoad } from '../ui';
import EeoForm from '../EeoForm';
import OfferCard from './OfferCard';
import OnboardingStatus from './OnboardingStatus';

function EeoSection({ application }) {
  const { t } = useTranslation();
  const status = useLoad(() => getCareerEeo(application.id), [application.id]);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState({});
  const [error, setError] = useState(null);
  if (!status.data?.offered) return null;
  if (status.data.submitted && !open) {
    return <p className="ox-careers-subtle">{t('careers.eeo.submitted')}</p>;
  }
  if (!open) {
    return <button type="button" className="ox-careers-btn" onClick={() => setOpen(true)}>{t('careers.eeo.add')}</button>;
  }
  return (
    <div>
      <EeoForm value={value} onChange={setValue} idPrefix={`eeo-${application.id}`} />
      <ErrorNotice error={error} />
      <div className="ox-careers-actions">
        <ActionButton
          primary
          disabled={!eeoPayload(value)}
          onClick={async () => {
            setError(null);
            try { await saveCareerEeo(application.id, eeoPayload(value)); setOpen(false); status.reload(); } catch (err) { setError(err); }
          }}
        >
          {t('careers.eeo.save')}
        </ActionButton>
        <button type="button" className="ox-careers-btn" onClick={() => setOpen(false)}>{t('careers.common.cancel')}</button>
      </div>
    </div>
  );
}

function ApplicationCard({ app, onChanged }) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState(null);
  const active = ACTIVE_STAGES.includes(app.stage);
  return (
    <article className="ox-careers-panel">
      <div className="ox-careers-row">
        <div>
          <p className="ox-careers-kicker">{app.employer_name}</p>
          <h2 className="ox-careers-card-title"><Link to={`/careers/${app.opening_id}`}>{app.title}</Link></h2>
        </div>
        <StageChip stage={app.stage} />
      </div>
      <p className="ox-careers-subtle">{t('careers.applied', { date: formatDate(app.created_at, i18n.language) })}{app.is_guest ? ` · ${t('careers.guestApplication')}` : ''}</p>
      {app.stage === 'rejected' && app.rejection_reason_code ? (
        <Notice>
          {t('careers.rejectionShown', { reason: t(`careers.rejection.${app.rejection_reason_code}`) })}
          {app.rejection_requirement ? ` ${t('careers.rejectionRequirement', { requirement: app.rejection_requirement })}` : ''}
          {app.rejection_fact_type ? ` ${t('careers.rejectionFact', { fact: t(`careers.facts.${app.rejection_fact_type}`) })}` : ''}
        </Notice>
      ) : null}
      {(app.interviews || []).filter((i) => i.status !== 'cancelled').map((i) => (
        <div key={i.id} className="ox-careers-app">
          <p><strong>{t('careers.interview.heading', { mode: t(`careers.interview.mode.${i.mode}`) })}</strong></p>
          <p>{formatWhen(i.scheduled_at, i.timezone || app.timezone, i18n.language)} · {t('careers.interview.minutes', { count: i.duration_minutes || 30 })}</p>
          {i.location ? <p>{i.location}</p> : null}
        </div>
      ))}
      {(app.offers || []).map((offer) => (
        <OfferCard key={offer.id} offer={offer} timezone={app.timezone} onDecided={onChanged} />
      ))}
      {app.onboarding_run_id ? <OnboardingStatus runId={app.onboarding_run_id} /> : null}
      {app.timeline?.length ? (
        <details className="ox-careers-section">
          <summary>{t('careers.timeline')}</summary>
          <ul className="ox-careers-steps">
            {app.timeline.map((e, idx) => (
              <li key={`${e.to_stage}-${idx}`}><span>{t(`careers.stage.${e.to_stage}`)}</span><span className="ox-careers-subtle">{formatDate(e.created_at, i18n.language)}</span></li>
            ))}
          </ul>
        </details>
      ) : null}
      {active && !app.is_guest ? <EeoSection application={app} /> : null}
      <ErrorNotice error={error} />
      {active ? (
        <div className="ox-careers-actions">
          <ActionButton
            danger
            confirm={t('careers.withdrawConfirm')}
            onClick={async () => {
              setError(null);
              try { await withdrawCareerApplication(app.id); onChanged?.(); } catch (err) { setError(err); }
            }}
          >
            {t('careers.withdraw')}
          </ActionButton>
        </div>
      ) : null}
    </article>
  );
}

export default function ApplicationsTab() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useLoad(() => listMyCareerApplications(), []);
  if (loading && !data) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data?.length) return <Empty>{t('careers.noApplications')} <Link to="/careers">{t('careers.browseRoles')}</Link></Empty>;
  return <div className="ox-careers-grid">{data.map((app) => <ApplicationCard key={app.id} app={app} onChanged={reload} />)}</div>;
}
