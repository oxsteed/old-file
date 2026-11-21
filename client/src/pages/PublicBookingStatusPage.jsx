import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Calendar, CheckCircle2, Clock3, MapPin } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import SponsorCardPay from '../components/booking/SponsorCardPay';
import {
  respondToRecipientInvite,
  getTokenParticipantSummary,
  getTokenChecklist,
  getTokenReceipt,
  listTokenSiteActions,
  recordTokenSiteAction,
  listTokenSupport,
  submitTokenSupport,
  listTokenSitePhotos,
  uploadTokenSitePhoto,
  listTokenFeedback,
  submitTokenFeedback,
  registerTokenUpdateEmail,
  removeTokenUpdateEmail,
  optOutTokenNotifications,
  archiveTokenVisit,
  requestTokenLinkRenewal,
  submitTokenContactCorrection,
  sendTokenRelayMessage,
  getTokenSponsorPreview,
  respondTokenSponsorship,
  createTokenSponsorPaymentIntent,
  confirmTokenSponsorPayment,
  getTokenSponsorReceipt,
  listTokenSponsorshipCharges,
  respondTokenSponsorshipCharge,
  createTokenChargePaymentIntent,
  confirmTokenChargePayment,
} from '../api/bookings';
import toast from 'react-hot-toast';
import './PublicBookingStatusPage.css';

// Group 3: public token page for the recipient, site contact, and sponsor.
// Token-gated, no sign-in. Shows the service, its status, and the arrival
// window only, plus the participant surfaces the token allows: the visit
// checklist, site actions, feedback, photos, support, and the sponsor's
// own payment flow. No amounts except the sponsor's own, no billing, no
// customer or helper identity beyond the door name once accepted.
function formatTime(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m || 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function money(cents) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
}

const SITE_ACTION_TYPES = [
  'acknowledge_instructions',
  'request_callback',
  'suggest_window',
  'report_entry_problem',
  'confirm_handoff',
  'acknowledge_completion',
];

const SUPPORT_KINDS = ['general', 'missed_provider', 'payment', 'callback'];

const CHECKLIST_KEYS = [
  'instructions_acknowledged',
  'access_window_suggested',
  'entry_problem_reported',
  'handoff_confirmed',
  'completion_acknowledged',
  'photos_contributed',
  'callback_requested',
];

function Section({ title, children }) {
  return (
    <section className="token-section">
      <h2 className="token-section-title">{title}</h2>
      {children}
    </section>
  );
}

