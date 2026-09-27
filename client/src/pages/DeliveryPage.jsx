import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  DollarSign,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import AddressAutocomplete from '../components/AddressAutocomplete';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { useAuth } from '../context/AuthContext';
import {
  claimDeliveryJob,
  createDelivery,
  listDeliveryJobs,
  quoteDelivery,
  updateDeliveryStatus,
} from '../api/delivery';
import '../styles/DeliveryPage.css';

const PACKAGE_OPTIONS = ['small', 'medium', 'large', 'oversized'];
const SERVICE_OPTIONS = ['standard', 'same_day', 'rush'];
const HELPER_MODES = new Set([
  'helper',
  'helper_pro',
  'business_owner',
  'business_manager',
  'business_representative',
  'business_employee',
]);

function isHelper(user) {
  return HELPER_MODES.has(user?.default_mode) || user?.role === 'helper';
}

function emptyPlace() {
  return { address: '', city: '', state: '', country: '', lat: null, lng: null };
}

function pointFromSuggestion(place, value) {
  return {
    address: place?.addressLine1 || place?.display || value,
    city: place?.city || '',
    state: place?.state || '',
    country: place?.country || '',
    lat: place?.lat,
    lng: place?.lng,
  };
}

function currency(cents, currencyCode = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
    }).format(Number(cents || 0) / 100);
  } catch {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }
}

function apiMessage(error, fallback) {
  const serverError = error?.response?.data?.error;
  return (typeof serverError === 'string' ? serverError : serverError?.message)
    || error?.response?.data?.message
    || fallback;
}

function statusLabel(status, t) {
  return t(`delivery.helper.status.${status}`, { defaultValue: String(status || '').replaceAll('_', ' ') });
}

function DeliveryCard({ job, helper, onClaim, onStatus, busyId, t }) {
  const canClaim = helper && job.status === 'posted';
  const canUpdate = helper && ['assigned', 'picked_up', 'in_transit'].includes(job.status) && job.helper_user_id;
  const nextStatus = job.status === 'assigned' ? 'picked_up'
    : job.status === 'picked_up' ? 'in_transit'
      : job.status === 'in_transit' ? 'delivered' : null;
  const isBusy = busyId === String(job.id);

  return (
    <article className="delivery-job-card">
      <div className="delivery-job-card__topline">
        <div>
          <span className="delivery-reference">{job.reference}</span>
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
        <span><Truck size={15} aria-hidden="true" />{Number(job.distance_miles || 0).toFixed(1)} mi</span>
        <span><Package size={15} aria-hidden="true" />{t(`delivery.packageTypes.${job.package_type}`, { defaultValue: job.package_type })}</span>
        <span><Clock3 size={15} aria-hidden="true" />{t(`delivery.serviceLevels.${job.service_level}`, { defaultValue: job.service_level })}</span>
      </div>
      <div className="delivery-job-card__footer">
        <div>
          <small>{helper ? t('delivery.helper.payout') : t('delivery.customer.total')}</small>
          <strong>{currency(helper ? job.driver_payout_cents : job.customer_total_cents)}</strong>
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
      </div>
    </article>
  );
}

