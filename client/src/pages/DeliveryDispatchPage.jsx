import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { useAuth } from '../context/AuthContext';
import { canAccessOperationsWorkspace } from '../utils/logisticsWorkspaces';
import {
  assignInternalDelivery, listDeliveryDrivers, listDeliveryVehicles, listInternalDeliveryQueue,
  releaseDeliveryToMarketplace, getInternalDelivery, createDeliveryVehicle, saveDeliveryDriver,
  reviewDeliveryReschedule, reviewDeliveryReturn, resolveDeliveryIssue,
  refundDeliveryPayment, uploadDeliveryProof, deliveryDate, deliveryUnit, deliveryError, deliveryMoney,
} from '../api/delivery';
import '../styles/DeliveryPage.css';

const HANDLING = ['stairs', 'loadingHelp', 'dolly', 'liftgate', 'parkingRequired', 'temperatureControl'];
const emptyResource = () => ({
  userId: '', label: '', vehicleType: 'van', maxPayloadLbs: '', cargoLengthIn: '', cargoWidthIn: '',
  cargoHeightIn: '', maxPieces: '1', fragileSupported: false, perishableSupported: false,
  insuranceAcknowledged: false, insuranceExpiresAt: '', availableFrom: '', availableUntil: '',
  states: '', equipment: {},
});
const localInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function ResourceForm({ kind, drivers, busy, run, t }) {
  const [form, setForm] = useState(emptyResource);
  const driver = kind === 'driver';
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const edit = (id) => {
    const item = drivers.find((entry) => String(entry.user_id) === id);
    if (!item) { setForm(emptyResource()); return; }
    setForm({
      userId: item.user_id, label: '', vehicleType: item.vehicle_type || 'van',
      maxPayloadLbs: item.max_payload_lbs || '', cargoLengthIn: item.cargo_length_in || '',
      cargoWidthIn: item.cargo_width_in || '', cargoHeightIn: item.cargo_height_in || '',
      maxPieces: item.max_pieces || 1, fragileSupported: item.fragile_supported === true,
      perishableSupported: item.perishable_supported === true, insuranceAcknowledged: item.insurance_acknowledged === true,
      insuranceExpiresAt: localInput(item.insurance_expires_at), availableFrom: localInput(item.available_from),
      availableUntil: localInput(item.available_until), states: (item.service_area?.states || []).join(', '), equipment: item.equipment || {},
    });
  };
  const submit = (event) => {
    event.preventDefault();
    const payload = {
      ...(driver ? { userId: form.userId } : { label: form.label }), vehicleType: form.vehicleType,
      maxPayloadLbs: Number(form.maxPayloadLbs), cargoLengthIn: Number(form.cargoLengthIn),
      cargoWidthIn: Number(form.cargoWidthIn), cargoHeightIn: Number(form.cargoHeightIn),
      maxPieces: Number(form.maxPieces), fragileSupported: form.fragileSupported,
      perishableSupported: form.perishableSupported, insuranceAcknowledged: form.insuranceAcknowledged,
      insuranceExpiresAt: form.insuranceExpiresAt ? new Date(form.insuranceExpiresAt).toISOString() : null,
      availableFrom: form.availableFrom ? new Date(form.availableFrom).toISOString() : null,
      availableUntil: form.availableUntil ? new Date(form.availableUntil).toISOString() : null,
      serviceArea: form.states.trim() ? { states: form.states.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean) } : {},
      equipment: form.equipment,
    };
    run(async () => {
      await (driver ? saveDeliveryDriver(payload) : createDeliveryVehicle(payload));
      setForm(emptyResource());
    });
  };
  return <form onSubmit={submit}><fieldset className="delivery-form-fields" disabled={busy}>
    <h3>{t(driver ? 'delivery.ui.saveDriver' : 'delivery.ui.addVehicle')}</h3>
    {driver && <label className="delivery-field">{t('delivery.ui.editDriver')}<select className="delivery-input" onChange={(event) => edit(event.target.value)} value={drivers.some((item) => String(item.user_id) === String(form.userId)) ? form.userId : ''}>
      <option value="">{t('delivery.ui.newDriver')}</option>{drivers.map((item) => <option key={item.user_id} value={item.user_id}>{[item.first_name, item.last_name].filter(Boolean).join(' ') || item.email || item.user_id}</option>)}
    </select></label>}
    <label className="delivery-field">{t(driver ? 'delivery.ui.userId' : 'delivery.ui.vehicleLabel')}<input className="delivery-input" value={driver ? form.userId : form.label} onChange={(event) => set(driver ? 'userId' : 'label', event.target.value)} required maxLength={120} /></label>
    <label className="delivery-field">{t('delivery.ui.vehicleType')}<select className="delivery-input" value={form.vehicleType} onChange={(event) => set('vehicleType', event.target.value)}>{['car', 'van', 'pickup', 'box_truck', 'cargo_bike'].map((type) => <option key={type} value={type}>{t(`delivery.ui.vehicleTypes.${type}`)}</option>)}</select></label>
    <div className="delivery-options-grid">{['maxPayloadLbs', 'cargoLengthIn', 'cargoWidthIn', 'cargoHeightIn', 'maxPieces'].map((key) => <label className="delivery-field" key={key}>{t(`delivery.ui.${key}`)}<input className="delivery-input" type="number" required min={key === 'maxPieces' ? '1' : '0.1'} step={key === 'maxPieces' ? '1' : '0.1'} value={form[key]} onChange={(event) => set(key, event.target.value)} /></label>)}</div>
    <label className="delivery-field">{t('delivery.ui.serviceStates')}<input className="delivery-input" value={form.states} onChange={(event) => set('states', event.target.value)} placeholder="NY, NJ" /></label>
    <div className="delivery-stop-grid">{['insuranceExpiresAt', 'availableFrom', 'availableUntil'].map((key) => <label className="delivery-field" key={key}>{t(`delivery.ui.${key}`)}<input className="delivery-input" type="datetime-local" value={form[key]} min={key === 'availableUntil' ? form.availableFrom || undefined : undefined} onChange={(event) => set(key, event.target.value)} /></label>)}</div>
    <div className="delivery-checkbox-row">{['fragileSupported', 'perishableSupported', 'insuranceAcknowledged'].map((key) => <label key={key}><input type="checkbox" checked={form[key]} onChange={(event) => set(key, event.target.checked)} /> {t(`delivery.ui.${key}`)}</label>)}</div>
    <fieldset className="delivery-fieldset"><legend>{t('delivery.operations.handling')}</legend><div className="delivery-checkbox-row">{HANDLING.map((key) => <label key={key}><input type="checkbox" checked={form.equipment[key] === true} onChange={(event) => set('equipment', { ...form.equipment, [key]: event.target.checked })} /> {t(`delivery.operations.${key}`)}</label>)}</div></fieldset>
    <button className="delivery-button delivery-button--primary">{t(driver ? 'delivery.ui.saveDriver' : 'delivery.ui.addVehicle')}</button>
  </fieldset></form>;
}

