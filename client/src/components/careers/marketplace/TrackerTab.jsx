import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getCareerTracker, setSavedCareerJobStatus, unsaveCareerJob } from '../../../api/careers';
import { ActionButton, Empty, Loading, LoadError, StageChip, useLoad } from '../ui';
import { formatDate, formatPayRange } from '../../../features/careers/careersModel';
import CandidateInterviews from './CandidateInterviews';
import MessageThread from './MessageThread';

/** "My jobs": saved, applied (with messages and interviews) and archived. */
export default function TrackerTab() {
  const { t, i18n } = useTranslation();
  const data = useLoad(() => getCareerTracker(), []);
  const [open, setOpen] = useState(null); // `${appId}:messages|interviews`
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <LoadError error={data.error} onRetry={data.reload} />;
  const { saved = [], archived = [], applied = [] } = data.data || {};
  const toggle = (key) => setOpen((cur) => (cur === key ? null : key));
  const savedRow = (s, isArchived) => (
    <article key={s.opening_id} className="ox-careers-panel">
      <div className="ox-careers-row">
        <div>
          <Link to={`/careers/${s.opening_id}`}><strong>{s.title}</strong></Link>
          <p className="ox-careers-subtle">{s.employer_name} · {formatPayRange(s, i18n.language)} {t(`careers.period.${s.compensation_period}`)} · {t('careers.mk.tracker.savedOn', { date: formatDate(s.saved_at, i18n.language) })}</p>
        </div>
        {s.applied ? <span className="ox-careers-chip ok">{t('careers.mk.tracker.applied')}</span> : null}
        {s.opening_status !== 'open' ? <span className="ox-careers-chip warn">{t(`careers.openingStatus.${s.opening_status}`)}</span> : null}
      </div>
      <div className="ox-careers-actions">
        {!s.applied && s.opening_status === 'open' ? <Link className="ox-careers-btn primary" to={`/careers/${s.opening_id}`}>{t('careers.mk.tracker.applyNow')}</Link> : null}
        <ActionButton onClick={async () => { await setSavedCareerJobStatus(s.opening_id, isArchived ? 'saved' : 'archived'); data.reload(); }}>
          {isArchived ? t('careers.mk.tracker.restore') : t('careers.mk.tracker.archive')}
        </ActionButton>
        <ActionButton danger onClick={async () => { await unsaveCareerJob(s.opening_id); data.reload(); }}>{t('careers.mk.actions.unsave')}</ActionButton>
      </div>
    </article>
  );
  return (
    <div className="ox-careers-grid">
      <section className="ox-careers-section">
        <h2>{t('careers.mk.tracker.appliedTitle')}</h2>
        {!applied.length ? <Empty>{t('careers.mk.tracker.noApplied')}</Empty> : applied.map((a) => (
          <article key={a.id} className="ox-careers-panel">
            <div className="ox-careers-row">
              <div>
                <Link to={`/careers/${a.opening_id}`}><strong>{a.title}</strong></Link>
                <p className="ox-careers-subtle">{a.employer_name} · {t('careers.applied', { date: formatDate(a.created_at, i18n.language) })}{a.viewed_by_employer ? ` · ${t('careers.mk.tracker.viewed')}` : ''}</p>
              </div>
              <StageChip stage={a.stage} />
            </div>
            <div className="ox-careers-actions">
              <button type="button" className="ox-careers-btn" aria-expanded={open === `${a.id}:messages`} onClick={() => toggle(`${a.id}:messages`)} data-track="ui.e3d622107e.1">
                {t('careers.mk.messages.open')}{a.unread_messages ? ` (${a.unread_messages})` : ''}
              </button>
              <button type="button" className="ox-careers-btn" aria-expanded={open === `${a.id}:interviews`} onClick={() => toggle(`${a.id}:interviews`)} data-track="ui.e3d622107e.2">
                {t('careers.mk.interviews.title')}{a.open_proposals ? ` (${a.open_proposals})` : ''}
              </button>
            </div>
            {open === `${a.id}:messages` ? <MessageThread applicationId={a.id} side="candidate" /> : null}
            {open === `${a.id}:interviews` ? <CandidateInterviews application={a} onChanged={data.reload} /> : null}
          </article>
        ))}
      </section>
      <section className="ox-careers-section">
        <h2>{t('careers.mk.tracker.savedTitle')}</h2>
        {!saved.length ? <Empty>{t('careers.mk.tracker.noSaved')}</Empty> : saved.map((s) => savedRow(s, false))}
      </section>
      {archived.length ? (
        <details className="ox-careers-section">
          <summary>{t('careers.mk.tracker.archivedTitle', { count: archived.length })}</summary>
          {archived.map((s) => savedRow(s, true))}
        </details>
      ) : null}
    </div>
  );
}