function CustomerDelivery({ t }) {
  const [origin, setOrigin] = useState(emptyPlace);
  const [destination, setDestination] = useState(emptyPlace);
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [packageType, setPackageType] = useState('small');
  const [weightLbs, setWeightLbs] = useState('5');
  const [serviceLevel, setServiceLevel] = useState('standard');
  const [notes, setNotes] = useState('');
  const [quote, setQuote] = useState(null);
  const [posted, setPosted] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const payload = useCallback(() => ({
    origin,
    destination,
    packageType,
    weightLbs: Number(weightLbs),
    serviceLevel,
  }), [destination, origin, packageType, serviceLevel, weightLbs]);

  const getQuote = async (event) => {
    event.preventDefault();
    setError('');
    setPosted(null);
    if (origin.lat === null || origin.lng === null || destination.lat === null || destination.lng === null) {
      setError(t('delivery.customer.selectAddress'));
      return;
    }
    setBusy(true);
    try {
      const response = await quoteDelivery(payload());
      setQuote(response.quote);
    } catch (requestError) {
      setQuote(null);
      setError(apiMessage(requestError, t('delivery.errors.quote')));
    } finally {
      setBusy(false);
    }
  };

  const postDelivery = async () => {
    setError('');
    setBusy(true);
    try {
      const response = await createDelivery({ ...payload(), notes });
      setPosted(response.job);
      setQuote(null);
    } catch (requestError) {
      setError(apiMessage(requestError, t('delivery.errors.create')));
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
          <div className="delivery-stop-grid">
            <label className="delivery-field">
              <span>{t('delivery.customer.pickup')}</span>
              <AddressAutocomplete
                value={originText}
                onChange={(value) => { setOriginText(value); setOrigin(emptyPlace()); setQuote(null); }}
                onSelect={(place) => setOrigin(pointFromSuggestion(place, originText))}
                placeholder={t('delivery.customer.pickupPlaceholder')}
                ariaLabel={t('delivery.customer.pickup')}
                inputClassName="delivery-input"
                required
              />
            </label>
            <label className="delivery-field">
              <span>{t('delivery.customer.dropoff')}</span>
              <AddressAutocomplete
                value={destinationText}
                onChange={(value) => { setDestinationText(value); setDestination(emptyPlace()); setQuote(null); }}
                onSelect={(place) => setDestination(pointFromSuggestion(place, destinationText))}
                placeholder={t('delivery.customer.dropoffPlaceholder')}
                ariaLabel={t('delivery.customer.dropoff')}
                inputClassName="delivery-input"
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
              <input className="delivery-input" type="number" min="0.1" step="0.1" value={weightLbs} onChange={(event) => { setWeightLbs(event.target.value); setQuote(null); }} />
            </label>
            <label className="delivery-field">
              <span>{t('delivery.customer.serviceLevel')}</span>
              <select className="delivery-input" value={serviceLevel} onChange={(event) => { setServiceLevel(event.target.value); setQuote(null); }}>
                {SERVICE_OPTIONS.map((option) => <option key={option} value={option}>{t(`delivery.serviceLevels.${option}`)}</option>)}
              </select>
            </label>
          </div>
          <label className="delivery-field">
            <span>{t('delivery.customer.notes')}</span>
            <textarea className="delivery-input delivery-input--textarea" value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} placeholder={t('delivery.customer.notesPlaceholder')} />
          </label>
          {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
          <button type="submit" className="delivery-button delivery-button--primary delivery-button--wide" disabled={busy}>
            {busy ? <Loader2 size={17} className="delivery-spin" aria-hidden="true" /> : <DollarSign size={17} aria-hidden="true" />}
            {t('delivery.customer.getQuote')}
          </button>
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
            <Link to="/messages" className="delivery-button delivery-button--secondary">{t('delivery.customer.openMessages')} <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        ) : (
          <div className="delivery-quote-panel">
            <div className="delivery-panel__heading">
              <div className="delivery-icon-badge delivery-icon-badge--green"><CheckCircle2 size={20} aria-hidden="true" /></div>
              <div><h2>{t('delivery.customer.quoteTitle')}</h2><p>{t('delivery.customer.quoteExpires', { minutes: quote.pricing.quoteTtlMinutes })}</p></div>
            </div>
            <div className="delivery-quote-total"><span>{t('delivery.customer.total')}</span><strong>{currency(quote.pricing.cents.customerTotal, quote.pricing.currency)}</strong></div>
            <div className="delivery-route-summary"><span><Truck size={16} aria-hidden="true" />{t('delivery.customer.distance', { miles: quote.route.distanceMiles })}</span><span><Clock3 size={16} aria-hidden="true" />{t('delivery.customer.duration', { minutes: quote.route.durationMinutes })}</span></div>
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

function HelperDelivery({ t }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await listDeliveryJobs();
      setJobs(response.jobs || []);
    } catch (requestError) {
      setError(apiMessage(requestError, t('delivery.errors.load')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const claim = async (id) => {
    setBusyId(String(id));
    setError('');
    try { await claimDeliveryJob(id); await loadJobs(); } catch (requestError) { setError(apiMessage(requestError, t('delivery.errors.claim'))); } finally { setBusyId(null); }
  };

  const move = async (id, status) => {
    setBusyId(String(id));
    setError('');
    try { await updateDeliveryStatus(id, status); await loadJobs(); } catch (requestError) { setError(apiMessage(requestError, t('delivery.errors.status'))); } finally { setBusyId(null); }
  };

  const openJobs = useMemo(() => jobs.filter((job) => job.status === 'posted'), [jobs]);
  const myJobs = useMemo(() => jobs.filter((job) => job.status !== 'posted'), [jobs]);

  return (
    <div className="delivery-helper-workspace">
      <div className="delivery-helper-toolbar">
        <div><span className="delivery-eyebrow">{t('delivery.helper.eyebrow')}</span><h2>{t('delivery.helper.title')}</h2><p>{t('delivery.helper.body')}</p></div>
        <button type="button" className="delivery-button delivery-button--secondary" onClick={loadJobs} disabled={loading}><RefreshCw size={16} className={loading ? 'delivery-spin' : ''} aria-hidden="true" />{t('delivery.helper.refresh')}</button>
      </div>
      {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
      {loading ? <div className="delivery-loading"><Loader2 className="delivery-spin" size={24} aria-hidden="true" />{t('delivery.helper.loading')}</div> : (
        <>
          <section><div className="delivery-section-title"><h3>{t('delivery.helper.open')}</h3><span>{openJobs.length}</span></div>{openJobs.length ? <div className="delivery-job-grid">{openJobs.map((job) => <DeliveryCard key={job.id} job={job} helper onClaim={claim} onStatus={move} busyId={busyId} t={t} />)}</div> : <p className="delivery-empty-copy">{t('delivery.helper.empty')}</p>}</section>
          <section><div className="delivery-section-title"><h3>{t('delivery.helper.myDeliveries')}</h3><span>{myJobs.length}</span></div>{myJobs.length ? <div className="delivery-job-grid">{myJobs.map((job) => <DeliveryCard key={job.id} job={job} helper onClaim={claim} onStatus={move} busyId={busyId} t={t} />)}</div> : <p className="delivery-empty-copy">{t('delivery.helper.myEmpty')}</p>}</section>
        </>
      )}
    </div>
  );
}

export default function DeliveryPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const helper = isHelper(user);

  return (
    <PageShell>
      <PageMeta title={t('delivery.metaTitle')} description={t('delivery.metaDescription')} />
      <div className="delivery-page">
        <header className="delivery-hero">
          <div>
            <span className="delivery-eyebrow">{t('delivery.eyebrow')}</span>
            <h1>{t('delivery.title')}</h1>
            <p>{helper ? t('delivery.helper.heroBody') : t('delivery.subtitle')}</p>
          </div>
          <div className="delivery-hero__badge"><Truck size={24} aria-hidden="true" /><span>{t('delivery.heroBadge')}</span></div>
        </header>
        {helper ? <HelperDelivery t={t} /> : <CustomerDelivery t={t} />}
      </div>
    </PageShell>
  );
}
