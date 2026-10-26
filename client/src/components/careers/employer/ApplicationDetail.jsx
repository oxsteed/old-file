import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  approveCareerOffer, cancelCareerInterview, changeCareerStage, createCareerOffer, getApplicantResumeUrl,
  getCareerApplication, requestBackgroundCheck, scheduleCareerInterview, withdrawCareerOffer,
} from '../../../api/careers';
import {
  FACT_TYPES, INTERVIEW_MODES, NEUTRAL_MOVES, PAY_PERIODS, REJECTION_REASONS, TEAM_ROLES,
  applicantLabel, factValueText, fieldErrorsFrom, formatDate, formatOfferPay, formatWhen, zonedToIso,
} from '../../../features/careers/careersModel';
import { ActionButton, Check, ErrorNotice, Field, Loading, LoadError, Notice, StageChip, useLoad } from '../ui';
import EmployerOnboarding from './EmployerOnboarding';

function RejectForm({ app, onDone }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ reason_code: '', requirement: '', fact_type: '', confirm: false });
  const [error, setError] = useState(null);
  return (
    <div className="ox-careers-app">
      <Field label={t('careers.employer.rejectReason')} htmlFor={`rej-${app.id}`}>
        <select id={`rej-${app.id}`} value={f.reason_code} onChange={(e) => setF({ ...f, reason_code: e.target.value })}>
          <option value="">{t('careers.common.choose')}</option>
          {REJECTION_REASONS.map((r) => <option key={r} value={r}>{t(`careers.rejection.${r}`)}</option>)}
        </select>
      </Field>
      {f.reason_code === 'requirements_not_met' ? (
        <Field label={t('careers.employer.rejectRequirement')} htmlFor={`rej-req-${app.id}`}>
          <input id={`rej-req-${app.id}`} maxLength={120} value={f.requirement} onChange={(e) => setF({ ...f, requirement: e.target.value })} />
        </Field>
      ) : null}
      <Field label={t('careers.employer.rejectFact')} htmlFor={`rej-fact-${app.id}`} hint={t('careers.employer.rejectFactHint')}>
        <select id={`rej-fact-${app.id}`} value={f.fact_type} onChange={(e) => setF({ ...f, fact_type: e.target.value })}>
          <option value="">{t('careers.common.none')}</option>
          {FACT_TYPES.map((x) => <option key={x} value={x}>{t(`careers.facts.${x}`)}</option>)}
        </select>
      </Field>
      <p className="ox-careers-subtle">{t('careers.employer.rejectShown')}</p>
      <Check id={`rej-confirm-${app.id}`} label={t('careers.employer.rejectConfirm')} checked={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} />
      <ErrorNotice error={error} />
      <div className="ox-careers-actions">
        <ActionButton
          danger
          disabled={!f.reason_code || !f.confirm}
          onClick={async () => {
            setError(null);
            try { await changeCareerStage(app.id, { stage: 'rejected', ...f, fact_type: f.fact_type || undefined }); onDone(true); } catch (err) { setError(err); }
          }}
        >
          {t('careers.employer.reject')}
        </ActionButton>
        <button type="button" className="ox-careers-btn" onClick={() => onDone(false)}>{t('careers.common.cancel')}</button>
      </div>
    </div>
  );
}

