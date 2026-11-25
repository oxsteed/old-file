import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  DollarSign,
  FileText,
  LifeBuoy,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Route,
  ShieldCheck,
  Truck,
  Upload,
  XCircle,
} from 'lucide-react';
import AddressAutocomplete from '../components/AddressAutocomplete';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { useAuth } from '../context/AuthContext';
import { canAccessOperationsWorkspace } from '../utils/logisticsWorkspaces';
import { selectOpenJobs } from '../utils/deliveryDriverJobs';
import {
  claimDeliveryJob,
  declineDeliveryJob,
  createDelivery,
  listDeliveryJobs,
  quoteDelivery,
  updateDeliveryStatus,
  getDriverProfile,
  registerDriverProfile,
  updateDriverProfile,
  listMyDriverPayouts,
  setDriverAvailability,
  getDriverReadiness,
  listDriverVehicles,
  createDriverVehicle,
  updateDriverVehicle,
  deleteDriverVehicle,
  activateDriverVehicle,
  listDriverDocuments,
  createDriverDocument,
  updateDriverDocument,
  deleteDriverDocument,
  deliveryDate,
  deliveryMoney, deliveryUnit, deliveryError, deliveryClaimReasons,
} from '../api/delivery';
import {
  EstimateCard,
  PACKAGE_OPTIONS,
  RoutePreview,
  emptyPlace,
  pointFromSuggestion,
  stopsHaveUsCoords,
  stopsReadyForPricing,
  takeEstimatePrefill,
} from '../components/delivery/DeliveryEstimate';
// Group 9 Slice B (items 457/458/460): the offer countdown, the driver
// route preview, and the decline (pass) form, shared with the detail page.
import { DeclineForm, OfferCountdown, hasRouteCoords, isOfferExpired } from '../components/delivery/DeliveryOffer';
import '../styles/DeliveryPage.css';

const SERVICE_OPTIONS = ['standard', 'same_day', 'rush'];
const CONTENTS = ['general', 'documents', 'food', 'groceries', 'furniture', 'electronics', 'tools', 'appliances', 'plants', 'parcels'];


function statusLabel(status, t) {
  return t(`delivery.helper.status.${status}`, { defaultValue: String(status || '').replaceAll('_', ' ') });
}

