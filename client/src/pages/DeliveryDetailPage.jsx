import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import DeliveryTrackingCard from '../components/delivery/DeliveryTrackingCard';
import DriverTrackingControls from '../components/delivery/DriverTrackingControls';
// Group 9 Slice G (items 496/497): the offline task checklist with
// its queued-action outbox, and the explicit connection-recovery
// flow (visible connection state + reconnect and resync).
import DriverOfflineChecklist from '../components/delivery/DriverOfflineChecklist';
import DriverConnectionRecovery from '../components/delivery/DriverConnectionRecovery';
import { buildOutboxExecutors } from '../components/delivery/driverOfflineOutbox';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import {
  createDeliveryExtraCheckout, createDeliveryCheckout, getDelivery, reportDeliveryIssue, requestDeliveryExtra,
  requestDeliveryReschedule, requestDeliveryReturn, reviewDeliveryExtra,
  syncDeliveryExtraPayment, syncDeliveryPayment, updateDeliveryStatus, uploadDeliveryProof,
  uploadDeliveryItemPhoto, claimDeliveryJob, declineDeliveryJob,
  addDeliveryStop, reorderDeliveryStops, completeDeliveryStop, updateDeliveryStopNote,
  sendDeliveryWaitingNotice, resumeDeliveryJob, requestDeliveryRedelivery, reviewDeliveryRedelivery,
  obtainDeliveryPin, deliveryDate, deliveryMoney, deliveryUnit, deliveryError, deliveryClaimReasons,
  getJobExceptions, listJobDocuments, downloadDeliveryReceipt,
  createDeliveryDispute, listJobDisputes,
} from '../api/delivery';
// Group 9 partials Wave 2 Batch L (455, G9-A15, D-531): the offer panel
// shows the job-scoped readiness checklist, so the driver sees what
// blocks this specific delivery before claiming.
import { DriverReadinessChecklist } from './DeliveryPage';
import { RoutePreview } from '../components/delivery/DeliveryEstimate';
// Group 9 Slice C (items 462/463/465): the multi-stop sequence, the
// window-warning banner, and the per-stop navigation handoff.
import DeliveryStops, { WindowWarningBanner } from '../components/delivery/DeliveryStops';
// Group 9 Slice B (items 457/458/460): the offer countdown, the driver
// route preview, and the decline (pass) form, shared with the inbox card.
import { DeclineForm, OfferCountdown, isOfferExpired } from '../components/delivery/DeliveryOffer';
import '../styles/DeliveryPage.css';

const TERMINAL = ['delivered', 'cancelled', 'returned'];
const EXTRA_CATEGORIES = ['waiting', 'parking_toll', 'difficult_access', 'loading_help', 'special_handling'];
// Group 9 Slice D (items 470/475): the two new issue codes. The five
// existing codes are unchanged.
// Group 9 Slice E (item 476): closed_site, with structured capture of
// what was closed, a posted notice, and any contact attempt.
const ISSUE_CODES = ['delay', 'damage', 'access_problem', 'missing_shipment', 'customer_report', 'wrong_item', 'recipient_unavailable', 'closed_site'];
const UNAVAILABLE_REASONS = ['no_answer', 'refused', 'wrong_address', 'moved', 'other'];
const CLOSED_SITE_WHATS = ['gate', 'building', 'reception', 'loading_dock', 'other'];
// Group 9 Slice F (item 494): the dispute subjects. A dispute is a
// filing on a completed assignment, distinct from a generic issue.
const DISPUTE_SUBJECTS = ['payout_amount', 'assignment_facts', 'rating'];

