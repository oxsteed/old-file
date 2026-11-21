import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, DollarSign, Loader2 } from 'lucide-react';
import AddressAutocomplete from '../AddressAutocomplete';
import TurnstileWidget from '../TurnstileWidget';
import { useCapabilities } from '../../hooks/useCapabilities';
import {
  estimateDelivery,
  getCustomerTrackingState,
  deliveryMoney, deliveryUnit, deliveryError,
} from '../../api/delivery';
import '../../styles/DeliveryPage.css';

// Shared instant-estimate pieces for the signed-in delivery page and the
// public /delivery landing page.

// A signed-out visitor's estimate is carried across sign-in in this tab only
// (sessionStorage), so the booking form opens prefilled after they return.
// Nothing is sent to the server until they book. Expires after 30 minutes.
export const ESTIMATE_PREFILL_KEY = 'oxsteed.delivery.estimatePrefill';
const ESTIMATE_PREFILL_TTL_MS = 30 * 60 * 1000;

export function storeEstimatePrefill(prefill, storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    storage?.setItem(ESTIMATE_PREFILL_KEY, JSON.stringify({ savedAt: now, prefill }));
    return true;
  } catch {
    return false;
  }
}

export function takeEstimatePrefill(storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    const raw = storage?.getItem(ESTIMATE_PREFILL_KEY);
    if (!raw) return null;
    storage.removeItem(ESTIMATE_PREFILL_KEY);
    const parsed = JSON.parse(raw);
    const prefill = parsed?.prefill;
    if (!prefill || typeof prefill !== 'object' || !(now - Number(parsed.savedAt) < ESTIMATE_PREFILL_TTL_MS)) return null;
    if (!PACKAGE_OPTIONS.includes(prefill.packageType)) return null;
    return prefill;
  } catch {
    return null;
  }
}

export const PACKAGE_OPTIONS = ['small', 'medium', 'large', 'oversized'];

export function emptyPlace() {
  return { address: '', city: '', state: '', country: '', lat: null, lng: null };
}

