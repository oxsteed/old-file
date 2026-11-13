import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  DollarSign,
  LifeBuoy,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Route,
  ShieldCheck,
  Truck,
  Upload,
} from 'lucide-react';
import AddressAutocomplete from '../components/AddressAutocomplete';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { useAuth } from '../context/AuthContext';
import { canAccessOperationsWorkspace } from '../utils/logisticsWorkspaces';
import {
  claimDeliveryJob,
  createDelivery,
  estimateDelivery,
  getCustomerTrackingState,
  listDeliveryJobs,
  quoteDelivery,
  updateDeliveryStatus,
  getDriverProfile,
  registerDriverProfile,
  listMyDriverPayouts,
  setDriverAvailability,
  deliveryMoney, deliveryUnit, deliveryError,
} from '../api/delivery';
import '../styles/DeliveryPage.css';

const PACKAGE_OPTIONS = ['small', 'medium', 'large', 'oversized'];
const SERVICE_OPTIONS = ['standard', 'same_day', 'rush'];
const CONTENTS = ['general', 'documents', 'food', 'groceries', 'furniture', 'electronics', 'tools', 'appliances', 'plants', 'parcels'];

function emptyPlace() {
  return { address: '', city: '', state: '', country: '', lat: null, lng: null };
}

function pointFromSuggestion(place, value) {
  return {
    address: place?.addressLine1 || place?.display || value,
    // The full suggestion text: the server geocodes this when the
    // suggestion carries no coordinates (manual fallback shape).
    display: place?.display || value || '',
    city: place?.city || '',
    state: place?.state || '',
    country: String(place?.country || '').toUpperCase(),
    lat: place?.lat,
    lng: place?.lng,
  };
}

// A stop with coordinates is validated locally; a stop with address text
// but no coordinates goes to the server, which geocodes it before pricing.
// Only a stop with neither text nor coordinates is a "choose a suggestion"
// error. The server enforces the US-only rule after geocoding.
function stopsReadyForPricing(origin, destination) {
  return [origin, destination].every((point) => String(point?.address || point?.display || '').trim() || (point?.lat != null && point?.lng != null));
}

function stopsHaveUsCoords(origin, destination) {
  return [origin, destination].every((point) => point?.lat == null || point?.lng == null || (point?.country === 'US' && point?.state));
}

// The server may locate stops the suggestion left coordinate-less. Carry the
// located stops into state so the intake form and the booking send the
// located city/state/country instead of the fallback parse.
function mergeLocatedStop(previous, located) {
  if (!located || located.lat == null || located.lng == null) return previous;
  return {
    ...previous,
    address: located.address || previous.address,
    display: located.display || previous.display,
    city: located.city || previous.city,
    state: located.state || previous.state,
    country: located.country || previous.country,
    lat: Number(located.lat),
    lng: Number(located.lng),
  };
}

function statusLabel(status, t) {
  return t(`delivery.helper.status.${status}`, { defaultValue: String(status || '').replaceAll('_', ' ') });
}

function DeliveryCard({ job, helper, onClaim, onStatus, busyId, t }) {
  const { i18n } = useTranslation();
  const canClaim = helper && job.status === 'posted' && job.marketplace_available === true && job.is_assigned_operator !== true;
  const canUpdate = job.is_assigned_operator === true && ['assigned', 'picked_up', 'in_transit'].includes(job.status);
  const nextStatus = job.status === 'assigned' ? 'picked_up'
    : job.status === 'picked_up' ? 'in_transit' : null;
  const isBusy = busyId !== null;

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
      <div className="delivery-job-card__footer">
        <div>
          <small>{helper ? t('delivery.helper.payout') : t('delivery.customer.total')}</small>
          <strong>{deliveryMoney(helper ? job.driver_payout_cents : job.customer_total_cents, i18n.language, job.currency)}</strong>
          {helper && job.driver_payout_cents == null && <small>{t('delivery.ui.payoutUnavailable')}</small>}
        </div>
        {canClaim && (
          <button type="button" className="delivery-button delivery-button--primary" onClick={() => onClaim(job.id)} disabled={isBusy}>
            {isBusy ? <Loader2 size={16} className="delivery-spin" aria-hidden="true" /> : <Truck size={16} aria-hidden="true" />}
            {t('delivery.helper.claim')}
          </button>
        )}
        {canUpdate && nextStatus && (
            <button type="button" className="delivery-button delivery-button--primary" onClick={() => onStatus(job.id, nextStatus)} disabled={isBusy}>
            {isBusy ? <Loader2 size={16} className="delivery-spin" aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
            {t('delivery.helper.moveTo', { status: statusLabel(nextStatus, t) })}
          </button>
        )}
        {canUpdate && job.status === 'in_transit' && <Link className="delivery-button delivery-button--primary" to={`/delivery/jobs/${job.id}`}>{t('delivery.detail.submitProof')}</Link>}
      </div>
    </article>
  );
}