function DeliveryCard({ job, helper, onClaim, onDecline, onStatus, busyId, t }) {
  const { i18n } = useTranslation();
  // Group 9 Slice B (item 457): the card re-renders every 30s so the
  // claim button disappears the moment the offer deadline passes,
  // without waiting for a reload or the hourly sweep.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const offerExpired = isOfferExpired(job, nowMs);
  const isOffer = helper && job.status === 'posted' && job.marketplace_available === true;
  const canClaim = helper && job.status === 'posted' && job.marketplace_available === true && job.is_assigned_operator !== true && !offerExpired;
  // Group 9 partials Wave 2 Batch M (457/460, G9-A14, D-539): an expired
  // offer can still be declined (the server accepts it, D-62); only the
  // claim stays hidden once the deadline passes.
  const canDecline = isOffer;
  const canUpdate = job.is_assigned_operator === true && ['assigned', 'picked_up', 'in_transit'].includes(job.status);
  const nextStatus = job.status === 'assigned' ? 'picked_up'
    : job.status === 'picked_up' ? 'in_transit' : null;
  const isBusy = busyId !== null;
  const [declineOpen, setDeclineOpen] = useState(false);
  // Group 9 partials Wave 2 Batch L (455, G9-A15, D-531): the per-job
  // readiness check. The profile checklist cannot tell the driver whether
  // this specific offer is claimable; this loads it for this job on demand.
  const [readinessOpen, setReadinessOpen] = useState(false);

  return (
    <article className="delivery-job-card">
      <div className="delivery-job-card__topline">
        <div>
          <Link className="delivery-reference" to={`/delivery/jobs/${job.id}`}>{job.reference}</Link>
          <h3>{[job.origin_city, job.origin_state].filter(Boolean).join(', ') || t('delivery.helper.localPickup')}</h3>
        </div>
        <span className={`delivery-status delivery-status--${job.status}`}>
          {statusLabel(job.status, t)}
        </span>
      </div>
      {isOffer && <OfferCountdown job={job} t={t} />}
      {hasRouteCoords(job) && (
        <div className="delivery-job-card__route-preview">
          <RoutePreview job={job} t={t} />
        </div>
      )}
      <div className="delivery-job-card__route">
        <span><MapPin size={15} aria-hidden="true" />{[job.origin_city, job.origin_state].filter(Boolean).join(', ') || '—'}</span>
        <ArrowRight size={16} aria-hidden="true" />
        <span><MapPin size={15} aria-hidden="true" />{[job.destination_city, job.destination_state].filter(Boolean).join(', ') || '—'}</span>
      </div>
      <div className="delivery-job-card__facts">
        <span><Truck size={15} aria-hidden="true" />{deliveryUnit(job.distance_miles, 'mile', i18n.language)}</span>
        <span><Package size={15} aria-hidden="true" />{t(`delivery.packageTypes.${job.package_type}`, { defaultValue: job.package_type })}</span>
        <span><Clock3 size={15} aria-hidden="true" />{t(`delivery.serviceLevels.${job.service_level}`, { defaultValue: job.service_level })}</span>
      </div>
      {job.item_description && <p className="delivery-job-card__item">{job.item_description}</p>}
      {job.my_decline && (
        <p className="delivery-job-card__declined">
          {t('delivery.driver.declined')} · {t(`delivery.driver.declineReasons.${job.my_decline.reason_code}`)}
        </p>
      )}
      <div className="delivery-job-card__footer">
        <div>
          <small>{helper ? t('delivery.helper.payout') : t('delivery.customer.total')}</small>
          <strong>{deliveryMoney(helper ? job.driver_payout_cents : job.customer_total_cents, i18n.language, job.currency)}</strong>
          {helper && job.driver_payout_cents == null && <small>{t('delivery.ui.payoutUnavailable')}</small>}
        </div>
        {canClaim && (
          <button type="button" className="delivery-button delivery-button--primary" onClick={() => onClaim(job.id)} disabled={isBusy} data-track="ui.2f5c44f3da.1">
            {isBusy ? <Loader2 size={16} className="delivery-spin" aria-hidden="true" /> : <Truck size={16} aria-hidden="true" />}
            {t('delivery.helper.claim')}
          </button>
        )}
        {canClaim && (
          <button type="button" className="delivery-button delivery-button--secondary" onClick={() => setReadinessOpen((open) => !open)} disabled={isBusy} data-track="ui.2f5c44f3da.2">
            {readinessOpen ? t('delivery.driver.readinessHide') : t('delivery.driver.readinessCheckJob')}
          </button>
        )}
        {canDecline && !declineOpen && (
          <button type="button" className="delivery-button delivery-button--secondary" onClick={() => setDeclineOpen(true)} disabled={isBusy} data-track="ui.2f5c44f3da.3">
            {job.my_decline ? t('delivery.driver.declineChange') : t('delivery.driver.decline')}
          </button>
        )}
        {canUpdate && nextStatus && (
            <button type="button" className="delivery-button delivery-button--primary" onClick={() => onStatus(job.id, nextStatus)} disabled={isBusy} data-track="ui.2f5c44f3da.4">
            {isBusy ? <Loader2 size={16} className="delivery-spin" aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
            {t('delivery.helper.moveTo', { status: statusLabel(nextStatus, t) })}
          </button>
        )}
        {canUpdate && job.status === 'in_transit' && <Link className="delivery-button delivery-button--primary" to={`/delivery/jobs/${job.id}`}>{t('delivery.detail.submitProof')}</Link>}
      </div>
      {declineOpen && canDecline && (
        <DeclineForm
          job={job}
          t={t}
          busy={isBusy}
          onSubmit={async (payload) => { setDeclineOpen(false); await onDecline(job.id, payload); }}
          onCancel={() => setDeclineOpen(false)}
        />
      )}
      {readinessOpen && canClaim && <DriverReadinessChecklist t={t} jobId={job.id} />}
    </article>
  );
}

const TERMINAL_DELIVERY_STATUSES = ['delivered', 'cancelled', 'returned'];


// "My deliveries" from the mockup: the signed-in customer's own jobs with
// Active / Completed tabs, the empty state, and a route preview per active
// job. Completed means delivered, cancelled, or returned.
function MyDeliveries({ t, refreshKey, onBook }) {
  const { user } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('active');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await listDeliveryJobs();
      setJobs((response.jobs || []).filter((job) => String(job.customer_user_id) === String(user?.id)));
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [t, user?.id]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const move = async (id, status) => {
    setBusyId(String(id));
    setError('');
    try { await updateDeliveryStatus(id, status); await load(); } catch (requestError) { setError(deliveryError(requestError, t, 'delivery.errors.status')); } finally { setBusyId(null); }
  };

  const activeJobs = useMemo(() => jobs.filter((job) => !TERMINAL_DELIVERY_STATUSES.includes(job.status)), [jobs]);
  const completedJobs = useMemo(() => jobs.filter((job) => TERMINAL_DELIVERY_STATUSES.includes(job.status)), [jobs]);
  const shown = tab === 'active' ? activeJobs : completedJobs;

  return (
    <section className="delivery-my" aria-labelledby="delivery-my-title">
      <div className="delivery-my__heading">
        <h2 id="delivery-my-title">{t('delivery.helper.myDeliveries')}</h2>
        <div className="delivery-my__tabs" role="tablist" aria-label={t('delivery.helper.myDeliveries')}>
          <button type="button" role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'is-active' : ''} onClick={() => setTab('active')} data-track="ui.2f5c44f3da.5">
            {t('delivery.myDeliveries.active')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'completed'} className={tab === 'completed' ? 'is-active' : ''} onClick={() => setTab('completed')} data-track="ui.2f5c44f3da.6">
            {t('delivery.myDeliveries.completed')}
          </button>
        </div>
      </div>
      {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
      {loading ? (
        <div className="delivery-loading"><Loader2 className="delivery-spin" size={24} aria-hidden="true" />{t('delivery.helper.loading')}</div>
      ) : shown.length === 0 ? (
        <div className="delivery-my__empty">
          <div className="delivery-my__van" aria-hidden="true"><Truck size={46} /></div>
          <p>{t(tab === 'active' ? 'delivery.myDeliveries.emptyActive' : 'delivery.myDeliveries.emptyCompleted')}</p>
          {tab === 'active' && (
            <button type="button" className="delivery-button delivery-button--outline" onClick={onBook} data-track="ui.2f5c44f3da.7">
              {t('delivery.myDeliveries.bookFirst')}
            </button>
          )}
        </div>
      ) : (
        <div className="delivery-my__jobs">
          {shown.map((job) => (
            <div key={job.id} className="delivery-my__job">
              <DeliveryCard job={job} helper={false} onClaim={() => {}} onStatus={move} busyId={busyId} t={t} />
              {tab === 'active' && <RoutePreview job={job} t={t} />}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ASAP windows: pickup starts about 15 minutes out with a 2-hour pickup
// window, and the drop-off window starts when pickup ends. Must satisfy
// normalizeOperational (both windows required, pickup end <= delivery start)
// and quoteForRequest (future pickup start).
function computeAsapWindows(now = Date.now()) {
  const pickupStart = new Date(now + 15 * 60000);
  const pickupEnd = new Date(pickupStart.getTime() + 2 * 3600000);
  const deliveryStart = pickupEnd;
  const deliveryEnd = new Date(deliveryStart.getTime() + 2 * 3600000);
  return {
    pickupWindow: { start: pickupStart.toISOString(), end: pickupEnd.toISOString() },
    deliveryWindow: { start: deliveryStart.toISOString(), end: deliveryEnd.toISOString() },
  };
}

function CustomerDelivery({ t, initial, onPosted }) {
  const { i18n } = useTranslation();
  const currency = (cents, code) => deliveryMoney(cents, i18n.language, code);
  const [origin, setOrigin] = useState(initial?.origin || emptyPlace);
  const [destination, setDestination] = useState(initial?.destination || emptyPlace);
  const [originText, setOriginText] = useState(initial?.originText || '');
  const [destinationText, setDestinationText] = useState(initial?.destinationText || '');
  const [packageType, setPackageType] = useState(initial?.packageType || 'small');
  const [weightLbs, setWeightLbs] = useState(initial?.weightLbs || '5');
  const [serviceLevel, setServiceLevel] = useState('standard');
  // What the item is. Separate from the driver notes below: the notes feed
  // the pickup/drop-off contact instructions, this names the item itself.
  // It is stored on the job and shown to the assigned driver.
  const [itemDescription, setItemDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [pieces, setPieces] = useState('1');
  const [dimensions, setDimensions] = useState({ lengthIn: '', widthIn: '', heightIn: '' });
  const [contentsCategory, setContentsCategory] = useState('general');
  const [declaredValue, setDeclaredValue] = useState('');
  const [fragile, setFragile] = useState(false);
  const [perishable, setPerishable] = useState(false);
  const [handlingRequirements, setHandlingRequirements] = useState({});
  const [originContact, setOriginContact] = useState({ name: '', phone: '', instructions: '' });
  const [destinationContact, setDestinationContact] = useState({ name: '', phone: '', instructions: '' });
  const [pickupWindow, setPickupWindow] = useState({ start: '', end: '' });
  const [deliveryWindow, setDeliveryWindow] = useState({ start: '', end: '' });
  // ASAP or scheduled: ASAP picks up in about 15 minutes with a 2-hour
  // pickup window, and the drop-off window follows the pickup window. The
  // windows are computed once at quote time and kept in a ref so the booking
  // posts the exact windows it was quoted for (the quote hash covers them).
  const [timing, setTiming] = useState('scheduled');
  const quotedWindowsRef = useRef(null);
  const [proofPreference, setProofPreference] = useState('recipient_confirmation');
  const [quote, setQuote] = useState(null);
  const [posted, setPosted] = useState(null);
  const [proofPin, setProofPin] = useState('');
  const [clientRequestId, setClientRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const payload = useCallback((windowsOverride) => {
    const windows = windowsOverride || {
      pickupWindow: { start: pickupWindow.start ? new Date(pickupWindow.start).toISOString() : undefined, end: pickupWindow.end ? new Date(pickupWindow.end).toISOString() : undefined },
      deliveryWindow: { start: deliveryWindow.start ? new Date(deliveryWindow.start).toISOString() : undefined, end: deliveryWindow.end ? new Date(deliveryWindow.end).toISOString() : undefined },
    };
    return {
    origin,
    destination,
    packageType,
    weightLbs: Number(weightLbs),
    serviceLevel,
    itemDescription: itemDescription || undefined,
    notes,
    pieces: Number(pieces),
    dimensions: Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, value ? Number(value) : undefined])),
    contentsCategory,
    declaredValueCents: declaredValue ? Math.round(Number(declaredValue) * 100) : 0,
    fragile,
    perishable,
    handlingRequirements,
    originContact,
    destinationContact,
    pickupWindow: windows.pickupWindow,
    deliveryWindow: windows.deliveryWindow,
    proofPreference,
    };
  }, [contentsCategory, declaredValue, deliveryWindow, destination, destinationContact, dimensions, fragile, handlingRequirements, itemDescription, notes, origin, originContact, packageType, perishable, pieces, pickupWindow, proofPreference, serviceLevel, weightLbs]);

  useEffect(() => { setQuote(null); setClientRequestId(''); }, [payload]);

  const getQuote = async (event) => {
    event.preventDefault();
    setError('');
    setPosted(null);
    if (!stopsReadyForPricing(origin, destination)) {
      setError(t('delivery.customer.selectAddress'));
      return;
    }
    if (!stopsHaveUsCoords(origin, destination)) {
      setError(t('delivery.ui.usOnly')); return;
    }
    if ([originContact, destinationContact].some((contact) => contact.phone.replace(/\D/g, '').length < 7)) {
      setError(t('delivery.ui.phoneInvalid')); return;
    }
    const windows = timing === 'asap' ? computeAsapWindows() : {
      pickupWindow: { start: pickupWindow.start ? new Date(pickupWindow.start).toISOString() : undefined, end: pickupWindow.end ? new Date(pickupWindow.end).toISOString() : undefined },
      deliveryWindow: { start: deliveryWindow.start ? new Date(deliveryWindow.start).toISOString() : undefined, end: deliveryWindow.end ? new Date(deliveryWindow.end).toISOString() : undefined },
    };
    const times = [windows.pickupWindow.start, windows.pickupWindow.end, windows.deliveryWindow.start, windows.deliveryWindow.end].map((value) => new Date(value).getTime());
    if (times.some((value) => !Number.isFinite(value)) || times[0] <= Date.now() || times[0] >= times[1] || times[1] > times[2] || times[2] >= times[3]) {
      setError(t('delivery.ui.intakeWindows')); return;
    }
    setBusy(true);
    try {
      const response = await quoteDelivery(payload(windows));
      // Keep the exact ASAP windows the quote was priced for: the booking
      // must post them unchanged or the quote hash mismatches.
      if (timing === 'asap') quotedWindowsRef.current = windows;
      setQuote(response.quote);
      setClientRequestId('');
    } catch (requestError) {
      setQuote(null);
      setError(deliveryError(requestError, t, 'delivery.errors.quote'));
    } finally {
      setBusy(false);
    }
  };

  const postDelivery = async () => {
    setError('');
    setBusy(true);
    try {
      const requestId = clientRequestId || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `delivery-${Date.now()}`);
      if (!clientRequestId) setClientRequestId(requestId);
      // Book the stops the server located when it quoted: a coordinate-less
      // suggestion is hashed from its resolved stops, so posting the
      // unresolved form would mismatch the quote. Any intake edit clears
      // the quote, so the quote's stops are always the current ones. ASAP
      // bookings likewise post the exact windows the quote was priced for.
      const response = await createDelivery({ ...payload(timing === 'asap' ? quotedWindowsRef.current : undefined), origin: quote?.origin || origin, destination: quote?.destination || destination, notes, quoteId: quote?.id, clientRequestId: requestId });
      setPosted(response.job);
      setProofPin(response.proofPin || '');
      setQuote(null);
      onPosted?.();
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.create'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="delivery-workspace">
      <section className="delivery-panel delivery-panel--form">
        <div className="delivery-panel__heading">
          <div className="delivery-icon-badge"><MapPin size={20} aria-hidden="true" /></div>
          <div>
            <h2>{t('delivery.customer.title')}</h2>
            <p>{t('delivery.customer.body')}</p>
          </div>
        </div>
        <form onSubmit={getQuote} className="delivery-form" data-track="ui.2f5c44f3da.8">
          <fieldset className="delivery-form-fields" disabled={busy}>
          <div className="delivery-stop-grid">
            <label className="delivery-field">
              <span>{t('delivery.customer.pickup')}</span>
              <AddressAutocomplete
                value={originText}
                onChange={(value) => { setOriginText(value); setOrigin({ ...emptyPlace(), address: value, display: value }); setQuote(null); }}
                onSelect={(place) => setOrigin(pointFromSuggestion(place, originText))}
                placeholder={t('delivery.customer.pickupPlaceholder')}
                ariaLabel={t('delivery.customer.pickup')}
                inputClassName="delivery-input"
                selectFullAddress
                suppressInitialSuggestions={Boolean(initial?.originText)}
                required
              />
            </label>
            <label className="delivery-field">
              <span>{t('delivery.customer.dropoff')}</span>
              <AddressAutocomplete
                value={destinationText}
                onChange={(value) => { setDestinationText(value); setDestination({ ...emptyPlace(), address: value, display: value }); setQuote(null); }}
                onSelect={(place) => setDestination(pointFromSuggestion(place, destinationText))}
                placeholder={t('delivery.customer.dropoffPlaceholder')}
                ariaLabel={t('delivery.customer.dropoff')}
                inputClassName="delivery-input"
                selectFullAddress
                suppressInitialSuggestions={Boolean(initial?.destinationText)}
                required
              />
            </label>
          </div>
          <div className="delivery-options-grid">
            <label className="delivery-field">
              <span>{t('delivery.customer.package')}</span>
              <select className="delivery-input" value={packageType} onChange={(event) => { setPackageType(event.target.value); setQuote(null); }}>
                {PACKAGE_OPTIONS.map((option) => <option key={option} value={option}>{t(`delivery.packageTypes.${option}`)}</option>)}
              </select>
            </label>
            <label className="delivery-field">
              <span>{t('delivery.customer.weight')}</span>
              <input className="delivery-input" type="number" min="0.1" max="300" step="0.1" required value={weightLbs} onChange={(event) => { setWeightLbs(event.target.value); setQuote(null); }} />
            </label>
            <label className="delivery-field">
              <span>{t('delivery.customer.serviceLevel')}</span>
              <select className="delivery-input" value={serviceLevel} onChange={(event) => { setServiceLevel(event.target.value); setQuote(null); }}>
                {SERVICE_OPTIONS.map((option) => <option key={option} value={option}>{t(`delivery.serviceLevels.${option}`)}</option>)}
              </select>
            </label>
          </div>
          <label className="delivery-field">
            <span>{t('delivery.customer.itemDescription')}</span>
            <input className="delivery-input" value={itemDescription} maxLength={500} onChange={(event) => { setItemDescription(event.target.value); setQuote(null); }} placeholder={t('delivery.customer.itemDescriptionPlaceholder')} />
          </label>
          <p className="delivery-estimate-defaults">{t('delivery.pricing.weight')}</p>
          <div className="delivery-options-grid">
            <label className="delivery-field"><span>{t('delivery.operations.pieces')}</span><input className="delivery-input" type="number" min="1" max="1000" step="1" required value={pieces} onChange={(event) => { setPieces(event.target.value); setQuote(null); }} /></label>
            <label className="delivery-field"><span>{t('delivery.operations.contents')}</span><select className="delivery-input" value={contentsCategory} onChange={(event) => { setContentsCategory(event.target.value); setQuote(null); }}>{CONTENTS.map((category) => <option key={category} value={category}>{t(`delivery.ui.contents.${category}`)}</option>)}</select></label>
            <label className="delivery-field"><span>{t('delivery.operations.declaredValue')}</span><input className="delivery-input" type="number" min="0.01" max="10000" step="0.01" required value={declaredValue} onChange={(event) => { setDeclaredValue(event.target.value); setQuote(null); }} placeholder="0.00" /></label>
          </div>
          <div className="delivery-options-grid">
            {['lengthIn', 'widthIn', 'heightIn'].map((key) => <label className="delivery-field" key={key}><span>{t(`delivery.operations.${key}`)}</span><input className="delivery-input" type="number" min="0.1" max="120" step="0.1" required value={dimensions[key]} onChange={(event) => { setDimensions((previous) => ({ ...previous, [key]: event.target.value })); setQuote(null); }} /></label>)}
          </div>
          <div className="delivery-options-grid">
            <label className="delivery-field"><span>{t('delivery.operations.pickupContact')}</span><input className="delivery-input" required value={originContact.name} onChange={(event) => setOriginContact((previous) => ({ ...previous, name: event.target.value }))} /></label>
            <label className="delivery-field"><span>{t('delivery.operations.pickupPhone')}</span><input className="delivery-input" type="tel" required value={originContact.phone} onChange={(event) => setOriginContact((previous) => ({ ...previous, phone: event.target.value }))} /></label>
            <label className="delivery-field"><span>{t('delivery.operations.dropoffContact')}</span><input className="delivery-input" required value={destinationContact.name} onChange={(event) => setDestinationContact((previous) => ({ ...previous, name: event.target.value }))} /></label>
            <label className="delivery-field"><span>{t('delivery.operations.dropoffPhone')}</span><input className="delivery-input" type="tel" required value={destinationContact.phone} onChange={(event) => setDestinationContact((previous) => ({ ...previous, phone: event.target.value }))} /></label>
          </div>
          <fieldset className="delivery-fieldset">
            <legend>{t('delivery.customer.timingTitle')}</legend>
            <div className="delivery-checkbox-row">
              <label><input type="radio" name="delivery-timing" checked={timing === 'asap'} onChange={() => { setTiming('asap'); setQuote(null); }} data-track="ui.2f5c44f3da.9" /> {t('delivery.customer.timingAsap')}</label>
              <label><input type="radio" name="delivery-timing" checked={timing === 'scheduled'} onChange={() => { setTiming('scheduled'); setQuote(null); }} data-track="ui.2f5c44f3da.10" /> {t('delivery.customer.timingScheduled')}</label>
            </div>
            {timing === 'asap' && <p className="delivery-estimate-defaults">{t('delivery.customer.asapNote')}</p>}
          </fieldset>
          {timing === 'scheduled' && (
          <div className="delivery-options-grid">
            <label className="delivery-field"><span>{t('delivery.operations.pickupWindowStart')}</span><input className="delivery-input" type="datetime-local" required value={pickupWindow.start} onChange={(event) => setPickupWindow((previous) => ({ ...previous, start: event.target.value }))} /></label>
            <label className="delivery-field"><span>{t('delivery.operations.pickupWindowEnd')}</span><input className="delivery-input" type="datetime-local" required value={pickupWindow.end} onChange={(event) => setPickupWindow((previous) => ({ ...previous, end: event.target.value }))} /></label>
            <label className="delivery-field"><span>{t('delivery.operations.dropoffWindowStart')}</span><input className="delivery-input" type="datetime-local" required value={deliveryWindow.start} onChange={(event) => setDeliveryWindow((previous) => ({ ...previous, start: event.target.value }))} /></label>
            <label className="delivery-field"><span>{t('delivery.operations.dropoffWindowEnd')}</span><input className="delivery-input" type="datetime-local" required value={deliveryWindow.end} onChange={(event) => setDeliveryWindow((previous) => ({ ...previous, end: event.target.value }))} /></label>
          </div>
          )}
          <div className="delivery-options-grid delivery-checkbox-row">
            <label><input type="checkbox" checked={fragile} onChange={(event) => setFragile(event.target.checked)} data-track="ui.2f5c44f3da.11" /> {t('delivery.operations.fragile')}</label>
            <label><input type="checkbox" checked={perishable} onChange={(event) => setPerishable(event.target.checked)} data-track="ui.2f5c44f3da.12" /> {t('delivery.operations.perishable')}</label>
            <label className="delivery-field"><span>{t('delivery.operations.proof')}</span><select className="delivery-input" value={proofPreference} onChange={(event) => setProofPreference(event.target.value)}><option value="recipient_confirmation">{t('delivery.proofTypes.recipient_confirmation')}</option><option value="pin">{t('delivery.proofTypes.pin')}</option><option value="signature">{t('delivery.proofTypes.signature')}</option><option value="photo">{t('delivery.proofTypes.photo')}</option></select></label>
          </div>
          <fieldset className="delivery-fieldset"><legend>{t('delivery.operations.handling')}</legend><div className="delivery-checkbox-row">
            {['stairs', 'loadingHelp', 'dolly', 'liftgate', 'parkingRequired', 'temperatureControl'].map((key) => <label key={key}><input type="checkbox" checked={handlingRequirements[key] === true} onChange={(event) => setHandlingRequirements((previous) => ({ ...previous, [key]: event.target.checked }))} data-track="ui.2f5c44f3da.13" /> {t(`delivery.operations.${key}`)}</label>)}
          </div></fieldset>
          <label className="delivery-field">
            <span>{t('delivery.customer.notes')}</span>
            <textarea className="delivery-input delivery-input--textarea" value={notes} maxLength={2000} onChange={(event) => { setNotes(event.target.value); setOriginContact((previous) => ({ ...previous, instructions: event.target.value })); setDestinationContact((previous) => ({ ...previous, instructions: event.target.value })); }} placeholder={t('delivery.customer.notesPlaceholder')} />
          </label>
          {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
          <button type="submit" className="delivery-button delivery-button--primary delivery-button--wide" disabled={busy} data-track="ui.2f5c44f3da.14">
            {busy ? <Loader2 size={17} className="delivery-spin" aria-hidden="true" /> : <DollarSign size={17} aria-hidden="true" />}
            {t('delivery.customer.getQuote')}
          </button>
          </fieldset>
        </form>
      </section>

      <section className="delivery-panel delivery-panel--quote" aria-live="polite">
        {!quote && !posted ? (
          <div className="delivery-empty-panel">
            <div className="delivery-icon-badge delivery-icon-badge--muted"><Package size={22} aria-hidden="true" /></div>
            <h2>{t('delivery.customer.quoteTitle')}</h2>
            <p>{t('delivery.customer.quoteHint')}</p>
          </div>
        ) : posted ? (
          <div className="delivery-success-panel">
            <CheckCircle2 size={34} aria-hidden="true" />
            <h2>{t('delivery.customer.posted')}</h2>
            <p>{posted.reference}</p>
            {proofPin && <p className="delivery-proof-pin"><ShieldCheck size={15} aria-hidden="true" />{t('delivery.detail.pin')}: <strong>{proofPin}</strong></p>}
            <Link to={`/delivery/jobs/${posted.id}`} className="delivery-button delivery-button--secondary">{t('delivery.operations.viewDelivery')} <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        ) : (
          <div className="delivery-quote-panel">
            <div className="delivery-panel__heading">
              <div className="delivery-icon-badge delivery-icon-badge--green"><CheckCircle2 size={20} aria-hidden="true" /></div>
              <div><h2>{t('delivery.customer.quoteTitle')}</h2><p>{t('delivery.customer.quoteExpires', { minutes: quote.pricing.quoteTtlMinutes })}</p></div>
            </div>
            <div className="delivery-quote-total"><span>{t('delivery.customer.total')}</span><strong>{currency(quote.pricing.cents.customerTotal, quote.pricing.currency)}</strong></div>
            <div className="delivery-route-summary"><span><Truck size={16} aria-hidden="true" />{deliveryUnit(quote.route.distanceMiles, 'mile', i18n.language)}</span><span><Clock3 size={16} aria-hidden="true" />{deliveryUnit(quote.route.durationMinutes, 'minute', i18n.language)}</span></div>
            <dl className="delivery-breakdown">
              <div><dt>{t('delivery.customer.subtotal')}</dt><dd>{currency(quote.pricing.cents.deliverySubtotal, quote.pricing.currency)}</dd></div>
              <div><dt>{t('delivery.customer.platformFee')}</dt><dd>{currency(quote.pricing.cents.platformFee, quote.pricing.currency)}</dd></div>
              <div><dt>{t('delivery.customer.tolls')}</dt><dd>{currency(quote.pricing.cents.passThrough, quote.pricing.currency)}</dd></div>
            </dl>
            <button type="button" className="delivery-button delivery-button--primary delivery-button--wide" onClick={postDelivery} disabled={busy} data-track="ui.2f5c44f3da.15">
              {busy ? <Loader2 size={17} className="delivery-spin" aria-hidden="true" /> : <Truck size={17} aria-hidden="true" />}
              {t('delivery.customer.post')}
            </button>
            <p className="delivery-pricing-note"><ShieldCheck size={15} aria-hidden="true" />{t('delivery.pricingNote')}</p>
          </div>
        )}
      </section>
    </div>
  );
}

const DRIVER_VEHICLE_TYPES = ['car', 'van', 'pickup', 'box_truck', 'cargo_bike'];
const EQUIPMENT_KEYS = ['stairs', 'loadingHelp', 'dolly', 'liftgate', 'parkingRequired', 'temperatureControl'];
const DOCUMENT_TYPES = ['license', 'insurance', 'registration', 'vehicle_registration', 'other'];

// Group 9 Slice A (item 454): the service area is a structured object, not
// free text. These helpers convert between the object the server stores
// and the comma-separated inputs the driver types.
function buildServiceArea(area) {
  const list = (value) => String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  const result = {};
  const states = list(area.states);
  if (states.length) result.states = states.map((state) => state.toUpperCase());
  const cities = list(area.cities);
  if (cities.length) result.cities = cities;
  const postalCodes = list(area.postalCodes);
  if (postalCodes.length) result.postalCodes = postalCodes;
  const lat = Number(area.centerLat);
  const lng = Number(area.centerLng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) result.center = { lat, lng };
  const radius = Number(area.radiusMiles);
  if (Number.isFinite(radius) && radius > 0) result.radiusMiles = radius;
  return result;
}

function serviceAreaToForm(area) {
  if (!area || typeof area !== 'object') return { states: '', cities: '', postalCodes: '', radiusMiles: '', centerLat: '', centerLng: '' };
  return {
    states: Array.isArray(area.states) ? area.states.join(', ') : '',
    cities: Array.isArray(area.cities) ? area.cities.join(', ') : '',
    postalCodes: Array.isArray(area.postalCodes) ? area.postalCodes.join(', ') : '',
    radiusMiles: area.radiusMiles != null ? String(area.radiusMiles) : '',
    centerLat: area.center?.lat != null ? String(area.center.lat) : '',
    centerLng: area.center?.lng != null ? String(area.center.lng) : '',
  };
}

function serviceAreaSummary(area, t) {
  if (!area || typeof area !== 'object' || Object.keys(area).length === 0) return t('delivery.driver.serviceAreaEverywhere');
  const parts = [];
  if (Array.isArray(area.states) && area.states.length) parts.push(area.states.join(', '));
  if (Array.isArray(area.cities) && area.cities.length) parts.push(area.cities.join(', '));
  if (Array.isArray(area.postalCodes) && area.postalCodes.length) parts.push(area.postalCodes.join(', '));
  if (area.radiusMiles) parts.push(t('delivery.driver.serviceAreaRadiusValue', { miles: area.radiusMiles }));
  return parts.join(' · ') || t('delivery.driver.serviceAreaEverywhere');
}

function ServiceAreaFields({ t, area, onChange }) {
  const set = (key, value) => onChange({ ...area, [key]: value });
  return (
    <fieldset className="delivery-fieldset">
      <legend>{t('delivery.driver.serviceAreaTitle')}</legend>
      <div className="delivery-options-grid">
        <label className="delivery-field">{t('delivery.driver.serviceAreaStates')}
          <input className="delivery-input" value={area.states} onChange={(event) => set('states', event.target.value)} placeholder={t('delivery.driver.serviceAreaStatesPlaceholder')} />
        </label>
        <label className="delivery-field">{t('delivery.driver.serviceAreaCities')}
          <input className="delivery-input" value={area.cities} onChange={(event) => set('cities', event.target.value)} placeholder={t('delivery.driver.serviceAreaCitiesPlaceholder')} />
        </label>
        <label className="delivery-field">{t('delivery.driver.serviceAreaPostalCodes')}
          <input className="delivery-input" value={area.postalCodes} onChange={(event) => set('postalCodes', event.target.value)} placeholder={t('delivery.driver.serviceAreaPostalCodesPlaceholder')} />
        </label>
      </div>
      <div className="delivery-options-grid">
        <label className="delivery-field">{t('delivery.driver.serviceAreaRadius')}
          <input className="delivery-input" type="number" min="0" step="any" value={area.radiusMiles} onChange={(event) => set('radiusMiles', event.target.value)} />
        </label>
        <label className="delivery-field">{t('delivery.driver.serviceAreaCenterLat')}
          <input className="delivery-input" type="number" step="any" value={area.centerLat} onChange={(event) => set('centerLat', event.target.value)} />
        </label>
        <label className="delivery-field">{t('delivery.driver.serviceAreaCenterLng')}
          <input className="delivery-input" type="number" step="any" value={area.centerLng} onChange={(event) => set('centerLng', event.target.value)} />
        </label>
      </div>
      <p className="delivery-estimate-defaults">{t('delivery.driver.serviceAreaHint')}</p>
    </fieldset>
  );
}

// Group 9 Slice A (item 455): the driver-facing readiness checklist. It
// renders the same readiness gate the server already enforces on claim
// and assign (capabilityFailures) as pass/fail/warn/not-applicable rows,
// each pointing at the section that fixes it. Advisory only: it changes
// no gate and no claim behavior.
const READINESS_DETAIL_KEYS = new Set([
  'missing_profile', 'no_payload_recorded', 'no_dimensions_recorded', 'no_expiry_recorded',
  'document_expired', 'document_expiring', 'no_documents', 'no_active_vehicle',
]);
const READINESS_FIX_TARGETS = {
  profile: 'driver-profile', vehicles: 'driver-vehicles', documents: 'driver-documents', 'service-area': 'driver-service-area',
};

export function DriverReadinessChecklist({ t, jobId = null, fixBase = '' }) {
  const [checklist, setChecklist] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const response = await getDriverReadiness(jobId || undefined);
      setChecklist(response.checklist || []);
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.load'));
    }
  }, [t, jobId]);
  useEffect(() => { load(); }, [load]);
  const statusIcon = (status) => {
    if (status === 'pass') return <CheckCircle2 size={17} aria-hidden="true" />;
    if (status === 'fail') return <XCircle size={17} aria-hidden="true" />;
    if (status === 'warn') return <AlertTriangle size={17} aria-hidden="true" />;
    return <Clock3 size={17} aria-hidden="true" />;
  };
  return (
    <section className="delivery-panel" aria-labelledby="driver-readiness-title">
      <div className="delivery-panel__heading">
        <div className="delivery-icon-badge delivery-icon-badge--green"><ShieldCheck size={20} aria-hidden="true" /></div>
        <div><h2 id="driver-readiness-title">{t('delivery.driver.readinessTitle')}</h2><p>{t('delivery.driver.readinessBody')}</p></div>
      </div>
      {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
      {checklist === null && !error ? <p className="delivery-estimate-defaults">{t('delivery.helper.loading')}</p> : (
        <ul className="delivery-checklist">
          {checklist.map((item) => (
            <li key={item.key} className={`delivery-checklist__row delivery-checklist__row--${item.status}`}>
              <span className="delivery-checklist__icon" aria-hidden="true">{statusIcon(item.status)}</span>
              <span className="delivery-checklist__text">
                <strong>{t(`delivery.driver.readiness.${item.key}`)}</strong>
                <span>{t(`delivery.driver.readinessStatus.${item.status}`)}</span>
                {item.detail && READINESS_DETAIL_KEYS.has(item.detail) && <span>{t(`delivery.driver.readinessDetails.${item.detail}`)}</span>}
              </span>
              {item.status !== 'pass' && item.fix && (
                <a className="delivery-checklist__fix" href={`${fixBase}#${READINESS_FIX_TARGETS[item.fix] || item.fix}`} data-track="ui.2f5c44f3da.16">{t('delivery.driver.readinessFix')}</a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Group 9 partials Wave 2 Batch L (451/453/455, G9-A1, D-528): the
// post-approval capacity editor. The onboarding form renders only
// pre-approval, and the service-area section patches only the service
// area, so an approved driver whose insurance expired, whose payload
// changed, or whose availability window moved had no self-serve fix and
// kept 409ing on every claim. This reuses PATCH /delivery/driver-profile
// (updateOwnDriverProfile accepts every field here, including the
// availability window the onboarding form never collected). Insurance
// acknowledgement is shown read-only: the PATCH endpoint has no such
// field. Saving never touches approval.
function profileFormFromProfile(profile) {
  const toDateInput = (value) => (value ? String(value).slice(0, 10) : '');
  return {
    vehicleType: profile?.vehicle_type || 'car',
    maxPayloadLbs: profile?.max_payload_lbs ?? '',
    cargoLengthIn: profile?.cargo_length_in ?? '',
    cargoWidthIn: profile?.cargo_width_in ?? '',
    cargoHeightIn: profile?.cargo_height_in ?? '',
    equipment: {
      stairs: profile?.equipment?.stairs === true,
      loadingHelp: profile?.equipment?.loadingHelp === true,
      dolly: profile?.equipment?.dolly === true,
      liftgate: profile?.equipment?.liftgate === true,
      parkingRequired: profile?.equipment?.parkingRequired === true,
      temperatureControl: profile?.equipment?.temperatureControl === true,
    },
    maxPieces: profile?.max_pieces ?? '',
    fragileSupported: profile?.fragile_supported === true,
    perishableSupported: profile?.perishable_supported === true,
    insuranceExpiresAt: toDateInput(profile?.insurance_expires_at),
    availableFrom: toDateInput(profile?.available_from),
    availableUntil: toDateInput(profile?.available_until),
  };
}

function DriverProfileEditorSection({ t, profile, onChanged }) {
  const [form, setForm] = useState(() => profileFormFromProfile(profile));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setForm(profileFormFromProfile(profile)); }, [profile?.updated_at]);
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const setEquipment = (key, value) => setForm((prev) => ({ ...prev, equipment: { ...prev.equipment, [key]: value } }));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    setError('');
    try {
      // Empty fields send null: updateOwnDriverProfile falls back to the
      // stored value for nulls, so an untouched field is never cleared.
      await updateDriverProfile({
        vehicleType: form.vehicleType,
        maxPayloadLbs: form.maxPayloadLbs === '' ? null : Number(form.maxPayloadLbs),
        cargoLengthIn: form.cargoLengthIn === '' ? null : Number(form.cargoLengthIn),
        cargoWidthIn: form.cargoWidthIn === '' ? null : Number(form.cargoWidthIn),
        cargoHeightIn: form.cargoHeightIn === '' ? null : Number(form.cargoHeightIn),
        equipment: form.equipment,
        maxPieces: form.maxPieces === '' ? null : Number(form.maxPieces),
        fragileSupported: form.fragileSupported,
        perishableSupported: form.perishableSupported,
        insuranceExpiresAt: form.insuranceExpiresAt ? new Date(form.insuranceExpiresAt).toISOString() : null,
        availableFrom: form.availableFrom ? new Date(form.availableFrom).toISOString() : null,
        availableUntil: form.availableUntil ? new Date(form.availableUntil).toISOString() : null,
      });
      setSaved(true);
      onChanged?.();
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.status'));
    } finally { setBusy(false); }
  };
  return (
    <section className="delivery-panel" id="driver-profile" aria-labelledby="driver-profile-title">
      <div className="delivery-panel__heading">
        <div className="delivery-icon-badge"><ShieldCheck size={20} aria-hidden="true" /></div>
        <div><h2 id="driver-profile-title">{t('delivery.driver.profileTitle')}</h2><p>{t('delivery.driver.profileBody')}</p></div>
      </div>
      <form className="delivery-form" onSubmit={submit} data-track="ui.2f5c44f3da.17">
        <div className="delivery-options-grid">
          <label className="delivery-field">{t('delivery.ui.vehicleType')}
            <select className="delivery-input" value={form.vehicleType} onChange={(event) => set('vehicleType', event.target.value)}>
              {DRIVER_VEHICLE_TYPES.map((type) => <option key={type} value={type}>{t(`delivery.ui.vehicleTypes.${type}`)}</option>)}
            </select>
          </label>
          <label className="delivery-field">{t('delivery.ui.maxPayloadLbs')}
            <input className="delivery-input" type="number" min="0" step="any" value={form.maxPayloadLbs} onChange={(event) => set('maxPayloadLbs', event.target.value)} />
          </label>
        </div>
        <div className="delivery-options-grid">
          <label className="delivery-field">{t('delivery.ui.cargoLengthIn')}
            <input className="delivery-input" type="number" min="0" step="any" value={form.cargoLengthIn} onChange={(event) => set('cargoLengthIn', event.target.value)} />
          </label>
          <label className="delivery-field">{t('delivery.ui.cargoWidthIn')}
            <input className="delivery-input" type="number" min="0" step="any" value={form.cargoWidthIn} onChange={(event) => set('cargoWidthIn', event.target.value)} />
          </label>
          <label className="delivery-field">{t('delivery.ui.cargoHeightIn')}
            <input className="delivery-input" type="number" min="0" step="any" value={form.cargoHeightIn} onChange={(event) => set('cargoHeightIn', event.target.value)} />
          </label>
        </div>
        <div className="delivery-options-grid">
          <label className="delivery-field">{t('delivery.driver.maxPieces')}
            <input className="delivery-input" type="number" min="1" step="1" value={form.maxPieces} onChange={(event) => set('maxPieces', event.target.value)} />
          </label>
          <label className="delivery-field">{t('delivery.driver.insuranceExpiresAt')}
            <input className="delivery-input" type="date" value={form.insuranceExpiresAt} onChange={(event) => set('insuranceExpiresAt', event.target.value)} />
          </label>
        </div>
        <div className="delivery-options-grid">
          <label className="delivery-field">{t('delivery.ui.availableFrom')}
            <input className="delivery-input" type="date" value={form.availableFrom} onChange={(event) => set('availableFrom', event.target.value)} />
          </label>
          <label className="delivery-field">{t('delivery.ui.availableUntil')}
            <input className="delivery-input" type="date" value={form.availableUntil} onChange={(event) => set('availableUntil', event.target.value)} />
          </label>
        </div>
        <fieldset className="delivery-fieldset">
          <legend>{t('delivery.driver.equipment')}</legend>
          <div className="delivery-checkbox-row">
            {EQUIPMENT_KEYS.map((key) => (
              <label key={key}><input type="checkbox" checked={form.equipment[key] === true} onChange={(event) => setEquipment(key, event.target.checked)} data-track="ui.2f5c44f3da.18" /> {t(`delivery.driver.equipmentKeys.${key}`)}</label>
            ))}
          </div>
        </fieldset>
        <div className="delivery-checkbox-row">
          <label><input type="checkbox" checked={form.fragileSupported} onChange={(event) => set('fragileSupported', event.target.checked)} data-track="ui.2f5c44f3da.19" /> {t('delivery.ui.fragileSupported')}</label>
          <label><input type="checkbox" checked={form.perishableSupported} onChange={(event) => set('perishableSupported', event.target.checked)} data-track="ui.2f5c44f3da.20" /> {t('delivery.ui.perishableSupported')}</label>
        </div>
        <label className="delivery-check">
          <input type="checkbox" checked={profile?.insurance_acknowledged === true} disabled data-track="ui.2f5c44f3da.21" />
          <span>{t('delivery.driver.insuranceAck')}</span>
        </label>
        {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
        {saved && <p className="delivery-alert delivery-alert--success" role="status">{t('delivery.driver.profileSaved')}</p>}
        <button type="submit" className="delivery-button delivery-button--primary" disabled={busy} data-track="ui.2f5c44f3da.22">
          {busy ? <Loader2 size={17} className="delivery-spin" aria-hidden="true" /> : <ShieldCheck size={17} aria-hidden="true" />}
          {t('delivery.driver.profileSave')}
        </button>
      </form>
    </section>
  );
}

// Group 9 Slice A (item 452): the driver's own vehicles, with identity
// (plate, make, model, year) and an active vehicle shown on the profile.
function DriverVehiclesSection({ t, onChanged }) {
  const [vehicles, setVehicles] = useState([]);
  const [activeVehicleId, setActiveVehicleId] = useState(null);
  const [form, setForm] = useState({ vehicleType: 'car', maxPayloadLbs: '', plate: '', make: '', model: '', year: '' });
  // Group 9 partials Wave 2 Batch L (452, G9-A12, D-532): in-place edit.
  // Fixing a plate typo used to mean delete + re-add, which cleared
  // active_vehicle_id. The PATCH endpoint preserves it; this form wires it.
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ vehicleType: 'car', maxPayloadLbs: '', plate: '', make: '', model: '', year: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await listDriverVehicles();
      setVehicles(response.vehicles || []);
      setActiveVehicleId(response.activeVehicleId || null);
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.load'));
    }
  }, [t]);
  useEffect(() => { load(); }, [load]);
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const setEdit = (key, value) => setEditForm((prev) => ({ ...prev, [key]: value }));
  const startEdit = (vehicle) => {
    setEditingId(vehicle.id);
    setEditForm({
      vehicleType: vehicle.vehicle_type || 'car',
      maxPayloadLbs: vehicle.max_payload_lbs ?? '',
      plate: vehicle.plate || '', make: vehicle.make || '', model: vehicle.model || '',
      year: vehicle.year ?? '',
    });
    setError('');
  };
  const submitEdit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await updateDriverVehicle(editingId, {
        vehicleType: editForm.vehicleType,
        maxPayloadLbs: editForm.maxPayloadLbs === '' ? null : Number(editForm.maxPayloadLbs),
        plate: editForm.plate, make: editForm.make, model: editForm.model,
        year: editForm.year === '' ? null : Number(editForm.year),
      });
      setEditingId(null);
      await load();
      onChanged?.();
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.status'));
    } finally { setBusy(false); }
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createDriverVehicle({
        vehicleType: form.vehicleType,
        maxPayloadLbs: form.maxPayloadLbs === '' ? null : Number(form.maxPayloadLbs),
        plate: form.plate, make: form.make, model: form.model,
        year: form.year === '' ? null : Number(form.year),
      });
      setForm({ vehicleType: 'car', maxPayloadLbs: '', plate: '', make: '', model: '', year: '' });
      await load();
      onChanged?.();
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.status'));
    } finally { setBusy(false); }
  };
  const activate = async (id) => {
    setBusy(true);
    setError('');
    try { await activateDriverVehicle(id); await load(); onChanged?.(); } catch (requestError) { setError(deliveryError(requestError, t, 'delivery.errors.status')); } finally { setBusy(false); }
  };
  const remove = async (id) => {
    setBusy(true);
    setError('');
    try { await deleteDriverVehicle(id); await load(); onChanged?.(); } catch (requestError) { setError(deliveryError(requestError, t, 'delivery.errors.status')); } finally { setBusy(false); }
  };
  return (
    <section className="delivery-panel" id="driver-vehicles" aria-labelledby="driver-vehicles-title">
      <div className="delivery-panel__heading">
        <div className="delivery-icon-badge"><Truck size={20} aria-hidden="true" /></div>
        <div><h2 id="driver-vehicles-title">{t('delivery.driver.vehiclesTitle')}</h2><p>{t('delivery.driver.vehiclesBody')}</p></div>
      </div>
      {vehicles.length === 0 ? <p className="delivery-empty-copy">{t('delivery.driver.vehiclesEmpty')}</p> : (
        <ul className="delivery-mini-list">
          {vehicles.map((vehicle) => (
            <li key={vehicle.id} className="delivery-mini-row">
              <span>
                <strong>{[vehicle.make, vehicle.model].filter(Boolean).join(' ') || t(`delivery.ui.vehicleTypes.${vehicle.vehicle_type}`)}</strong>
                <span>{[vehicle.plate, vehicle.year ? String(vehicle.year) : null].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="delivery-mini-actions">
                {String(vehicle.id) === String(activeVehicleId)
                  ? <span className="delivery-onboard-badge"><ShieldCheck size={15} aria-hidden="true" />{t('delivery.driver.vehicleActive')}</span>
                  : <button type="button" className="delivery-button delivery-button--secondary" onClick={() => activate(vehicle.id)} disabled={busy} data-track="ui.2f5c44f3da.23">{t('delivery.driver.vehicleSetActive')}</button>}
                <button type="button" className="delivery-button delivery-button--secondary" onClick={() => startEdit(vehicle)} disabled={busy} data-track="ui.2f5c44f3da.24">{t('delivery.driver.vehicleEdit')}</button>
                <button type="button" className="delivery-button delivery-button--secondary" onClick={() => remove(vehicle.id)} disabled={busy} data-track="ui.2f5c44f3da.25">{t('delivery.driver.vehicleRemove')}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editingId !== null && (
        <form className="delivery-form" onSubmit={submitEdit} data-track="ui.2f5c44f3da.26">
          <div className="delivery-options-grid">
            <label className="delivery-field">{t('delivery.ui.vehicleType')}
              <select className="delivery-input" value={editForm.vehicleType} onChange={(event) => setEdit('vehicleType', event.target.value)}>
                {DRIVER_VEHICLE_TYPES.map((type) => <option key={type} value={type}>{t(`delivery.ui.vehicleTypes.${type}`)}</option>)}
              </select>
            </label>
            <label className="delivery-field">{t('delivery.ui.maxPayloadLbs')}
              <input className="delivery-input" type="number" min="0" step="any" value={editForm.maxPayloadLbs} onChange={(event) => setEdit('maxPayloadLbs', event.target.value)} />
            </label>
            <label className="delivery-field">{t('delivery.driver.vehiclePlate')}
              <input className="delivery-input" value={editForm.plate} onChange={(event) => setEdit('plate', event.target.value)} />
            </label>
          </div>
          <div className="delivery-options-grid">
            <label className="delivery-field">{t('delivery.driver.vehicleMake')}
              <input className="delivery-input" value={editForm.make} onChange={(event) => setEdit('make', event.target.value)} />
            </label>
            <label className="delivery-field">{t('delivery.driver.vehicleModel')}
              <input className="delivery-input" value={editForm.model} onChange={(event) => setEdit('model', event.target.value)} />
            </label>
            <label className="delivery-field">{t('delivery.driver.vehicleYear')}
              <input className="delivery-input" type="number" min="1900" step="1" value={editForm.year} onChange={(event) => setEdit('year', event.target.value)} />
            </label>
          </div>
          {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
          <div className="delivery-checkbox-row">
            <button type="submit" className="delivery-button delivery-button--primary" disabled={busy} data-track="ui.2f5c44f3da.27">
              {busy ? <Loader2 size={17} className="delivery-spin" aria-hidden="true" /> : <Truck size={17} aria-hidden="true" />}
              {t('delivery.driver.vehicleSave')}
            </button>
            <button type="button" className="delivery-button delivery-button--secondary" onClick={() => setEditingId(null)} disabled={busy} data-track="ui.2f5c44f3da.28">{t('delivery.ui.cancel')}</button>
          </div>
        </form>
      )}
      <form className="delivery-form" onSubmit={submit} data-track="ui.2f5c44f3da.29">
        <div className="delivery-options-grid">
          <label className="delivery-field">{t('delivery.ui.vehicleType')}
            <select className="delivery-input" value={form.vehicleType} onChange={(event) => set('vehicleType', event.target.value)}>
              {DRIVER_VEHICLE_TYPES.map((type) => <option key={type} value={type}>{t(`delivery.ui.vehicleTypes.${type}`)}</option>)}
            </select>
          </label>
          <label className="delivery-field">{t('delivery.ui.maxPayloadLbs')}
            <input className="delivery-input" type="number" min="0" step="any" value={form.maxPayloadLbs} onChange={(event) => set('maxPayloadLbs', event.target.value)} />
          </label>
          <label className="delivery-field">{t('delivery.driver.vehiclePlate')}
            <input className="delivery-input" value={form.plate} onChange={(event) => set('plate', event.target.value)} />
          </label>
        </div>
        <div className="delivery-options-grid">
          <label className="delivery-field">{t('delivery.driver.vehicleMake')}
            <input className="delivery-input" value={form.make} onChange={(event) => set('make', event.target.value)} />
          </label>
          <label className="delivery-field">{t('delivery.driver.vehicleModel')}
            <input className="delivery-input" value={form.model} onChange={(event) => set('model', event.target.value)} />
          </label>
          <label className="delivery-field">{t('delivery.driver.vehicleYear')}
            <input className="delivery-input" type="number" min="1900" step="1" value={form.year} onChange={(event) => set('year', event.target.value)} />
          </label>
        </div>
        {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
        <button type="submit" className="delivery-button delivery-button--primary" disabled={busy} data-track="ui.2f5c44f3da.30">
          {busy ? <Loader2 size={17} className="delivery-spin" aria-hidden="true" /> : <Truck size={17} aria-hidden="true" />}
          {t('delivery.driver.vehicleAdd')}
        </button>
      </form>
    </section>
  );
}

// Group 9 Slice A (item 453): the driver's own documents with expiry
// dates. Records plus renewal reminders only; no verification workflow.
function DriverDocumentsSection({ t, onChanged }) {
  const { i18n } = useTranslation();
  const [documents, setDocuments] = useState([]);
  const [form, setForm] = useState({ documentType: 'license', title: '', expiresAt: '', notes: '' });
  // Group 9 partials Wave 2 Batch L (453, G9-A12, D-532): in-place edit.
  // Fixing a wrong expiry used to mean delete + re-add, which dropped the
  // reminder stamps, so a re-added document could be re-reminded for a
  // window already sent. The PATCH endpoint preserves the stamps.
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ documentType: 'license', title: '', expiresAt: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await listDriverDocuments();
      setDocuments(response.documents || []);
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.load'));
    }
  }, [t]);
  useEffect(() => { load(); }, [load]);
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const setEdit = (key, value) => setEditForm((prev) => ({ ...prev, [key]: value }));
  const startEdit = (doc) => {
    setEditingId(doc.id);
    setEditForm({
      documentType: doc.document_type || 'license',
      title: doc.title || '',
      expiresAt: doc.expires_at ? String(doc.expires_at).slice(0, 10) : '',
      notes: doc.notes || '',
    });
    setError('');
  };
  const submitEdit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await updateDriverDocument(editingId, {
        documentType: editForm.documentType, title: editForm.title,
        expiresAt: editForm.expiresAt ? new Date(editForm.expiresAt).toISOString() : null,
        notes: editForm.notes,
      });
      setEditingId(null);
      await load();
      onChanged?.();
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.status'));
    } finally { setBusy(false); }
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createDriverDocument({
        documentType: form.documentType, title: form.title,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        notes: form.notes,
      });
      setForm({ documentType: 'license', title: '', expiresAt: '', notes: '' });
      await load();
      onChanged?.();
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.status'));
    } finally { setBusy(false); }
  };
  const remove = async (id) => {
    setBusy(true);
    setError('');
    try { await deleteDriverDocument(id); await load(); onChanged?.(); } catch (requestError) { setError(deliveryError(requestError, t, 'delivery.errors.status')); } finally { setBusy(false); }
  };
  return (
    <section className="delivery-panel" id="driver-documents" aria-labelledby="driver-documents-title">
      <div className="delivery-panel__heading">
        <div className="delivery-icon-badge"><FileText size={20} aria-hidden="true" /></div>
        <div><h2 id="driver-documents-title">{t('delivery.driver.documentsTitle')}</h2><p>{t('delivery.driver.documentsBody')}</p></div>
      </div>
      {documents.length === 0 ? <p className="delivery-empty-copy">{t('delivery.driver.documentsEmpty')}</p> : (
        <ul className="delivery-mini-list">
          {documents.map((doc) => (
            <li key={doc.id} className="delivery-mini-row">
              <span>
                <strong>{doc.title}</strong>
                <span>{t(`delivery.driver.documentTypes.${doc.document_type}`)}</span>
                <span>
                  {doc.expires_at
                    ? `${deliveryDate(doc.expires_at, i18n.language)} · ${doc.days_until_expiry < 0 ? t('delivery.driver.documentExpired') : t('delivery.driver.documentExpiresIn', { days: doc.days_until_expiry })}`
                    : t('delivery.driver.documentNoExpiry')}
                </span>
              </span>
              <span className="delivery-mini-actions">
                <button type="button" className="delivery-button delivery-button--secondary" onClick={() => startEdit(doc)} disabled={busy} data-track="ui.2f5c44f3da.31">{t('delivery.driver.documentEdit')}</button>
                <button type="button" className="delivery-button delivery-button--secondary" onClick={() => remove(doc.id)} disabled={busy} data-track="ui.2f5c44f3da.32">{t('delivery.driver.documentRemove')}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editingId !== null && (
        <form className="delivery-form" onSubmit={submitEdit} data-track="ui.2f5c44f3da.33">
          <div className="delivery-options-grid">
            <label className="delivery-field">{t('delivery.driver.documentType')}
              <select className="delivery-input" value={editForm.documentType} onChange={(event) => setEdit('documentType', event.target.value)}>
                {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{t(`delivery.driver.documentTypes.${type}`)}</option>)}
              </select>
            </label>
            <label className="delivery-field">{t('delivery.driver.documentTitle')}
              <input className="delivery-input" value={editForm.title} onChange={(event) => setEdit('title', event.target.value)} />
            </label>
            <label className="delivery-field">{t('delivery.driver.documentExpiresAt')}
              <input className="delivery-input" type="date" value={editForm.expiresAt} onChange={(event) => setEdit('expiresAt', event.target.value)} />
            </label>
          </div>
          <label className="delivery-field">{t('delivery.driver.documentNotes')}
            <input className="delivery-input" value={editForm.notes} onChange={(event) => setEdit('notes', event.target.value)} />
          </label>
          {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
          <div className="delivery-checkbox-row">
            <button type="submit" className="delivery-button delivery-button--primary" disabled={busy} data-track="ui.2f5c44f3da.34">
              {busy ? <Loader2 size={17} className="delivery-spin" aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}
              {t('delivery.driver.documentSave')}
            </button>
            <button type="button" className="delivery-button delivery-button--secondary" onClick={() => setEditingId(null)} disabled={busy} data-track="ui.2f5c44f3da.35">{t('delivery.ui.cancel')}</button>
          </div>
        </form>
      )}
      <form className="delivery-form" onSubmit={submit} data-track="ui.2f5c44f3da.36">
        <div className="delivery-options-grid">
          <label className="delivery-field">{t('delivery.driver.documentType')}
            <select className="delivery-input" value={form.documentType} onChange={(event) => set('documentType', event.target.value)}>
              {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{t(`delivery.driver.documentTypes.${type}`)}</option>)}
            </select>
          </label>
          <label className="delivery-field">{t('delivery.driver.documentTitle')}
            <input className="delivery-input" value={form.title} onChange={(event) => set('title', event.target.value)} />
          </label>
          <label className="delivery-field">{t('delivery.driver.documentExpiresAt')}
            <input className="delivery-input" type="date" value={form.expiresAt} onChange={(event) => set('expiresAt', event.target.value)} />
          </label>
        </div>
        {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
        <button type="submit" className="delivery-button delivery-button--primary" disabled={busy} data-track="ui.2f5c44f3da.37">
          {busy ? <Loader2 size={17} className="delivery-spin" aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}
          {t('delivery.driver.documentAdd')}
        </button>
      </form>
    </section>
  );
}

// Group 9 Slice A (item 454): the driver's service area after approval.
// Editing reuses the same structured fields as onboarding and patches only
// the service area, so approval and capacity are never touched.
function DriverServiceAreaSection({ t, profile, onChanged }) {
  const [area, setArea] = useState(() => serviceAreaToForm(profile?.service_area));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setArea(serviceAreaToForm(profile?.service_area)); }, [profile?.service_area]);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    setError('');
    try {
      await updateDriverProfile({ serviceArea: buildServiceArea(area) });
      setSaved(true);
      onChanged?.();
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.status'));
    } finally { setBusy(false); }
  };
  return (
    <section className="delivery-panel" id="driver-service-area" aria-labelledby="driver-service-area-title">
      <div className="delivery-panel__heading">
        <div className="delivery-icon-badge"><MapPin size={20} aria-hidden="true" /></div>
        <div>
          <h2 id="driver-service-area-title">{t('delivery.driver.serviceAreaTitle')}</h2>
          <p>{t('delivery.driver.serviceAreaCurrent', { area: serviceAreaSummary(profile?.service_area, t) })}</p>
        </div>
      </div>
      <form className="delivery-form" onSubmit={submit} data-track="ui.2f5c44f3da.38">
        <ServiceAreaFields t={t} area={area} onChange={setArea} />
        {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
        {saved && <p className="delivery-alert delivery-alert--success" role="status">{t('delivery.driver.serviceAreaSaved')}</p>}
        <button type="submit" className="delivery-button delivery-button--primary" disabled={busy} data-track="ui.2f5c44f3da.39">
          {busy ? <Loader2 size={17} className="delivery-spin" aria-hidden="true" /> : <MapPin size={17} aria-hidden="true" />}
          {t('delivery.driver.serviceAreaSave')}
        </button>
      </form>
    </section>
  );
}

// P2-4-F10: self-serve driver onboarding. Drivers without an ops-provisioned
// driver profile register their own capability profile here; the profile is
// created pending operations approval, and claiming stays gated until then.
// G-46: registration is open to admitted drivers (helper mode or a
// logistics.ship grant), not helpers only.
function DriverOnboarding({ t, profile, onRegistered, canRegister = true }) {
  const [form, setForm] = useState({
    vehicleType: 'car',
    maxPayloadLbs: '',
    cargoLengthIn: '',
    cargoWidthIn: '',
    cargoHeightIn: '',
    // Group 9 Slice A (item 452): equipment is an object of boolean keys
    // from the allowed list, not free text. The old free-text input 400d
    // every submission that typed anything.
    equipment: { stairs: false, loadingHelp: false, dolly: false, liftgate: false, parkingRequired: false, temperatureControl: false },
    maxPieces: '',
    fragileSupported: false,
    perishableSupported: false,
    insuranceExpiresAt: '',
    // Group 9 partials Wave 2 Batch L (451, G9-A1, D-533): the form
    // never collected the availability window, so a driver could never
    // set their own window at all. The server leg already persisted it.
    availableFrom: '',
    availableUntil: '',
    insuranceAcknowledged: false,
  });
  // Group 9 Slice A (item 454): the service area is a structured object
  // (states/cities/postal codes, optional radius around a center), not
  // the free-text string the old form stored.
  const [area, setArea] = useState({ states: '', cities: '', postalCodes: '', radiusMiles: '', centerLat: '', centerLng: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const setEquipment = (key, value) => setForm((prev) => ({ ...prev, equipment: { ...prev.equipment, [key]: value } }));

  const submit = async (event) => {
    event.preventDefault();
    // Self-serve onboarding requires driver admission server-side; the form is
    // shown to non-drivers with a hint instead of a dead-end 403.
    if (!canRegister) {
      setError(t('delivery.driver.driverAccessHint'));
      return;
    }
    if (!form.insuranceAcknowledged) {
      setError(t('delivery.driver.insuranceRequired'));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await registerDriverProfile({
        vehicleType: form.vehicleType,
        maxPayloadLbs: form.maxPayloadLbs === '' ? null : Number(form.maxPayloadLbs),
        cargoLengthIn: form.cargoLengthIn === '' ? null : Number(form.cargoLengthIn),
        cargoWidthIn: form.cargoWidthIn === '' ? null : Number(form.cargoWidthIn),
        cargoHeightIn: form.cargoHeightIn === '' ? null : Number(form.cargoHeightIn),
        equipment: form.equipment,
        serviceArea: buildServiceArea(area),
        maxPieces: form.maxPieces === '' ? null : Number(form.maxPieces),
        fragileSupported: form.fragileSupported,
        perishableSupported: form.perishableSupported,
        insuranceExpiresAt: form.insuranceExpiresAt ? new Date(form.insuranceExpiresAt).toISOString() : null,
        availableFrom: form.availableFrom ? new Date(form.availableFrom).toISOString() : null,
        availableUntil: form.availableUntil ? new Date(form.availableUntil).toISOString() : null,
        insuranceAcknowledged: true,
      });
      setDone(true);
      onRegistered(result.profile || null);
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.status'));
    } finally {
      setSubmitting(false);
    }
  };

  if ((profile && profile.approved !== true) || done) {
    return (
      <section className="delivery-panel delivery-onboard" aria-live="polite">
        <div className="delivery-panel__heading">
          <div className="delivery-icon-badge"><Clock3 size={20} aria-hidden="true" /></div>
          <div><h2>{t('delivery.driver.pendingTitle')}</h2><p>{t('delivery.driver.pendingBody')}</p></div>
        </div>
      </section>
    );
  }

  return (
    <section className="delivery-panel delivery-onboard" aria-live="polite">
      <div className="delivery-panel__heading">
        <div className="delivery-icon-badge delivery-icon-badge--green"><Truck size={20} aria-hidden="true" /></div>
        <div><h2>{t('delivery.driver.title')}</h2><p>{t('delivery.driver.body')}</p></div>
      </div>
      <form className="delivery-form" onSubmit={submit} data-track="ui.2f5c44f3da.40">
        {!canRegister && <p className="delivery-alert delivery-alert--error" role="alert">{t('delivery.driver.driverAccessHint')}</p>}
        <fieldset className="delivery-form-fields" disabled={!canRegister}>
        <div className="delivery-options-grid">
          <label className="delivery-field">{t('delivery.ui.vehicleType')}
            <select className="delivery-input" value={form.vehicleType} onChange={(event) => set('vehicleType', event.target.value)}>
              {DRIVER_VEHICLE_TYPES.map((type) => <option key={type} value={type}>{t(`delivery.ui.vehicleTypes.${type}`)}</option>)}
            </select>
          </label>
          <label className="delivery-field">{t('delivery.ui.maxPayloadLbs')}
            <input className="delivery-input" type="number" min="0" step="any" value={form.maxPayloadLbs} onChange={(event) => set('maxPayloadLbs', event.target.value)} />
          </label>
        </div>
        <div className="delivery-options-grid">
          <label className="delivery-field">{t('delivery.ui.cargoLengthIn')}
            <input className="delivery-input" type="number" min="0" step="any" value={form.cargoLengthIn} onChange={(event) => set('cargoLengthIn', event.target.value)} />
          </label>
          <label className="delivery-field">{t('delivery.ui.cargoWidthIn')}
            <input className="delivery-input" type="number" min="0" step="any" value={form.cargoWidthIn} onChange={(event) => set('cargoWidthIn', event.target.value)} />
          </label>
          <label className="delivery-field">{t('delivery.ui.cargoHeightIn')}
            <input className="delivery-input" type="number" min="0" step="any" value={form.cargoHeightIn} onChange={(event) => set('cargoHeightIn', event.target.value)} />
          </label>
        </div>
        <div className="delivery-options-grid">
          <label className="delivery-field">{t('delivery.driver.maxPieces')}
            <input className="delivery-input" type="number" min="1" step="1" value={form.maxPieces} onChange={(event) => set('maxPieces', event.target.value)} />
          </label>
          <label className="delivery-field">{t('delivery.driver.insuranceExpiresAt')}
            <input className="delivery-input" type="date" value={form.insuranceExpiresAt} onChange={(event) => set('insuranceExpiresAt', event.target.value)} />
          </label>
        </div>
        <div className="delivery-options-grid">
          <label className="delivery-field">{t('delivery.ui.availableFrom')}
            <input className="delivery-input" type="date" value={form.availableFrom} onChange={(event) => set('availableFrom', event.target.value)} />
          </label>
          <label className="delivery-field">{t('delivery.ui.availableUntil')}
            <input className="delivery-input" type="date" value={form.availableUntil} onChange={(event) => set('availableUntil', event.target.value)} />
          </label>
        </div>
        <fieldset className="delivery-fieldset">
          <legend>{t('delivery.driver.equipment')}</legend>
          <div className="delivery-checkbox-row">
            {EQUIPMENT_KEYS.map((key) => (
              <label key={key}><input type="checkbox" checked={form.equipment[key] === true} onChange={(event) => setEquipment(key, event.target.checked)} data-track="ui.2f5c44f3da.41" /> {t(`delivery.driver.equipmentKeys.${key}`)}</label>
            ))}
          </div>
        </fieldset>
        <div className="delivery-checkbox-row">
          <label><input type="checkbox" checked={form.fragileSupported} onChange={(event) => set('fragileSupported', event.target.checked)} data-track="ui.2f5c44f3da.42" /> {t('delivery.ui.fragileSupported')}</label>
          <label><input type="checkbox" checked={form.perishableSupported} onChange={(event) => set('perishableSupported', event.target.checked)} data-track="ui.2f5c44f3da.43" /> {t('delivery.ui.perishableSupported')}</label>
        </div>
        <ServiceAreaFields t={t} area={area} onChange={setArea} />
        <label className="delivery-check">
          <input type="checkbox" checked={form.insuranceAcknowledged} onChange={(event) => set('insuranceAcknowledged', event.target.checked)} data-track="ui.2f5c44f3da.44" />
          <span>{t('delivery.driver.insuranceAck')}</span>
        </label>
        {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
        <button type="submit" className="delivery-button delivery-button--primary delivery-button--wide" disabled={submitting} data-track="ui.2f5c44f3da.45">
          {submitting ? <Loader2 size={17} className="delivery-spin" aria-hidden="true" /> : <Truck size={17} aria-hidden="true" />}
          {submitting ? t('delivery.driver.submitting') : t('delivery.driver.submit')}
        </button>
        </fieldset>
      </form>
    </section>
  );
}

function HelperDelivery({ t }) {
  const { user } = useAuth();
  const { i18n } = useTranslation();
  // canDrive is the server's driver-admission flag (legacy helper state or
  // a logistics.ship grant). It drives the open list and the registration
  // form: approved internal drivers in helper mode see open deliveries too
  // (item 11 drops the old client-side internalDriver exclusion). Pure
  // internal drivers (canDrive false) do not receive marketplace jobs from
  // GET /delivery/jobs server-side.
  const [canDrive, setCanDrive] = useState(false);
  const [internalDriver, setInternalDriver] = useState(false);
  const [jobs, setJobs] = useState([]);
  const jobsRef = useRef([]);
  // Group 9 partials Wave 2 Batch M (456, G9-A19, D-537): the feed is
  // paged (limit/offset + total, mirroring the driver payout list). The
  // list mixes the driver's own jobs with marketplace offers in one
  // created_at order, so "My claimed" only shows loaded pages until the
  // driver loads more.
  const [feedTotal, setFeedTotal] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const FEED_PAGE_LIMIT = 100;
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  // Group 9 partials Wave 2 Batch L (455, G9-A15, D-531): the server's
  // reasons for a failed claim, rendered under the error instead of
  // leaving the driver with a generic capacity message.
  const [claimReasons, setClaimReasons] = useState([]);
  // P2-4-F10: the helper's driver profile; claiming stays gated until ops
  // approves a profile (self-serve registration below).
  const [driverProfile, setDriverProfile] = useState(null);
  const [activeVehicle, setActiveVehicle] = useState(null);
  // Group 9 partials Wave 2 Batch M (454/456, G9-A2, D-535): the feed's
  // 50-mile filter needs a location. Precise device location wins when
  // the driver grants it; otherwise the service-area center from the
  // profile applies; otherwise the server falls back to the stored
  // center, and a driver with no center gets the unfiltered feed.
  const [feedGeo, setFeedGeo] = useState(null);
  const profileCenter = useMemo(() => {
    const center = driverProfile?.service_area && typeof driverProfile.service_area === 'object'
      ? driverProfile.service_area.center : null;
    const lat = Number(center?.lat);
    const lng = Number(center?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [driverProfile?.service_area]);
  const feedGeoParams = useCallback(() => feedGeo || profileCenter || {}, [feedGeo, profileCenter]);
  const [onboardingForced, setOnboardingForced] = useState(false);
  const [payouts, setPayouts] = useState(null);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const onboardingRef = useRef(null);

  const loadDriverProfile = useCallback(async () => {
    try {
      const response = await getDriverProfile();
      setDriverProfile(response.profile || null);
      setActiveVehicle(response.activeVehicle || null);
    } catch {
      setDriverProfile(null);
      setActiveVehicle(null);
    }
  }, []);

  useEffect(() => { loadDriverProfile(); }, [loadDriverProfile]);

  const loadJobs = useCallback(async (options = {}) => {
    const append = options.append === true;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const offset = append ? jobsRef.current.length : 0;
      const response = await listDeliveryJobs({ ...feedGeoParams(), limit: FEED_PAGE_LIMIT, offset });
      const nextJobs = response.jobs || [];
      jobsRef.current = append ? [...jobsRef.current, ...nextJobs] : nextJobs;
      setJobs(jobsRef.current);
      setFeedTotal(typeof response.total === 'number' ? response.total : nextJobs.length);
      setCanDrive(response.canDrive === true);
      setInternalDriver(response.internalDriver === true);
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.load'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [t, feedGeoParams]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Group 9 partials Wave 2 Batch M (454/456, G9-A2, D-535): ask once
  // for the device location so the feed's 50-mile filter can engage with
  // precise coordinates. A denial or timeout is silent: the service-area
  // center (client-side above, server-side in the list endpoint) is the
  // fallback, and the claim gate is what stops a far claim.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return;
        setFeedGeo({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => {},
      { timeout: 5000, maximumAge: 600000 },
    );
    return () => { cancelled = true; };
  }, [setFeedGeo]);

  // Earnings summary (item 12): totals by payout status, aggregated
  // client-side from the driver's own payout rows. No new queries.
  useEffect(() => {
    if (!canDrive && !internalDriver) return;
    let cancelled = false;
    listMyDriverPayouts()
      .then((response) => { if (!cancelled) setPayouts(response.payouts || []); })
      .catch(() => { if (!cancelled) setPayouts([]); });
    return () => { cancelled = true; };
  }, [canDrive, internalDriver]);

  const claim = async (id) => {
    setBusyId(String(id));
    setError('');
    setClaimReasons([]);
    try {
      // Group 9 partials Wave 2 Batch M (454/456, G9-A2, D-535): send the
      // feed location with the claim so the server can enforce the
      // 50-mile distance sanity.
      await claimDeliveryJob(id, feedGeoParams());
      await loadJobs();
    } catch (requestError) {
      // P2-4-F10: a driver with no driver profile gets a registration path
      // instead of a dead-end 409.
      if (requestError?.response?.data?.code === 'delivery_driver_onboarding_required') {
        setOnboardingForced(true);
        requestAnimationFrame(() => onboardingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
      // Group 9 partials Wave 2 Batch M (454/456, G9-A2, D-534): a claim
      // refused for a missing service area scrolls the driver to the
      // section that fixes it instead of leaving a bare error.
      if (requestError?.response?.data?.code === 'delivery_service_area_required') {
        requestAnimationFrame(() => document.getElementById('driver-service-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
      setClaimReasons(deliveryClaimReasons(requestError, t));
      setError(deliveryError(requestError, t, 'delivery.errors.claim'));
    } finally { setBusyId(null); }
  };

  const move = async (id, status, proof = {}) => {
    setBusyId(String(id));
    setError('');
    setClaimReasons([]);
    try { await updateDeliveryStatus(id, status, proof); await loadJobs(); } catch (requestError) { setError(deliveryError(requestError, t, 'delivery.errors.status')); } finally { setBusyId(null); }
  };

  // Group 9 Slice B (item 460): passing on an offer records the reason
  // for dispatch. It never blocks the driver: the job stays claimable.
  const decline = async (id, payload) => {
    setBusyId(String(id));
    setError('');
    setClaimReasons([]);
    try { await declineDeliveryJob(id, payload); await loadJobs(); } catch (requestError) { setError(deliveryError(requestError, t, 'delivery.errors.status')); } finally { setBusyId(null); }
  };

  // Group 9 partials Wave 2 Batch M (459, G9-A3, D-536): availability
  // gates the open-jobs feed AND claiming AND operations assignment.
  // An offline driver sees no open jobs and cannot claim (even from a
  // shared link) or be assigned until they go back online.
  const isOnline = driverProfile?.available === true;
  const openJobs = useMemo(() => selectOpenJobs(jobs, { canDrive, available: isOnline, userId: user?.id }), [jobs, canDrive, isOnline, user?.id]);
  const myJobs = useMemo(() => jobs.filter((job) => job.is_assigned_operator === true || String(job.customer_user_id) === String(user?.id)), [jobs, user?.id]);
  const isDriver = canDrive || internalDriver;
  const payoutTotals = useMemo(() => {
    const totals = { paid: 0, pending: 0, voided: 0 };
    for (const payout of payouts || []) {
      const cents = Number(payout.payout_cents) || 0;
      if (payout.status === 'paid') totals.paid += cents;
      else if (payout.status === 'voided') totals.voided += cents;
      else totals.pending += cents;
    }
    return totals;
  }, [payouts]);

  const toggleAvailability = async (checked) => {
    setAvailabilityBusy(true);
    setError('');
    try {
      const response = await setDriverAvailability(checked);
      setDriverProfile(response.profile || null);
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.status'));
    } finally {
      setAvailabilityBusy(false);
    }
  };

  return (
    <div className="delivery-helper-workspace">
      <div className="delivery-helper-toolbar">
        <div><h2>{t(isDriver ? 'delivery.driver.workTitle' : 'delivery.driver.title')}</h2><p>{t(isDriver ? 'delivery.driver.workBody' : 'delivery.driver.body')}</p></div>
        <button type="button" className="delivery-button delivery-button--secondary" onClick={loadJobs} disabled={loading} data-track="ui.2f5c44f3da.46"><RefreshCw size={16} className={loading ? 'delivery-spin' : ''} aria-hidden="true" />{t('delivery.helper.refresh')}</button>
      </div>
      {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
      {claimReasons.length > 0 && (
        <div className="delivery-alert delivery-alert--error" role="alert">
          <p>{t('delivery.errors.claimReasons')}</p>
          <ul>{claimReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}
      {loading ? <div className="delivery-loading"><Loader2 className="delivery-spin" size={24} aria-hidden="true" />{t('delivery.helper.loading')}</div> : (
        <>
          {canDrive && (driverProfile?.approved !== true || onboardingForced) && (
            <div ref={onboardingRef}>
              <DriverOnboarding
                t={t}
                profile={onboardingForced ? null : driverProfile}
                onRegistered={(profile) => { setDriverProfile(profile); setOnboardingForced(false); }}
              />
            </div>
          )}
          {!canDrive && driverProfile?.approved !== true && (
            <div ref={onboardingRef}>
              <DriverOnboarding
                t={t}
                profile={null}
                canRegister={false}
                onRegistered={(profile) => { setDriverProfile(profile); setOnboardingForced(false); }}
              />
            </div>
          )}
          {isDriver && driverProfile?.approved === true && !onboardingForced && (
            <>
              <p className="delivery-onboard-badge"><ShieldCheck size={15} aria-hidden="true" />{t('delivery.driver.verified')}</p>
              <p className="delivery-estimate-defaults">
                {activeVehicle
                  ? t('delivery.driver.activeVehicle', { vehicle: [activeVehicle.make, activeVehicle.model, activeVehicle.plate].filter(Boolean).join(' · ') })
                  : t('delivery.driver.noActiveVehicle')}
              </p>
              <label className="delivery-check delivery-availability">
                <input type="checkbox" checked={driverProfile.available === true} disabled={availabilityBusy} onChange={(event) => toggleAvailability(event.target.checked)} data-track="ui.2f5c44f3da.47" />
                <span>{t('delivery.driver.availability')}</span>
              </label>
              <p className="delivery-estimate-defaults">{t('delivery.driver.availabilityNote')}</p>
              <section className="delivery-earnings" aria-labelledby="delivery-earnings-title">
                <h3 id="delivery-earnings-title">{t('delivery.driver.earningsTitle')}</h3>
                {payouts === null ? (
                  <p className="delivery-estimate-defaults">{t('delivery.helper.loading')}</p>
                ) : payouts.length === 0 ? (
                  <p className="delivery-estimate-defaults">{t('delivery.driver.earningsEmpty')}</p>
                ) : (
                  <dl>
                    <div><dt>{t('delivery.driver.earningsPaid')}</dt><dd>{deliveryMoney(payoutTotals.paid, i18n.language)}</dd></div>
                    <div><dt>{t('delivery.driver.earningsPending')}</dt><dd>{deliveryMoney(payoutTotals.pending, i18n.language)}</dd></div>
                    <div><dt>{t('delivery.driver.earningsVoided')}</dt><dd>{deliveryMoney(payoutTotals.voided, i18n.language)}</dd></div>
                  </dl>
                )}
                {/* Group 9 Slice G (item 500): the driver's record
                  surfaces — payouts, weekly reports, shifts. */}
                <p>
                  <Link to="/delivery/payouts">{t('delivery.driverPayoutHistory.viewHistory')}</Link>
                  {' · '}
                  <Link to="/delivery/weekly-report">{t('delivery.weeklyReport.link')}</Link>
                  {' · '}
                  <Link to="/delivery/shifts">{t('delivery.shift.link')}</Link>
                </p>
              </section>
            </>
          )}
          {driverProfile && (
            <>
              <DriverReadinessChecklist t={t} />
              <DriverProfileEditorSection t={t} profile={driverProfile} onChanged={loadDriverProfile} />
              <DriverServiceAreaSection t={t} profile={driverProfile} onChanged={loadDriverProfile} />
              <DriverVehiclesSection t={t} onChanged={loadDriverProfile} />
              <DriverDocumentsSection t={t} onChanged={loadDriverProfile} />
            </>
          )}
          {canDrive && <section><div className="delivery-section-title"><h3>{t('delivery.helper.open')}</h3><span>{openJobs.length}</span></div>{driverProfile?.approved === true && !isOnline ? <p className="delivery-empty-copy">{t('delivery.driver.offlineNote')}</p> : openJobs.length ? <div className="delivery-job-grid">{openJobs.map((job) => <DeliveryCard key={job.id} job={job} helper onClaim={claim} onDecline={decline} onStatus={move} busyId={busyId} t={t} />)}</div> : <p className="delivery-empty-copy">{t('delivery.helper.empty')}</p>}
            {feedTotal != null && jobs.length > 0 && <p className="delivery-estimate-defaults">{t('delivery.helper.showingOf', { shown: jobs.length, total: feedTotal })}</p>}
            {feedTotal != null && jobs.length < feedTotal && <button type="button" className="delivery-button delivery-button--secondary" onClick={() => loadJobs({ append: true })} disabled={loadingMore || loading} data-track="ui.2f5c44f3da.50">{t('delivery.helper.loadMore')}</button>}
          </section>}
          <section><div className="delivery-section-title"><h3>{t(isDriver ? 'delivery.driver.myClaimed' : 'delivery.helper.myDeliveries')}</h3><span>{myJobs.length}</span></div>{myJobs.length ? <div className="delivery-job-grid">{myJobs.map((job) => <DeliveryCard key={job.id} job={job} helper={isDriver && job.is_assigned_operator === true} onClaim={claim} onDecline={decline} onStatus={move} busyId={busyId} t={t} />)}</div> : !error && <p className="delivery-empty-copy">{t('delivery.ui.noDeliveries')}</p>}</section>
        </>
      )}
    </div>
  );
}

// Trust and pricing info (item 10): only the real pricing model, the
// landing-page FAQ reused verbatim, and proof-of-delivery copy for what the
// product actually offers. No insurance claims anywhere: declared value is
// recorded only, and there is no coverage product in delivery code. Each of
// the 1-2-3 steps gets its one-line explanation here, next to its label.
function DeliveryInfo({ t }) {
  const steps = [
    { label: t('delivery.hero.step1'), detail: t('delivery.howItWorks.step1') },
    { label: t('delivery.hero.step2'), detail: t('delivery.howItWorks.step2') },
    { label: t('delivery.hero.step3'), detail: t('delivery.howItWorks.step3') },
  ];
  return (
    <section className="delivery-info" aria-labelledby="delivery-info-pricing">
      <div className="delivery-info__block">
        <h2 id="delivery-info-pricing">{t('delivery.pricing.title')}</h2>
        <ul>
          {['base', 'extraMile', 'minimum', 'platformFee', 'driverShare', 'size', 'weight'].map((key) => (
            <li key={key}>{t(`delivery.pricing.${key}`)}</li>
          ))}
        </ul>
      </div>
      <div className="delivery-info__block">
        <h2>{t('delivery.hero.stepsLabel')}</h2>
        <ol className="delivery-info__steps">
          {steps.map((step, index) => (
            <li key={step.label}>
              <strong>{index + 1}. {step.label}</strong>
              <span>{step.detail}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="delivery-info__block">
        <h2>{t('delivery.proofInfo.title')}</h2>
        <p>{t('delivery.proofInfo.body')}</p>
        <ul>
          {['pin', 'signature', 'photo', 'recipient_confirmation'].map((type) => (
            <li key={type}>{t(`delivery.proofTypes.${type}`)}</li>
          ))}
        </ul>
        <p>{t('delivery.proofInfo.declaredValue')}</p>
      </div>
      <div className="delivery-info__block">
        <h2>{t('deliveryLanding.faqTitle')}</h2>
        <dl className="delivery-info__faq">
          {[1, 2, 3, 4].map((number) => (
            <div key={number}>
              <dt>{t(`deliveryLanding.faq${number}Q`)}</dt>
              <dd>{t(`deliveryLanding.faq${number}A`)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export default function DeliveryPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [view, setView] = useState('book');
  const [showFullForm, setShowFullForm] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [postedVersion, setPostedVersion] = useState(0);
  const estimateRef = useRef(null);
  const formRef = useRef(null);
  const operations = canAccessOperationsWorkspace(user);
  const operationsRole = ['admin', 'super_admin'].includes(user?.role) || ['sourcing_operator', 'logistics_coordinator', 'warehouse_operator'].includes(user?.logistics_role);

  // A visitor who priced a delivery while signed out and then signed in
  // lands back here with that estimate: open the booking form prefilled.
  useEffect(() => {
    const stored = takeEstimatePrefill();
    if (stored) {
      setPrefill({ ...stored, key: Date.now() });
      setShowFullForm(true);
    }
  }, []);

  useEffect(() => {
    if (showFullForm) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showFullForm]);

  const scrollToEstimate = () => {
    estimateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    estimateRef.current?.querySelector('input')?.focus({ preventScroll: true });
  };

  return (
    <PageShell>
      <PageMeta title={t('delivery.metaTitle')} description={t('delivery.metaDescription')} />
      <div className="delivery-page" dir={i18n.dir()}>
        <nav className="delivery-workspace-tabs" aria-label={t('delivery.title')}>
          <button type="button" className="delivery-button delivery-button--secondary" aria-pressed={view === 'book'} onClick={() => setView('book')} data-track="ui.2f5c44f3da.48">{t('delivery.customer.title')}</button>
          <button type="button" className="delivery-button delivery-button--secondary" aria-pressed={view === 'driving'} onClick={() => setView('driving')} data-track="ui.2f5c44f3da.49">{t('delivery.tabs.driving')}</button>
          {operationsRole && <Link className="delivery-button delivery-button--secondary" to={operations ? '/delivery/operations' : '/logistics/login?mode=operations&next=%2Fdelivery%2Foperations'}>{t(operations ? 'delivery.dispatch.metaTitle' : 'delivery.ui.operationsLogin')}</Link>}
        </nav>
        {view === 'book' ? (
          <>
            <header className="delivery-hero delivery-hero--redesign">
              <div className="delivery-hero__copy">
                <span className="delivery-eyebrow">{t('delivery.eyebrow')}</span>
                <h1>{t('delivery.title')}</h1>
                <p>{t('delivery.hero.subtitle')}</p>
                <ol className="delivery-steps" aria-label={t('delivery.hero.stepsLabel')}>
                  <li>
                    <span className="delivery-steps__number">1</span>
                    <span>{t('delivery.hero.step1')}</span>
                    <Upload size={18} aria-hidden="true" />
                  </li>
                  <li>
                    <span className="delivery-steps__number">2</span>
                    <span>{t('delivery.hero.step2')}</span>
                    <LifeBuoy size={18} aria-hidden="true" />
                  </li>
                  <li>
                    <span className="delivery-steps__number">3</span>
                    <span>{t('delivery.hero.step3')}</span>
                    <Route size={18} aria-hidden="true" />
                  </li>
                </ol>
              </div>
              <EstimateCard
                t={t}
                cardRef={estimateRef}
                onContinue={(nextPrefill) => { setPrefill({ ...nextPrefill, key: Date.now() }); setShowFullForm(true); }}
              />
            </header>
            {showFullForm && (
              <div ref={formRef} className="delivery-booking-form">
                <CustomerDelivery
                  key={prefill?.key || 'default'}
                  t={t}
                  initial={prefill}
                  onPosted={() => setPostedVersion((version) => version + 1)}
                />
              </div>
            )}
            <DeliveryInfo t={t} />
            <MyDeliveries t={t} refreshKey={postedVersion} onBook={scrollToEstimate} />
          </>
        ) : (
          <HelperDelivery t={t} />
        )}
      </div>
    </PageShell>
  );
}