function JobReview({ detail, busy, run, t, language }) {
  const [resolution, setResolution] = useState({});
  const [refund, setRefund] = useState({});
  const label = (group, value) => t(`delivery.${group}.${value}`, { defaultValue: t('delivery.ui.unknown') });
  const date = (value) => deliveryDate(value, language);
  const requests = detail.rescheduleRequests;
  const returns = detail.returns;
  const issues = detail.issues;
  const decisions = (item, allowed, callback) => <div className="delivery-dispatch-actions">{allowed.map((decision) => <button key={decision} className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => run(() => callback(item.id, decision))}>{t(`delivery.ui.decisions.${decision}`)}</button>)}</div>;
  return <section className="delivery-panel delivery-review"><h2>{detail.job.reference} · {t('delivery.ui.review')}</h2>
    <p>{detail.job.origin_address} → {detail.job.destination_address}</p>
    <h3>{t('delivery.ui.requests')}</h3>
    {(!Array.isArray(requests) || !Array.isArray(returns) || !Array.isArray(issues)) && <p role="status">{t('delivery.ui.reviewUnavailable')}</p>}
    {requests?.map((item) => <article key={item.id} className="delivery-review-item"><h4>{t('delivery.detail.requestReschedule')} · {label('ui.requestStates', item.status)}</h4><p>{item.reason}</p>
      {['pickup', 'delivery'].map((kind) => item[`${kind}_window_start`] && <p key={kind}>{t(kind === 'pickup' ? 'delivery.customer.pickup' : 'delivery.customer.dropoff')}: {date(item[`${kind}_window_start`])} – {date(item[`${kind}_window_end`])}</p>)}
      {item.status === 'pending' && decisions(item, ['approved', 'rejected'], reviewDeliveryReschedule)}
    </article>)}
    {returns?.map((item) => <article key={item.id} className="delivery-review-item"><h4>{t('delivery.detail.requestReturn')} · {label('ui.requestStates', item.status)}</h4><p>{item.reason}</p>
      {item.status === 'requested' && decisions(item, ['approved', 'rejected'], reviewDeliveryReturn)}
      {item.status === 'approved' && decisions(item, ['in_transit'], reviewDeliveryReturn)}
      {['approved', 'in_transit'].includes(item.status) && <ReturnProof item={item} job={detail.job} busy={busy} run={run} t={t} />}
    </article>)}
    {issues?.map((item) => <article key={item.id} className="delivery-review-item"><h4>{label('ui.issueCodes', item.code)} · {label('ui.requestStates', item.status)}</h4><p>{item.description}</p><p>{item.resolution}</p>
      {item.status === 'open' && <form onSubmit={(event) => { event.preventDefault(); run(() => resolveDeliveryIssue(item.id, resolution[item.id])); }}>
        <label className="delivery-field">{t('delivery.ui.resolution')}<textarea className="delivery-input" maxLength={2000} required disabled={busy} value={resolution[item.id] || ''} onChange={(event) => setResolution({ ...resolution, [item.id]: event.target.value })} /></label>
        <button className="delivery-button delivery-button--primary" disabled={busy || !resolution[item.id]?.trim()}>{t('delivery.ui.resolve')}</button>
      </form>}
    </article>)}
    {requests?.length === 0 && returns?.length === 0 && issues?.length === 0 && <p>{t('delivery.ui.noReviews')}</p>}
    <h3>{t('delivery.ui.audit')}</h3>
    <ol className="delivery-timeline">{(detail.activity || []).map((event) => <li key={event.id}><div><strong>{label('events', event.event_type)}</strong><time>{date(event.created_at)}</time>{event.actor_user_id && <small>{t('delivery.ui.actor', { id: event.actor_user_id })}</small>}</div></li>)}</ol>
    <h3>{t('delivery.ui.attempts')}</h3>
    {(detail.dispatchAttempts || []).map((attempt) => <p key={attempt.id}>{label('ui.attemptActions', attempt.action)} · {date(attempt.created_at)} {attempt.reason || ''}</p>)}
    {!detail.activity?.length && !detail.dispatchAttempts?.length && <p>{t('delivery.ui.noActivity')}</p>}
    <h3>{t('delivery.detail.payments')}</h3>
    {(detail.payments || []).map((payment) => <article key={payment.id} className="delivery-review-item">
      <p>{deliveryMoney(payment.amount_cents, language, payment.currency)} · {label('ui.paymentStates', payment.status)}</p>
      <p>{t('delivery.ui.refundedAmount', { amount: deliveryMoney(payment.refunded_amount_cents || 0, language, payment.currency) })}</p>
      {['paid', 'partially_refunded'].includes(payment.status) && <form onSubmit={(event) => { event.preventDefault(); run(() => refundDeliveryPayment(payment.id, { targetRefundedAmountCents: Math.round(Number(refund[payment.id]?.amount) * 100), reason: refund[payment.id]?.reason })); }}>
        <p>{t('delivery.ui.refundHint')}</p>
        <label className="delivery-field">{t('delivery.ui.refundTarget')}<input className="delivery-input" disabled={busy} required type="number" min={(Number(payment.refunded_amount_cents || 0) + 1) / 100} max={Number(payment.amount_cents) / 100} step="0.01" value={refund[payment.id]?.amount || ''} onChange={(event) => setRefund({ ...refund, [payment.id]: { ...refund[payment.id], amount: event.target.value } })} /></label>
        <label className="delivery-field">{t('delivery.ui.reason')}<input className="delivery-input" disabled={busy} required maxLength={500} value={refund[payment.id]?.reason || ''} onChange={(event) => setRefund({ ...refund, [payment.id]: { ...refund[payment.id], reason: event.target.value } })} /></label>
        <button className="delivery-button delivery-button--danger" disabled={busy}>{t('delivery.ui.refund')}</button>
      </form>}
    </article>)}
  </section>;
}

