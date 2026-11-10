import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import api from '../../../api/axios';
import {
  addInterviewNote, createInterviewProposal, listInterviewNotes, listTeamProposals, rescheduleTeamInterview, runCareerAiMatch,
  suggestInterviewSlots, teamInterviewIcsUrl,
} from '../../../api/careers';
import { ActionButton, Check, Empty, Field, Notice, useCareerErrors, useLoad } from '../ui';
import { formatWhen, INTERVIEW_MODES } from '../../../features/careers/careersModel';
import { bandKey, groupSlotsByDay } from '../../../features/careers/marketplaceModel';
import { downloadVia } from './shared';
import MessageThread from './MessageThread';

function ScreenerAnswers({ app }) {
  const { t } = useTranslation();
  const answers = app.screener_answers?.answers || (Array.isArray(app.screener_answers) ? app.screener_answers : null);
  if (!answers?.length) return null;
  const show = (a) => {
    if (a.answer == null) return '—';
    if (a.answer_type === 'yes_no') return a.answer ? t('careers.common.yes') : t('careers.common.no');
    if (Array.isArray(a.answer)) return a.answer.map((c) => t(`careers.mk.screener.choice.${c}`)).join(', ');
    if (a.answer_type === 'choice' && a.preset_code) return t(`careers.mk.screener.choice.${a.answer}`);
    return String(a.answer);
  };
  return (
    <div className="ox-careers-section">
      <h3>{t('careers.mk.screener.title')}</h3>
      {app.screener_passed === false ? <Notice tone="warn">{t('careers.mk.screener.failed')}</Notice> : null}
      {app.screener_passed === true ? <span className="ox-careers-chip ok">{t('careers.mk.screener.passed')}</span> : null}
      <ul className="ox-careers-steps">
        {answers.map((a) => (
          <li key={a.question_id}>
            <span>{a.preset_code ? t(`careers.mk.screener.preset.${a.preset_code}`) : a.prompt}{a.dealbreaker ? ` (${t('careers.mk.screener.dealbreaker')})` : ''}</span>
            <span>{show(a)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AiMatch({ app }) {
  const { t } = useTranslation();
  const [match, setMatch] = useState(app.ai_match || null);
  const [note, setNote] = useState('');
  return (
    <div className="ox-careers-section">
      <h3>{t('careers.mk.ai.title')}</h3>
      <p className="ox-careers-subtle">{t('careers.mk.ai.advisory')}</p>
      {match?.band ? (
        <>
          <span className="ox-careers-chip">{t(`careers.mk.ai.band.${bandKey(match.band)}`)}</span>
          {(match.met || []).length ? <p className="ox-careers-subtle">{t('careers.mk.ai.met')}: {match.met.join(' · ')}</p> : null}
          {(match.gaps || []).length ? <p className="ox-careers-subtle">{t('careers.mk.ai.gaps')}: {match.gaps.join(' · ')}</p> : null}
        </>
      ) : null}
      {note ? <Notice>{note}</Notice> : null}
      <ActionButton onClick={async () => {
        const r = await runCareerAiMatch(app.id);
        if (r?.available) setMatch(r); else setNote(t(`careers.mk.ai.unavailable.${['no_profile', 'model_unavailable'].includes(r?.reason) ? r.reason : 'gated'}`));
      }}
      >{match ? t('careers.mk.ai.rerun') : t('careers.mk.ai.run')}</ActionButton>
    </div>
  );
}

function ProposeTimes({ app, timezone, rescheduleOf = null, onDone }) {
  const { t, i18n } = useTranslation();
  const errorText = useCareerErrors();
  const [f, setF] = useState({ mode: 'video', duration_minutes: 30, use_video_room: false, sms_reminder: false, location: '', expires_in_hours: 48 });
  const [picked, setPicked] = useState([]);
  const suggestions = useLoad(() => suggestInterviewSlots(app.id, { duration_minutes: f.duration_minutes }).catch(() => ({ slots: [] })), [app.id, f.duration_minutes]);
  const zone = suggestions.data?.timezone || timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const groups = groupSlotsByDay(suggestions.data?.slots || [], zone, i18n.language);
  const toggle = (iso) => setPicked((p) => (p.includes(iso) ? p.filter((x) => x !== iso) : [...p, iso]));
  return (
    <div className="ox-careers-panel">
      <h4>{rescheduleOf ? t('careers.mk.interviews.offerNewTimes') : t('careers.mk.interviews.letPick')}</h4>
      <div className="ox-careers-form-grid">
        <Field label={t('careers.interview.modeLabel')} htmlFor={`pt-mode-${app.id}`}>
          <select id={`pt-mode-${app.id}`} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
            {INTERVIEW_MODES.map((m) => <option key={m} value={m}>{t(`careers.interview.mode.${m}`)}</option>)}
          </select>
        </Field>
        <Field label={t('careers.interview.duration')} htmlFor={`pt-dur-${app.id}`}>
          <select id={`pt-dur-${app.id}`} value={f.duration_minutes} onChange={(e) => { setF({ ...f, duration_minutes: Number(e.target.value) }); setPicked([]); }}>
            {[15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{t('careers.mk.interviews.minutes', { count: m })}</option>)}
          </select>
        </Field>
        {!(f.mode === 'video' && f.use_video_room) ? (
          <Field label={t('careers.interview.location')} htmlFor={`pt-loc-${app.id}`}>
            <input id={`pt-loc-${app.id}`} maxLength={300} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
          </Field>
        ) : null}
        <Field label={t('careers.mk.interviews.expiresIn')} htmlFor={`pt-exp-${app.id}`}>
          <select id={`pt-exp-${app.id}`} value={f.expires_in_hours} onChange={(e) => setF({ ...f, expires_in_hours: Number(e.target.value) })}>
            {[24, 48, 72, 168].map((h) => <option key={h} value={h}>{t('careers.mk.analytics.hours', { count: h })}</option>)}
          </select>
        </Field>
      </div>
      {f.mode === 'video' ? <Check id={`pt-room-${app.id}`} label={t('careers.mk.interviews.useRoom')} checked={f.use_video_room} onChange={(v) => setF({ ...f, use_video_room: v })} /> : null}
      <Check id={`pt-sms-${app.id}`} label={t('careers.mk.interviews.smsReminder')} checked={f.sms_reminder} onChange={(v) => setF({ ...f, sms_reminder: v })} />
      <p className="ox-careers-subtle">{t('careers.mk.interviews.pickHint', { zone })}</p>
      {!groups.length && !suggestions.loading ? <Notice tone="warn">{t('careers.mk.interviews.noAvailability')}</Notice> : null}
      {groups.map((g) => (
        <fieldset key={g.key} className="ox-careers-slots">
          <legend>{g.label}</legend>
          {g.slots.map((s) => (
            <label key={s.iso} className={`ox-careers-slot${picked.includes(s.iso) ? ' active' : ''}`}>
              <input type="checkbox" checked={picked.includes(s.iso)} onChange={() => toggle(s.iso)} />
              <span>{s.label}</span>
            </label>
          ))}
        </fieldset>
      ))}
      <div className="ox-careers-actions">
        <ActionButton primary disabled={!groups.length} onClick={async () => {
          try {
            await createInterviewProposal(app.id, {
              ...f, timezone: zone, slots: picked, auto: !picked.length, location: f.location || undefined,
              reschedule_of_interview_id: rescheduleOf || undefined,
            });
            toast.success(t('careers.mk.interviews.proposalSent'));
            onDone(true);
          } catch (err) { toast.error(errorText(err)); }
        }}
        >{picked.length ? t('careers.mk.interviews.sendPicked', { count: picked.length }) : t('careers.mk.interviews.sendAll')}</ActionButton>
        <button type="button" className="ox-careers-btn" onClick={() => onDone(false)}>{t('careers.common.cancel')}</button>
      </div>
    </div>
  );
}

function Notes({ app, interview }) {
  const { t, i18n } = useTranslation();
  const errorText = useCareerErrors();
  const notes = useLoad(() => listInterviewNotes(app.id, interview.id), [app.id, interview.id]);
  const [f, setF] = useState({ note: '', rating: '', recommendation: '' });
  return (
    <div className="ox-careers-panel">
      <h4>{t('careers.mk.notes.title')}</h4>
      <p className="ox-careers-subtle">{t('careers.mk.notes.private')}</p>
      {(notes.data || []).map((n) => (
        <p key={n.id} className="ox-careers-prose">
          <strong>{n.author}</strong> · {formatWhen(n.created_at, undefined, i18n.language)}
          {n.rating ? ` · ${n.rating}/5` : ''}{n.recommendation ? ` · ${t(`careers.mk.notes.rec.${n.recommendation}`)}` : ''}
          {n.note ? <><br />{n.note}</> : null}
        </p>
      ))}
      <form onSubmit={async (e) => {
        e.preventDefault();
        try { await addInterviewNote(app.id, interview.id, { note: f.note || undefined, rating: f.rating || undefined, recommendation: f.recommendation || undefined }); setF({ note: '', rating: '', recommendation: '' }); notes.reload(); } catch (err) { toast.error(errorText(err)); }
      }}
      >
        <div className="ox-careers-form-grid">
          <Field label={t('careers.mk.notes.rating')} htmlFor={`nt-r-${interview.id}`}>
            <select id={`nt-r-${interview.id}`} value={f.rating} onChange={(e) => setF({ ...f, rating: e.target.value })}>
              <option value="">{t('careers.common.none')}</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label={t('careers.mk.notes.recommendation')} htmlFor={`nt-rec-${interview.id}`}>
            <select id={`nt-rec-${interview.id}`} value={f.recommendation} onChange={(e) => setF({ ...f, recommendation: e.target.value })}>
              <option value="">{t('careers.common.none')}</option>
              {['advance', 'hold', 'decline'].map((r) => <option key={r} value={r}>{t(`careers.mk.notes.rec.${r}`)}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('careers.mk.notes.note')} htmlFor={`nt-n-${interview.id}`}><textarea id={`nt-n-${interview.id}`} rows={3} maxLength={4000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <button type="submit" className="ox-careers-btn" disabled={!f.note.trim() && !f.rating && !f.recommendation}>{t('careers.mk.notes.add')}</button>
      </form>
    </div>
  );
}

function Reschedule({ app, interview, onDone }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const [when, setWhen] = useState('');
  return (
    <form className="ox-careers-actions" onSubmit={async (e) => {
      e.preventDefault();
      try { await rescheduleTeamInterview(app.id, interview.id, { scheduled_at: new Date(when).toISOString() }); toast.success(t('careers.mk.interviews.rescheduled')); onDone(true); } catch (err) { toast.error(errorText(err)); }
    }}
    >
      <Field label={t('careers.mk.interviews.newTime')} htmlFor={`rs-${interview.id}`}><input id={`rs-${interview.id}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <button type="submit" className="ox-careers-btn" disabled={!when}>{t('careers.mk.interviews.reschedule')}</button>
    </form>
  );
}

/**
 * Marketplace additions to the employer's application view: screener
 * answers, advisory AI match, self-scheduling proposals, per-interview
 * notes/ICS/room/reschedule, and the candidate message thread.
 */
export default function EmployerApplicationExtras({ app, opening, timezone, onChanged }) {
  const { t, i18n } = useTranslation();
  const [panel, setPanel] = useState(null);
  const proposals = useLoad(() => (app.is_guest ? Promise.resolve([]) : listTeamProposals(app.id).catch(() => [])), [app.id]);
  const ctx = { employerType: opening?.employer_type === 'platform' ? 'platform' : 'business', businessId: opening?.business_id || null };
  const done = (changed) => { setPanel(null); if (changed) { proposals.reload(); onChanged?.(); } };
  const active = (app.interviews || []).filter((i) => !i.cancelled_at);
  const openProposal = (proposals.data || []).find((p) => p.status === 'open');
  return (
    <>
      <ScreenerAnswers app={app} />
      {!app.is_guest ? <AiMatch app={app} /> : null}
      <div className="ox-careers-section">
        <h3>{t('careers.mk.interviews.title')}</h3>
        {openProposal ? <Notice>{t('careers.mk.interviews.waitingPick', { count: openProposal.slots.length, when: formatWhen(openProposal.expires_at, undefined, i18n.language) })}</Notice> : null}
        {(proposals.data || []).filter((p) => p.status === 'declined' && p.candidate_message).slice(0, 1).map((p) => <Notice key={p.id} tone="warn">{t('careers.mk.interviews.candidateAsked', { message: p.candidate_message })}</Notice>)}
        {active.map((i) => (
          <div key={i.id} className="ox-careers-app">
            <div className="ox-careers-row">
              <span>{formatWhen(i.scheduled_at, i.timezone, i18n.language)} · {t(`careers.interview.mode.${i.mode}`)}</span>
              {i.candidate_confirmed_at ? <span className="ox-careers-chip ok">{t('careers.mk.interviews.confirmed')}</span> : null}
              {i.reschedule_requested_at ? <span className="ox-careers-chip warn">{t('careers.mk.interviews.rescheduleRequested')}</span> : null}
            </div>
            <div className="ox-careers-actions">
              <ActionButton onClick={() => downloadVia(api, teamInterviewIcsUrl(app.id, i.id), 'interview.ics')}>{t('careers.mk.interviews.addToCalendar')}</ActionButton>
              {i.has_video_room ? <Link className="ox-careers-btn" to={`/careers/interview-room/${i.id}?application=${app.id}&side=team`}>{t('careers.mk.interviews.joinVideo')}</Link> : null}
              <button type="button" className="ox-careers-btn" onClick={() => setPanel(`notes:${i.id}`)}>{t('careers.mk.notes.title')}</button>
              <button type="button" className="ox-careers-btn" onClick={() => setPanel(`resched:${i.id}`)}>{t('careers.mk.interviews.reschedule')}</button>
              {!app.is_guest ? <button type="button" className="ox-careers-btn" onClick={() => setPanel(`repropose:${i.id}`)}>{t('careers.mk.interviews.offerNewTimes')}</button> : null}
            </div>
            {panel === `notes:${i.id}` ? <Notes app={app} interview={i} /> : null}
            {panel === `resched:${i.id}` ? <Reschedule app={app} interview={i} onDone={done} /> : null}
            {panel === `repropose:${i.id}` ? <ProposeTimes app={app} timezone={timezone} rescheduleOf={i.id} onDone={done} /> : null}
          </div>
        ))}
        {!active.length && !openProposal ? <Empty>{t('careers.mk.interviews.noneTeam')}</Empty> : null}
        {!app.is_guest && ['received', 'screening', 'interview'].includes(app.stage) && panel !== 'propose' ? (
          <button type="button" className="ox-careers-btn" onClick={() => setPanel('propose')}>{t('careers.mk.interviews.letPick')}</button>
        ) : null}
        {panel === 'propose' ? <ProposeTimes app={app} timezone={timezone} onDone={done} /> : null}
      </div>
      {!app.is_guest ? (
        <details className="ox-careers-section">
          <summary>{t('careers.mk.messages.open')}</summary>
          <MessageThread applicationId={app.id} side="employer" ctx={ctx} />
        </details>
      ) : null}
    </>
  );
}
