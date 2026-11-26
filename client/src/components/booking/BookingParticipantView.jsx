import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  getBookingParticipantSummary,
  getBookingChecklist,
  listBookingSiteActions,
  recordBookingSiteAction,
  listBookingCallbacks,
  listBookingSupport,
  submitBookingSupport,
  listBookingFeedback,
  submitBookingFeedback,
  listBookingSitePhotos,
  uploadBookingSitePhoto,
  getBookingReceipt,
  registerBookingUpdateEmail,
  removeBookingUpdateEmail,
  optOutBookingNotifications,
  optInBookingNotifications,
  archiveBookingVisit,
  unarchiveBookingVisit,
  correctBookingContact,
  sendBookingRelayMessage,
  respondAsRecipient,
  cancelBookingRequest,
  respondBookingSponsorship,
  createSponsorPaymentIntent,
  confirmSponsorPayment,
  getSponsorReceipt,
  listSponsorshipCharges,
  respondSponsorshipCharge,
  createChargePaymentIntent,
  confirmChargePayment,
  voidBookingSponsorship,
} from '../../api/bookings';
import SponsorCardPay from './SponsorCardPay';
import './BookingRequestCard.css';

// Wave 4 (G3-2, items 107/118/120/122/124/125/127/128/129/135/140/146/147/148):
// the account participant view. A recipient, site contact, or sponsor who
// is signed in sees the visit they are part of — summary, checklist,
// actions, callbacks, support, feedback, photos, receipt, channel
// controls, corrections, relay — instead of the booker's card, which
// assumes the viewer is the customer. The booker keeps BookingRequestCard.
// Loads are role-gated to what the server admits for the resolved role
// (checklist/actions/feedback/photos exclude sponsors; callbacks exclude
// sponsors on the account path), so a 403 never becomes a load error.
const CHECKLIST_KEYS = [
  'instructions_acknowledged',
  'access_window_suggested',
  'entry_problem_reported',
  'handoff_confirmed',
  'completion_acknowledged',
  'photos_contributed',
  'callback_requested',
];
const SITE_ACTION_TYPES = [
  'acknowledge_instructions',
  'request_callback',
  'suggest_window',
  'report_entry_problem',
  'confirm_handoff',
  'acknowledge_completion',
];
const SUPPORT_KINDS = ['general', 'missed_provider', 'payment', 'callback'];
const RELAY_TARGETS = ['booker', 'helper', 'site_contact'];