// Instant estimate defaults: the item size maps to a representative weight and
// standard service, shown next to the size choice so the number is honest.
// The price itself depends on distance and size, not on the exact weight,
// which only has to stay under the size cap.
const SIZE_DEFAULT_WEIGHT_LBS = { small: 5, medium: 25, large: 75, oversized: 150 };
// Size caps in pounds. Mirrors server PACKAGE_TYPES and the locale
// packageTypes labels ("up to 25 lb"); prices never come from here, only
// from the estimate response's server-computed sizePrices.
const PACKAGE_CAPS_LBS = { small: 25, medium: 75, large: 150, oversized: 300 };
const TERMINAL_DELIVERY_STATUSES = ['delivered', 'cancelled', 'returned'];

// The mockup's "Get an instant estimate" card: two stops and an item size
// only. It prices the live route through POST /delivery/estimate, which
// creates no quote row. Booking still goes through the full intake form and
// its bookable quote.
function EstimateCard({ t, onContinue, cardRef }) {
  const { i18n } = useTranslation();
  const [origin, setOrigin] = useState(emptyPlace);
  const [destination, setDestination] = useState(emptyPlace);
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [size, setSize] = useState('small');
  const [estimate, setEstimate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const getEstimate = async (event) => {
    event.preventDefault();
    setError('');
    if (!stopsReadyForPricing(origin, destination)) {
      setError(t('delivery.customer.selectAddress'));
      return;
    }
    if (!stopsHaveUsCoords(origin, destination)) {
      setError(t('delivery.ui.usOnly'));
      return;
    }
    setBusy(true);
    try {
      const response = await estimateDelivery({
        origin,
        destination,
        packageType: size,
        weightLbs: SIZE_DEFAULT_WEIGHT_LBS[size],
        serviceLevel: 'standard',
      });
      setEstimate(response.estimate);
      if (response.estimate?.origin) setOrigin((previous) => mergeLocatedStop(previous, response.estimate.origin));
      if (response.estimate?.destination) setDestination((previous) => mergeLocatedStop(previous, response.estimate.destination));
    } catch (requestError) {
      setEstimate(null);
      setError(deliveryError(requestError, t, 'delivery.errors.quote'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="delivery-estimate-card" ref={cardRef} aria-labelledby="delivery-estimate-title">
      <h2 id="delivery-estimate-title">{t('delivery.estimate.title')}</h2>
      <form onSubmit={getEstimate} className="delivery-form">
        <label className="delivery-field">
          <span>{t('delivery.customer.pickup')}</span>
          <AddressAutocomplete
            value={originText}
            onChange={(value) => { setOriginText(value); setOrigin({ ...emptyPlace(), address: value, display: value }); setEstimate(null); }}
            onSelect={(place) => setOrigin(pointFromSuggestion(place, originText))}
            placeholder={t('delivery.customer.pickupPlaceholder')}
            ariaLabel={t('delivery.customer.pickup')}
            inputClassName="delivery-input"
            selectFullAddress
            required
          />
        </label>
        <label className="delivery-field">
          <span>{t('delivery.customer.dropoff')}</span>
          <AddressAutocomplete
            value={destinationText}
            onChange={(value) => { setDestinationText(value); setDestination({ ...emptyPlace(), address: value, display: value }); setEstimate(null); }}
            onSelect={(place) => setDestination(pointFromSuggestion(place, destinationText))}
            placeholder={t('delivery.customer.dropoffPlaceholder')}
            ariaLabel={t('delivery.customer.dropoff')}
            inputClassName="delivery-input"
            selectFullAddress
            required
          />
        </label>
        <label className="delivery-field">
          <span>{t('delivery.estimate.itemSize')}</span>
          <select className="delivery-input" value={size} onChange={(event) => { setSize(event.target.value); setEstimate(null); }}>
            {PACKAGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {estimate?.sizePrices?.[option]
                  ? `${t(`delivery.packageTypes.${option}`)} — ${deliveryMoney(estimate.sizePrices[option].customerTotalCents, i18n.language, estimate.pricing.currency)}`
                  : t(`delivery.packageTypes.${option}`)}
              </option>
            ))}
          </select>
        </label>
        <p className="delivery-estimate-defaults">
          {t('delivery.estimate.defaults', { weight: deliveryUnit(SIZE_DEFAULT_WEIGHT_LBS[size], 'pound', i18n.language), cap: deliveryUnit(PACKAGE_CAPS_LBS[size], 'pound', i18n.language) })}
        </p>
        {estimate ? (
          <div className="delivery-estimate-result" aria-live="polite">
            <div className="delivery-estimate-total">
              <span>{t('delivery.customer.total')}</span>
              <strong>{deliveryMoney(estimate.pricing.cents.customerTotal, i18n.language, estimate.pricing.currency)}</strong>
            </div>
            <dl className="delivery-estimate-facts">
              <div><dt>{t('delivery.estimate.distance')}</dt><dd>{deliveryUnit(estimate.route.distanceMiles, 'mile', i18n.language)}</dd></div>
              <div><dt>{t('delivery.estimate.routeTime')}</dt><dd>{deliveryUnit(estimate.route.durationMinutes, 'minute', i18n.language)}</dd></div>
            </dl>
            <RoutePreview origin={estimate.origin} destination={estimate.destination} t={t} />
          </div>
        ) : (
          <p className="delivery-estimate-hint">{t('delivery.customer.quoteHint')}</p>
        )}
        {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
        <button type="submit" className="delivery-button delivery-button--primary delivery-button--wide" disabled={busy}>
          {busy ? <Loader2 size={17} className="delivery-spin" aria-hidden="true" /> : <DollarSign size={17} aria-hidden="true" />}
          {t('delivery.estimate.get')}
        </button>
        {estimate && (
          <button
            type="button"
            className="delivery-button delivery-button--secondary delivery-button--wide"
            onClick={() => onContinue({ origin, destination, originText, destinationText, packageType: size, weightLbs: String(SIZE_DEFAULT_WEIGHT_LBS[size]) })}
          >
            {t('delivery.estimate.continue')}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
      </form>
    </section>
  );
}

// Route preview drawn from real origin/destination coordinates: a stylized
// street grid with a route line and A/B pins. No map library, no placeholder
// coordinates. It takes either a job (with origin_lat/lng fields, plus live
// driver tracking when the job is trackable) or plain origin/destination
// points, so the instant-estimate panel can reuse it with the estimate's
// located stops. When the driver is live, the approximate driver position
// from the customer tracking state is shown as a marker.
function RoutePreview({ job, origin: originPoint, destination: destinationPoint, t }) {
  const gradientId = useId();
  const [driverPoint, setDriverPoint] = useState(null);
  const trackable = Boolean(job) && ['assigned', 'picked_up', 'in_transit', 'approaching'].includes(job.status);

  useEffect(() => {
    if (!trackable) return undefined;
    let cancelled = false;
    getCustomerTrackingState(job.id)
      .then((response) => { if (!cancelled) setDriverPoint(response.state?.approximateArea || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [job?.id, trackable]);

  const origin = job
    ? { lat: Number(job.origin_lat), lng: Number(job.origin_lng) }
    : { lat: Number(originPoint?.lat), lng: Number(originPoint?.lng) };
  const destination = job
    ? { lat: Number(job.destination_lat), lng: Number(job.destination_lng) }
    : { lat: Number(destinationPoint?.lat), lng: Number(destinationPoint?.lng) };
  if (![origin.lat, origin.lng, destination.lat, destination.lng].every(Number.isFinite)) return null;

  const width = 320;
  const height = 180;
  const pad = 36;
  const midLat = (origin.lat + destination.lat) / 2;
  const midLng = (origin.lng + destination.lng) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const rawOrigin = { x: (origin.lng - midLng) * kx, y: -(origin.lat - midLat) };
  const rawDestination = { x: (destination.lng - midLng) * kx, y: -(destination.lat - midLat) };
  const spanX = Math.max(Math.abs(rawOrigin.x - rawDestination.x), 1e-6);
  const spanY = Math.max(Math.abs(rawOrigin.y - rawDestination.y), 1e-6);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const centerX = (rawOrigin.x + rawDestination.x) / 2;
  const centerY = (rawOrigin.y + rawDestination.y) / 2;
  const project = (lat, lng) => ({
    x: width / 2 + ((lng - midLng) * kx - centerX) * scale,
    y: height / 2 + (-(lat - midLat) - centerY) * scale,
  });
  const a = project(origin.lat, origin.lng);
  const bRaw = project(destination.lat, destination.lng);
  // Separate coincident stops so both pins stay visible.
  const sameStop = Math.hypot(a.x - bRaw.x, a.y - bRaw.y) < 26;
  const b = sameStop ? { x: Math.min(bRaw.x + 30, width - pad), y: Math.max(bRaw.y - 22, pad) } : bRaw;
  const bend = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 16 };
  const driver = driverPoint && Number.isFinite(Number(driverPoint.approxLat)) && Number.isFinite(Number(driverPoint.approxLng))
    ? project(Number(driverPoint.approxLat), Number(driverPoint.approxLng))
    : null;

  return (
    <figure className="delivery-route-preview">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('delivery.routePreview.label')}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#60a5fa" />
          </linearGradient>
        </defs>
        <rect width={width} height={height} className="delivery-route-preview__base" />
        <g className="delivery-route-preview__streets" aria-hidden="true">
          {[0.2, 0.4, 0.6, 0.8].map((fraction) => (
            <line key={`v${fraction}`} x1={width * fraction} y1="0" x2={width * fraction} y2={height} />
          ))}
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line key={`h${fraction}`} x1="0" y1={height * fraction} x2={width} y2={height * fraction} />
          ))}
          <line x1="0" y1={height} x2={width} y2="0" />
          <line x1="0" y1={height * 0.8} x2={width} y2={height * 0.2} />
        </g>
        <path d={`M ${a.x} ${a.y} Q ${bend.x} ${bend.y} ${b.x} ${b.y}`} fill="none" stroke={`url(#${gradientId})`} strokeWidth="4" strokeLinecap="round" />
        {driver && (
          <g>
            <circle cx={driver.x} cy={driver.y} r="10" className="delivery-route-preview__driver-ring" />
            <circle cx={driver.x} cy={driver.y} r="5" className="delivery-route-preview__driver" />
            <title>{t('delivery.routePreview.driver')}</title>
          </g>
        )}
        <g>
          <circle cx={a.x} cy={a.y} r="11" className="delivery-route-preview__pin-a" />
          <text x={a.x} y={a.y + 4} textAnchor="middle" className="delivery-route-preview__pin-label">A</text>
        </g>
        <g>
          <circle cx={b.x} cy={b.y} r="11" className="delivery-route-preview__pin-b" />
          <text x={b.x} y={b.y + 4} textAnchor="middle" className="delivery-route-preview__pin-label">B</text>
        </g>
      </svg>
      <figcaption>
        <span>{t('delivery.routePreview.title')}</span>
        <small>{t('delivery.routePreview.schematic')}</small>
      </figcaption>
    </figure>
  );
}

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
          <button type="button" role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'is-active' : ''} onClick={() => setTab('active')}>
            {t('delivery.myDeliveries.active')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'completed'} className={tab === 'completed' ? 'is-active' : ''} onClick={() => setTab('completed')}>
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
            <button type="button" className="delivery-button delivery-button--outline" onClick={onBook}>
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
  }), [contentsCategory, declaredValue, deliveryWindow, destination, destinationContact, dimensions, fragile, handlingRequirements, itemDescription, notes, origin, originContact, packageType, perishable, pieces, pickupWindow, proofPreference, serviceLevel, weightLbs]);

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
        <form onSubmit={getQuote} className="delivery-form">
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
              <label><input type="radio" name="delivery-timing" checked={timing === 'asap'} onChange={() => { setTiming('asap'); setQuote(null); }} /> {t('delivery.customer.timingAsap')}</label>
              <label><input type="radio" name="delivery-timing" checked={timing === 'scheduled'} onChange={() => { setTiming('scheduled'); setQuote(null); }} /> {t('delivery.customer.timingScheduled')}</label>
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
            <label><input type="checkbox" checked={fragile} onChange={(event) => setFragile(event.target.checked)} /> {t('delivery.operations.fragile')}</label>
            <label><input type="checkbox" checked={perishable} onChange={(event) => setPerishable(event.target.checked)} /> {t('delivery.operations.perishable')}</label>
            <label className="delivery-field"><span>{t('delivery.operations.proof')}</span><select className="delivery-input" value={proofPreference} onChange={(event) => setProofPreference(event.target.value)}><option value="recipient_confirmation">{t('delivery.proofTypes.recipient_confirmation')}</option><option value="pin">{t('delivery.proofTypes.pin')}</option><option value="signature">{t('delivery.proofTypes.signature')}</option><option value="photo">{t('delivery.proofTypes.photo')}</option></select></label>
          </div>
          <fieldset className="delivery-fieldset"><legend>{t('delivery.operations.handling')}</legend><div className="delivery-checkbox-row">
            {['stairs', 'loadingHelp', 'dolly', 'liftgate', 'parkingRequired', 'temperatureControl'].map((key) => <label key={key}><input type="checkbox" checked={handlingRequirements[key] === true} onChange={(event) => setHandlingRequirements((previous) => ({ ...previous, [key]: event.target.checked }))} /> {t(`delivery.operations.${key}`)}</label>)}
          </div></fieldset>
          <label className="delivery-field">
            <span>{t('delivery.customer.notes')}</span>
            <textarea className="delivery-input delivery-input--textarea" value={notes} maxLength={2000} onChange={(event) => { setNotes(event.target.value); setOriginContact((previous) => ({ ...previous, instructions: event.target.value })); setDestinationContact((previous) => ({ ...previous, instructions: event.target.value })); }} placeholder={t('delivery.customer.notesPlaceholder')} />
          </label>
          {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
          <button type="submit" className="delivery-button delivery-button--primary delivery-button--wide" disabled={busy}>
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
            <button type="button" className="delivery-button delivery-button--primary delivery-button--wide" onClick={postDelivery} disabled={busy}>
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

// P2-4-F10: self-serve driver onboarding. Helpers without an ops-provisioned
// driver profile register their own capability profile here; the profile is
// created pending operations approval, and claiming stays gated until then.
function DriverOnboarding({ t, profile, onRegistered, canRegister = true }) {
  const [form, setForm] = useState({
    vehicleType: 'car',
    maxPayloadLbs: '',
    cargoLengthIn: '',
    cargoWidthIn: '',
    cargoHeightIn: '',
    equipment: '',
    serviceArea: '',
    insuranceAcknowledged: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    // Self-serve onboarding requires helper mode server-side; the form is
    // shown to non-helpers with a hint instead of a dead-end 403.
    if (!canRegister) {
      setError(t('delivery.driver.helperModeHint'));
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
        serviceArea: form.serviceArea,
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
      <form className="delivery-form" onSubmit={submit}>
        {!canRegister && <p className="delivery-alert delivery-alert--error" role="alert">{t('delivery.driver.helperModeHint')}</p>}
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
        <label className="delivery-field">{t('delivery.driver.equipment')}
          <input className="delivery-input" value={form.equipment} onChange={(event) => set('equipment', event.target.value)} placeholder={t('delivery.driver.equipmentPlaceholder')} />
        </label>
        <label className="delivery-field">{t('delivery.driver.serviceArea')}
          <input className="delivery-input" value={form.serviceArea} onChange={(event) => set('serviceArea', event.target.value)} placeholder={t('delivery.driver.serviceAreaPlaceholder')} />
        </label>
        <label className="delivery-check">
          <input type="checkbox" checked={form.insuranceAcknowledged} onChange={(event) => set('insuranceAcknowledged', event.target.checked)} />
          <span>{t('delivery.driver.insuranceAck')}</span>
        </label>
        {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
        <button type="submit" className="delivery-button delivery-button--primary delivery-button--wide" disabled={submitting}>
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
  // helperMode is the server's helper flag (default_mode in HELPER_MODES or
  // role helper). It drives the open list: approved internal drivers in
  // helper mode see open deliveries too (item 11 drops the old client-side
  // internalDriver exclusion). Pure internal drivers (helperMode false) do
  // not receive marketplace jobs from GET /delivery/jobs server-side.
  const [helperMode, setHelperMode] = useState(false);
  const [internalDriver, setInternalDriver] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  // P2-4-F10: the helper's driver profile; claiming stays gated until ops
  // approves a profile (self-serve registration below).
  const [driverProfile, setDriverProfile] = useState(null);
  const [onboardingForced, setOnboardingForced] = useState(false);
  const [payouts, setPayouts] = useState(null);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const onboardingRef = useRef(null);

  const loadDriverProfile = useCallback(async () => {
    try {
      const response = await getDriverProfile();
      setDriverProfile(response.profile || null);
    } catch {
      setDriverProfile(null);
    }
  }, []);

  useEffect(() => { loadDriverProfile(); }, [loadDriverProfile]);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await listDeliveryJobs();
      setJobs(response.jobs || []);
      setHelperMode(response.helper === true);
      setInternalDriver(response.internalDriver === true);
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Earnings summary (item 12): totals by payout status, aggregated
  // client-side from the driver's own payout rows. No new queries.
  useEffect(() => {
    if (!helperMode && !internalDriver) return;
    let cancelled = false;
    listMyDriverPayouts()
      .then((response) => { if (!cancelled) setPayouts(response.payouts || []); })
      .catch(() => { if (!cancelled) setPayouts([]); });
    return () => { cancelled = true; };
  }, [helperMode, internalDriver]);

  const claim = async (id) => {
    setBusyId(String(id));
    setError('');
    try {
      await claimDeliveryJob(id);
      await loadJobs();
    } catch (requestError) {
      // P2-4-F10: a helper with no driver profile gets a registration path
      // instead of a dead-end 409.
      if (requestError?.response?.data?.code === 'delivery_driver_onboarding_required') {
        setOnboardingForced(true);
        requestAnimationFrame(() => onboardingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
      setError(deliveryError(requestError, t, 'delivery.errors.claim'));
    } finally { setBusyId(null); }
  };

  const move = async (id, status, proof = {}) => {
    setBusyId(String(id));
    setError('');
    try { await updateDeliveryStatus(id, status, proof); await loadJobs(); } catch (requestError) { setError(deliveryError(requestError, t, 'delivery.errors.status')); } finally { setBusyId(null); }
  };

  const openJobs = useMemo(() => helperMode ? jobs.filter((job) => job.status === 'posted' && job.marketplace_available === true && String(job.customer_user_id) !== String(user?.id)) : [], [jobs, helperMode, user?.id]);
  const myJobs = useMemo(() => jobs.filter((job) => job.is_assigned_operator === true || String(job.customer_user_id) === String(user?.id)), [jobs, user?.id]);
  const isDriver = helperMode || internalDriver;
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
        <button type="button" className="delivery-button delivery-button--secondary" onClick={loadJobs} disabled={loading}><RefreshCw size={16} className={loading ? 'delivery-spin' : ''} aria-hidden="true" />{t('delivery.helper.refresh')}</button>
      </div>
      {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
      {loading ? <div className="delivery-loading"><Loader2 className="delivery-spin" size={24} aria-hidden="true" />{t('delivery.helper.loading')}</div> : (
        <>
          {helperMode && (driverProfile?.approved !== true || onboardingForced) && (
            <div ref={onboardingRef}>
              <DriverOnboarding
                t={t}
                profile={onboardingForced ? null : driverProfile}
                onRegistered={(profile) => { setDriverProfile(profile); setOnboardingForced(false); }}
              />
            </div>
          )}
          {!helperMode && driverProfile?.approved !== true && (
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
              <label className="delivery-check delivery-availability">
                <input type="checkbox" checked={driverProfile.available === true} disabled={availabilityBusy} onChange={(event) => toggleAvailability(event.target.checked)} />
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
              </section>
            </>
          )}
          {helperMode && <section><div className="delivery-section-title"><h3>{t('delivery.helper.open')}</h3><span>{openJobs.length}</span></div>{openJobs.length ? <div className="delivery-job-grid">{openJobs.map((job) => <DeliveryCard key={job.id} job={job} helper onClaim={claim} onStatus={move} busyId={busyId} t={t} />)}</div> : <p className="delivery-empty-copy">{t('delivery.helper.empty')}</p>}</section>}
          <section><div className="delivery-section-title"><h3>{t(isDriver ? 'delivery.driver.myClaimed' : 'delivery.helper.myDeliveries')}</h3><span>{myJobs.length}</span></div>{myJobs.length ? <div className="delivery-job-grid">{myJobs.map((job) => <DeliveryCard key={job.id} job={job} helper={isDriver && job.is_assigned_operator === true} onClaim={claim} onStatus={move} busyId={busyId} t={t} />)}</div> : !error && <p className="delivery-empty-copy">{t('delivery.ui.noDeliveries')}</p>}</section>
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
          <button type="button" className="delivery-button delivery-button--secondary" aria-pressed={view === 'book'} onClick={() => setView('book')}>{t('delivery.customer.title')}</button>
          <button type="button" className="delivery-button delivery-button--secondary" aria-pressed={view === 'driving'} onClick={() => setView('driving')}>{t('delivery.tabs.driving')}</button>
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
