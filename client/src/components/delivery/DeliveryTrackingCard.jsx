import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Link2, MapPin, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../../hooks/useSocket';
import {
  createTrackingLink,
  deliveryDate,
  deliveryError,
  getCustomerTrackingState,
} from '../../api/delivery';

// Customer-safe socket events broadcast to the `delivery_<jobId>` room
// (see server/services/deliveryTrackingEventBus.js). Tracking events are
// point-in-time broadcasts, never state: every event triggers a reload of
// the authoritative customer-state.
const TRACKING_EVENTS = [
  'location_updated',
  'eta_updated',
  'geofence_arrival',
  'geofence_departure',
  'scan_recorded',
  'tracking_stale',
  'tracking_reconnected',
  'tracking_exception',
];

export default function DeliveryTrackingCard({ jobId }) {
  const { t, i18n } = useTranslation();
  const { socket } = useSocket();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [link, setLink] = useState(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [copied, setCopied] = useState(false);
  const requestSequence = useRef(0);
  const date = (value) => deliveryDate(value, i18n.language);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const response = await getCustomerTrackingState(jobId);
      if (sequence !== requestSequence.current) return;
      setState(response?.state || null);
      setRefreshedAt(new Date().toISOString());
      setError('');
    } catch (failure) {
      if (sequence !== requestSequence.current) return;
      setState(null);
      setError(deliveryError(failure, t, 'delivery.tracking.customer.loadError'));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [jobId, t]);

  useEffect(() => {
    requestSequence.current += 1;
    setState(null);
    setError('');
    setLink(null);
    setLinkError('');
    setCopied(false);
    load();
    return () => { requestSequence.current += 1; };
  }, [jobId, load]);

  // Socket lifecycle: join the customer-safe tracking room on mount and on
  // every reconnect (the reconnect contract requires re-emitting
  // `delivery:join` and reloading authoritative state), then leave on unmount.
  useEffect(() => {
    if (!socket || !jobId) return undefined;
    const matches = (payload) => String(payload?.deliveryJobId) === String(jobId);
    const join = () => socket.emit('delivery:join', jobId);
    const reload = (payload) => { if (matches(payload)) load(); };
    const onReconnect = () => { join(); load(); };
    join();
    TRACKING_EVENTS.forEach((eventType) => socket.on(`tracking:${eventType}`, reload));
    socket.on('connect', onReconnect);
    return () => {
      TRACKING_EVENTS.forEach((eventType) => socket.off(`tracking:${eventType}`, reload));
      socket.off('connect', onReconnect);
      socket.emit('delivery:leave', jobId);
    };
  }, [socket, jobId, load]);

  const share = async () => {
    if (linkBusy) return;
    setLinkBusy(true);
    setLinkError('');
    setCopied(false);
    try {
      const response = await createTrackingLink(jobId);
      const token = response?.link?.token;
      if (!token) throw new Error('Missing tracking token');
      setLink({
        url: `${window.location.origin}/t/${token}`,
        expiresAt: response.link.expiresAt || null,
      });
    } catch (failure) {
      setLinkError(deliveryError(failure, t, 'delivery.tracking.customer.linkError'));
    } finally {
      setLinkBusy(false);
    }
  };

  const copy = async () => {
    if (!link?.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch (failure) {
      setLinkError(t('delivery.tracking.customer.copyFailed'));
    }
  };

  const milestoneLabel = (milestone) =>
    t(`delivery.tracking.milestones.${milestone.key}`, { defaultValue: milestone.label || milestone.key });

  const eta = state?.eta || {};
  const milestones = state?.milestones || [];

  return (
    <section className="delivery-panel delivery-tracking-card" aria-label={t('delivery.tracking.customer.title')}>
      <div className="delivery-panel__heading">
        <div>
          <h2>{t('delivery.tracking.customer.title')}</h2>
          <p>{t('delivery.tracking.customer.subtitle')}</p>
        </div>
        <button
          className="delivery-button delivery-button--secondary"
          type="button"
          disabled={loading}
          onClick={load}
          title={t('delivery.tracking.customer.refresh')}
        >
          <RefreshCw size={16} className={loading ? 'delivery-spin' : undefined} />
          {t('delivery.tracking.customer.refresh')}
        </button>
      </div>

      {loading && !state && <p role="status">{t('delivery.tracking.customer.loading')}</p>}

      {error && (
        <div className="delivery-alert delivery-alert--error" role="alert">
          {error}
          <button className="delivery-button delivery-button--secondary" type="button" onClick={load}>
            {t('delivery.tracking.customer.retry')}
          </button>
        </div>
      )}

      {!loading && !error && !state && <p>{t('delivery.tracking.customer.empty')}</p>}

      {state && (
        <>
          <div className="delivery-tracking__meta">
            <div>
              <strong>{t('delivery.tracking.customer.eta')}</strong>
              <p>
                {eta.at
                  ? date(eta.at)
                  : t('delivery.tracking.customer.etaUnavailable')}
              </p>
              {refreshedAt && (
                <small>{t('delivery.tracking.customer.lastUpdated', { date: date(refreshedAt) })}</small>
              )}
            </div>
            <div className="delivery-tracking__area">
              <MapPin size={16} aria-hidden="true" />
              <span>
                {state.approximateArea
                  ? t('delivery.tracking.customer.area')
                  : t('delivery.tracking.customer.areaUnavailable')}
              </span>
            </div>
          </div>

          {eta.freshness === 'stale' && (
            <p className="delivery-alert delivery-alert--warning" role="status">
              {t('delivery.tracking.customer.staleEta')}
            </p>
          )}

          <ol className="delivery-timeline" aria-label={t('delivery.tracking.customer.title')}>
            {milestones.map((milestone) => (
              <li key={milestone.key}>
                <span
                  className={`delivery-timeline__dot${milestone.reached ? ' delivery-timeline__dot--done' : ''}`}
                  aria-hidden="true"
                >
                  {milestone.reached && <Check size={10} aria-hidden="true" />}
                </span>
                <div>
                  <strong>{milestoneLabel(milestone)}</strong>
                  {milestone.at && <time dateTime={milestone.at}>{date(milestone.at)}</time>}
                </div>
              </li>
            ))}
          </ol>

          <div className="delivery-tracking__share">
            <div>
              <h3>{t('delivery.tracking.customer.shareTitle')}</h3>
              <p>{t('delivery.tracking.customer.shareHint')}</p>
            </div>
            {!link && (
              <button
                className="delivery-button delivery-button--secondary"
                type="button"
                disabled={linkBusy}
                onClick={share}
              >
                <Link2 size={16} />
                {t('delivery.tracking.customer.createLink')}
              </button>
            )}
            {link && (
              <div className="delivery-tracking__link" role="status">
                <p><strong>{t('delivery.tracking.customer.linkReady')}</strong></p>
                <div className="delivery-tracking__link-row">
                  <input
                    className="delivery-input"
                    type="text"
                    readOnly
                    value={link.url}
                    onFocus={(event) => event.target.select()}
                    aria-label={t('delivery.tracking.customer.shareTitle')}
                  />
                  <button
                    className="delivery-button delivery-button--secondary"
                    type="button"
                    onClick={copy}
                  >
                    {copied ? t('delivery.tracking.customer.copied') : t('delivery.tracking.customer.copyLink')}
                  </button>
                </div>
                {link.expiresAt && (
                  <small>{t('delivery.tracking.customer.linkExpires', { date: date(link.expiresAt) })}</small>
                )}
              </div>
            )}
            {linkError && <p className="delivery-alert delivery-alert--error" role="alert">{linkError}</p>}
          </div>
        </>
      )}
    </section>
  );
}