function money(cents) {
  if (cents == null) return null;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function formatTime(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m || 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function BookingParticipantView({ booking, sponsorshipId = null, onReload }) {
  const { t } = useTranslation();
  const bookingId = booking?.id;
  const [summary, setSummary] = useState(null);
  const [checklist, setChecklist] = useState(null);
  const [actions, setActions] = useState([]);
  const [callbacks, setCallbacks] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const [charges, setCharges] = useState([]);
  const [sponsorReceipt, setSponsorReceipt] = useState(null);
  const [loadErrors, setLoadErrors] = useState([]);
  const [loading, setLoading] = useState(true);

  const [actionType, setActionType] = useState('acknowledge_instructions');
  const [actionDetail, setActionDetail] = useState('');
  const [supportKind, setSupportKind] = useState('general');
  const [supportMessage, setSupportMessage] = useState('');
  const [feedbackRating, setFeedbackRating] = useState('5');
  const [feedbackBody, setFeedbackBody] = useState('');
  const [updateEmail, setUpdateEmail] = useState('');
  const [correctionName, setCorrectionName] = useState('');
  const [correctionPhone, setCorrectionPhone] = useState('');
  const [relayTarget, setRelayTarget] = useState('booker');
  const [relayMessage, setRelayMessage] = useState('');
  const [cancelArmed, setCancelArmed] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);

  const load = useCallback(async () => {
    if (!bookingId) return;
    setLoading(true);
    setLoadErrors([]);
    const errors = [];
    const s = await getBookingParticipantSummary(bookingId).catch(() => null);
    if (!s) {
      setLoadErrors(['summary']);
      setSummary(null);
      setLoading(false);
      return;
    }
    setSummary(s);
    const role = s.viewerRole;
    const isVisitParty = role === 'recipient' || role === 'site_contact';
    const jobs = [];
    if (isVisitParty) {
      jobs.push(['checklist', getBookingChecklist(bookingId)]);
      jobs.push(['actions', listBookingSiteActions(bookingId)]);
      jobs.push(['callbacks', listBookingCallbacks(bookingId)]);
      jobs.push(['feedback', listBookingFeedback(bookingId)]);
      jobs.push(['photos', listBookingSitePhotos(bookingId)]);
    }
    jobs.push(['support', listBookingSupport(bookingId)]);
    const settled = await Promise.allSettled(jobs.map(([, p]) => p));
    const byKey = {};
    jobs.forEach(([key], i) => { byKey[key] = settled[i]; });
    const take = (key, fallback) => {
      const r = byKey[key];
      if (!r || r.status !== 'fulfilled') { errors.push(key); return fallback; }
      return r.value ?? fallback;
    };
    setChecklist(take('checklist', null));
    setActions(take('actions', []));
    setCallbacks(take('callbacks', []));
    setFeedback(take('feedback', []));
    setPhotos(take('photos', []));
    setTickets(take('support', []));
    if (s.receiptSharedWithRecipient && isVisitParty) {
      const r = await getBookingReceipt(bookingId).catch(() => null);
      if (r) setReceipt(r);
      else errors.push('receipt');
    }
    if (role === 'sponsor') {
      const own = (s.payment?.sponsors || []).find((x) => String(x.id) === String(sponsorshipId))
        || (s.payment?.sponsors || [])[0] || null;
      if (own) {
        setCharges(await listSponsorshipCharges(bookingId, own.id).catch(() => []));
        if (own.status === 'paid') {
          setSponsorReceipt(await getSponsorReceipt(bookingId, own.id).catch(() => null));
        }
      }
    }
    setLoadErrors(errors);
    setLoading(false);
  }, [bookingId, sponsorshipId]);

  useEffect(() => { load(); }, [load]);

  if (!bookingId) return null;
  if (loading) return <p>{t('common.loading')}</p>;
  if (!summary) {
    return (
      <div className="booking-participant-panel">
        <p role="alert">{t('booking.participant.loadFailed')}</p>
        <button type="button" className="booking-btn-secondary" onClick={load} data-track="ui.597a27664a.1">{t('booking.refreshStatus')}</button>
      </div>
    );
  }

  const role = summary.viewerRole;
  const isVisitParty = role === 'recipient' || role === 'site_contact';
  const isRecipient = role === 'recipient';
  const ownSponsorship = role === 'sponsor'
    ? (summary.payment?.sponsors || []).find((x) => String(x.id) === String(sponsorshipId))
      || (summary.payment?.sponsors || [])[0] || null
    : null;
  const dateLabel = summary.requestedDate
    ? new Date(`${summary.requestedDate}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    : null;
  const supportKindOptions = role === 'sponsor' ? ['payment'] : SUPPORT_KINDS;
  // Sponsors open payment support only (server-enforced): the select
  // offers just that kind, so the submitted kind follows the role.
  const effectiveSupportKind = role === 'sponsor' ? 'payment' : supportKind;
  const relayOptions = summary.hasSiteContactAccount ? RELAY_TARGETS : ['booker', 'helper'];

  const run = async (fn, okKey, failKey, after) => {
    try {
      const result = await fn();
      if (okKey) toast.success(t(okKey));
      await load();
      after?.(result);
    } catch (err) {
      toast.error(err?.response?.data?.error || t(failKey));
    }
  };

  return (
    <div className="booking-participant-panel">
      <h3>{summary.serviceName}</h3>
      <p>
        {dateLabel}
        {summary.requestedStartTime && ` · ${formatTime(summary.requestedStartTime)} – ${formatTime(summary.requestedEndTime)}`}
      </p>
      <p>{summary.serviceLocation || ''}</p>
      <p>
        {t(`booking.publicStatus.${summary.status}`)} · {t(`booking.sharingRole.${role}`)}
      </p>
      {summary.labels?.ownershipLabel && <p>{summary.labels.ownershipLabel}</p>}
      {summary.archived && <p role="status">{t('booking.participant.archivedNote')}</p>}
      {loadErrors.length > 0 && (
        <p role="alert">
          {t('booking.participant.loadError', { sections: loadErrors.join(', ') })}
        </p>
      )}

      <div className="booking-participant-grid">
        <div className="booking-participant-section">
          <h4>{t('booking.participant.summaryTitle')}</h4>
          <ul className="booking-participant-list">
            {summary.labels?.recipient && <li>{t('booking.participant.recipientLabel')}: {summary.labels.recipient}</li>}
            {summary.labels?.siteContact && <li>{t('booking.participant.siteContactLabel')}: {summary.labels.siteContact}</li>}
            {summary.helper?.name && <li>{t('booking.participant.helperLabel')}: {summary.helper.name}</li>}
            {summary.helper?.doorName && <li>{t('booking.participant.doorNameLabel')}: {summary.helper.doorName}</li>}
            {(summary.authority?.[role] || []).map((a) => <li key={a}>{a}</li>)}
          </ul>
          {(summary.payment?.sponsors || []).length > 0 && (
            <>
              <h4>{t('booking.participant.paymentTitle')}</h4>
              <ul className="booking-participant-list">
                {summary.payment.sponsors.map((s) => (
                  <li key={s.id}>
                    {s.sponsorName || s.sponsorEmail} — {t(`booking.participant.sponsorStatus.${s.status}`)}
                    {s.amountCents != null ? ` · ${money(s.amountCents)}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          {summary.careInstructions && (
            <>
              <h4>{t('booking.token.careTitle')}</h4>
              <p>{summary.careInstructions}</p>
            </>
          )}
        </div>

        {isVisitParty && checklist && (
          <div className="booking-participant-section">
            <h4>{t('booking.token.checklistTitle')}</h4>
            <ul className="booking-participant-list">
              {CHECKLIST_KEYS.map((key) => {
                const item = checklist.items?.find((i) => i.key === key);
                return <li key={key}>{item?.done ? '✓' : '○'} {t(`booking.token.checklist.${key}`)}</li>;
              })}
            </ul>
          </div>
        )}

        {isRecipient && summary.recipientConsentStatus === 'pending' && (
          <div className="booking-participant-section">
            <h4>{t('booking.participant.respondTitle')}</h4>
            <button
              type="button"
              className="booking-btn-secondary"
              onClick={() => run(() => respondAsRecipient(bookingId, 'accepted'), 'booking.participant.visitAccepted', 'booking.participant.respondFailed')} data-track="ui.597a27664a.2"
            >
              {t('booking.participant.acceptVisit')}
            </button>
            <button
              type="button"
              className="booking-btn-secondary"
              onClick={() => run(() => respondAsRecipient(bookingId, 'declined'), 'booking.participant.visitDeclined', 'booking.participant.respondFailed')} data-track="ui.597a27664a.3"
            >
              {t('booking.participant.declineVisit')}
            </button>
          </div>
        )}

        {isRecipient && ['pending', 'accepted'].includes(summary.status) && (
          <div className="booking-participant-section">
            <h4>{t('booking.participant.cancelTitle')}</h4>
            <button
              type="button"
              className="booking-btn-secondary"
              onClick={() => {
                if (!cancelArmed) { setCancelArmed(true); return; }
                run(() => cancelBookingRequest(bookingId), 'booking.participant.visitCancelled', 'booking.participant.cancelFailed', () => onReload?.());
              }} data-track="ui.597a27664a.4"
            >
              {cancelArmed ? t('booking.participant.cancelConfirm') : t('booking.participant.cancelVisit')}
            </button>
          </div>
        )}

        {isVisitParty && (
          <div className="booking-participant-section">
            <h4>{t('booking.token.actionsTitle')}</h4>
            <div className="booking-participant-form">
              <label className="booking-field">
                <span>{t('booking.token.actionTypeLabel')}</span>
                <select value={actionType} onChange={(e) => setActionType(e.target.value)}>
                  {SITE_ACTION_TYPES.map((type) => (
                    <option key={type} value={type}>{t(`booking.participant.actionTypes.${type}`)}</option>
                  ))}
                </select>
              </label>
              <label className="booking-field">
                <span>{t('booking.participant.actionDetailLabel')}</span>
                <input type="text" value={actionDetail} onChange={(e) => setActionDetail(e.target.value)} placeholder={t('booking.participant.actionDetailPlaceholder')} />
              </label>
              <button
                type="button"
                className="booking-btn-secondary"
                onClick={() => {
                  const details = {};
                  if (actionType === 'request_callback' || actionType === 'suggest_window') details.window = actionDetail;
                  else if (actionType === 'report_entry_problem') details.problem = actionDetail;
                  else if (actionType === 'confirm_handoff') details.handedTo = actionDetail;
                  run(
                    () => recordBookingSiteAction(bookingId, { type: actionType, details }),
                    'booking.participant.actionRecorded',
                    'booking.participant.actionFailed',
                    () => setActionDetail(''),
                  );
                }} data-track="ui.597a27664a.5"
              >
                {t('booking.participant.recordAction')}
              </button>
            </div>
            {actions.length === 0 && <p>{t('booking.noSiteActions')}</p>}
            <ul className="booking-participant-list">
              {actions.map((a) => (
                <li key={a.id}>{a.label} — {a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}</li>
              ))}
            </ul>
          </div>
        )}

        {isVisitParty && (
          <div className="booking-participant-section">
            <h4>{t('booking.participant.callbacksTitle')}</h4>
            {callbacks.length === 0 && <p>{t('booking.participant.noCallbacks')}</p>}
            <ul className="booking-participant-list">
              {callbacks.map((c) => (
                <li key={c.id}>
                  {t(`booking.participant.callbackTarget.${c.target}`)} — {t(`booking.participant.callbackStatus.${c.status}`)}
                  {c.preferredWindow ? ` · ${c.preferredWindow}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="booking-participant-section">
          <h4>{t('booking.token.supportTitle')}</h4>
          <div className="booking-participant-form">
            <label className="booking-field">
              <span>{t('booking.token.supportKindLabel')}</span>
              <select value={effectiveSupportKind} onChange={(e) => setSupportKind(e.target.value)}>
                {supportKindOptions.map((kind) => (
                  <option key={kind} value={kind}>{t(`booking.token.supportKinds.${kind}`)}</option>
                ))}
              </select>
            </label>
            <label className="booking-field">
              <span>{t('booking.token.supportMessageLabel')}</span>
              <textarea value={supportMessage} onChange={(e) => setSupportMessage(e.target.value)} placeholder={t('booking.token.supportMessagePlaceholder')} />
            </label>
            <button
              type="button"
              className="booking-btn-secondary"
              onClick={() => {
                if (!supportMessage.trim()) { toast.error(t('booking.participant.supportMessageRequired')); return; }
                run(
                  () => submitBookingSupport(bookingId, { kind: effectiveSupportKind, message: supportMessage.trim() }),
                  'booking.token.supportSubmitted',
                  'booking.token.supportFailed',
                  () => setSupportMessage(''),
                );
              }} data-track="ui.597a27664a.6"
            >
              {t('booking.participant.supportSubmit')}
            </button>
          </div>
          {tickets.length === 0 && <p>{t('booking.participant.noTickets')}</p>}
          <ul className="booking-participant-list">
            {tickets.map((k) => (
              <li key={k.id}>{k.ticketNumber || k.id} — {k.subject} ({k.status})</li>
            ))}
          </ul>
        </div>

        {isVisitParty && (
          <div className="booking-participant-section">
            <h4>{t('booking.token.feedbackTitle')}</h4>
            {summary.status === 'completed' && (
              <div className="booking-participant-form">
                <label className="booking-field">
                  <span>{t('booking.participant.feedbackRatingLabel')}</span>
                  <select value={feedbackRating} onChange={(e) => setFeedbackRating(e.target.value)}>
                    {['5', '4', '3', '2', '1'].map((r) => <option key={r} value={r}>{r}/5</option>)}
                  </select>
                </label>
                <label className="booking-field">
                  <span>{t('booking.participant.feedbackBodyLabel')}</span>
                  <textarea value={feedbackBody} onChange={(e) => setFeedbackBody(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="booking-btn-secondary"
                  onClick={() => run(
                    () => submitBookingFeedback(bookingId, { rating: Number(feedbackRating), body: feedbackBody.trim() }),
                    'booking.participant.feedbackSubmitted',
                    'booking.participant.feedbackFailed',
                    () => setFeedbackBody(''),
                  )} data-track="ui.597a27664a.7"
                >
                  {t('booking.participant.feedbackSubmit')}
                </button>
              </div>
            )}
            {feedback.length === 0 && <p>{t('booking.noFeedback')}</p>}
            <ul className="booking-participant-list">
              {feedback.map((f) => (
                <li key={f.id}>{f.rating ? `${f.rating}/5 — ` : ''}{f.body}</li>
              ))}
            </ul>
            <h4>{t('booking.token.photosTitle')}</h4>
            <div className="booking-participant-form">
              <label className="booking-field">
                <span>{t('booking.participant.photoLabel')}</span>
                <input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
              </label>
              <button
                type="button"
                className="booking-btn-secondary"
                disabled={!photoFile}
                onClick={() => run(
                  () => uploadBookingSitePhoto(bookingId, photoFile),
                  'booking.participant.photoUploaded',
                  'booking.participant.photoFailed',
                  () => setPhotoFile(null),
                )} data-track="ui.597a27664a.8"
              >
                {t('booking.participant.uploadPhoto')}
              </button>
            </div>
            {photos.length === 0 && <p>{t('booking.participant.noPhotos')}</p>}
            <ul className="booking-participant-list">
              {photos.map((p) => (
                <li key={p.id}>
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer" data-track="ui.597a27664a.9">{t('booking.photoLink')}</a>
                  ) : (
                    t('booking.token.photoBy', { who: p.contributorType })
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {isVisitParty && receipt && (
          <div className="booking-participant-section">
            <h4>{t('booking.participant.receiptTitle')}</h4>
            <p>{receipt.serviceName} — {receipt.requestedDate}</p>
            <p>{t('booking.participant.receiptCode', { code: receipt.confirmationCode })}</p>
          </div>
        )}

        {isVisitParty && (
          <div className="booking-participant-section">
            <h4>{t('booking.participant.channelsTitle')}</h4>
            <div className="booking-participant-form">
              <label className="booking-field">
                <span>{t('booking.participant.updateEmailLabel')}</span>
                <input type="email" value={updateEmail} onChange={(e) => setUpdateEmail(e.target.value)} />
              </label>
              <button
                type="button"
                className="booking-btn-secondary"
                onClick={() => {
                  if (!updateEmail.trim()) { toast.error(t('booking.participant.emailRequired')); return; }
                  run(() => registerBookingUpdateEmail(bookingId, updateEmail.trim()), 'booking.participant.emailRegistered', 'booking.participant.emailFailed');
                }} data-track="ui.597a27664a.10"
              >
                {t('booking.participant.registerEmail')}
              </button>
              <button
                type="button"
                className="booking-btn-secondary"
                onClick={() => {
                  if (!updateEmail.trim()) { toast.error(t('booking.participant.emailRequired')); return; }
                  run(() => removeBookingUpdateEmail(bookingId, updateEmail.trim()), 'booking.participant.emailRemoved', 'booking.participant.emailFailed');
                }} data-track="ui.597a27664a.11"
              >
                {t('booking.participant.removeEmail')}
              </button>
              <button
                type="button"
                className="booking-btn-secondary"
                onClick={() => run(() => optOutBookingNotifications(bookingId, {}), 'booking.participant.optedOut', 'booking.participant.channelFailed')} data-track="ui.597a27664a.12"
              >
                {t('booking.participant.optOut')}
              </button>
              <button
                type="button"
                className="booking-btn-secondary"
                onClick={() => run(() => optInBookingNotifications(bookingId, {}), 'booking.participant.optedIn', 'booking.participant.channelFailed')} data-track="ui.597a27664a.13"
              >
                {t('booking.participant.optIn')}
              </button>
              <button
                type="button"
                className="booking-btn-secondary"
                onClick={() => run(
                  () => (summary.archived ? unarchiveBookingVisit(bookingId) : archiveBookingVisit(bookingId)),
                  summary.archived ? 'booking.participant.visitUnarchived' : 'booking.participant.visitArchived',
                  'booking.participant.archiveFailed',
                )} data-track="ui.597a27664a.14"
              >
                {summary.archived ? t('booking.participant.unarchiveVisit') : t('booking.participant.archiveVisit')}
              </button>
            </div>
            <div className="booking-participant-form">
              <label className="booking-field">
                <span>{t('booking.participant.correctionNameLabel')}</span>
                <input type="text" value={correctionName} onChange={(e) => setCorrectionName(e.target.value)} />
              </label>
              <label className="booking-field">
                <span>{t('booking.participant.correctionPhoneLabel')}</span>
                <input type="tel" value={correctionPhone} onChange={(e) => setCorrectionPhone(e.target.value)} />
              </label>
              <button
                type="button"
                className="booking-btn-secondary"
                onClick={() => {
                  if (!correctionName.trim() && !correctionPhone.trim()) { toast.error(t('booking.participant.correctionRequired')); return; }
                  run(
                    () => correctBookingContact(bookingId, { name: correctionName.trim() || undefined, phone: correctionPhone.trim() || undefined }),
                    'booking.participant.correctionSubmitted',
                    'booking.participant.correctionFailed',
                    () => { setCorrectionName(''); setCorrectionPhone(''); },
                  );
                }} data-track="ui.597a27664a.15"
              >
                {t('booking.participant.correctionSubmit')}
              </button>
            </div>
            <div className="booking-participant-form">
              <label className="booking-field">
                <span>{t('booking.participant.relayTargetLabel')}</span>
                <select value={relayTarget} onChange={(e) => setRelayTarget(e.target.value)}>
                  {relayOptions.map((target) => (
                    <option key={target} value={target}>{t(`booking.participant.relayTargets.${target}`)}</option>
                  ))}
                </select>
              </label>
              <label className="booking-field">
                <span>{t('booking.participant.relayMessageLabel')}</span>
                <textarea value={relayMessage} onChange={(e) => setRelayMessage(e.target.value)} />
              </label>
              <button
                type="button"
                className="booking-btn-secondary"
                onClick={() => {
                  if (!relayMessage.trim()) { toast.error(t('booking.participant.relayMessageRequired')); return; }
                  run(
                    () => sendBookingRelayMessage(bookingId, { to: relayTarget, message: relayMessage.trim() }),
                    'booking.participant.relaySent',
                    'booking.participant.relayFailed',
                    () => setRelayMessage(''),
                  );
                }} data-track="ui.597a27664a.16"
              >
                {t('booking.participant.relaySend')}
              </button>
            </div>
          </div>
        )}

        {role === 'sponsor' && (
          <div className="booking-participant-section">
            <h4>{t('booking.participant.sponsorTitle')}</h4>
            <button
              type="button"
              className="booking-btn-secondary"
              onClick={() => run(() => optOutBookingNotifications(bookingId, {}), 'booking.participant.optedOut', 'booking.participant.channelFailed')} data-track="ui.597a27664a.17"
            >
              {t('booking.participant.optOut')}
            </button>
            <button
              type="button"
              className="booking-btn-secondary"
              onClick={() => run(() => optInBookingNotifications(bookingId, {}), 'booking.participant.optedIn', 'booking.participant.channelFailed')} data-track="ui.597a27664a.18"
            >
              {t('booking.participant.optIn')}
            </button>
            {ownSponsorship && (
              <>
                <p>
                  {money(ownSponsorship.amountCents)} — {t(`booking.participant.sponsorStatus.${ownSponsorship.status}`)}
                </p>
                {ownSponsorship.canRespond && (
                  <>
                    <button
                      type="button"
                      className="booking-btn-secondary"
                      onClick={() => run(() => respondBookingSponsorship(bookingId, ownSponsorship.id, 'accepted'), 'booking.participant.sponsorAccepted', 'booking.participant.sponsorRespondFailed')} data-track="ui.597a27664a.19"
                    >
                      {t('booking.participant.acceptSponsorship')}
                    </button>
                    <button
                      type="button"
                      className="booking-btn-secondary"
                      onClick={() => run(() => respondBookingSponsorship(bookingId, ownSponsorship.id, 'declined'), 'booking.participant.sponsorDeclined', 'booking.participant.sponsorRespondFailed')} data-track="ui.597a27664a.20"
                    >
                      {t('booking.participant.declineSponsorship')}
                    </button>
                  </>
                )}
                {ownSponsorship.canPay && (
                  <SponsorCardPay
                    amountCents={ownSponsorship.amountCents}
                    createIntent={() => createSponsorPaymentIntent(bookingId, ownSponsorship.id)}
                    onConfirmPayment={(paymentIntentId) => confirmSponsorPayment(bookingId, ownSponsorship.id, paymentIntentId)}
                    onPaid={() => load()}
                  />
                )}
                {ownSponsorship.status === 'accepted' && (
                  <button
                    type="button"
                    className="booking-btn-secondary"
                    onClick={() => run(() => voidBookingSponsorship(bookingId, ownSponsorship.id), 'booking.participant.sponsorshipVoided', 'booking.participant.sponsorshipVoidFailed')} data-track="ui.597a27664a.21"
                  >
                    {t('booking.participant.voidSponsorship')}
                  </button>
                )}
                {ownSponsorship.status === 'paid' && sponsorReceipt && (
                  <>
                    <h4>{t('booking.participant.sponsorReceiptTitle')}</h4>
                    <p>{sponsorReceipt.serviceName} — {money(sponsorReceipt.amountCents)}</p>
                    {sponsorReceipt.paidAt && <p>{t('booking.token.sponsorPaidAt', { date: new Date(sponsorReceipt.paidAt).toLocaleDateString() })}</p>}
                  </>
                )}
                <h4>{t('booking.participant.chargesTitle')}</h4>
                {charges.length === 0 && <p>{t('booking.participant.noCharges')}</p>}
                <ul className="booking-participant-list">
                  {charges.map((c) => (
                    <li key={c.id}>
                      {c.reason} — {c.amountCents != null ? money(c.amountCents) : t(`booking.participant.sponsorStatus.${c.status}`)}
                      {c.canRespond && (
                        <>
                          {' '}
                          <button type="button" className="booking-btn-secondary" onClick={() => run(() => respondSponsorshipCharge(bookingId, ownSponsorship.id, c.id, 'accepted'), 'booking.participant.chargeAccepted', 'booking.participant.chargeRespondFailed')} data-track="ui.597a27664a.22">
                            {t('booking.participant.acceptCharge')}
                          </button>
                          {' '}
                          <button type="button" className="booking-btn-secondary" onClick={() => run(() => respondSponsorshipCharge(bookingId, ownSponsorship.id, c.id, 'declined'), 'booking.participant.chargeDeclined', 'booking.participant.chargeRespondFailed')} data-track="ui.597a27664a.23">
                            {t('booking.participant.declineCharge')}
                          </button>
                        </>
                      )}
                      {c.canPay && (
                        <SponsorCardPay
                          amountCents={c.amountCents}
                          createIntent={() => createChargePaymentIntent(bookingId, ownSponsorship.id, c.id)}
                          onConfirmPayment={(paymentIntentId) => confirmChargePayment(bookingId, ownSponsorship.id, c.id, paymentIntentId)}
                          onPaid={() => load()}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