function ReturnProof({ item, job, busy, run, t }) {
  const [proof, setProof] = useState({ proofValue: '', recipientName: '', recipientContact: '', confirmed: false });
  const [file, setFile] = useState(null);
  const uploaded = useRef(null);
  const type = job.proof_preference;
  return <form onSubmit={(event) => {
    event.preventDefault();
    run(async () => {
      const details = { proofType: type };
      if (type === 'pin') details.proofValue = proof.proofValue;
      if (type === 'recipient_confirmation') Object.assign(details, { recipientName: proof.recipientName, recipientContact: proof.recipientContact, confirmed: proof.confirmed });
      if (['photo', 'signature'].includes(type)) {
        if (!uploaded.current) uploaded.current = await uploadDeliveryProof(job.id, file, type);
        details.uploadId = uploaded.current.uploadId;
      }
      await reviewDeliveryReturn(item.id, 'completed', details);
    });
  }}><fieldset className="delivery-form-fields" disabled={busy}>
    <p>{t('delivery.ui.returnProofHint')}</p>
    {type === 'pin' && <label className="delivery-field">{t('delivery.detail.pin')}<input className="delivery-input" required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" value={proof.proofValue} onChange={(event) => setProof({ ...proof, proofValue: event.target.value })} /></label>}
    {type === 'recipient_confirmation' && <>
      {['recipientName', 'recipientContact'].map((key) => <label className="delivery-field" key={key}>{t(key === 'recipientName' ? 'delivery.detail.recipientName' : 'delivery.ui.recipientContact')}<input className="delivery-input" required value={proof[key]} onChange={(event) => setProof({ ...proof, [key]: event.target.value })} /></label>)}
      <label><input type="checkbox" required checked={proof.confirmed} onChange={(event) => setProof({ ...proof, confirmed: event.target.checked })} /> {t('delivery.ui.recipientConfirmed')}</label>
    </>}
    {['photo', 'signature'].includes(type) && <label className="delivery-field">{t('delivery.detail.proofFile')}<input type="file" required accept={type === 'signature' ? 'image/jpeg,image/png,image/webp,application/pdf' : 'image/jpeg,image/png,image/webp'} onChange={(event) => { setFile(event.target.files?.[0]); uploaded.current = null; }} /></label>}
    <button className="delivery-button delivery-button--primary" disabled={!['pin', 'recipient_confirmation', 'photo', 'signature'].includes(type)}>{t('delivery.ui.decisions.completed')}</button>
  </fieldset></form>;
}

export default function DeliveryDispatchPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const allowed = canAccessOperationsWorkspace(user);
  const [jobs, setJobs] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [selection, setSelection] = useState({});
  const [detail, setDetail] = useState(null);
  const [lookup, setLookup] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const reviewSequence = useRef(0);

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return; }
    setLoading(true);
    try {
      const [queue, driverList, vehicleList] = await Promise.all([listInternalDeliveryQueue(), listDeliveryDrivers(), listDeliveryVehicles()]);
      setJobs(queue.jobs || []); setDrivers(driverList.drivers || []); setVehicles(vehicleList.vehicles || []); setError('');
    } catch (failure) {
      setError(deliveryError(failure, t, 'delivery.dispatch.loadError'));
      if ([401, 403].includes(failure?.response?.status)) { setJobs([]); setDrivers([]); setVehicles([]); setDetail(null); }
    } finally { setLoading(false); }
  }, [allowed, t]);
  useEffect(() => { load(); }, [load]);

  const openReview = async (id) => {
    const sequence = ++reviewSequence.current;
    setBusy(true); setError(''); setDetail(null);
    try { const response = await getInternalDelivery(id); if (sequence === reviewSequence.current) setDetail(response); }
    catch (failure) { if (sequence === reviewSequence.current) setError(deliveryError(failure, t, 'delivery.errors.detail')); }
    finally { if (sequence === reviewSequence.current) setBusy(false); }
  };

  const run = async (operation) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await operation(); setNotice(t('delivery.ui.saved'));
      if (detail?.job?.id) setDetail(await getInternalDelivery(detail.job.id));
      await load();
    } catch (failure) { setError(deliveryError(failure, t)); }
    finally { lock.current = false; setBusy(false); }
  };
  const choiceFor = (id, key, value) => setSelection((previous) => ({ ...previous, [id]: { ...previous[id], [key]: value } }));
  const shown = jobs.filter((job) => filter === 'all' || (filter === 'exception' ? job.dispatch_state === 'exception' : ['posted', 'assigned'].includes(job.status)));
  const label = (group, value) => t(`delivery.${group}.${value}`, { defaultValue: t('delivery.ui.unknown') });

  if (!allowed) return <PageShell><div className="delivery-page" dir={i18n.dir()}><h1>{t('delivery.ui.permission')}</h1><p>{t('delivery.ui.permissionHint')}</p><Link className="delivery-button delivery-button--primary" to="/logistics/operations/login?next=%2Fdelivery%2Foperations">{t('delivery.ui.operationsLogin')}</Link><Link to="/delivery">{t('delivery.detail.back')}</Link></div></PageShell>;

  return <PageShell><PageMeta title={t('delivery.dispatch.metaTitle')} description={t('delivery.dispatch.subtitle')} />
    <div className="delivery-page delivery-dispatch-page" dir={i18n.dir()}>
      <header className="delivery-hero"><div><Link className="delivery-back-link" to="/delivery">{t('delivery.detail.back')}</Link><h1>{t('delivery.dispatch.title')}</h1><p>{t('delivery.dispatch.subtitle')}</p></div><button className="delivery-button delivery-button--secondary" disabled={loading || busy} onClick={load}>{t('delivery.helper.refresh')}</button></header>
      {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
      {notice && <p className="delivery-alert delivery-alert--success" role="status">{notice}</p>}
      <section className="delivery-panel"><div className="delivery-stop-grid">
        <label className="delivery-field">{t('delivery.ui.queueFilter')}<select className="delivery-input" value={filter} onChange={(event) => setFilter(event.target.value)}>{['all', 'exception', 'dispatch'].map((value) => <option key={value} value={value}>{t(`delivery.ui.filters.${value}`)}</option>)}</select></label>
        <form className="delivery-form" onSubmit={(event) => { event.preventDefault(); openReview(lookup); }}><label className="delivery-field">{t('delivery.ui.lookup')}<input className="delivery-input" value={lookup} onChange={(event) => setLookup(event.target.value)} required pattern="[1-9][0-9]*" /></label><button className="delivery-button delivery-button--secondary" disabled={busy}>{t('delivery.ui.review')}</button></form>
      </div></section>
      {loading && <p role="status">{t('delivery.helper.loading')}</p>}
      {!loading && !error && !shown.length && <p>{t('delivery.dispatch.empty')}</p>}
      <div className="delivery-dispatch-grid">{shown.map((job) => {
        const choice = selection[job.id] || {};
        const dispatchable = ['posted', 'assigned'].includes(job.status) && ['internal_review', 'internal_assignment_attempt', 'internal_assigned', 'exception'].includes(job.dispatch_state) && !job.exception_code;
        return <article className="delivery-panel" key={job.id}>
          <div className="delivery-job-card__topline"><h2>{job.reference}</h2><span className="delivery-status">{label('dispatchStates', job.dispatch_state)}</span></div>
          <p>{job.origin_city} → {job.destination_city}</p><p>{deliveryUnit(job.weight_lbs, 'pound', i18n.language)} · {deliveryUnit(job.distance_miles, 'mile', i18n.language)}</p>
          <p>{deliveryDate(job.pickup_window_start, i18n.language)} – {deliveryDate(job.delivery_window_end, i18n.language)}</p>
          {dispatchable && <fieldset className="delivery-form-fields" disabled={busy || loading}>
            <div className="delivery-stop-grid"><label className="delivery-field">{t('delivery.dispatch.driver')}<select className="delivery-input" value={choice.driverUserId || ''} onChange={(event) => choiceFor(job.id, 'driverUserId', event.target.value)}><option value="">{t('delivery.dispatch.chooseDriver')}</option>{drivers.filter((item) => item.active !== false && item.approved !== false).map((item) => <option key={item.user_id} value={item.user_id}>{[item.first_name, item.last_name].filter(Boolean).join(' ') || item.email || item.user_id}</option>)}</select></label>
              <label className="delivery-field">{t('delivery.dispatch.vehicle')}<select className="delivery-input" value={choice.vehicleId || ''} onChange={(event) => choiceFor(job.id, 'vehicleId', event.target.value)}><option value="">{t('delivery.dispatch.chooseVehicle')}</option>{vehicles.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.label} · {deliveryUnit(item.max_payload_lbs, 'pound', i18n.language)}</option>)}</select></label></div>
            <p>{t('delivery.ui.capacityHint')}</p>
            <button className="delivery-button delivery-button--primary" disabled={!choice.driverUserId || !choice.vehicleId} onClick={() => run(() => assignInternalDelivery(job.id, { driverUserId: choice.driverUserId, vehicleId: choice.vehicleId }))}>{t('delivery.dispatch.assign')}</button>
            {!job.helper_user_id && <form onSubmit={(event) => { event.preventDefault(); run(() => releaseDeliveryToMarketplace(job.id, choice.reason)); }}><label className="delivery-field">{t('delivery.ui.releaseReason')}<input className="delivery-input" required maxLength={500} value={choice.reason || ''} onChange={(event) => choiceFor(job.id, 'reason', event.target.value)} /></label><button className="delivery-button delivery-button--secondary">{t('delivery.dispatch.release')}</button></form>}
          </fieldset>}
          <button className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => openReview(job.id)}>{t('delivery.ui.review')}</button>
        </article>;
      })}</div>
      {detail && <JobReview key={detail.job.id} detail={detail} busy={busy} run={run} t={t} language={i18n.language} />}
      <section className="delivery-panel"><h2>{t('delivery.ui.resources')}</h2><p>{t('delivery.ui.resourceHint')}</p>
        <div className="delivery-detail-grid"><ResourceForm kind="driver" drivers={drivers} busy={busy} run={run} t={t} /><ResourceForm kind="vehicle" drivers={drivers} busy={busy} run={run} t={t} /></div>
        <h3>{t('delivery.ui.vehicles')}</h3><ul>{vehicles.map((item) => <li key={item.id}>{item.label} · {deliveryUnit(item.max_payload_lbs, 'pound', i18n.language)}</li>)}</ul>
      </section>
    </div>
  </PageShell>;
}
