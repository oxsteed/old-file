import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import api from '../../../api/axios';
import {
  bookInterviewSlot, confirmMyInterview, declineInterviewProposal, getMyInterviewProposals, myInterviewIcsUrl, requestInterviewReschedule,
} from '../../../api/careers';
import { ActionButton, Empty, Field, Loading, Notice, useCareerErrors, useLoad } from '../ui';
import { formatWhen } from '../../../features/careers/careersModel';
import { groupSlotsByDay } from '../../../features/careers/marketplaceModel';
import { downloadVia } from './shared';

/** Pick one of the employer's offered times (self-scheduling). */
function ProposalPicker({ applicationId, proposal, onBooked }) {
  const { t, i18n } = useTranslation();
  const errorText = useCareerErrors();
  const [chosen, setChosen] = useState('');
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || proposal.timezone;
  const groups = groupSlotsByDay(proposal.slots, zone, i18n.language);
  return (
    <div className="ox-careers-panel">
      <h4>{proposal.reschedule_of_interview_id ? t('careers.mk.interviews.newTimes') : t('careers.mk.interviews.pickTime')}</h4>
      <p className="ox-careers-subtle">
        {t(`careers.interview.mode.${proposal.mode}`)} · {t('careers.mk.interviews.minutes', { count: proposal.duration_minutes })}
        {proposal.use_video_room ? ` · ${t('careers.mk.interviews.inAppVideo')}` : ''}
        {' · '}{t('careers.mk.interviews.shownIn', { zone })}
        {' · '}{t('careers.mk.interviews.expires', { when: formatWhen(proposal.expires_at, zone, i18n.language) })}
      </p>
      {groups.map((g) => (
        <fieldset key={g.key} className="ox-careers-slots">
          <legend>{g.label}</legend>
          {g.slots.map((s) => (
            <label key={s.iso} className={`ox-careers-slot${chosen === s.iso ? ' active' : ''}`}>
              <input type="radio" name={`slot-${proposal.id}`} value={s.iso} checked={chosen === s.iso} onChange={() => setChosen(s.iso)} />
              <span>{s.label}</span>
            </label>
          ))}
        </fieldset>
      ))}
      <div className="ox-careers-actions">
        <ActionButton primary disabled={!chosen} onClick={async () => {
          try { await bookInterviewSlot(applicationId, proposal.id, chosen); toast.success(t('careers.mk.interviews.booked')); onBooked(); } catch (err) {
            if (err?.response?.status === 409) { toast.error(t('careers.mk.interviews.slotTaken')); onBooked(); } else throw err;
          }
        }}
        >{t('careers.mk.interviews.book')}</ActionButton>
        <button type="button" className="ox-careers-btn" onClick={() => setDeclining((v) => !v)}>{t('careers.mk.interviews.noneWork')}</button>
      </div>
      {declining ? (
        <form className="ox-careers-panel" onSubmit={async (e) => {
          e.preventDefault();
          try { await declineInterviewProposal(applicationId, proposal.id, note); toast.success(t('careers.mk.interviews.declinedSent')); onBooked(); } catch (err) { toast.error(errorText(err)); }
        }}
        >
          <Field label={t('careers.mk.interviews.whatWorks')} htmlFor={`decline-${proposal.id}`}>
            <textarea id={`decline-${proposal.id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <button type="submit" className="ox-careers-btn">{t('careers.mk.interviews.askOther')}</button>
        </form>
      ) : null}
    </div>
  );
}

/** Worker view of one application's interview: offered times, booking, confirm, reschedule, ICS, room. */
export default function CandidateInterviews({ application, onChanged }) {
  const { t, i18n } = useTranslation();
  const proposals = useLoad(() => getMyInterviewProposals(application.id), [application.id]);
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const next = application.next_interview;
  const refresh = () => { proposals.reload(); onChanged?.(); };
  return (
    <section className="ox-careers-section">
      <h3>{t('careers.mk.interviews.title')}</h3>
      {proposals.loading && !proposals.data ? <Loading /> : null}
      {(proposals.data || []).map((p) => <ProposalPicker key={p.id} applicationId={application.id} proposal={p} onBooked={refresh} />)}
      {next ? (
        <div className="ox-careers-panel">
          <p><strong>{formatWhen(next.scheduled_at, next.timezone, i18n.language)}</strong> · {t(`careers.interview.mode.${next.mode}`)}</p>
          {next.confirmed ? <span className="ox-careers-chip ok">{t('careers.mk.interviews.confirmed')}</span> : null}
          <div className="ox-careers-actions">
            {!next.confirmed ? <ActionButton primary onClick={async () => { await confirmMyInterview(application.id, next.id); refresh(); }}>{t('careers.mk.interviews.confirm')}</ActionButton> : null}
            <ActionButton onClick={() => downloadVia(api, myInterviewIcsUrl(application.id, next.id), 'interview.ics')}>{t('careers.mk.interviews.addToCalendar')}</ActionButton>
            {next.has_room ? <Link className="ox-careers-btn" to={`/careers/interview-room/${next.id}?application=${application.id}`}>{t('careers.mk.interviews.joinVideo')}</Link> : null}
            <button type="button" className="ox-careers-btn" onClick={() => setAsking((v) => !v)}>{t('careers.mk.interviews.reschedule')}</button>
          </div>
          {asking ? (
            <form className="ox-careers-panel" onSubmit={async (e) => {
              e.preventDefault();
              await requestInterviewReschedule(application.id, next.id, reason);
              toast.success(t('careers.mk.interviews.rescheduleSent'));
              setAsking(false); refresh();
            }}
            >
              <Field label={t('careers.mk.interviews.rescheduleWhy')} htmlFor={`rs-${next.id}`}>
                <textarea id={`rs-${next.id}`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <button type="submit" className="ox-careers-btn">{t('careers.mk.interviews.rescheduleSend')}</button>
            </form>
          ) : null}
        </div>
      ) : null}
      {!next && !(proposals.data || []).length && !proposals.loading ? <Empty>{t('careers.mk.interviews.none')}</Empty> : null}
      <Notice>{t('careers.mk.interviews.tipsHint')} <Link to="/careers/interview-tips">{t('careers.mk.tips.link')}</Link></Notice>
    </section>
  );
}
