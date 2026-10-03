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
import { canAccessOperationsWorkspace } from '../utils/logisticsWorkspaces';
import {
  claimDeliveryJob,
  createDelivery,
  listDeliveryJobs,
  quoteDelivery,
  updateDeliveryStatus,
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
    city: place?.city || '',
    state: place?.state || '',
    country: String(place?.country || '').toUpperCase(),
    lat: place?.lat,
    lng: place?.lng,
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

function CustomerDelivery({ t }) {
  const { i18n } = useTranslation();
  const currency = (cents, code) => deliveryMoney(cents, i18n.language, code);
  const [origin, setOrigin] = useState(emptyPlace);
  const [destination, setDestination] = useState(emptyPlace);
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [packageType, setPackageType] = useState('small');
  const [weightLbs, setWeightLbs] = useState('5');
  const [serviceLevel, setServiceLevel] = useState('standard');
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
  const [proofPreference, setProofPreference] = useState('recipient_confirmation');
  const [quote, setQuote] = useState(null);
  const [posted, setPosted] = useState(null);
  const [proofPin, setProofPin] = useState('');
  const [clientRequestId, setClientRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const payload = useCallback(() => ({
    origin,
    destination,
    packageType,
    weightLbs: Number(weightLbs),
    serviceLevel,
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
    pickupWindow: { start: pickupWindow.start ? new Date(pickupWindow.start).toISOString() : undefined, end: pickupWindow.end ? new Date(pickupWindow.end).toISOString() : undefined },
    deliveryWindow: { start: deliveryWindow.start ? new Date(deliveryWindow.start).toISOString() : undefined, end: deliveryWindow.end ? new Date(deliveryWindow.end).toISOString() : undefined },
    proofPreference,
  }), [contentsCategory, declaredValue, deliveryWindow, destination, destinationContact, dimensions, fragile, handlingRequirements, notes, origin, originContact, packageType, perishable, pieces, pickupWindow, proofPreference, serviceLevel, weightLbs]);

  useEffect(() => { setQuote(null); setClientRequestId(''); }, [payload]);

  const getQuote = async (event) => {
    event.preventDefault();
    setError('');
    setPosted(null);
    if ([origin, destination].some((point) => point.lat == null || point.lng == null || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng)))) {
      setError(t('delivery.customer.selectAddress'));
      return;
    }
    if ([origin, destination].some((point) => point.country !== 'US' || !point.state)) {
      setError(t('delivery.ui.usOnly')); return;
    }
    if ([originContact, destinationContact].some((contact) => contact.phone.replace(/\D/g, '').length < 7)) {
      setError(t('delivery.ui.phoneInvalid')); return;
    }
    const times = [pickupWindow.start, pickupWindow.end, deliveryWindow.start, deliveryWindow.end].map((value) => new Date(value).getTime());
    if (times.some((value) => !Number.isFinite(value)) || times[0] <= Date.now() || times[0] >= times[1] || times[1] > times[2] || times[2] >= times[3]) {
      setError(t('delivery.ui.intakeWindows')); return;
    }
    setBusy(true);
    try {
      const response = await quoteDelivery(payload());
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
      const response = await createDelivery({ ...payload(), notes, quoteId: quote?.id, clientRequestId: requestId });
      setPosted(response.job);
      setProofPin(response.proofPin || '');
      setQuote(null);
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
              <input className="delivery-input" type="number" min="0.1" max="300" step="0.1" required value={weightLbs} onChange={(event) => { setWeightLbs(event.target.value); setQuote(null); }} />
            </label>
            <label className="delivery-field">
              <span>{t('delivery.customer.serviceLevel')}</span>
              <select className="delivery-input" value={serviceLevel} onChange={(event) => { setServiceLevel(event.target.value); setQuote(null); }}>
                {SERVICE_OPTIONS.map((option) => <option key={option} value={option}>{t(`delivery.serviceLevels.${option}`)}</option>)}
              </select>
            </label>
          </div>
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
          <div className="delivery-options-grid">
            <label className="delivery-field"><span>{t('delivery.operations.pickupWindowStart')}</span><input className="delivery-input" type="datetime-local" required value={pickupWindow.start} onChange={(event) => setPickupWindow((previous) => ({ ...previous, start: event.target.value }))} /></label>
            <label className="delivery-field"><span>{t('delivery.operations.pickupWindowEnd')}</span><input className="delivery-input" type="datetime-local" required value={pickupWindow.end} onChange={(event) => setPickupWindow((previous) => ({ ...previous, end: event.target.value }))} /></label>
            <label className="delivery-field"><span>{t('delivery.operations.dropoffWindowStart')}</span><input className="delivery-input" type="datetime-local" required value={deliveryWindow.start} onChange={(event) => setDeliveryWindow((previous) => ({ ...previous, start: event.target.value }))} /></label>
            <label className="delivery-field"><span>{t('delivery.operations.dropoffWindowEnd')}</span><input className="delivery-input" type="datetime-local" required value={deliveryWindow.end} onChange={(event) => setDeliveryWindow((previous) => ({ ...previous, end: event.target.value }))} /></label>
          </div>
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

function HelperDelivery({ t }) {
  const { user } = useAuth();
  const [marketplaceHelper, setMarketplaceHelper] = useState(false);
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
      setMarketplaceHelper(response.helper === true && response.internalDriver !== true);
    } catch (requestError) {
      setError(deliveryError(requestError, t, 'delivery.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const claim = async (id) => {
    setBusyId(String(id));
    setError('');
    try { await claimDeliveryJob(id); await loadJobs(); } catch (requestError) { setError(deliveryError(requestError, t, 'delivery.errors.claim')); } finally { setBusyId(null); }
  };

  const move = async (id, status, proof = {}) => {
    setBusyId(String(id));
    setError('');
    try { await updateDeliveryStatus(id, status, proof); await loadJobs(); } catch (requestError) { setError(deliveryError(requestError, t, 'delivery.errors.status')); } finally { setBusyId(null); }
  };

  const openJobs = useMemo(() => marketplaceHelper ? jobs.filter((job) => job.status === 'posted' && job.marketplace_available === true && String(job.customer_user_id) !== String(user?.id)) : [], [jobs, marketplaceHelper, user?.id]);
  const myJobs = useMemo(() => jobs.filter((job) => job.is_assigned_operator === true || String(job.customer_user_id) === String(user?.id)), [jobs, user?.id]);

  return (
    <div className="delivery-helper-workspace">
      <div className="delivery-helper-toolbar">
        <div><h2>{t(marketplaceHelper ? 'delivery.helper.title' : 'delivery.helper.myDeliveries')}</h2><p>{t(marketplaceHelper ? 'delivery.helper.body' : 'delivery.ui.workspaceHint')}</p></div>
        <button type="button" className="delivery-button delivery-button--secondary" onClick={loadJobs} disabled={loading}><RefreshCw size={16} className={loading ? 'delivery-spin' : ''} aria-hidden="true" />{t('delivery.helper.refresh')}</button>
      </div>
      {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
      {loading ? <div className="delivery-loading"><Loader2 className="delivery-spin" size={24} aria-hidden="true" />{t('delivery.helper.loading')}</div> : (
        <>
          {marketplaceHelper && <section><div className="delivery-section-title"><h3>{t('delivery.helper.open')}</h3><span>{openJobs.length}</span></div>{openJobs.length ? <div className="delivery-job-grid">{openJobs.map((job) => <DeliveryCard key={job.id} job={job} helper onClaim={claim} onStatus={move} busyId={busyId} t={t} />)}</div> : <p className="delivery-empty-copy">{t('delivery.helper.empty')}</p>}</section>}
          <section><div className="delivery-section-title"><h3>{t('delivery.helper.myDeliveries')}</h3><span>{myJobs.length}</span></div>{myJobs.length ? <div className="delivery-job-grid">{myJobs.map((job) => <DeliveryCard key={job.id} job={job} helper={marketplaceHelper && job.is_assigned_operator === true} onClaim={claim} onStatus={move} busyId={busyId} t={t} />)}</div> : !error && <p className="delivery-empty-copy">{t('delivery.ui.noDeliveries')}</p>}</section>
        </>
      )}
    </div>
  );
}

export default function DeliveryPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [booking, setBooking] = useState(false);
  const operations = canAccessOperationsWorkspace(user);
  const operationsRole = ['admin', 'super_admin'].includes(user?.role) || ['sourcing_operator', 'logistics_coordinator', 'warehouse_operator'].includes(user?.logistics_role);

  return (
    <PageShell>
      <PageMeta title={t('delivery.metaTitle')} description={t('delivery.metaDescription')} />
      <div className="delivery-page" dir={i18n.dir()}>
        <header className="delivery-hero">
          <div>
            <span className="delivery-eyebrow">{t('delivery.eyebrow')}</span>
            <h1>{t('delivery.title')}</h1>
            <p>{t('delivery.subtitle')}</p>
          </div>
          <div className="delivery-hero__badge"><Truck size={24} aria-hidden="true" /><span>{t('delivery.heroBadge')}</span></div>
        </header>
        <nav className="delivery-workspace-tabs" aria-label={t('delivery.title')}>
          <button type="button" className="delivery-button delivery-button--secondary" aria-pressed={booking} onClick={() => setBooking(true)}>{t('delivery.customer.title')}</button>
          <button type="button" className="delivery-button delivery-button--secondary" aria-pressed={!booking} onClick={() => setBooking(false)}>{t('delivery.helper.myDeliveries')}</button>
          {operationsRole && <Link className="delivery-button delivery-button--secondary" to={operations ? '/delivery/operations' : '/logistics/login?mode=operations&next=%2Fdelivery%2Foperations'}>{t(operations ? 'delivery.dispatch.metaTitle' : 'delivery.ui.operationsLogin')}</Link>}
        </nav>
        {booking ? <CustomerDelivery t={t} /> : <HelperDelivery t={t} />}
      </div>
    </PageShell>
  );
}