// Sponsor branch (items 121-127): preview, accept/decline, pay with the
// sponsor's own card, receipt, and additional charges.
function SponsorSection({ token, preview, onPreviewChange }) {
  const { t } = useTranslation();
  const [receipt, setReceipt] = useState(null);
  const [charges, setCharges] = useState([]);
  const [busy, setBusy] = useState(false);

  const loadCharges = useCallback(async () => {
    try {
      setCharges(await listTokenSponsorshipCharges(token));
    } catch {
      setCharges([]);
    }
  }, [token]);

  useEffect(() => { loadCharges(); }, [loadCharges]);
  useEffect(() => {
    if (preview?.status !== 'paid') return;
    (async () => {
      try {
        setReceipt(await getTokenSponsorReceipt(token));
      } catch {
        setReceipt(null);
      }
    })();
  }, [preview?.status, token]);

  const handleRespond = async (decision) => {
    setBusy(true);
    try {
      const updated = await respondTokenSponsorship(token, decision);
      onPreviewChange((prev) => ({ ...prev, ...updated }));
      toast.success(t(decision === 'accepted' ? 'booking.token.sponsorAccepted' : 'booking.token.sponsorDeclined'));
    } catch {
      toast.error(t('booking.token.sponsorRespondFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleChargeRespond = async (charge, decision) => {
    setBusy(true);
    try {
      const updated = await respondTokenSponsorshipCharge(token, charge.id, decision);
      setCharges((prev) => prev.map((c) => (c.id === charge.id ? updated : c)));
      toast.success(t(decision === 'accepted' ? 'booking.token.chargeAccepted' : 'booking.token.chargeDeclined'));
    } catch {
      toast.error(t('booking.token.chargeRespondFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!preview) return null;
  return (
    <div>
      <p>{t('booking.token.sponsorIntro')}</p>
      <div className="token-detail-row">
        <span className="token-detail-label">{t('booking.service')}:</span>
        <span>{preview.serviceName}</span>
      </div>
      <div className="token-detail-row">
        <span className="token-detail-label">{t('booking.date')}:</span>
        <span>{preview.requestedDate ? new Date(`${preview.requestedDate}T12:00:00`).toLocaleDateString() : ''}</span>
      </div>
      <div className="token-detail-row">
        <span className="token-detail-label">{t('booking.token.sponsorAmount')}:</span>
        <span>{money(preview.amountCents)}</span>
      </div>
      {preview.paymentDeadlineAt && (
        <div className="token-detail-row">
          <span className="token-detail-label">{t('booking.token.sponsorDeadline')}:</span>
          <span>{new Date(preview.paymentDeadlineAt).toLocaleDateString()}</span>
        </div>
      )}
      <p className="token-note">{t('booking.token.sponsorOnlyOwnAmount')}</p>
      {preview.status === 'invited' && (
        <div className="token-button-row">
          <button type="button" disabled={busy} onClick={() => handleRespond('accepted')} data-track="ui.474702b501.10">
            {t('booking.acceptBooking')}
          </button>
          <button type="button" disabled={busy} onClick={() => handleRespond('declined')} data-track="ui.474702b501.11">
            {t('booking.declineBooking')}
          </button>
        </div>
      )}
      {preview.status === 'accepted' && (
        <Section title={t('booking.token.sponsorPayTitle')}>
          <SponsorCardPay
            amountCents={preview.amountCents}
            createIntent={() => createTokenSponsorPaymentIntent(token)}
            onConfirmPayment={(paymentIntentId) => confirmTokenSponsorPayment(token, paymentIntentId)}
            onPaid={async () => {
              const updated = await getTokenSponsorPreview(token);
              onPreviewChange(updated);
              loadCharges();
            }}
          />
        </Section>
      )}
      {preview.status === 'paid' && receipt && (
        <Section title={t('booking.token.sponsorReceiptTitle')}>
          <div className="token-detail-row">
            <span className="token-detail-label">{t('booking.service')}:</span>
            <span>{receipt.serviceName}</span>
          </div>
          <div className="token-detail-row">
            <span className="token-detail-label">{t('booking.token.sponsorAmount')}:</span>
            <span>{money(receipt.amountCents)}</span>
          </div>
          <div className="token-detail-row">
            <span className="token-detail-label">{t('booking.status')}:</span>
            <span>{receipt.status}</span>
          </div>
          {receipt.paidAt && (
            <p className="token-note">{t('booking.token.sponsorPaidAt', { date: new Date(receipt.paidAt).toLocaleDateString() })}</p>
          )}
        </Section>
      )}
      {charges.length > 0 && (
        <Section title={t('booking.token.chargesTitle')}>
          <ul className="token-list">
            {charges.map((charge) => (
              <li key={charge.id} className="token-list-item">
                <div>{charge.reason} — {money(charge.amountCents)} — {charge.status}</div>
                {charge.status === 'requested' && (
                  <div className="token-button-row">
                    <button type="button" disabled={busy} onClick={() => handleChargeRespond(charge, 'accepted')} data-track="ui.474702b501.12">
                      {t('booking.acceptBooking')}
                    </button>
                    <button type="button" disabled={busy} onClick={() => handleChargeRespond(charge, 'declined')} data-track="ui.474702b501.13">
                      {t('booking.declineBooking')}
                    </button>
                  </div>
                )}
                {charge.status === 'accepted' && (
                  <SponsorCardPay
                    amountCents={charge.amountCents}
                    createIntent={() => createTokenChargePaymentIntent(token, charge.id)}
                    onConfirmPayment={(paymentIntentId) => confirmTokenChargePayment(token, charge.id, paymentIntentId)}
                    onPaid={loadCharges}
                  />
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export default function PublicBookingStatusPage() {
  const { token } = useParams();
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [responding, setResponding] = useState(false);
  const [summary, setSummary] = useState(null);
  const [checklist, setChecklist] = useState(null);
  const [actions, setActions] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [feedbackList, setFeedbackList] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const [receiptNotShared, setReceiptNotShared] = useState(false);
  const [sponsorPreview, setSponsorPreview] = useState(null);
  const [actionType, setActionType] = useState('acknowledge_instructions');
  const [actionDetail, setActionDetail] = useState('');
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackBody, setFeedbackBody] = useState('');
  const [supportKind, setSupportKind] = useState('general');
  const [supportMessage, setSupportMessage] = useState('');
  const [updateEmail, setUpdateEmail] = useState('');
  const [correctionField, setCorrectionField] = useState('name');
  const [correctionValue, setCorrectionValue] = useState('');
  const [relayTo, setRelayTo] = useState('booker');
  const [relayMessage, setRelayMessage] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}`);
        if (!mounted) return;
        const next = data?.data || null;
        setStatus(next);
        if (!next) return;
        if (next.isSponsorPreview) {
          try {
            setSponsorPreview(await getTokenSponsorPreview(token));
          } catch {
            setSponsorPreview(null);
          }
          try {
            setTickets(await listTokenSupport(token));
          } catch {
            setTickets([]);
          }
          return;
        }
        const [s, c, a, tk, p, f] = await Promise.all([
          getTokenParticipantSummary(token).catch(() => null),
          getTokenChecklist(token).catch(() => null),
          listTokenSiteActions(token).catch(() => []),
          listTokenSupport(token).catch(() => []),
          listTokenSitePhotos(token).catch(() => []),
          listTokenFeedback(token).catch(() => []),
        ]);
        if (!mounted) return;
        setSummary(s);
        setChecklist(c);
        setActions(a || []);
        setTickets(tk || []);
        setPhotos(p || []);
        setFeedbackList(f || []);
        try {
          setReceipt(await getTokenReceipt(token));
        } catch {
          setReceipt(null);
          setReceiptNotShared(true);
        }
      } catch {
        if (mounted) setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [token]);

  // G-6: the recipient accepts or declines via their invite token. The
  // site-contact link never offers this: only the recipient token does.
  const handleRespond = async (decision) => {
    setResponding(true);
    try {
      const result = await respondToRecipientInvite(token, decision);
      setStatus((prev) => (prev ? {
        ...prev,
        recipientConsentStatus: result.recipientConsentStatus || decision,
        recipientConsentedAt: result.recipientConsentedAt || new Date().toISOString(),
        canRespondAsRecipient: false,
      } : prev));
      toast.success(t(decision === 'accepted' ? 'booking.recipientAccepted' : 'booking.recipientDeclined'));
    } catch {
      toast.error(t('booking.recipientResponseFailed'));
    } finally {
      setResponding(false);
    }
  };

  const run = async (fn, okKey, failKey) => {
    setBusy(true);
    try {
      await fn();
      if (okKey) toast.success(t(okKey));
    } catch {
      toast.error(t(failKey));
    } finally {
      setBusy(false);
    }
  };

  const handleSiteAction = () => run(async () => {
    const details = {};
    if (actionType === 'request_callback' || actionType === 'suggest_window') details.window = actionDetail;
    else if (actionType === 'report_entry_problem') details.problem = actionDetail;
    else if (actionType === 'confirm_handoff') details.handedTo = actionDetail;
    else details.message = actionDetail;
    const row = await recordTokenSiteAction(token, { actionType, details });
    setActions((prev) => [row, ...prev]);
    setChecklist(await getTokenChecklist(token).catch(() => null));
    setActionDetail('');
  }, 'booking.token.actionRecorded', 'booking.token.actionFailed');

  const handleFeedback = () => run(async () => {
    await submitTokenFeedback(token, { rating: feedbackRating, body: feedbackBody });
    setFeedbackList(await listTokenFeedback(token).catch(() => []));
    setFeedbackBody('');
  }, 'booking.token.feedbackSubmitted', 'booking.token.feedbackFailed');

  const handlePhoto = () => run(async () => {
    if (!photoFile) return;
    await uploadTokenSitePhoto(token, photoFile);
    setPhotos(await listTokenSitePhotos(token).catch(() => []));
    setPhotoFile(null);
  }, 'booking.token.photoUploaded', 'booking.token.photoFailed');

  const handleSupport = () => run(async () => {
    await submitTokenSupport(token, { kind: supportKind, message: supportMessage });
    setTickets(await listTokenSupport(token).catch(() => []));
    setSupportMessage('');
  }, 'booking.token.supportSubmitted', 'booking.token.supportFailed');

  const dateLabel = status?.requestedDate
    ? new Date(`${status.requestedDate}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    : null;

  return (
    <div className="public-booking-status">
      <PageMeta title={t('booking.publicStatusTitle')} />
      <h1>{t('booking.publicStatusTitle')}</h1>
      {loading && <p>{t('common.loading')}</p>}
      {!loading && error && (
        <p role="alert">
          <AlertCircle size={18} aria-hidden="true" /> {t('booking.publicStatusNotFound')}
        </p>
      )}
      {!loading && !error && status && (
        <div>
          <p>
            <Calendar size={18} aria-hidden="true" /> {dateLabel}
          </p>
          <p>
            <Clock3 size={18} aria-hidden="true" />{' '}
            {formatTime(status.requestedStartTime)} – {formatTime(status.requestedEndTime)}
          </p>
          <p>
            <MapPin size={18} aria-hidden="true" /> {status.serviceName}
          </p>
          <p>
            <CheckCircle2 size={18} aria-hidden="true" />{' '}
            {t(`booking.publicStatus.${status.status}`)}
          </p>
          {status.arrivedAt && (
            <p>{t('booking.publicStatusArrived', { time: new Date(status.arrivedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })}</p>
          )}
          {status.helperDoorName && (
            <p>{t('booking.token.doorName', { name: status.helperDoorName })}</p>
          )}
          {status.careInstructions && (
            <p>{t('booking.token.careTitle')}: {status.careInstructions}</p>
          )}
          {status.siteContactName && (
            <p>{t('booking.publicStatusFor', { name: status.siteContactName })}</p>
          )}
          {status.hasRecipient && status.recipientConsentStatus === 'accepted' && (
            <p>{t('booking.recipientAcceptedNote')}</p>
          )}
          {status.hasRecipient && status.recipientConsentStatus === 'declined' && (
            <p>{t('booking.recipientDeclinedNote')}</p>
          )}
          {status.canRespondAsRecipient && (
            <div className="token-button-row">
              <p>{t('booking.recipientRespondPrompt')}</p>
              <button
                type="button"
                disabled={responding}
                onClick={() => handleRespond('accepted')}
                data-track="ui.474702b501.8"
              >
                {t('booking.acceptBooking')}
              </button>
              <button
                type="button"
                disabled={responding}
                onClick={() => handleRespond('declined')}
                data-track="ui.474702b501.9"
              >
                {t('booking.declineBooking')}
              </button>
            </div>
          )}
          {status.statusTokenExpiresAt && (
            <p className="token-note">
              {t('booking.publicStatusExpires', { date: new Date(status.statusTokenExpiresAt).toLocaleDateString() })}
              {' '}{t('booking.token.expiryExplain')}
            </p>
          )}
          <p className="token-note">{t('booking.publicStatusNote')}</p>

          {status.isSponsorPreview && (
            <SponsorSection token={token} preview={sponsorPreview} onPreviewChange={setSponsorPreview} />
          )}

          {!status.isSponsorPreview && summary && (
            <Section title={t('booking.token.summaryTitle')}>
              <p>{t('booking.token.visitFor', { name: summary.labels?.recipient || summary.labels?.siteContact || summary.serviceName })}</p>
              <p>{t('booking.token.yourRole', { role: t(`booking.sharingRole.${summary.viewerRole === 'site_contact' ? 'siteContact' : summary.viewerRole}`) })}</p>
              {summary.scope?.site && <p>{t('booking.token.scopeSite')}: {summary.scope.site}</p>}
              {summary.description && <p>{t('booking.token.scopeDescription')}: {summary.description}</p>}
              {summary.helper?.doorName && <p>{t('booking.token.doorName', { name: summary.helper.doorName })}</p>}
              {summary.authority?.[summary.viewerRole] && (
                <ul className="token-list">
                  {summary.authority[summary.viewerRole].map((item, index) => (
                    <li key={item}>
                      {t(`booking.token.authority.${summary.viewerRole === 'site_contact' ? 'siteContact' : summary.viewerRole}.${index}`)}
                    </li>
                  ))}
                </ul>
              )}
              {summary.careInstructions && <p>{t('booking.token.careTitle')}: {summary.careInstructions}</p>}
            </Section>
          )}

          {!status.isSponsorPreview && checklist && (
            <Section title={t('booking.token.checklistTitle')}>
              <ul className="token-list">
                {CHECKLIST_KEYS.map((key) => {
                  const item = checklist.items?.find((i) => i.key === key);
                  return (
                    <li key={key}>
                      {item?.done ? '✓' : '○'} {t(`booking.token.checklist.${key}`)}
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {!status.isSponsorPreview && (
            <Section title={t('booking.token.actionsTitle')}>
              <label className="token-field">
                <span>{t('booking.token.actionTypeLabel')}</span>
                <select value={actionType} onChange={(e) => setActionType(e.target.value)}>
                  {SITE_ACTION_TYPES.map((type) => (
                    <option key={type} value={type}>{t(`booking.token.siteActions.${type}`)}</option>
                  ))}
                </select>
              </label>
              <label className="token-field">
                <span>{t('booking.token.actionDetailLabel')}</span>
                <input
                  type="text"
                  value={actionDetail}
                  onChange={(e) => setActionDetail(e.target.value)}
                  placeholder={t('booking.token.actionDetailPlaceholder')}
                />
              </label>
              <button type="button" disabled={busy} onClick={handleSiteAction} data-track="ui.474702b501.14">
                {t('booking.token.recordAction')}
              </button>
              {actions.length > 0 && (
                <ul className="token-list">
                  {actions.map((a) => (
                    <li key={a.id} className="token-list-item">
                      {a.label} — {a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}
                    </li>
                  ))}
                </ul>
              )}
              {actions.length === 0 && <p className="token-note">{t('booking.token.noActions')}</p>}
            </Section>
          )}

          {!status.isSponsorPreview && status.status === 'completed' && (
            <Section title={t('booking.token.feedbackTitle')}>
              <p>{t('booking.token.feedbackPrompt')}</p>
              <label className="token-field">
                <span>{t('booking.token.feedbackRatingLabel')}</span>
                <select value={feedbackRating} onChange={(e) => setFeedbackRating(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label className="token-field">
                <span>{t('booking.token.feedbackBodyLabel')}</span>
                <textarea value={feedbackBody} onChange={(e) => setFeedbackBody(e.target.value)} placeholder={t('booking.token.feedbackBodyPlaceholder')} />
              </label>
              <button type="button" disabled={busy} onClick={handleFeedback} data-track="ui.474702b501.15">
                {t('booking.token.feedbackSubmit')}
              </button>
              {feedbackList.length > 0 && (
                <ul className="token-list">
                  {feedbackList.map((f) => (
                    <li key={f.id}>{f.rating ? `${f.rating}/5 — ` : ''}{f.body}</li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {!status.isSponsorPreview && (
            <Section title={t('booking.token.photosTitle')}>
              <label className="token-field">
                <span>{t('booking.token.photoUploadLabel')}</span>
                <input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
              </label>
              <button type="button" disabled={busy || !photoFile} onClick={handlePhoto} data-track="ui.474702b501.16">
                {t('common.submit')}
              </button>
              {photos.length > 0 && (
                <ul className="token-photo-list">
                  {photos.map((p) => (
                    <li key={p.id}>
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noreferrer">
                          <img className="token-photo-thumb" src={p.url} alt={t('booking.token.photoAlt')} />
                        </a>
                      ) : (
                        <span>{t('booking.token.photoBy', { who: p.contributorType })}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {photos.length === 0 && <p className="token-note">{t('booking.token.noPhotos')}</p>}
            </Section>
          )}

          <Section title={t('booking.token.supportTitle')}>
            <label className="token-field">
              <span>{t('booking.token.supportKindLabel')}</span>
              <select value={supportKind} onChange={(e) => setSupportKind(e.target.value)}>
                {SUPPORT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{t(`booking.token.supportKinds.${kind}`)}</option>
                ))}
              </select>
            </label>
            <label className="token-field">
              <span>{t('booking.token.supportMessageLabel')}</span>
              <textarea value={supportMessage} onChange={(e) => setSupportMessage(e.target.value)} placeholder={t('booking.token.supportMessagePlaceholder')} />
            </label>
            <button type="button" disabled={busy || !supportMessage.trim()} onClick={handleSupport} data-track="ui.474702b501.17">
              {t('booking.token.supportSubmit')}
            </button>
            {tickets.length > 0 && (
              <ul className="token-list">
                {tickets.map((ticket) => (
                  <li key={ticket.ticketId} className="token-list-item">
                    <div>{t('booking.token.supportTicket', { number: ticket.ticketNumber })} — {ticket.status}</div>
                    {ticket.messages?.map((m) => (
                      <div key={m.id} className="token-note">
                        {m.fromSupport ? t('booking.token.supportFromSupport') : m.senderName}: {m.content}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            {tickets.length === 0 && <p className="token-note">{t('booking.token.noSupport')}</p>}
          </Section>

          {!status.isSponsorPreview && (
            <>
              <Section title={t('booking.token.updateEmailTitle')}>
                <label className="token-field">
                  <span>{t('booking.token.updateEmailLabel')}</span>
                  <input
                    type="email"
                    value={updateEmail}
                    onChange={(e) => setUpdateEmail(e.target.value)}
                    placeholder={t('booking.token.updateEmailPlaceholder')}
                  />
                </label>
                <div className="token-button-row">
                  <button type="button" disabled={busy || !updateEmail.trim()} onClick={() => run(async () => { await registerTokenUpdateEmail(token, updateEmail); }, 'booking.token.updateEmailRegistered', 'booking.token.updateEmailFailed')} data-track="ui.474702b501.18">
                    {t('booking.token.updateEmailRegister')}
                  </button>
                  <button type="button" disabled={busy || !updateEmail.trim()} onClick={() => run(async () => { await removeTokenUpdateEmail(token, updateEmail); }, 'booking.token.updateEmailRemoved', 'booking.token.updateEmailFailed')} data-track="ui.474702b501.19">
                    {t('booking.token.updateEmailRemove')}
                  </button>
                </div>
              </Section>

              <Section title={t('booking.token.correctionTitle')}>
                <label className="token-field">
                  <span>{t('booking.token.correctionFieldLabel')}</span>
                  <select value={correctionField} onChange={(e) => setCorrectionField(e.target.value)}>
                    <option value="name">{t('booking.token.correctionName')}</option>
                    <option value="phone">{t('booking.token.correctionPhone')}</option>
                  </select>
                </label>
                <label className="token-field">
                  <span>{t('booking.token.correctionValueLabel')}</span>
                  <input type="text" value={correctionValue} onChange={(e) => setCorrectionValue(e.target.value)} />
                </label>
                <button type="button" disabled={busy || !correctionValue.trim()} onClick={() => run(async () => { await submitTokenContactCorrection(token, { field: correctionField, value: correctionValue }); setCorrectionValue(''); }, 'booking.token.correctionDone', 'booking.token.correctionFailed')} data-track="ui.474702b501.20">
                  {t('booking.token.correctionSubmit')}
                </button>
              </Section>

              <Section title={t('booking.token.relayTitle')}>
                <label className="token-field">
                  <span>{t('booking.token.relayToLabel')}</span>
                  <select value={relayTo} onChange={(e) => setRelayTo(e.target.value)}>
                    <option value="booker">{t('booking.token.relayTo.booker')}</option>
                    <option value="helper">{t('booking.token.relayTo.helper')}</option>
                    <option value="site_contact">{t('booking.token.relayTo.site_contact')}</option>
                  </select>
                </label>
                <label className="token-field">
                  <span>{t('booking.token.relayMessageLabel')}</span>
                  <textarea value={relayMessage} onChange={(e) => setRelayMessage(e.target.value)} placeholder={t('booking.token.relayMessagePlaceholder')} />
                </label>
                <button type="button" disabled={busy || !relayMessage.trim()} onClick={() => run(async () => { await sendTokenRelayMessage(token, { to: relayTo, message: relayMessage }); setRelayMessage(''); }, 'booking.token.relaySent', 'booking.token.relayFailed')} data-track="ui.474702b501.21">
                  {t('booking.token.relaySend')}
                </button>
              </Section>

              <Section title={t('booking.token.linkTitle')}>
                <p className="token-note">{t('booking.token.renewalExplain')}</p>
                <div className="token-button-row">
                  <button type="button" disabled={busy} onClick={() => run(async () => { await requestTokenLinkRenewal(token, {}); }, 'booking.token.renewalRequested', 'booking.token.renewalFailed')} data-track="ui.474702b501.22">
                    {t('booking.token.renewalRequest')}
                  </button>
                  <button type="button" disabled={busy} onClick={() => run(async () => { await optOutTokenNotifications(token, {}); }, 'booking.token.optOutDone', 'booking.token.optOutFailed')} data-track="ui.474702b501.23">
                    {t('booking.token.optOutLabel')}
                  </button>
                  <button type="button" disabled={busy} onClick={() => run(async () => { await archiveTokenVisit(token); }, 'booking.token.archived', 'booking.token.archiveFailed')} data-track="ui.474702b501.24">
                    {t('booking.token.archiveButton')}
                  </button>
                </div>
              </Section>

              <Section title={t('booking.token.receiptTitle')}>
                {receipt && (
                  <div>
                    <div className="token-detail-row">
                      <span className="token-detail-label">{t('booking.service')}:</span>
                      <span>{receipt.serviceName}</span>
                    </div>
                    <div className="token-detail-row">
                      <span className="token-detail-label">{t('booking.status')}:</span>
                      <span>{receipt.status}</span>
                    </div>
                    <p className="token-note">{t('booking.token.receiptConfirmation', { code: receipt.confirmationCode })}</p>
                  </div>
                )}
                {!receipt && receiptNotShared && <p className="token-note">{t('booking.token.receiptNotShared')}</p>}
              </Section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