export function pointFromSuggestion(place, value) {
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
export function stopsReadyForPricing(origin, destination) {
  return [origin, destination].every((point) => String(point?.address || point?.display || '').trim() || (point?.lat != null && point?.lng != null));
}

export function stopsHaveUsCoords(origin, destination) {
  return [origin, destination].every((point) => point?.lat == null || point?.lng == null || (point?.country === 'US' && point?.state));
}

// The server may locate stops the suggestion left coordinate-less. Carry the
// located stops into state so the intake form and the booking send the
// located city/state/country instead of the fallback parse.
export function mergeLocatedStop(previous, located) {
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

// Instant estimate defaults: the item size maps to a representative weight and
// standard service, shown next to the size choice so the number is honest.
// The price itself depends on distance and size, not on the exact weight,
// which only has to stay under the size cap.
export const SIZE_DEFAULT_WEIGHT_LBS = { small: 5, medium: 25, large: 75, oversized: 150 };
// Size caps in pounds. Mirrors server PACKAGE_TYPES and the locale
// packageTypes labels ("up to 25 lb"); prices never come from here, only
// from the estimate response's server-computed sizePrices.
export const PACKAGE_CAPS_LBS = { small: 25, medium: 75, large: 150, oversized: 300 };

// The estimate headline: an honest price range for the chosen size, from
// standard (low) to rush (high) service, both priced by the server for this
// route. One price when the two match (for example at the minimum fare).
export function EstimatePrice({ t, estimate, size }) {
  const { i18n } = useTranslation();
  const entry = estimate?.sizePrices?.[size];
  const exact = entry?.customerTotalCents ?? estimate?.pricing?.cents?.customerTotal;
  const min = entry?.range?.minCents ?? exact;
  const max = entry?.range?.maxCents ?? exact;
  const money = (cents) => deliveryMoney(cents, i18n.language, estimate?.pricing?.currency);
  return (
    <div className="delivery-estimate-total">
      <span>{t('delivery.estimate.priceRangeLabel')}</span>
      <strong data-testid="delivery-estimate-range">
        <bdi>{min === max ? money(min) : t('delivery.estimate.priceRange', { min: money(min), max: money(max) })}</bdi>
      </strong>
      {min !== max && <small>{t('delivery.estimate.rangeNote')}</small>}
    </div>
  );
}

// The mockup's "Get an instant estimate" card: two stops and an item size
// only. It prices the live route through POST /delivery/estimate, which
// creates no quote row. Booking still goes through the full intake form and
// its bookable quote.
export function EstimateCard({
  t,
  onContinue,
  cardRef,
  requestEstimate = estimateDelivery,
  continueLabel,
  continueNote,
  captcha = null,
  onCaptchaRequired,
}) {
  const { i18n } = useTranslation();
  const [origin, setOrigin] = useState(emptyPlace);
  const [destination, setDestination] = useState(emptyPlace);
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [size, setSize] = useState('small');
  const [estimate, setEstimate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Bot check for the public estimate: shown only when the server's captcha
  // config is enabled. Each token is single-use, so the widget is reset after
  // every request; an expired token is dropped and the visitor re-checks.
  const captchaOn = Boolean(captcha?.enabled);
  const captchaRef = useRef(null);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaFailed, setCaptchaFailed] = useState(false);
  // G-29: estimates price a live route through the geo provider. Without
  // one every submit fails, so the form is disabled with an honest
  // unavailable state instead of looking live. Driven by the existing
  // geocoding capability flag; no provider keys are set here.
  const { isAvailable, loading: capabilitiesLoading } = useCapabilities();
  const estimatesUnavailable = !capabilitiesLoading && !isAvailable('geocoding');
  const standardCents = estimate ? (estimate.sizePrices?.[size]?.customerTotalCents ?? estimate.pricing.cents.customerTotal) : null;
  const money = (cents) => deliveryMoney(cents, i18n.language, estimate?.pricing?.currency);

  const getEstimate = async (event) => {
    event.preventDefault();
    setError('');
    if (estimatesUnavailable) {
      setError(t('delivery.estimate.unavailable'));
      return;
    }
    if (!stopsReadyForPricing(origin, destination)) {
      setError(t('delivery.customer.selectAddress'));
      return;
    }
    if (!stopsHaveUsCoords(origin, destination)) {
      setError(t('delivery.ui.usOnly'));
      return;
    }
    if (captchaOn && (!captcha.siteKey || captchaFailed)) {
      setError(t('delivery.captcha.unavailable'));
      return;
    }
    if (captchaOn && !captchaToken) {
      setError(t('delivery.captcha.required'));
      return;
    }
    setBusy(true);
    try {
      const response = await requestEstimate({
        origin,
        destination,
        packageType: size,
        weightLbs: SIZE_DEFAULT_WEIGHT_LBS[size],
        serviceLevel: 'standard',
        ...(captchaOn ? { captchaToken } : {}),
      });
      setEstimate(response.estimate);
      if (response.estimate?.origin) setOrigin((previous) => mergeLocatedStop(previous, response.estimate.origin));
      if (response.estimate?.destination) setDestination((previous) => mergeLocatedStop(previous, response.estimate.destination));
    } catch (requestError) {
      setEstimate(null);
      const captchaCode = requestError?.response?.data?.error;
      if (captchaCode === 'captcha_required' || captchaCode === 'captcha_failed') {
        setError(t(captchaOn ? 'delivery.captcha.failed' : 'delivery.captcha.required'));
        // The server enforces a check this page did not know about yet.
        if (!captchaOn) onCaptchaRequired?.();
      } else {
        setError(deliveryError(requestError, t, 'delivery.errors.quote'));
      }
    } finally {
      setBusy(false);
      if (captchaOn) {
        setCaptchaToken('');
        captchaRef.current?.reset();
      }
    }
  };

  return (
    <section className="delivery-estimate-card" ref={cardRef} aria-labelledby="delivery-estimate-title">
      <h2 id="delivery-estimate-title">{t('delivery.estimate.title')}</h2>
      {estimatesUnavailable && (
        <p className="delivery-alert delivery-alert--error" role="alert">
          {t('delivery.estimate.unavailable')}
        </p>
      )}
      <form onSubmit={getEstimate} className="delivery-form" data-track="ui.2b39ea124a.1">
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
            disabled={estimatesUnavailable}
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
            disabled={estimatesUnavailable}
          />
        </label>
        <label className="delivery-field">
          <span>{t('delivery.estimate.itemSize')}</span>
          <select className="delivery-input" value={size} onChange={(event) => { setSize(event.target.value); }} disabled={estimatesUnavailable}>
            {PACKAGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {estimate?.sizePrices?.[option]
                  ? `${t(`delivery.packageTypes.${option}`)} · ${deliveryMoney(estimate.sizePrices[option].customerTotalCents, i18n.language, estimate.pricing.currency)}`
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
            <EstimatePrice t={t} estimate={estimate} size={size} />
            <dl className="delivery-estimate-facts">
              <div><dt>{t('delivery.estimate.standardTotal')}</dt><dd>{money(standardCents)}</dd></div>
              <div><dt>{t('delivery.estimate.distance')}</dt><dd>{deliveryUnit(estimate.route.distanceMiles, 'mile', i18n.language)}</dd></div>
              <div><dt>{t('delivery.estimate.routeTime')}</dt><dd>{deliveryUnit(estimate.route.durationMinutes, 'minute', i18n.language)}</dd></div>
            </dl>
            <RoutePreview origin={estimate.origin} destination={estimate.destination} t={t} />
          </div>
        ) : (
          <>
            <p className="delivery-estimate-hint">{t('delivery.customer.quoteHint')}</p>
            <RoutePreview sample t={t} />
          </>
        )}
        {captchaOn && captcha.siteKey && (
          <div className="delivery-captcha">
            <span className="delivery-estimate-defaults">{t('delivery.captcha.label')}</span>
            <TurnstileWidget
              ref={captchaRef}
              siteKey={captcha.siteKey}
              language={i18n.language}
              onToken={(token) => { setCaptchaToken(token); setCaptchaFailed(false); }}
              onExpire={() => setCaptchaToken('')}
              onError={() => { setCaptchaToken(''); setCaptchaFailed(true); }}
            />
          </div>
        )}
        {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
        <button type="submit" className="delivery-button delivery-button--primary delivery-button--wide" disabled={busy || estimatesUnavailable} data-track="ui.2b39ea124a.2">
          {busy ? <Loader2 size={17} className="delivery-spin" aria-hidden="true" /> : <DollarSign size={17} aria-hidden="true" />}
          {t('delivery.estimate.get')}
        </button>
        {estimate && (
          <button
            type="button"
            className="delivery-button delivery-button--secondary delivery-button--wide"
            onClick={() => onContinue({ origin, destination, originText, destinationText, packageType: size, weightLbs: String(SIZE_DEFAULT_WEIGHT_LBS[size]) })} data-track="ui.2b39ea124a.3"
          >
            {continueLabel || t('delivery.estimate.continue')}
            <ArrowRight size={16} aria-hidden="true" className="delivery-flip-rtl" />
          </button>
        )}
        {estimate && continueNote && <p className="delivery-estimate-defaults">{continueNote}</p>}
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
// Illustrative stops for the sample preview shown before any estimate exists.
// Labelled as a sample in the caption; never presented as the user's route.
const SAMPLE_ORIGIN = { lat: 40.7484, lng: -73.9967 };
const SAMPLE_DESTINATION = { lat: 40.7308, lng: -73.9845 };

export function RoutePreview({ job, origin: sampleOrigin, destination: sampleDestination, sample = false, t }) {
  const originPoint = sample ? SAMPLE_ORIGIN : sampleOrigin;
  const destinationPoint = sample ? SAMPLE_DESTINATION : sampleDestination;
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
    <figure className={`delivery-route-preview${sample ? ' delivery-route-preview--sample' : ''}`} data-sample={sample ? 'true' : undefined}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t(sample ? 'delivery.routePreview.sampleLabel' : 'delivery.routePreview.label')}>
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
        <small>{t(sample ? 'delivery.routePreview.sample' : 'delivery.routePreview.schematic')}</small>
      </figcaption>
    </figure>
  );
}