function InterviewForm({ app, timezone, onDone }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ when: '', timezone: timezone || 'UTC', mode: 'video', duration_minutes: 30, location: '', notes: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  return (
    <div className="ox-careers-app">
      <div className="ox-careers-form-grid">
        <Field label={t('careers.interview.when')} htmlFor={`iv-when-${app.id}`} error={errors.scheduled_at}>
          <input id={`iv-when-${app.id}`} type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} />
        </Field>
        <Field label={t('careers.fields.timezone')} htmlFor={`iv-tz-${app.id}`} error={errors.timezone}>
          <input id={`iv-tz-${app.id}`} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />
        </Field>
        <Field label={t('careers.interview.modeLabel')} htmlFor={`iv-mode-${app.id}`}>
          <select id={`iv-mode-${app.id}`} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
            {INTERVIEW_MODES.map((m) => <option key={m} value={m}>{t(`careers.interview.mode.${m}`)}</option>)}
          </select>
        </Field>
        <Field label={t('careers.interview.duration')} htmlFor={`iv-dur-${app.id}`} error={errors.duration_minutes}>
          <input id={`iv-dur-${app.id}`} type="number" min={10} max={240} value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label={f.mode === 'video' ? t('careers.interview.link') : t('careers.interview.location')} htmlFor={`iv-loc-${app.id}`} error={errors.location}>
        <input id={`iv-loc-${app.id}`} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
      </Field>
      <Field label={t('careers.interview.notes')} htmlFor={`iv-notes-${app.id}`}>
        <textarea id={`iv-notes-${app.id}`} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      <ErrorNotice error={error} />
      <div className="ox-careers-actions">
        <ActionButton
          primary
          disabled={!f.when}
          onClick={async () => {
            setError(null);
            setErrors({});
            try {
              await scheduleCareerInterview(app.id, { scheduled_at: zonedToIso(f.when, f.timezone), timezone: f.timezone, mode: f.mode, duration_minutes: f.duration_minutes, location: f.location || null, notes: f.notes || null });
              toast.success(t('careers.interview.scheduled'));
              onDone(true);
            } catch (err) { setErrors(fieldErrorsFrom(err)); setError(err); }
          }}
        >
          {t('careers.interview.schedule')}
        </ActionButton>
        <button type="button" className="ox-careers-btn" onClick={() => onDone(false)}>{t('careers.common.cancel')}</button>
      </div>
    </div>
  );
}