export default function DeliveryDetailPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { socket } = useSocket();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  // Group 9 partials Wave 2 Batch L (455, G9-A15, D-531): the server's
  // reasons for a failed claim, rendered under the error.
  const [claimReasons, setClaimReasons] = useState([]);
  const [denied, setDenied] = useState(false);
  // Group 9 Slice G (item 498): a driver's job access expires 7
  // days after the job reaches a terminal state. The detail read
  // 410s, and the page shows the expired-access state with links to
  // the surfaces that stay open (history, payouts, reports, shifts).
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [issue, setIssue] = useState('');
  const [issueCode, setIssueCode] = useState('delay');
  // Group 9 Slice D (items 467/468/470/475): the pickup confirmation
  // (piece count + condition acknowledgment), the wrong-item pair, the
  // recipient-unavailable reason, and the reason carried into a failed
  // drop-off return.
  const [pickupPieces, setPickupPieces] = useState('');
  const [conditionAck, setConditionAck] = useState(false);
  const [conditionNote, setConditionNote] = useState('');
  const [wrongItemReceived, setWrongItemReceived] = useState('');
  const [wrongItemExpected, setWrongItemExpected] = useState('');
  const [unavailableReason, setUnavailableReason] = useState('no_answer');
  // Group 9 Slice E (item 476): the closed-site structure — what was
  // closed, whether a notice was posted, whether anyone on site was
  // contacted.
  const [closedWhat, setClosedWhat] = useState('gate');
  const [noticeSeen, setNoticeSeen] = useState(false);
  const [contactAttempted, setContactAttempted] = useState(false);
  const [returnUnavailableReason, setReturnUnavailableReason] = useState('');
  const [proofValue, setProofValue] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientContact, setRecipientContact] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [proofFile, setProofFile] = useState(null);
  const [itemPhotoFile, setItemPhotoFile] = useState(null);
  const [pin, setPin] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [windowType, setWindowType] = useState('deliveryWindow');
  const [reason, setReason] = useState('');
  const [declineOpen, setDeclineOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  // Group 9 Slice F (items 488/489/494): the exception summary, the
  // authorized document list, and the disputes for this job. Each
  // read is participant-only server-side; a marketplace driver
  // previewing an offer gets none of them, so failures resolve to
  // empty and the sections stay hidden.
  const [exceptions, setExceptions] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeSubject, setDisputeSubject] = useState('payout_amount');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [extra, setExtra] = useState({ category: 'waiting', amount: '', notes: '' });
  // Group 9 partials Wave 2 Batch O (469/475, G9-A10/G9-A11, D-545/
  // D-548): the free waiting-notice note, and the redelivery-attempt
  // request (a new delivery window for a failed drop-off).
  const [waitingNote, setWaitingNote] = useState('');
  const [redeliveryStart, setRedeliveryStart] = useState('');
  const [redeliveryEnd, setRedeliveryEnd] = useState('');
  const [redeliveryReason, setRedeliveryReason] = useState('');
  const uploaded = useRef(null);
  const requestSequence = useRef(0);
  const actionLock = useRef(false);
  // Group 9 Slice G (item 496): the offline outbox executors for
  // this job, built once from the delivery API. The checklist and
  // the connection-recovery flow share them, so a queued action
  // replays the same way from either surface.
  const outboxExecutors = useMemo(() => buildOutboxExecutors(id, {
    updateDeliveryStatus, reportDeliveryIssue, completeDeliveryStop, uploadDeliveryProof,
  }), [id]);
  const job = data?.job;
  const isCustomer = Boolean(user?.id) && String(job?.customer_user_id) === String(user.id);
  const isAssigned = job?.is_assigned_operator === true;
  const participant = isCustomer || isAssigned;
  const active = job && !TERMINAL.includes(job.status);
  const money = (cents, currency) => deliveryMoney(cents, i18n.language, currency);
  const date = (value) => deliveryDate(value, i18n.language);
  const label = (group, value) => t(`delivery.${group}.${value}`, { defaultValue: t('delivery.ui.unknown') });

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setExpired(false);
    try {
      const response = await getDelivery(id);
      if (sequence !== requestSequence.current) return null;
      setData(response); setDenied(false); setError('');
      const [exceptionResponse, documentResponse, disputeResponse] = await Promise.all([
        getJobExceptions(id).catch(() => null),
        listJobDocuments(id).catch(() => null),
        listJobDisputes(id).catch(() => null),
      ]);
      if (sequence !== requestSequence.current) return null;
      setExceptions(exceptionResponse);
      setDocuments(Array.isArray(documentResponse?.documents) ? documentResponse.documents : []);
      setDisputes(Array.isArray(disputeResponse?.disputes) ? disputeResponse.disputes : []);
      return response.job || null;
    } catch (failure) {
      if (sequence !== requestSequence.current) return null;
      setError(deliveryError(failure, t, 'delivery.errors.detail'));
      // Group 9 Slice G (item 498): 410 is the expired-access
      // state, not a generic failure. The job stays out of reach;
      // the driver's history, payouts, reports, and receipts are
      // separate surfaces and stay open.
      if (failure?.response?.status === 410) setExpired(true);
      if ([401, 403, 404].includes(failure?.response?.status)) {
        setData(null); setDenied([401, 403].includes(failure.response.status));
      }
      return null;
    } finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [id, t]);

  useEffect(() => {
    setData(null); setPin(''); setProofValue(''); setReason(''); setNotice(''); setDeclineOpen(false);
    uploaded.current = null;
    load();
    return () => { requestSequence.current += 1; };
  }, [id, load]);

  useEffect(() => {
    const refresh = (payload) => { if (String(payload?.jobId) === String(id)) load(); };
    socket?.on('delivery:updated', refresh);
    socket?.on('connect', load);
    return () => { socket?.off('delivery:updated', refresh); socket?.off('connect', load); };
  }, [id, load, socket]);

  const act = async (operation, successKey = 'delivery.ui.saved', errorKey = 'delivery.errors.status') => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(''); setNotice(''); setClaimReasons([]);
    try {
      await operation();
      setNotice(t(successKey));
      await load();
    } catch (failure) { setClaimReasons(deliveryClaimReasons(failure, t)); setError(deliveryError(failure, t, errorKey)); }
    finally { actionLock.current = false; setBusy(false); }
  };

  useEffect(() => {
    const extraId = searchParams.get('extra_id');
    if (!isCustomer || searchParams.get('payment') !== 'success') return;
    // A checkout redirect is not proof of payment. Only the API can confirm it.
    let cancelled = false;
    const pending = (data?.payments || []).filter((payment) => !['paid', 'refunded'].includes(payment.status));
    if (!extraId && !pending.length) return;
    const reconciliation = extraId ? syncDeliveryExtraPayment(extraId) : Promise.all(pending.map((payment) => syncDeliveryPayment(payment.id)));
    reconciliation.then(() => { if (!cancelled) load(); })
      .catch((failure) => { if (!cancelled) setError(deliveryError(failure, t, 'delivery.errors.payment')); });
    return () => { cancelled = true; };
  }, [isCustomer, load, searchParams, t]);

  const submitProof = (event) => {
    event.preventDefault();
    act(async () => {
      const proofType = job.proof_preference;
      const details = { proofType };
      if (proofType === 'pin') details.proofValue = proofValue;
      if (proofType === 'recipient_confirmation') Object.assign(details, { recipientName, recipientContact, confirmed });
      if (['photo', 'signature'].includes(proofType)) {
        if (!proofFile) throw new Error('Missing proof');
        if (!uploaded.current) uploaded.current = await uploadDeliveryProof(id, proofFile, proofType);
        if (!uploaded.current.uploadId) throw new Error('Missing upload receipt');
        details.uploadId = uploaded.current.uploadId;
      }
      await updateDeliveryStatus(id, 'delivered', details);
      setProofValue(''); setProofFile(null); uploaded.current = null;
    }, 'delivery.ui.saved', 'delivery.ui.proofInvalid');
  };

  const reschedule = (event) => {
    event.preventDefault();
    const start = new Date(windowStart), end = new Date(windowEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start <= new Date() || end <= start) {
      setError(t('delivery.ui.windowInvalid')); return;
    }
    act(() => requestDeliveryReschedule(id, { [windowType]: { start: start.toISOString(), end: end.toISOString() }, reason }),
      'delivery.detail.rescheduleSent', 'delivery.errors.reschedule');
  };

  const checkout = (extraId = null) => act(async () => {
    const response = extraId ? await createDeliveryExtraCheckout(extraId) : await createDeliveryCheckout(id);
    if (response.checkoutUrl && new URL(response.checkoutUrl).protocol === 'https:') window.location.assign(response.checkoutUrl);
    else if (!response.payment) throw new Error('Checkout unavailable');
  }, 'delivery.ui.paymentPending', 'delivery.errors.payment');

  if (!job) return <PageShell><div className="delivery-page" dir={i18n.dir()}>
    {loading ? <p role="status">{t('delivery.detail.loading')}</p> : <p className="delivery-alert delivery-alert--error" role="alert">{error || t('delivery.errors.detail')}</p>}
    {!loading && <button className="delivery-button delivery-button--secondary" onClick={load} data-track="ui.4c1e141977.1">{t('delivery.ui.retry')}</button>}
    {denied && <p>{t('delivery.ui.permissionHint')}</p>}
    {/* Group 9 Slice G (item 498): the expired-access state. The
      job detail is closed, but the driver's own record surfaces
      stay open: history, payouts, weekly reports, shifts, receipts. */}
    {expired && <div className="delivery-alert delivery-alert--warning" role="alert">
      <p>{t('delivery.ui.accessExpired')}</p>
      <p>{t('delivery.ui.accessExpiredHint')}</p>
      <p>
        <Link to="/delivery">{t('delivery.ui.historyLink')}</Link>
        {' · '}
        <Link to="/delivery/payouts">{t('delivery.driverPayoutHistory.viewHistory')}</Link>
        {' · '}
        <Link to="/delivery/weekly-report">{t('delivery.weeklyReport.link')}</Link>
        {' · '}
        <Link to="/delivery/shifts">{t('delivery.shift.link')}</Link>
      </p>
    </div>}
    <Link className="delivery-button delivery-button--secondary" to="/delivery">{t('delivery.detail.back')}</Link>
  </div></PageShell>;

  const { activity = [], proofs = [], extras = [], issues = [], payments = [], rescheduleRequests = [], redeliveryRequests = [], returns = [], itemPhotos = [] } = data;
  // Group 9 partials Wave 2 Batch N (467/468, G9-A5, D-542): the
  // customer photos the driver checks the items against before
  // acknowledging the condition, shown inside the pickup form as
  // well as in the photos section below it.
  const pickupPhotos = itemPhotos.filter((photo) => photo.url);
  // Group 9 Slice C (items 462/463): the stop sequence and the current
  // window warnings, both from the detail read.
  const stops = data.stops || [];
  const windowWarnings = data.windowWarnings || [];
  const eta = data.eta || job.eta;
  const trackable = ['assigned', 'picked_up', 'in_transit'].includes(job.status);
  // Group 9 Slice B (items 457/458/460, D-65): a marketplace driver may
  // open a posted offer read-only. They see the route preview, the
  // countdown, and the claim / decline actions; the participant-only
  // sections below stay hidden because isCustomer/isAssigned are false.
  const isOffered = job.status === 'posted' && job.marketplace_available === true;
  const basePayment = payments.find((payment) => payment.delivery_extra_id == null);
  const nextStatus = job.status === 'assigned' ? 'picked_up' : job.status === 'picked_up' ? 'in_transit' : null;
  const canReturn = participant && ['picked_up', 'in_transit', 'failed'].includes(job.status);
  const canCancel = participant && ['posted', 'assigned'].includes(job.status);
  // Group 9 partials Wave 2 Batch O (475, G9-A11, D-548): the driver
  // can request a redelivery attempt on a failed drop-off — the job
  // is failed, or a recipient_unavailable issue was recorded for it —
  // while no redelivery request is already pending.
  const canRedelivery = isAssigned && ['failed', 'in_transit', 'picked_up'].includes(job.status)
    && (job.status === 'failed' || issues.some((item) => item.code === 'recipient_unavailable'))
    && !redeliveryRequests.some((item) => item.status === 'pending');
  const paymentLabel = (extraItem) => ['captured', 'paid'].includes(extraItem.payment_status)
    ? t('delivery.detail.paymentStates.paid')
    : extraItem.status === 'approved' ? label('ui.paymentStates', extraItem.payment_status) : label('detail.extraStatus', extraItem.status);

  return <PageShell>
    <PageMeta title={`${job.reference} - ${t('delivery.metaTitle')}`} description={t('delivery.detail.subtitle')} />
    <div className="delivery-page delivery-detail-page" dir={i18n.dir()}>
      <header className="delivery-hero">
        <div><Link className="delivery-back-link" to="/delivery"><ArrowLeft size={15} />{t('delivery.detail.back')}</Link><h1>{job.reference}</h1><p>{t('delivery.detail.subtitle')}</p></div>
        <span className="delivery-hero__badge"><Truck size={24} />{label('helper.status', job.status)}</span>
        <button className="delivery-button delivery-button--secondary" disabled={loading || busy} onClick={load} data-track="ui.4c1e141977.2"><RefreshCw size={16} />{t('delivery.helper.refresh')}</button>
      </header>
      {error && <div className="delivery-alert delivery-alert--error" role="alert">{error}<button className="delivery-button delivery-button--secondary" disabled={loading || busy} onClick={load} data-track="ui.4c1e141977.3">{t('delivery.helper.refresh')}</button></div>}
      {claimReasons.length > 0 && (
        <div className="delivery-alert delivery-alert--error" role="alert">
          <p>{t('delivery.errors.claimReasons')}</p>
          <ul>{claimReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}
      {notice && <p className="delivery-alert delivery-alert--success" role="status">{notice}</p>}
      {/* Group 9 Slice D (item 467): a mismatched pickup count is
        flagged to everyone on the job, never silently passed. */}
      {job.pickup_pieces_mismatch && <p className="delivery-alert delivery-alert--error" role="alert">{t('delivery.detail.pickupPiecesMismatch', { confirmed: job.pickup_confirmed_pieces, booked: job.pieces })}</p>}
      {trackable && <DeliveryTrackingCard jobId={id} />}
      <div className="delivery-detail-grid">
        <section className="delivery-panel"><h2>{t('delivery.detail.route')}</h2>
          <dl className="delivery-breakdown">
            {['origin', 'destination'].map((stop) => <div key={stop}><dt>{t(stop === 'origin' ? 'delivery.customer.pickup' : 'delivery.customer.dropoff')}</dt>
              <dd>{[job[`${stop}_address`], job[`${stop}_city`], job[`${stop}_state`]].filter(Boolean).join(', ')}
                {job[`${stop}_contact_name`] && <p>{job[`${stop}_contact_name`]} {job[`${stop}_contact_phone`]}</p>}
                {job[`${stop}_instructions`] && <p>{job[`${stop}_instructions`]}</p>}</dd></div>)}
            <div><dt>{t('delivery.customer.total')}</dt><dd>{money(job.customer_total_cents, job.currency)}</dd></div>
            <div><dt>{t('delivery.customer.package')}</dt><dd>{label('packageTypes', job.package_type)}</dd></div>
            {job.item_description && <div><dt>{t('delivery.detail.itemDescription')}</dt><dd>{job.item_description}</dd></div>}
            {job.notes && <div><dt>{t('delivery.customer.notes')}</dt><dd>{job.notes}</dd></div>}
            <div><dt>{t('delivery.customer.weight')}</dt><dd>{deliveryUnit(job.weight_lbs, 'pound', i18n.language)}</dd></div>
            <div><dt>{t('delivery.operations.pieces')}</dt><dd>{new Intl.NumberFormat(i18n.language === 'ht' ? 'fr-HT' : i18n.language).format(job.pieces || 1)}</dd></div>
            {/* Group 9 Slice D (items 467/468): the confirmed pickup
              count and the condition acknowledgment, shown to the
              shipper, the customer, and the driver. */}
            {job.pickup_confirmed_pieces != null && <div><dt>{t('delivery.detail.pickupConfirmedPieces')}</dt><dd>{new Intl.NumberFormat(i18n.language === 'ht' ? 'fr-HT' : i18n.language).format(job.pickup_confirmed_pieces)}</dd></div>}
            {job.pickup_condition_acknowledged && <div><dt>{t('delivery.detail.pickupConditionAcknowledged')}</dt><dd>{job.pickup_condition_note || t('delivery.detail.pickupCondition')}</dd></div>}
            <div><dt>{t('delivery.ui.eta')}</dt><dd>{eta?.available && eta.estimatedArrivalAt ? date(eta.estimatedArrivalAt) : t('delivery.ui.etaUnavailable')}
              {eta?.available && eta.updatedAt && <small>{t('delivery.ui.updated', { date: date(eta.updatedAt) })}</small>}</dd></div>
            {['pickup', 'delivery'].map((kind) => job[`${kind}_window_start`] && <div key={kind}><dt>{t(kind === 'pickup' ? 'delivery.customer.pickup' : 'delivery.customer.dropoff')}</dt><dd>{date(job[`${kind}_window_start`])} – {date(job[`${kind}_window_end`])}</dd></div>)}
          </dl>
          {/* Group 9 Slice B (item 458): the driver route preview. It
            renders nothing when the job has no coordinates, so a job
            without route data falls back to the addresses and distance
            above instead of a broken map. */}
          <RoutePreview job={job} t={t} />
          {/* Group 9 Slice C (items 462/463/465): the stop sequence with
            per-stop completion, reordering, and navigation handoff, plus
            the window-warning banner for the assigned driver. Single-leg
            jobs read as their two legacy stops (origin pickup,
            destination dropoff), so the route section is unchanged for
            them apart from the Navigate links. */}
          {isAssigned && windowWarnings.length > 0 && <WindowWarningBanner warnings={windowWarnings} t={t} date={date} />}
          <DeliveryStops job={job} stops={stops} warnings={windowWarnings} isAssigned={isAssigned} isOwner={isCustomer} t={t} date={date} busy={busy}
            onComplete={(stopId) => act(() => completeDeliveryStop(id, stopId))}
            onMove={(stopIds) => act(() => reorderDeliveryStops(id, stopIds))}
            onNote={(stopId, note) => act(() => updateDeliveryStopNote(id, stopId, note))}
            onAdd={(payload) => act(() => addDeliveryStop(id, payload))} />
          {isOffered && (
            <div className="delivery-offer-panel">
              <OfferCountdown job={job} t={t} />
              {job.my_decline && <p className="delivery-job-card__declined">{t('delivery.driver.declined')} · {t(`delivery.driver.declineReasons.${job.my_decline.reason_code}`)}</p>}
              <DriverReadinessChecklist t={t} jobId={id} fixBase="/delivery" />
              {/* Group 9 partials Wave 2 Batch M (457/460, G9-A14, D-539):
                the claim hides once the offer expires, but the decline
                stays: the server accepts declining an expired offer (D-62)
                and the signal is still useful to dispatch. */}
              <div className="delivery-dispatch-actions">
                {!isOfferExpired(job) && (
                  <button type="button" className="delivery-button delivery-button--primary" disabled={busy} onClick={() => act(() => claimDeliveryJob(id), 'delivery.ui.saved', 'delivery.errors.claim')} data-track="ui.4c1e141977.26">{t('delivery.helper.claim')}</button>
                )}
                {!declineOpen && <button type="button" className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => setDeclineOpen(true)} data-track="ui.4c1e141977.27">{job.my_decline ? t('delivery.driver.declineChange') : t('delivery.driver.decline')}</button>}
              </div>
              {declineOpen && (
                <DeclineForm job={job} t={t} busy={busy} onSubmit={(payload) => { setDeclineOpen(false); act(() => declineDeliveryJob(id, payload)); }} onCancel={() => setDeclineOpen(false)} />
              )}
            </div>
          )}
          {/* Group 9 Slice D (items 467/468): pickup is a confirmation
            step, not a bare button. The driver confirms the collected
            piece count and acknowledges the item condition before the
            pickup can complete; the server 400s without either.
            Group 9 partials Wave 2 Batch N (467/468, G9-A5, D-541):
            the count starts blank and the driver must type it. A blank
            or out-of-range count never sends a request, so the booked
            count can no longer slip through as the confirmation.
            Batch N (468, D-542): the customer photos render inside the
            form when present; when none exist the form says so, and the
            checkbox covers the driver's own inspection instead. */}
          {isAssigned && nextStatus === 'picked_up' && <form onSubmit={(event) => { event.preventDefault(); const confirmedPieces = Number(pickupPieces); if (!Number.isInteger(confirmedPieces) || confirmedPieces < 1 || confirmedPieces > 9999) { setError(t('delivery.detail.pickupPiecesRequired')); return; } act(async () => { await updateDeliveryStatus(id, 'picked_up', { pickupConfirmedPieces: confirmedPieces, conditionAcknowledged: conditionAck, conditionNote }); setPickupPieces(''); setConditionAck(false); setConditionNote(''); }, 'delivery.ui.saved', 'delivery.errors.status'); }} data-track="ui.4c1e141977.28"><fieldset className="delivery-form-fields" disabled={busy}>
            <h3>{t('delivery.detail.pickupConfirmTitle')}</h3><p>{t('delivery.detail.pickupPiecesHint')}</p>
            <label className="delivery-field">{t('delivery.detail.pickupPieces')}<input className="delivery-input" type="number" min="1" max="9999" inputMode="numeric" required value={pickupPieces} onChange={(event) => setPickupPieces(event.target.value)} /></label>
            {pickupPhotos.length ? (
              <div className="delivery-item-photos">
                <p>{t('delivery.detail.pickupConditionPhotos')}</p>
                <div className="delivery-item-photos__grid">
                  {pickupPhotos.map((photo) => (
                    <img key={photo.id} src={photo.url} alt={t('delivery.detail.itemPhoto')} />
                  ))}
                </div>
              </div>
            ) : <p>{t('delivery.detail.pickupConditionNoPhotos')}</p>}
            <label><input type="checkbox" checked={conditionAck} onChange={(event) => setConditionAck(event.target.checked)} required data-track="ui.4c1e141977.29" /> {pickupPhotos.length ? t('delivery.detail.pickupCondition') : t('delivery.detail.pickupConditionSelfChecked')}</label>
            <label className="delivery-field">{t('delivery.detail.pickupConditionNote')}<input className="delivery-input" value={conditionNote} onChange={(event) => setConditionNote(event.target.value)} maxLength={500} /></label>
            <button className="delivery-button delivery-button--primary" data-track="ui.4c1e141977.30">{t('delivery.helper.moveTo', { status: label('helper.status', nextStatus) })}</button>
          </fieldset></form>}
          {isAssigned && nextStatus === 'in_transit' && <button className="delivery-button delivery-button--primary" disabled={busy} onClick={() => act(() => updateDeliveryStatus(id, nextStatus))} data-track="ui.4c1e141977.4">{t('delivery.helper.moveTo', { status: label('helper.status', nextStatus) })}</button>}
          <div className="delivery-item-photos">
            <h3>{t('delivery.detail.itemPhoto')}</h3>
            {itemPhotos.filter((photo) => photo.url).length ? (
              <div className="delivery-item-photos__grid">
                {itemPhotos.filter((photo) => photo.url).map((photo) => (
                  <img key={photo.id} src={photo.url} alt={t('delivery.detail.itemPhoto')} />
                ))}
              </div>
            ) : <p>{t('delivery.detail.itemPhotosEmpty')}</p>}
            {isCustomer && ['posted', 'assigned'].includes(job.status) && (
              <form onSubmit={(event) => { event.preventDefault(); if (!itemPhotoFile) return; act(async () => { await uploadDeliveryItemPhoto(id, itemPhotoFile); setItemPhotoFile(null); }, 'delivery.ui.saved', 'delivery.errors.status'); }} data-track="ui.4c1e141977.24">
                <label className="delivery-field">{t('delivery.detail.itemPhotoUpload')}
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file && file.size > 10485760) { setItemPhotoFile(null); event.target.value = ''; setError(t('delivery.ui.fileTooLarge')); } else setItemPhotoFile(file || null); }} />
                  <small>{t('delivery.detail.itemPhotoHint')}</small>
                </label>
                <button type="submit" className="delivery-button delivery-button--secondary" disabled={!itemPhotoFile || busy} data-track="ui.4c1e141977.25">{t('delivery.detail.itemPhotoUpload')}</button>
              </form>
            )}
          </div>
          {isCustomer && active && job.proof_preference === 'pin' && <div className="delivery-proof-list"><p>{t('delivery.ui.pinHint')}</p><button className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => act(async () => { const result = await obtainDeliveryPin(id); setPin(result.proofPin || ''); })} data-track="ui.4c1e141977.5">{t('delivery.ui.obtainPin')}</button>{pin && <p role="status"><strong>{t('delivery.detail.pin')}: <bdi>{pin}</bdi></strong></p>}</div>}
          <div className="delivery-proof-list"><h3>{t('delivery.detail.proof')}</h3>{proofs.length ? proofs.map((proof) => <p key={proof.id}>{label('proofTypes', proof.proof_type)} · {label('ui.proofStates', proof.verification_status)}</p>) : <p>{t('delivery.detail.noProof')}</p>}</div>
          {isAssigned && job.status === 'in_transit' && <form onSubmit={submitProof} className="delivery-form" data-track="ui.4c1e141977.6"><fieldset className="delivery-form-fields" disabled={busy}>
            <h3>{t('delivery.detail.submitProof')}</h3><p>{t('delivery.detail.proofPreference', { type: label('proofTypes', job.proof_preference) })}</p>
            {job.proof_preference === 'pin' && <label className="delivery-field">{t('delivery.detail.pin')}<input className="delivery-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={proofValue} onChange={(event) => setProofValue(event.target.value)} required /></label>}
            {job.proof_preference === 'recipient_confirmation' && <>
              <label className="delivery-field">{t('delivery.detail.recipientName')}<input className="delivery-input" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} maxLength={160} required /></label>
              {/* Group 9 partials Wave 2 Batch O (471, G9-A6, D-546):
                the recipient phone is masked to its last 4 digits, so
                the last 4 digits are enough here; the full number is
                no longer shown anywhere on the page. */}
              <label className="delivery-field">{t('delivery.ui.recipientContact')}<input className="delivery-input" value={recipientContact} onChange={(event) => setRecipientContact(event.target.value)} maxLength={160} required /><small>{t('delivery.detail.recipientContactHint')}</small></label>
              <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required data-track="ui.4c1e141977.7" /> {t('delivery.ui.recipientConfirmed')}</label>
            </>}
            {['photo', 'signature'].includes(job.proof_preference) && <label className="delivery-field">{t('delivery.detail.proofFile')}<input type="file" accept={job.proof_preference === 'signature' ? 'image/jpeg,image/png,image/webp,application/pdf' : 'image/jpeg,image/png,image/webp'} required onChange={(event) => { const file = event.target.files?.[0]; uploaded.current = null; if (file && file.size > 10485760) { setProofFile(null); event.target.value = ''; setError(t('delivery.ui.fileTooLarge')); } else setProofFile(file || null); }} /><small>{t('delivery.ui.proofFileHint')}</small></label>}
            <button className="delivery-button delivery-button--primary" disabled={!['pin', 'photo', 'signature', 'recipient_confirmation'].includes(job.proof_preference)} data-track="ui.4c1e141977.8">{t('delivery.detail.markDelivered')}</button>
          </fieldset></form>}
        </section>
        <section className="delivery-panel"><h2>{t('delivery.detail.timeline')}</h2><ol className="delivery-timeline">{activity.map((event) => <li key={event.id}><span className="delivery-timeline__dot" /><div><strong>{label('events', event.event_type)}</strong><time dateTime={event.created_at}>{date(event.created_at)}</time></div></li>)}</ol>{!activity.length && <p>{t('delivery.ui.noActivity')}</p>}</section>
      </div>
      {isAssigned && <DriverTrackingControls job={job} userId={user?.id} />}
      {/* Group 9 Slice G (items 496/497): the offline task checklist
        with its queued-action outbox, and the explicit connection
        recovery flow, for the assigned driver on an active job. */}
      {isAssigned && active && <DriverConnectionRecovery job={job} executors={outboxExecutors} onResync={load} />}
      {isAssigned && active && <DriverOfflineChecklist job={job} stops={stops} itemPhotos={itemPhotos} executors={outboxExecutors} onChanged={load} />}
      {isAssigned && (
        <section className="delivery-panel">
          <Link to="/delivery/payouts">{t('delivery.driverPayoutHistory.viewHistory')}</Link>
          {' · '}
          <Link to="/delivery/weekly-report">{t('delivery.weeklyReport.link')}</Link>
          {' · '}
          <Link to="/delivery/shifts">{t('delivery.shift.link')}</Link>
          <p><button type="button" className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => act(async () => { await downloadDeliveryReceipt(id, job.reference); }, 'delivery.detail.receiptDownloaded', 'delivery.errors.detail')} data-track="ui.4c1e141977.32">{t('delivery.detail.receiptDownload')}</button></p>
        </section>
      )}
      {/* Group 9 Slice F (item 488): the per-shipment exception
        summary — every issue, delay, failed attempt, and return for
        this shipment in one timeline, read from the existing stores. */}
      {participant && exceptions && (
        <section className="delivery-panel"><h2>{t('delivery.detail.exceptionsTitle')}</h2>
          <p>{t('delivery.detail.exceptionsOpenCount', { count: exceptions.openCount || 0 })}</p>
          {/* Group 9 partials Wave 2 Batch O (470/475, G9-A7, D-547):
            once ops has acked the exception (no open issues left) a
            failed job the driver still holds can be resumed by the
            driver. Ops still resolves; this button only appears after
            the ack, and the server refuses it while anything is open. */}
          {isAssigned && exceptions.resumeAvailable && <p><button type="button" className="delivery-button delivery-button--primary" disabled={busy} onClick={() => act(() => resumeDeliveryJob(id), 'delivery.detail.resumed', 'delivery.errors.resume')} data-track="ui.4c1e141977.38">{t('delivery.detail.resumeDelivery')}</button></p>}
          {!exceptions.events?.length && <p>{t('delivery.detail.exceptionsEmpty')}</p>}
          <ol className="delivery-timeline">{(exceptions.events || []).map((event) => <li key={event.id}><span className="delivery-timeline__dot" /><div>
            <strong>{t(`delivery.detail.exceptionKinds.${event.kind}`)}{event.code ? ` · ${label('ui.issueCodes', event.code)}` : ''}</strong>
            {event.at && <time dateTime={event.at}>{date(event.at)}</time>}
            {event.description && <p>{event.description}</p>}
            {event.reason && <p>{event.reason}</p>}
            {event.status && <p>{label('ui.requestStates', event.status)}{event.resolution ? ` · ${event.resolution}` : ''}</p>}
            {event.kind === 'redelivery' && event.deliveryWindowStart && <p>{date(event.deliveryWindowStart)} – {date(event.deliveryWindowEnd)}</p>}
            {/* Group 9 partials Wave 2 Batch O (470/475, G9-A7,
              D-547): the exception escalation timer — how long the
              driver has waited, and when ops aims to answer. A passed
              target never auto-resolves anything; it only says so. */}
            {event.kind === 'issue' && event.status === 'open' && event.responseTargetMinutes != null && (
              <p role="status">
                {event.responseOverdue
                  ? t('delivery.detail.exceptionResponseOverdue', { minutes: event.minutesWaiting, target: event.responseTargetMinutes })
                  : t('delivery.detail.exceptionResponseEta', { minutes: event.minutesWaiting, target: event.responseTargetMinutes, when: date(event.responseDueAt) })}
              </p>
            )}
          </div></li>)}</ol>
        </section>
      )}
      {/* Group 9 Slice F (item 489): the authorized document list —
        verified proofs of delivery and item photos, each downloading
        through its existing signed URL. A proof with no stored file
        (PIN or recipient confirmation) is named, not linked. */}
      {participant && (
        <section className="delivery-panel"><h2>{t('delivery.detail.documentsTitle')}</h2>
          {!documents.length && <p>{t('delivery.detail.documentsEmpty')}</p>}
          <div className="delivery-extra-list">{documents.map((document) => <div key={`${document.kind}-${document.id}`}>
            <span>{document.kind === 'proof' ? t('delivery.detail.documentProof', { type: label('proofTypes', document.proofType) }) : t('delivery.detail.documentItemPhoto')}</span>
            <small>{date(document.createdAt)}{document.verificationStatus ? ` · ${label('ui.proofStates', document.verificationStatus)}` : ''}</small>
            {document.url
              ? <a href={document.url} target="_blank" rel="noreferrer" data-track="ui.4c1e141977.33">{t('delivery.detail.documentDownload')}</a>
              : <small>{t('delivery.detail.documentNoDownload')}</small>}
          </div>)}</div>
        </section>
      )}
      <section className="delivery-panel"><h2>{t('delivery.ui.extras')}</h2>
        <div className="delivery-extra-list">{extras.map((item) => <div key={item.id}>
          <span>{label('extraCategories', item.category)}<p>{item.notes}</p></span><strong>{money(item.amount_cents, item.currency)}</strong><small>{paymentLabel(item)}</small>
          {isCustomer && item.status === 'pending' && ['approved', 'rejected'].map((decision) => <button key={decision} className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => act(() => reviewDeliveryExtra(item.id, decision), 'delivery.ui.saved', 'delivery.errors.extra')} data-track="ui.4c1e141977.9">{t(decision === 'approved' ? 'delivery.detail.approve' : 'delivery.detail.reject')}</button>)}
          {isCustomer && item.status === 'approved' && ['requires_action', 'failed', 'cancelled'].includes(item.payment_status) && <button className="delivery-button delivery-button--primary" disabled={busy} onClick={() => checkout(item.id)} data-track="ui.4c1e141977.10">{t('delivery.detail.payExtra')}</button>}
          {isCustomer && item.status === 'approved' && !['paid', 'captured', 'not_required'].includes(item.payment_status) && <button className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => act(() => syncDeliveryExtraPayment(item.id), 'delivery.ui.paymentChecked', 'delivery.errors.payment')} data-track="ui.4c1e141977.11">{t('delivery.ui.checkPayment')}</button>}
        </div>)}</div>
        {isAssigned && active && <form onSubmit={(event) => { event.preventDefault(); act(async () => { await requestDeliveryExtra(id, { category: extra.category, amountCents: Math.round(Number(extra.amount) * 100), notes: extra.notes }); setExtra({ category: 'waiting', amount: '', notes: '' }); }, 'delivery.ui.saved', 'delivery.errors.extra'); }} data-track="ui.4c1e141977.12"><fieldset className="delivery-form-fields" disabled={busy}>
          <label className="delivery-field">{t('delivery.ui.extraCategory')}<select className="delivery-input" value={extra.category} onChange={(event) => setExtra({ ...extra, category: event.target.value })}>{EXTRA_CATEGORIES.map((category) => <option key={category} value={category}>{label('extraCategories', category)}</option>)}</select></label>
          <label className="delivery-field">{t('delivery.ui.amount')}<input className="delivery-input" type="number" min="0.01" step="0.01" required value={extra.amount} onChange={(event) => setExtra({ ...extra, amount: event.target.value })} /></label>
          <label className="delivery-field">{t('delivery.customer.notes')}<textarea className="delivery-input" required maxLength={2000} value={extra.notes} onChange={(event) => setExtra({ ...extra, notes: event.target.value })} /></label>
          <button className="delivery-button delivery-button--secondary" data-track="ui.4c1e141977.13">{t('delivery.ui.requestExtra')}</button>
        </fieldset></form>}
        {/* Group 9 partials Wave 2 Batch O (469, G9-A10, D-545): the
          free waiting notice next to the chargeable waiting extra. No
          amount, no approval, no charge — it only tells the shipper
          the driver is waiting. Limited to one notice per job every
          15 minutes server-side. */}
        {isAssigned && active && <form onSubmit={(event) => { event.preventDefault(); act(async () => { await sendDeliveryWaitingNotice(id, { note: waitingNote }); setWaitingNote(''); }, 'delivery.detail.waitingNoticeSent', 'delivery.errors.waitingNotice'); }} data-track="ui.4c1e141977.37"><fieldset className="delivery-form-fields" disabled={busy}>
          <h3>{t('delivery.detail.waitingNoticeTitle')}</h3><p>{t('delivery.detail.waitingNoticeHint')}</p>
          <label className="delivery-field">{t('delivery.customer.notes')}<input className="delivery-input" value={waitingNote} onChange={(event) => setWaitingNote(event.target.value)} maxLength={500} placeholder={t('delivery.detail.waitingNoticePlaceholder')} /></label>
          <button className="delivery-button delivery-button--secondary" data-track="ui.4c1e141977.40">{t('delivery.detail.waitingNoticeSend')}</button>
        </fieldset></form>}
      </section>
      {isCustomer && <section className="delivery-panel"><h2>{t('delivery.detail.payments')}</h2>
        {!payments.length && <p>{t('delivery.ui.noPayments')}</p>}
        {/* Group 9 Slice F (item 490): the OxSteed delivery receipt,
          generated from the job record. The Stripe receipt link on
          each payment below is untouched; this is in addition. */}
        {payments.length > 0 && <p><button type="button" className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => act(async () => { await downloadDeliveryReceipt(id, job.reference); }, 'delivery.detail.receiptDownloaded', 'delivery.errors.detail')} data-track="ui.4c1e141977.31">{t('delivery.detail.receiptDownload')}</button></p>}
        {!['cancelled', 'returned'].includes(job.status) && !['paid', 'captured', 'refunded'].includes(basePayment?.status) && <button className="delivery-button delivery-button--primary" disabled={busy} onClick={() => checkout()} data-track="ui.4c1e141977.14">{t('delivery.ui.payDelivery')}</button>}
        <div className="delivery-extra-list">{payments.map((payment) => <div key={payment.id}><span>{t(payment.delivery_extra_id == null ? 'delivery.ui.basePayment' : 'delivery.ui.extraPayment')}</span><strong>{money(payment.amount_cents, payment.currency)}</strong><span>{label('ui.paymentStates', payment.status)}</span>
          {Number(payment.refunded_amount_cents) > 0 && <span>{t('delivery.ui.refundedAmount', { amount: money(payment.refunded_amount_cents, payment.currency) })}</span>}
          {payment.receipt_url?.startsWith('https://') && <a href={payment.receipt_url} target="_blank" rel="noreferrer" data-track="ui.4c1e141977.15">{t('delivery.detail.receipt')}</a>}
          {!['paid', 'captured', 'refunded', 'cancelled'].includes(payment.status) && <button className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => act(() => syncDeliveryPayment(payment.id), 'delivery.ui.paymentChecked', 'delivery.errors.payment')} data-track="ui.4c1e141977.16">{t('delivery.ui.checkPayment')}</button>}
        </div>)}</div>
      </section>}
      {active && participant && <section className="delivery-panel"><h2>{t('delivery.detail.recoveryTitle')}</h2><p>{t('delivery.detail.recoveryHint')}</p>
        <form onSubmit={reschedule} data-track="ui.4c1e141977.17"><fieldset className="delivery-form-fields" disabled={busy}>
          <label className="delivery-field">{t('delivery.ui.reason')}<textarea className="delivery-input" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required /></label>
          <label className="delivery-field">{t('delivery.ui.windowType')}<select className="delivery-input" value={windowType} onChange={(event) => setWindowType(event.target.value)}><option value="deliveryWindow">{t('delivery.customer.dropoff')}</option><option value="pickupWindow">{t('delivery.customer.pickup')}</option></select></label>
          <p>{t('delivery.ui.localTime', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
          <div className="delivery-stop-grid">
            <label className="delivery-field">{t('delivery.ui.windowStart')}<input className="delivery-input" type="datetime-local" value={windowStart} onChange={(event) => setWindowStart(event.target.value)} required /></label>
            <label className="delivery-field">{t('delivery.ui.windowEnd')}<input className="delivery-input" type="datetime-local" min={windowStart || undefined} value={windowEnd} onChange={(event) => setWindowEnd(event.target.value)} required /></label>
          </div>
          <button className="delivery-button delivery-button--secondary" data-track="ui.4c1e141977.18">{t('delivery.detail.requestReschedule')}</button>
          {/* Group 9 partials Wave 2 Batch O (475, G9-A11, D-548): the
            redelivery-attempt request — a new delivery window for a
            failed drop-off, approved by the shipper or ops. Its own
            path: the general reschedule above still refuses a job
            after pickup. */}
          {canRedelivery && <div className="delivery-stop-grid">
            <label className="delivery-field">{t('delivery.detail.redeliveryWindowStart')}<input className="delivery-input" type="datetime-local" value={redeliveryStart} onChange={(event) => setRedeliveryStart(event.target.value)} required /></label>
            <label className="delivery-field">{t('delivery.detail.redeliveryWindowEnd')}<input className="delivery-input" type="datetime-local" min={redeliveryStart || undefined} value={redeliveryEnd} onChange={(event) => setRedeliveryEnd(event.target.value)} required /></label>
          </div>}
          {canRedelivery && <label className="delivery-field">{t('delivery.detail.redeliveryReason')}<input className="delivery-input" value={redeliveryReason} onChange={(event) => setRedeliveryReason(event.target.value)} maxLength={1000} /></label>}
          {canRedelivery && <button type="button" className="delivery-button delivery-button--secondary" disabled={!redeliveryStart || !redeliveryEnd} onClick={() => { const start = new Date(redeliveryStart), end = new Date(redeliveryEnd); if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start <= new Date() || end <= start) { setError(t('delivery.ui.windowInvalid')); return; } act(async () => { await requestDeliveryRedelivery(id, { deliveryWindowStart: start.toISOString(), deliveryWindowEnd: end.toISOString(), reason: redeliveryReason }); setRedeliveryStart(''); setRedeliveryEnd(''); setRedeliveryReason(''); }, 'delivery.detail.redeliverySent', 'delivery.errors.redelivery'); }} data-track="ui.4c1e141977.39">{t('delivery.detail.requestRedelivery')}</button>}
          {/* Group 9 Slice D (item 475): when the return is a failed
            drop-off because the recipient was unavailable, the reason
            travels with the return request so the structured
            recipient_unavailable issue is recorded with it. */}
          {canReturn && <label className="delivery-field">{t('delivery.detail.unavailableReason')}<select className="delivery-input" value={returnUnavailableReason} onChange={(event) => setReturnUnavailableReason(event.target.value)}><option value="">{t('delivery.ui.unknown')}</option>{UNAVAILABLE_REASONS.map((reasonOption) => <option key={reasonOption} value={reasonOption}>{t(`delivery.ui.unavailableReasons.${reasonOption}`)}</option>)}</select></label>}
          {canReturn && <button type="button" className="delivery-button delivery-button--secondary" disabled={!reason.trim() || returns.some((item) => ['requested', 'approved', 'in_transit'].includes(item.status))} onClick={() => act(() => requestDeliveryReturn(id, { reason, ...(returnUnavailableReason ? { unavailableReason: returnUnavailableReason } : {}) }), 'delivery.detail.returnSent', 'delivery.errors.return')} data-track="ui.4c1e141977.19">{t('delivery.detail.requestReturn')}</button>}
          {canCancel && <button type="button" className="delivery-button delivery-button--secondary" onClick={() => setCancelOpen(!cancelOpen)} data-track="ui.4c1e141977.20">{t('delivery.ui.cancelDelivery')}</button>}
          {cancelOpen && canCancel && <div role="group" aria-label={t('delivery.ui.cancelDelivery')}><p>{t('delivery.ui.cancelHint')}</p><button type="button" className="delivery-button delivery-button--danger" disabled={!reason.trim()} onClick={() => act(async () => { await updateDeliveryStatus(id, 'cancelled', { reason }); setCancelOpen(false); })} data-track="ui.4c1e141977.21">{t('delivery.ui.confirmCancel')}</button></div>}
        </fieldset></form>
      </section>}
      {(rescheduleRequests.length > 0 || returns.length > 0 || redeliveryRequests.length > 0) && <section className="delivery-panel"><h2>{t('delivery.ui.requests')}</h2>{rescheduleRequests.map((item) => <p key={item.id}>{t('delivery.detail.requestReschedule')} · {label('ui.requestStates', item.status)} · {date(item.delivery_window_start || item.pickup_window_start)} · {item.reason}</p>)}{returns.map((item) => <p key={item.id}>{t('delivery.detail.requestReturn')} · {label('ui.requestStates', item.status)} · {item.reason}</p>)}{redeliveryRequests.map((item) => <p key={item.id}>{t('delivery.detail.requestRedelivery')} · {label('ui.requestStates', item.status)} · {date(item.delivery_window_start)} – {date(item.delivery_window_end)}{item.reason ? ` · ${item.reason}` : ''}
        {isCustomer && item.status === 'pending' && <><button key="approved" className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => act(() => reviewDeliveryRedelivery(id, item.id, 'approved'), 'delivery.ui.saved', 'delivery.errors.redelivery')} data-track="ui.4c1e141977.41">{t('delivery.detail.approve')}</button><button key="rejected" className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => act(() => reviewDeliveryRedelivery(id, item.id, 'rejected'), 'delivery.ui.saved', 'delivery.errors.redelivery')} data-track="ui.4c1e141977.42">{t('delivery.detail.reject')}</button></>}
      </p>)}</section>}
      <section className="delivery-panel"><h2>{t('delivery.detail.supportTitle')}</h2><p>{t('delivery.detail.supportHint')}</p>
        {issues.map((item) => <p key={item.id}>{label('ui.issueCodes', item.code)} · {item.description} · {label('ui.requestStates', item.status)} {item.resolution}
          {/* Group 9 Slice D (items 470/475): the structured metadata,
            shown distinctly from the free-text description. */}
          {item.metadata?.received && <> · {t('delivery.detail.issueReceived', { value: item.metadata.received })} · {t('delivery.detail.issueExpected', { value: item.metadata.expected })}</>}
          {item.metadata?.unavailableReason && <> · {t(`delivery.ui.unavailableReasons.${item.metadata.unavailableReason}`)}</>}
          {/* Group 9 Slice E (item 476): the closed-site structure, and
            the failed drop-off flag — an open closed-site report is a
            failed drop-off candidate for dispatch to review. */}
          {item.metadata?.closedWhat && <> · {t(`delivery.ui.closedSiteWhats.${item.metadata.closedWhat}`)}{item.metadata.noticeSeen ? ` · ${t('delivery.detail.closedSiteNotice')}` : ''}{item.metadata.contactAttempted ? ` · ${t('delivery.detail.closedSiteContact')}` : ''}</>}
          {item.code === 'closed_site' && item.status === 'open' && <> · {t('delivery.detail.closedSiteFailedDropoff')}</>}
        </p>)}
        {participant && <form onSubmit={(event) => { event.preventDefault(); act(async () => { await reportDeliveryIssue(id, { code: issueCode, description: issue, ...(issueCode === 'wrong_item' ? { received: wrongItemReceived, expected: wrongItemExpected } : {}), ...(issueCode === 'recipient_unavailable' ? { unavailableReason } : {}), ...(issueCode === 'closed_site' ? { closedWhat, noticeSeen, contactAttempted } : {}) }); setIssue(''); setWrongItemReceived(''); setWrongItemExpected(''); setNoticeSeen(false); setContactAttempted(false); }, 'delivery.ui.saved', 'delivery.errors.issue'); }} data-track="ui.4c1e141977.22"><fieldset className="delivery-form-fields" disabled={busy}>
          <label className="delivery-field">{t('delivery.ui.issueType')}<select className="delivery-input" value={issueCode} onChange={(event) => setIssueCode(event.target.value)}>{ISSUE_CODES.map((code) => <option key={code} value={code}>{label('ui.issueCodes', code)}</option>)}</select></label>
          {issueCode === 'wrong_item' && <>
            <label className="delivery-field">{t('delivery.detail.wrongItemReceived')}<input className="delivery-input" value={wrongItemReceived} onChange={(event) => setWrongItemReceived(event.target.value)} maxLength={500} required /></label>
            <label className="delivery-field">{t('delivery.detail.wrongItemExpected')}<input className="delivery-input" value={wrongItemExpected} onChange={(event) => setWrongItemExpected(event.target.value)} maxLength={500} required /></label>
          </>}
          {issueCode === 'recipient_unavailable' && <label className="delivery-field">{t('delivery.detail.unavailableReason')}<select className="delivery-input" value={unavailableReason} onChange={(event) => setUnavailableReason(event.target.value)}>{UNAVAILABLE_REASONS.map((reasonOption) => <option key={reasonOption} value={reasonOption}>{t(`delivery.ui.unavailableReasons.${reasonOption}`)}</option>)}</select></label>}
          {issueCode === 'closed_site' && <>
            <label className="delivery-field">{t('delivery.detail.closedWhat')}<select className="delivery-input" value={closedWhat} onChange={(event) => setClosedWhat(event.target.value)}>{CLOSED_SITE_WHATS.map((what) => <option key={what} value={what}>{t(`delivery.ui.closedSiteWhats.${what}`)}</option>)}</select></label>
            <div className="delivery-checkbox-row">
              <label><input type="checkbox" checked={noticeSeen} onChange={(event) => setNoticeSeen(event.target.checked)} data-track="ui.4c1e141977.24" /> {t('delivery.detail.closedSiteNoticeSeen')}</label>
              <label><input type="checkbox" checked={contactAttempted} onChange={(event) => setContactAttempted(event.target.checked)} data-track="ui.4c1e141977.25" /> {t('delivery.detail.closedSiteContactAttempted')}</label>
            </div>
          </>}
          <label className="delivery-field">{t('delivery.detail.issuePlaceholder')}<textarea className="delivery-input" value={issue} onChange={(event) => setIssue(event.target.value)} maxLength={2000} required /></label>
          <button className="delivery-button delivery-button--secondary" data-track="ui.4c1e141977.23">{t('delivery.detail.report')}</button>
        </fieldset></form>}
      </section>
      {/* Group 9 Slice F (item 494): disputes on a completed
        assignment. Distinct from a generic issue: the driver files
        about the payout amount, the assignment facts, or a rating,
        and follows the dispute status here. Resolving a dispute never
        moves money by itself. */}
      {participant && (disputes.length > 0 || (isAssigned && ['delivered', 'returned'].includes(job.status))) && (
        <section className="delivery-panel"><h2>{t('delivery.detail.disputeTitle')}</h2><p>{t('delivery.detail.disputeSubtitle')}</p>
          {disputes.map((dispute) => <p key={dispute.id}>{t(`delivery.detail.disputeSubjects.${dispute.subject}`)} · {t(`delivery.detail.disputeStatuses.${dispute.status}`)} · {dispute.description}{dispute.resolution ? ` · ${dispute.resolution}` : ''}</p>)}
          {!disputes.length && <p>{t('delivery.detail.disputeEmpty')}</p>}
          {isAssigned && ['delivered', 'returned'].includes(job.status) && !disputeOpen && <button type="button" className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => setDisputeOpen(true)} data-track="ui.4c1e141977.34">{t('delivery.detail.disputeSubmit')}</button>}
          {isAssigned && ['delivered', 'returned'].includes(job.status) && disputeOpen && <form onSubmit={(event) => { event.preventDefault(); act(async () => { await createDeliveryDispute(id, { subject: disputeSubject, description: disputeDescription }); setDisputeDescription(''); setDisputeOpen(false); }, 'delivery.detail.disputeSubmitted', 'delivery.errors.issue'); }} data-track="ui.4c1e141977.35"><fieldset className="delivery-form-fields" disabled={busy}>
            <label className="delivery-field">{t('delivery.detail.disputeSubject')}<select className="delivery-input" value={disputeSubject} onChange={(event) => setDisputeSubject(event.target.value)}>{DISPUTE_SUBJECTS.map((subject) => <option key={subject} value={subject}>{t(`delivery.detail.disputeSubjects.${subject}`)}</option>)}</select></label>
            <label className="delivery-field">{t('delivery.detail.disputeDescription')}<textarea className="delivery-input" value={disputeDescription} onChange={(event) => setDisputeDescription(event.target.value)} maxLength={2000} required /></label>
            <button className="delivery-button delivery-button--secondary" data-track="ui.4c1e141977.36">{t('delivery.detail.disputeSubmit')}</button>
          </fieldset></form>}
        </section>
      )}
    </div>
  </PageShell>;
}
