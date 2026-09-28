import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import {
  createDeliveryExtraCheckout, createDeliveryCheckout, getDelivery, reportDeliveryIssue, requestDeliveryExtra,
  requestDeliveryReschedule, requestDeliveryReturn, reviewDeliveryExtra,
  syncDeliveryExtraPayment, syncDeliveryPayment, updateDeliveryStatus, uploadDeliveryProof,
  obtainDeliveryPin, deliveryDate, deliveryMoney, deliveryUnit, deliveryError,
} from '../api/delivery';
import '../styles/DeliveryPage.css';

const TERMINAL = ['delivered', 'cancelled', 'returned'];
const EXTRA_CATEGORIES = ['waiting', 'parking_toll', 'difficult_access', 'loading_help', 'special_handling'];

export default function DeliveryDetailPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { socket } = useSocket();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [issue, setIssue] = useState('');
  const [issueCode, setIssueCode] = useState('delay');
  const [proofValue, setProofValue] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientContact, setRecipientContact] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [proofFile, setProofFile] = useState(null);
  const [pin, setPin] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [windowType, setWindowType] = useState('deliveryWindow');
  const [reason, setReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [extra, setExtra] = useState({ category: 'waiting', amount: '', notes: '' });
  const uploaded = useRef(null);
  const requestSequence = useRef(0);
  const actionLock = useRef(false);
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
    try {
      const response = await getDelivery(id);
      if (sequence !== requestSequence.current) return;
      setData(response); setDenied(false); setError('');
    } catch (failure) {
      if (sequence !== requestSequence.current) return;
      setError(deliveryError(failure, t, 'delivery.errors.detail'));
      if ([401, 403, 404].includes(failure?.response?.status)) {
        setData(null); setDenied([401, 403].includes(failure.response.status));
      }
    } finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [id, t]);

  useEffect(() => {
    setData(null); setPin(''); setProofValue(''); setReason(''); setNotice('');
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
    actionLock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await operation();
      setNotice(t(successKey));
      await load();
    } catch (failure) { setError(deliveryError(failure, t, errorKey)); }
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
    {!loading && <button className="delivery-button delivery-button--secondary" onClick={load}>{t('delivery.ui.retry')}</button>}
    {denied && <p>{t('delivery.ui.permissionHint')}</p>}
    <Link className="delivery-button delivery-button--secondary" to="/delivery">{t('delivery.detail.back')}</Link>
  </div></PageShell>;

  const { activity = [], proofs = [], extras = [], issues = [], payments = [], rescheduleRequests = [], returns = [] } = data;
  const eta = data.eta || job.eta;
  const basePayment = payments.find((payment) => payment.delivery_extra_id == null);
  const nextStatus = job.status === 'assigned' ? 'picked_up' : job.status === 'picked_up' ? 'in_transit' : null;
  const canReturn = participant && ['picked_up', 'in_transit', 'failed'].includes(job.status);
  const canCancel = participant && ['posted', 'assigned'].includes(job.status);
  const paymentLabel = (extraItem) => ['captured', 'paid'].includes(extraItem.payment_status)
    ? t('delivery.detail.paymentStates.paid')
    : extraItem.status === 'approved' ? label('ui.paymentStates', extraItem.payment_status) : label('detail.extraStatus', extraItem.status);

  return <PageShell>
    <PageMeta title={`${job.reference} - ${t('delivery.metaTitle')}`} description={t('delivery.detail.subtitle')} />
    <div className="delivery-page delivery-detail-page" dir={i18n.dir()}>
      <header className="delivery-hero">
        <div><Link className="delivery-back-link" to="/delivery"><ArrowLeft size={15} />{t('delivery.detail.back')}</Link><h1>{job.reference}</h1><p>{t('delivery.detail.subtitle')}</p></div>
        <span className="delivery-hero__badge"><Truck size={24} />{label('helper.status', job.status)}</span>
        <button className="delivery-button delivery-button--secondary" disabled={loading || busy} onClick={load}><RefreshCw size={16} />{t('delivery.helper.refresh')}</button>
      </header>
      {error && <div className="delivery-alert delivery-alert--error" role="alert">{error}<button className="delivery-button delivery-button--secondary" disabled={loading || busy} onClick={load}>{t('delivery.helper.refresh')}</button></div>}
      {notice && <p className="delivery-alert delivery-alert--success" role="status">{notice}</p>}
      <div className="delivery-detail-grid">
        <section className="delivery-panel"><h2>{t('delivery.detail.route')}</h2>
          <dl className="delivery-breakdown">
            {['origin', 'destination'].map((stop) => <div key={stop}><dt>{t(stop === 'origin' ? 'delivery.customer.pickup' : 'delivery.customer.dropoff')}</dt>
              <dd>{[job[`${stop}_address`], job[`${stop}_city`], job[`${stop}_state`]].filter(Boolean).join(', ')}
                <p>{job[`${stop}_contact_name`]} {job[`${stop}_contact_phone`]}</p><p>{job[`${stop}_instructions`]}</p></dd></div>)}
            <div><dt>{t('delivery.customer.total')}</dt><dd>{money(job.customer_total_cents, job.currency)}</dd></div>
            <div><dt>{t('delivery.customer.package')}</dt><dd>{label('packageTypes', job.package_type)}</dd></div>
            <div><dt>{t('delivery.customer.weight')}</dt><dd>{deliveryUnit(job.weight_lbs, 'pound', i18n.language)}</dd></div>
            <div><dt>{t('delivery.operations.pieces')}</dt><dd>{new Intl.NumberFormat(i18n.language === 'ht' ? 'fr-HT' : i18n.language).format(job.pieces || 1)}</dd></div>
            <div><dt>{t('delivery.ui.eta')}</dt><dd>{eta?.available && eta.estimatedArrivalAt ? date(eta.estimatedArrivalAt) : t('delivery.ui.etaUnavailable')}
              {eta?.available && eta.updatedAt && <small>{t('delivery.ui.updated', { date: date(eta.updatedAt) })}</small>}</dd></div>
            {['pickup', 'delivery'].map((kind) => job[`${kind}_window_start`] && <div key={kind}><dt>{t(kind === 'pickup' ? 'delivery.customer.pickup' : 'delivery.customer.dropoff')}</dt><dd>{date(job[`${kind}_window_start`])} – {date(job[`${kind}_window_end`])}</dd></div>)}
          </dl>
          {isAssigned && nextStatus && <button className="delivery-button delivery-button--primary" disabled={busy} onClick={() => act(() => updateDeliveryStatus(id, nextStatus))}>{t('delivery.helper.moveTo', { status: label('helper.status', nextStatus) })}</button>}
          {isCustomer && active && job.proof_preference === 'pin' && <div className="delivery-proof-list"><p>{t('delivery.ui.pinHint')}</p><button className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => act(async () => { const result = await obtainDeliveryPin(id); setPin(result.proofPin || ''); })}>{t('delivery.ui.obtainPin')}</button>{pin && <p role="status"><strong>{t('delivery.detail.pin')}: <bdi>{pin}</bdi></strong></p>}</div>}
          <div className="delivery-proof-list"><h3>{t('delivery.detail.proof')}</h3>{proofs.length ? proofs.map((proof) => <p key={proof.id}>{label('proofTypes', proof.proof_type)} · {label('ui.proofStates', proof.verification_status)}</p>) : <p>{t('delivery.detail.noProof')}</p>}</div>
          {isAssigned && job.status === 'in_transit' && <form onSubmit={submitProof} className="delivery-form"><fieldset className="delivery-form-fields" disabled={busy}>
            <h3>{t('delivery.detail.submitProof')}</h3><p>{t('delivery.detail.proofPreference', { type: label('proofTypes', job.proof_preference) })}</p>
            {job.proof_preference === 'pin' && <label className="delivery-field">{t('delivery.detail.pin')}<input className="delivery-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={proofValue} onChange={(event) => setProofValue(event.target.value)} required /></label>}
            {job.proof_preference === 'recipient_confirmation' && <>
              <label className="delivery-field">{t('delivery.detail.recipientName')}<input className="delivery-input" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} maxLength={160} required /></label>
              <label className="delivery-field">{t('delivery.ui.recipientContact')}<input className="delivery-input" value={recipientContact} onChange={(event) => setRecipientContact(event.target.value)} maxLength={160} required /></label>
              <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required /> {t('delivery.ui.recipientConfirmed')}</label>
            </>}
            {['photo', 'signature'].includes(job.proof_preference) && <label className="delivery-field">{t('delivery.detail.proofFile')}<input type="file" accept={job.proof_preference === 'signature' ? 'image/jpeg,image/png,image/webp,application/pdf' : 'image/jpeg,image/png,image/webp'} required onChange={(event) => { const file = event.target.files?.[0]; uploaded.current = null; if (file && file.size > 10485760) { setProofFile(null); event.target.value = ''; setError(t('delivery.ui.fileTooLarge')); } else setProofFile(file || null); }} /><small>{t('delivery.ui.proofFileHint')}</small></label>}
            <button className="delivery-button delivery-button--primary" disabled={!['pin', 'photo', 'signature', 'recipient_confirmation'].includes(job.proof_preference)}>{t('delivery.detail.markDelivered')}</button>
          </fieldset></form>}
        </section>
        <section className="delivery-panel"><h2>{t('delivery.detail.timeline')}</h2><ol className="delivery-timeline">{activity.map((event) => <li key={event.id}><span className="delivery-timeline__dot" /><div><strong>{label('events', event.event_type)}</strong><time dateTime={event.created_at}>{date(event.created_at)}</time></div></li>)}</ol>{!activity.length && <p>{t('delivery.ui.noActivity')}</p>}</section>
      </div>
      <section className="delivery-panel"><h2>{t('delivery.ui.extras')}</h2>
        <div className="delivery-extra-list">{extras.map((item) => <div key={item.id}>
          <span>{label('extraCategories', item.category)}<p>{item.notes}</p></span><strong>{money(item.amount_cents, item.currency)}</strong><small>{paymentLabel(item)}</small>
          {isCustomer && item.status === 'pending' && ['approved', 'rejected'].map((decision) => <button key={decision} className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => act(() => reviewDeliveryExtra(item.id, decision), 'delivery.ui.saved', 'delivery.errors.extra')}>{t(decision === 'approved' ? 'delivery.detail.approve' : 'delivery.detail.reject')}</button>)}
          {isCustomer && item.status === 'approved' && ['requires_action', 'failed', 'cancelled'].includes(item.payment_status) && <button className="delivery-button delivery-button--primary" disabled={busy} onClick={() => checkout(item.id)}>{t('delivery.detail.payExtra')}</button>}
          {isCustomer && item.status === 'approved' && !['paid', 'captured', 'not_required'].includes(item.payment_status) && <button className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => act(() => syncDeliveryExtraPayment(item.id), 'delivery.ui.paymentChecked', 'delivery.errors.payment')}>{t('delivery.ui.checkPayment')}</button>}
        </div>)}</div>
        {isAssigned && active && <form onSubmit={(event) => { event.preventDefault(); act(async () => { await requestDeliveryExtra(id, { category: extra.category, amountCents: Math.round(Number(extra.amount) * 100), notes: extra.notes }); setExtra({ category: 'waiting', amount: '', notes: '' }); }, 'delivery.ui.saved', 'delivery.errors.extra'); }}><fieldset className="delivery-form-fields" disabled={busy}>
          <label className="delivery-field">{t('delivery.ui.extraCategory')}<select className="delivery-input" value={extra.category} onChange={(event) => setExtra({ ...extra, category: event.target.value })}>{EXTRA_CATEGORIES.map((category) => <option key={category} value={category}>{label('extraCategories', category)}</option>)}</select></label>
          <label className="delivery-field">{t('delivery.ui.amount')}<input className="delivery-input" type="number" min="0.01" step="0.01" required value={extra.amount} onChange={(event) => setExtra({ ...extra, amount: event.target.value })} /></label>
          <label className="delivery-field">{t('delivery.customer.notes')}<textarea className="delivery-input" required maxLength={2000} value={extra.notes} onChange={(event) => setExtra({ ...extra, notes: event.target.value })} /></label>
          <button className="delivery-button delivery-button--secondary">{t('delivery.ui.requestExtra')}</button>
        </fieldset></form>}
      </section>
      {isCustomer && <section className="delivery-panel"><h2>{t('delivery.detail.payments')}</h2>
        {!payments.length && <p>{t('delivery.ui.noPayments')}</p>}
        {!['cancelled', 'returned'].includes(job.status) && !['paid', 'captured', 'refunded'].includes(basePayment?.status) && <button className="delivery-button delivery-button--primary" disabled={busy} onClick={() => checkout()}>{t('delivery.ui.payDelivery')}</button>}
        <div className="delivery-extra-list">{payments.map((payment) => <div key={payment.id}><span>{t(payment.delivery_extra_id == null ? 'delivery.ui.basePayment' : 'delivery.ui.extraPayment')}</span><strong>{money(payment.amount_cents, payment.currency)}</strong><span>{label('ui.paymentStates', payment.status)}</span>
          {Number(payment.refunded_amount_cents) > 0 && <span>{t('delivery.ui.refundedAmount', { amount: money(payment.refunded_amount_cents, payment.currency) })}</span>}
          {payment.receipt_url?.startsWith('https://') && <a href={payment.receipt_url} target="_blank" rel="noreferrer">{t('delivery.detail.receipt')}</a>}
          {!['paid', 'captured', 'refunded', 'cancelled'].includes(payment.status) && <button className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => act(() => syncDeliveryPayment(payment.id), 'delivery.ui.paymentChecked', 'delivery.errors.payment')}>{t('delivery.ui.checkPayment')}</button>}
        </div>)}</div>
      </section>}
      {active && participant && <section className="delivery-panel"><h2>{t('delivery.detail.recoveryTitle')}</h2><p>{t('delivery.detail.recoveryHint')}</p>
        <form onSubmit={reschedule}><fieldset className="delivery-form-fields" disabled={busy}>
          <label className="delivery-field">{t('delivery.ui.reason')}<textarea className="delivery-input" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required /></label>
          <label className="delivery-field">{t('delivery.ui.windowType')}<select className="delivery-input" value={windowType} onChange={(event) => setWindowType(event.target.value)}><option value="deliveryWindow">{t('delivery.customer.dropoff')}</option><option value="pickupWindow">{t('delivery.customer.pickup')}</option></select></label>
          <p>{t('delivery.ui.localTime', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
          <div className="delivery-stop-grid">
            <label className="delivery-field">{t('delivery.ui.windowStart')}<input className="delivery-input" type="datetime-local" value={windowStart} onChange={(event) => setWindowStart(event.target.value)} required /></label>
            <label className="delivery-field">{t('delivery.ui.windowEnd')}<input className="delivery-input" type="datetime-local" min={windowStart || undefined} value={windowEnd} onChange={(event) => setWindowEnd(event.target.value)} required /></label>
          </div>
          <button className="delivery-button delivery-button--secondary">{t('delivery.detail.requestReschedule')}</button>
          {canReturn && <button type="button" className="delivery-button delivery-button--secondary" disabled={!reason.trim() || returns.some((item) => ['requested', 'approved', 'in_transit'].includes(item.status))} onClick={() => act(() => requestDeliveryReturn(id, { reason }), 'delivery.detail.returnSent', 'delivery.errors.return')}>{t('delivery.detail.requestReturn')}</button>}
          {canCancel && <button type="button" className="delivery-button delivery-button--secondary" onClick={() => setCancelOpen(!cancelOpen)}>{t('delivery.ui.cancelDelivery')}</button>}
          {cancelOpen && canCancel && <div role="group" aria-label={t('delivery.ui.cancelDelivery')}><p>{t('delivery.ui.cancelHint')}</p><button type="button" className="delivery-button delivery-button--danger" disabled={!reason.trim()} onClick={() => act(async () => { await updateDeliveryStatus(id, 'cancelled', { reason }); setCancelOpen(false); })}>{t('delivery.ui.confirmCancel')}</button></div>}
        </fieldset></form>
      </section>}
      {(rescheduleRequests.length > 0 || returns.length > 0) && <section className="delivery-panel"><h2>{t('delivery.ui.requests')}</h2>{rescheduleRequests.map((item) => <p key={item.id}>{t('delivery.detail.requestReschedule')} · {label('ui.requestStates', item.status)} · {date(item.delivery_window_start || item.pickup_window_start)} · {item.reason}</p>)}{returns.map((item) => <p key={item.id}>{t('delivery.detail.requestReturn')} · {label('ui.requestStates', item.status)} · {item.reason}</p>)}</section>}
      <section className="delivery-panel"><h2>{t('delivery.detail.supportTitle')}</h2><p>{t('delivery.detail.supportHint')}</p>
        {issues.map((item) => <p key={item.id}>{label('ui.issueCodes', item.code)} · {item.description} · {label('ui.requestStates', item.status)} {item.resolution}</p>)}
        {participant && <form onSubmit={(event) => { event.preventDefault(); act(async () => { await reportDeliveryIssue(id, { code: issueCode, description: issue }); setIssue(''); }, 'delivery.ui.saved', 'delivery.errors.issue'); }}><fieldset className="delivery-form-fields" disabled={busy}>
          <label className="delivery-field">{t('delivery.ui.issueType')}<select className="delivery-input" value={issueCode} onChange={(event) => setIssueCode(event.target.value)}>{['delay', 'damage', 'access_problem', 'missing_shipment', 'customer_report'].map((code) => <option key={code} value={code}>{label('ui.issueCodes', code)}</option>)}</select></label>
          <label className="delivery-field">{t('delivery.detail.issuePlaceholder')}<textarea className="delivery-input" value={issue} onChange={(event) => setIssue(event.target.value)} maxLength={2000} required /></label>
          <button className="delivery-button delivery-button--secondary">{t('delivery.detail.report')}</button>
        </fieldset></form>}
      </section>
    </div>
  </PageShell>;
}