function OfferForm({ app, opening, locations, onDone }) {
  const { t } = useTranslation();
  const [f, setF] = useState({
    title: opening?.title || '', pay: opening?.compensation_min ?? '', pay_period: opening?.compensation_period || 'hourly', start_date: '',
    expires_in_days: 7, location_id: (app.preferred_location_ids || [])[0] || (opening?.location_ids || [])[0] || '', team_role: opening?.team_role || 'employee',
    shift_date: '', shift_start: '', shift_end: '', outside_posted_range_reason: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const outside = opening && f.pay !== '' && (Number(f.pay) < Number(opening.compensation_min) || Number(f.pay) > Number(opening.compensation_max));
  const storeChoices = locations.filter((l) => !(opening?.location_ids || []).length || opening.location_ids.map(Number).includes(Number(l.id)));
  return (
    <div className="ox-careers-app">
      <div className="ox-careers-form-grid">
        <Field label={t('careers.fields.title')} htmlFor={`of-title-${app.id}`} error={errors.title}>
          <input id={`of-title-${app.id}`} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label={t('careers.offer.payLabel')} htmlFor={`of-pay-${app.id}`} error={errors.pay}>
          <input id={`of-pay-${app.id}`} type="number" min={0} step="0.01" value={f.pay} onChange={(e) => setF({ ...f, pay: e.target.value })} />
        </Field>
        <Field label={t('careers.fields.payPeriod')} htmlFor={`of-period-${app.id}`}>
          <select id={`of-period-${app.id}`} value={f.pay_period} onChange={(e) => setF({ ...f, pay_period: e.target.value })}>
            {PAY_PERIODS.map((p) => <option key={p} value={p}>{t(`careers.period.${p}`)}</option>)}
          </select>
        </Field>
        <Field label={t('careers.offer.startDate')} htmlFor={`of-start-${app.id}`} error={errors.start_date}>
          <input id={`of-start-${app.id}`} type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
        </Field>
        <Field label={t('careers.offer.expiresIn')} htmlFor={`of-exp-${app.id}`} error={errors.expires_in_days}>
          <input id={`of-exp-${app.id}`} type="number" min={1} max={30} value={f.expires_in_days} onChange={(e) => setF({ ...f, expires_in_days: Number(e.target.value) })} />
        </Field>
        {storeChoices.length ? (
          <Field label={t('careers.offer.store')} htmlFor={`of-loc-${app.id}`} error={errors.location_id}>
            <select id={`of-loc-${app.id}`} value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}>
              <option value="">{t('careers.common.choose')}</option>
              {storeChoices.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        ) : null}
        {opening?.employer_type !== 'platform' ? (
          <Field label={t('careers.fields.teamRole')} htmlFor={`of-role-${app.id}`} error={errors.team_role}>
            <select id={`of-role-${app.id}`} value={f.team_role} onChange={(e) => setF({ ...f, team_role: e.target.value })}>
              {TEAM_ROLES.map((r) => <option key={r} value={r}>{t(`careers.teamRole.${r}`)}</option>)}
            </select>
          </Field>
        ) : null}
      </div>
      <fieldset className="ox-careers-section">
        <legend>{t('careers.offer.firstShift')}</legend>
        <div className="ox-careers-form-grid">
          <input aria-label={t('careers.offer.shiftDate')} type="date" value={f.shift_date} onChange={(e) => setF({ ...f, shift_date: e.target.value })} />
          <input aria-label={t('careers.profile.from')} type="time" value={f.shift_start} onChange={(e) => setF({ ...f, shift_start: e.target.value })} />
          <input aria-label={t('careers.profile.to')} type="time" value={f.shift_end} onChange={(e) => setF({ ...f, shift_end: e.target.value })} />
        </div>
      </fieldset>
      {outside ? (
        <Field label={t('careers.offer.outsideReason')} htmlFor={`of-why-${app.id}`} hint={t('careers.offer.outsideHint')} error={errors.outside_posted_range_reason}>
          <input id={`of-why-${app.id}`} value={f.outside_posted_range_reason} onChange={(e) => setF({ ...f, outside_posted_range_reason: e.target.value })} />
        </Field>
      ) : null}
      <ErrorNotice error={error} />
      <div className="ox-careers-actions">
        <ActionButton
          primary
          onClick={async () => {
            setError(null);
            setErrors({});
            try {
              const body = {
                title: f.title, pay: Number(f.pay), pay_period: f.pay_period, start_date: f.start_date || null, expires_in_days: f.expires_in_days,
                location_id: f.location_id ? Number(f.location_id) : null, team_role: f.team_role,
                first_shift: f.shift_date ? { date: f.shift_date, start: f.shift_start, end: f.shift_end } : null,
                outside_posted_range_reason: outside ? f.outside_posted_range_reason : null,
              };
              const r = await createCareerOffer(app.id, body);
              toast.success(r.offer?.status === 'awaiting_approval' ? t('careers.offer.awaitingApproval') : t('careers.offer.sent'));
              onDone(true);
            } catch (err) { setErrors(fieldErrorsFrom(err)); setError(err); }
          }}
        >
          {t('careers.offer.send')}
        </ActionButton>
        <button type="button" className="ox-careers-btn" onClick={() => onDone(false)}>{t('careers.common.cancel')}</button>
      </div>
    </div>
  );
}

export default function ApplicationDetail({ applicationId, opening, locations = [], canApprove, onChanged }) {
  const { t, i18n } = useTranslation();
  const { data: app, loading, error, reload } = useLoad(() => getCareerApplication(applicationId), [applicationId]);
  const [mode, setMode] = useState(null);
  if (loading && !app) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!app) return null;
  const done = (changed) => { setMode(null); if (changed) { reload(); onChanged?.(); } };
  const moves = NEUTRAL_MOVES[app.stage] || [];
  const canReject = ['received', 'screening', 'interview', 'assessment', 'offer'].includes(app.stage);
  const canOffer = ['received', 'screening', 'interview', 'assessment', 'offer'].includes(app.stage) && !(app.offers || []).some((o) => ['pending', 'awaiting_approval'].includes(o.status));
  const tz = opening?.timezone || app.timezone;
  const check = app.background_check;
  const conditionalOffer = (app.offers || []).find((o) => ['pending', 'accepted'].includes(o.status) && (o.conditions || []).includes('background_check'));

  return (
    <article className="ox-careers-panel">
      <div className="ox-careers-row">
        <div>
          <h2 className="ox-careers-card-title">{applicantLabel(app, t)}</h2>
          <p className="ox-careers-subtle">
            {t(`careers.employer.verified.${app.verified_label}`)} · {t('careers.applied', { date: formatDate(app.created_at, i18n.language) })}
            {app.identity_hidden ? ` · ${t('careers.employer.identityHidden')}` : ''}
          </p>
        </div>
        <StageChip stage={app.stage} />
      </div>
      {app.email || app.phone ? <p>{[app.email, app.phone].filter(Boolean).join(' · ')}</p> : null}
      <p>
        {t('careers.employer.authorized', { answer: app.authorized_to_work ? t('careers.common.yes') : t('careers.common.no') })} ·{' '}
        {t('careers.employer.sponsorship', { answer: app.needs_sponsorship ? t('careers.common.yes') : t('careers.common.no') })}
      </p>
      {app.accommodation_requested ? <Notice>{t('careers.employer.accommodation')}</Notice> : null}
      {app.preferred_location_ids?.length ? (
        <p>{t('careers.employer.preferredStores', { list: app.preferred_location_ids.map((id) => locations.find((l) => Number(l.id) === Number(id))?.name || `#${id}`).join(', ') })}</p>
      ) : null}
      {app.languages?.length ? <p>{t('careers.fields.languages')}: {app.languages.join(', ')}</p> : null}

      <div className="ox-careers-section">
        <h3>{t('careers.employer.sharedFacts')}</h3>
        {app.is_guest ? <p className="ox-careers-subtle">{t('careers.employer.guestNoFacts')}</p> : null}
        <div className="ox-careers-facts">
          {(app.shared_facts || []).map((f, i) => <span key={`${f.fact_type}-${i}`} className="ox-careers-chip ok">{t(`careers.facts.${f.fact_type}`)} {factValueText(f, i18n.language)}</span>)}
          {(app.employer_facts || []).map((f) => (
            <span key={f.fact_type} className="ox-careers-chip">
              {f.fact_type === 'rehire_eligible' ? (f.value?.eligible ? t('careers.employer.rehireEligible') : t('careers.employer.rehireNotEligible')) : t(`careers.check.status.${f.value?.status}`)}
            </span>
          ))}
        </div>
        {app.checklist?.length ? (
          <ul className="ox-careers-steps">
            {app.checklist.map((c, i) => (
              <li key={`${c.kind}-${c.code}-${i}`}>
                <span>{t(`careers.employer.checklist.${c.kind}`, { code: c.code || '' })}{c.required ? '' : ` (${t('careers.employer.preferred')})`}</span>
                <span className={`ox-careers-chip ${c.status === 'met' ? 'ok' : 'warn'}`}>{c.status === 'met' ? t('careers.employer.met') : t('careers.employer.notShown')}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {app.cover_letter ? <div className="ox-careers-section"><h3>{t('careers.fields.coverLetter')}</h3><p className="ox-careers-prose">{app.cover_letter}</p></div> : null}
      {app.has_resume ? (
        <ActionButton onClick={async () => { const r = await getApplicantResumeUrl(app.id); if (r.url) window.open(r.url, '_blank', 'noopener'); }}>{t('careers.employer.openResume')}</ActionButton>
      ) : null}

      {(app.interviews || []).length ? (
        <div className="ox-careers-section">
          <h3>{t('careers.interview.title')}</h3>
          {app.interviews.map((i) => (
            <div key={i.id} className="ox-careers-row ox-careers-app">
              <span>{formatWhen(i.scheduled_at, i.timezone, i18n.language)} · {t(`careers.interview.mode.${i.mode}`)}{i.cancelled_at ? ` · ${t('careers.interview.cancelled')}` : ''}</span>
              {!i.cancelled_at ? <ActionButton onClick={async () => { await cancelCareerInterview(app.id, i.id); done(true); }}>{t('careers.interview.cancel')}</ActionButton> : null}
            </div>
          ))}
        </div>
      ) : null}

      {(app.offers || []).length ? (
        <div className="ox-careers-section">
          <h3>{t('careers.offer.heading')}</h3>
          {app.offers.map((o) => (
            <div key={o.id} className="ox-careers-app">
              <div className="ox-careers-row">
                <span>{o.title} · {formatOfferPay(o, i18n.language)} {t(`careers.period.${o.pay_period}`)}</span>
                <span className="ox-careers-chip">{t(`careers.offer.status.${o.status}`)}</span>
              </div>
              {o.above_range ? <p className="ox-careers-subtle">{t('careers.offer.aboveRange')}</p> : null}
              <div className="ox-careers-actions">
                {o.status === 'awaiting_approval' && canApprove ? <ActionButton primary onClick={async () => { await approveCareerOffer(o.id); done(true); }}>{t('careers.offer.approve')}</ActionButton> : null}
                {['pending', 'awaiting_approval'].includes(o.status) ? <ActionButton danger confirm={t('careers.offer.withdrawConfirm')} onClick={async () => { await withdrawCareerOffer(o.id); done(true); }}>{t('careers.offer.withdraw')}</ActionButton> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {opening?.background_check_required || check ? (
        <div className="ox-careers-section">
          <h3>{t('careers.check.title')}</h3>
          <p className="ox-careers-subtle">{t('careers.check.afterOffer')}</p>
          {check ? <p>{t(`careers.check.status.${check.status}`)}</p> : null}
          {!check && conditionalOffer ? (
            <ActionButton onClick={async () => { await requestBackgroundCheck(app.id); done(true); }}>{t('careers.check.request')}</ActionButton>
          ) : null}
        </div>
      ) : null}

      {app.onboarding_run ? <EmployerOnboarding runId={app.onboarding_run.id} /> : null}

      {mode === 'reject' ? <RejectForm app={app} onDone={done} /> : null}
      {mode === 'interview' ? <InterviewForm app={app} timezone={tz} onDone={done} /> : null}
      {mode === 'offer' ? <OfferForm app={app} opening={opening} locations={locations} onDone={done} /> : null}
      {!mode ? (
        <div className="ox-careers-actions">
          {moves.map((s) => (
            <ActionButton key={s} onClick={async () => { await changeCareerStage(app.id, { stage: s }); done(true); }}>{t('careers.employer.moveTo', { stage: t(`careers.stage.${s}`) })}</ActionButton>
          ))}
          {['received', 'screening', 'interview', 'assessment'].includes(app.stage) ? <button type="button" className="ox-careers-btn" onClick={() => setMode('interview')}>{t('careers.interview.schedule')}</button> : null}
          {canOffer ? <button type="button" className="ox-careers-btn primary" onClick={() => setMode('offer')}>{t('careers.offer.make')}</button> : null}
          {canReject ? <button type="button" className="ox-careers-btn danger" onClick={() => setMode('reject')}>{t('careers.employer.reject')}</button> : null}
        </div>
      ) : null}
      {app.stage === 'offer' ? <p className="ox-careers-subtle">{t('careers.employer.hireByAcceptance')}</p> : null}

      {app.events?.length ? (
        <details className="ox-careers-section">
          <summary>{t('careers.timeline')}</summary>
          <ul className="ox-careers-steps">
            {app.events.map((e, i) => <li key={i}><span>{e.from_stage ? `${t(`careers.stage.${e.from_stage}`)} → ` : ''}{t(`careers.stage.${e.to_stage}`)}</span><span className="ox-careers-subtle">{formatDate(e.created_at, i18n.language)}</span></li>)}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
