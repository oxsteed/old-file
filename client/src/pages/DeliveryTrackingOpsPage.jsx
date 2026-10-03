import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { canAccessOperationsWorkspace } from '../utils/logisticsWorkspaces';
import {
  getExactTracking, getInternalDelivery, listTrackingReviewQueue, reviewTrackingPoint,
  listTelematicsConnections, createTelematicsConnection,
  pauseTelematicsConnection, resumeTelematicsConnection, revokeTelematicsConnection,
  reconcileTelematicsConnection, refreshTrackingEta,
  listTrackingLinks, createTrackingLink, revokeTrackingLink,
  deliveryDate, deliveryError,
} from '../api/delivery';
import '../styles/DeliveryPage.css';

const T = 'delivery.tracking.ops';
// Matches server/services/deliveryTrackingEventBus.js TRACKING_SOCKET_EVENTS.
const OPS_SOCKET_EVENTS = [
  'location_updated', 'eta_updated', 'geofence_arrival', 'geofence_departure',
  'scan_recorded', 'tracking_stale', 'tracking_reconnected', 'tracking_exception',
];
// Matches server/workers/deliveryTrackingWorkers.js STALE_POINT_MINUTES.
const STALE_MS = 15 * 60 * 1000;
const TABS = ['location', 'eta', 'geofences', 'scans', 'events', 'review', 'provider', 'links'];

function maskId(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return `••••${text.slice(-4)}`;
}

function trackingLinkUrl(token) {
  const base = import.meta.env.VITE_API_URL || '/api';
  const origin = base.startsWith('/') && typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${base.replace(/\/$/, '')}/delivery/t/public/${token}`;
}

function Section({ title, children }) {
  return <section className="delivery-panel"><h2>{title}</h2>{children}</section>;
}

export default function DeliveryTrackingOpsPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const allowed = canAccessOperationsWorkspace(user);
  const { socket, connected, connectionState } = useSocket();
  const [tab, setTab] = useState('location');
  const [tracking, setTracking] = useState(null);
  const [jobDetail, setJobDetail] = useState(null);
  const [reviewPoints, setReviewPoints] = useState([]);
  const [reviewState, setReviewState] = useState('suspicious');
  const [notes, setNotes] = useState({});
  const [connections, setConnections] = useState([]);
  const [showAllConnections, setShowAllConnections] = useState(false);
  const [cursorInputs, setCursorInputs] = useState({});
  const [newConnection, setNewConnection] = useState({ provider: '', vehicleId: '', credentialRef: '', webhookSecretRef: '' });
  const [links, setLinks] = useState([]);
  const [ttlHours, setTtlHours] = useState('72');
  const [newToken, setNewToken] = useState(null);
  const [revokeReason, setRevokeReason] = useState({});
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refreshTimer = useRef(null);
  const language = i18n.language;

  const date = (value) => deliveryDate(value, language);

  const loadTracking = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [exact, detail, queue, conns, linkList] = await Promise.all([
        getExactTracking(id),
        getInternalDelivery(id),
        listTrackingReviewQueue(reviewState, 1, 100),
        listTelematicsConnections(),
        listTrackingLinks(id),
      ]);
      setTracking(exact?.tracking || null);
      setJobDetail(detail?.job || null);
      const points = Array.isArray(queue?.points) ? queue.points : [];
      setReviewPoints(points.filter((point) => String(point.delivery_job_id) === String(id)));
      setConnections(Array.isArray(conns?.connections) ? conns.connections : []);
      setLinks(Array.isArray(linkList?.links) ? linkList.links : []);
      setError('');
    } catch (failure) {
      if (!silent) setError(deliveryError(failure, t, `${T}.loadError`));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id, reviewState, t]);

  useEffect(() => { if (allowed) loadTracking(); else setLoading(false); }, [allowed, loadTracking]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      loadTracking({ silent: true });
      setNotice(t(`${T}.live.updateReceived`));
    }, 1500);
  }, [loadTracking, t]);

  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  // Ops users receive exact tracking broadcasts on the ops_delivery room
  // (joined server-side). Refresh authoritative state on each job event.
  useEffect(() => {
    if (!socket) return undefined;
    const subscriptions = OPS_SOCKET_EVENTS.map((type) => {
      const event = `tracking:ops:${type}`;
      const handler = (payload) => {
        if (String(payload?.deliveryJobId) !== String(id)) return;
        scheduleRefresh();
      };
      socket.on(event, handler);
      return [event, handler];
    });
    return () => { subscriptions.forEach(([event, handler]) => socket.off(event, handler)); };
  }, [socket, id, scheduleRefresh]);

  const run = async (operation, successKey) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await operation();
      if (successKey) setNotice(t(successKey));
      await loadTracking({ silent: true });
      return result;
    } catch (failure) {
      setError(deliveryError(failure, t));
      return null;
    } finally { setBusy(false); }
  };

  const job = tracking?.job || {};
  const assignment = tracking?.assignment || null;
  const device = tracking?.device || null;
  const consent = tracking?.consent || null;
  const points = Array.isArray(tracking?.points) ? tracking.points : [];
  const latest = points[0] || null;
  const etaHistory = Array.isArray(tracking?.etaHistory) ? tracking.etaHistory : [];
  const geofences = Array.isArray(tracking?.geofences) ? tracking.geofences : [];
  const observations = Array.isArray(tracking?.geofenceObservations) ? tracking.geofenceObservations : [];
  const scans = Array.isArray(tracking?.scans) ? tracking.scans : [];
  const events = Array.isArray(tracking?.events) ? tracking.events : [];

  const lastUpdateMs = tracking?.lastLocationAt ? new Date(tracking.lastLocationAt).getTime() : NaN;
  const staleMs = Number.isFinite(lastUpdateMs) ? Date.now() - lastUpdateMs : null;
  const isStale = staleMs != null && staleMs > STALE_MS;
  const health = !assignment ? 'idle' : (isStale ? 'stale' : 'active');

  const sourceLabel = (source) => t(`${T}.location.sources.${source}`, { defaultValue: String(source || '').replace(/_/g, ' ') });
  const customerId = jobDetail?.customer_user_id;
  const vehicleId = device?.vehicle_id ? String(device.vehicle_id) : '';
  const visibleConnections = showAllConnections || !vehicleId
    ? connections
    : connections.filter((conn) => String(conn.vehicleId ?? '') === vehicleId);

  const copyToken = async () => {
    if (!newToken?.token) return;
    try {
      await navigator.clipboard.writeText(newToken.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const linkStatus = (link) => {
    if (link.revoked_at) return 'revoked';
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return 'expired';
    return 'active';
  };

  if (!allowed) return <PageShell><div className="delivery-page" dir={i18n.dir()}><h1>{t('delivery.ui.permission')}</h1><p>{t(`${T}.subtitle`)}</p><Link className="delivery-button delivery-button--primary" to="/logistics/login?mode=operations&next=%2Fdelivery%2Foperations">{t('delivery.ui.operationsLogin')}</Link><Link to="/delivery">{t('delivery.detail.back')}</Link></div></PageShell>;

  return <PageShell><PageMeta title={t(`${T}.metaTitle`)} description={t(`${T}.subtitle`)} />
    <div className="delivery-page delivery-dispatch-page" dir={i18n.dir()}>
      <header className="delivery-hero">
        <div>
          <Link className="delivery-back-link" to="/delivery/operations">{t(`${T}.back`)}</Link>
          <h1>{t(`${T}.title`)}</h1>
          <p>{t(`${T}.subtitle`)}</p>
        </div>
        <div className="delivery-dispatch-actions">
          <span className="delivery-status" role="status">{connected ? t(`${T}.health.live`) : t(`${T}.health.${connectionState === 'reconnecting' ? 'reconnecting' : 'offline'}`)}</span>
          <button className="delivery-button delivery-button--secondary" disabled={loading || busy} onClick={() => loadTracking()}>{t(`${T}.refresh`)}</button>
        </div>
      </header>
      {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
      {notice && <p className="delivery-alert delivery-alert--success" role="status">{notice}</p>}
      {loading && <p role="status">{t(`${T}.loading`)}</p>}

      {!loading && tracking && <>
        <Section title={`${t(`${T}.header.reference`)}: ${job.reference || id}`}>
          <div className="delivery-stop-grid">
            <p><strong>{t(`${T}.header.status`)}:</strong> {job.status || '—'}</p>
            <p><strong>{t(`${T}.header.customer`)}:</strong> {customerId ? t(`${T}.header.customerMasked`, { id: maskId(customerId) }) : t(`${T}.header.customerUnknown`)}</p>
            {(jobDetail?.origin_city || jobDetail?.destination_city) && <p><strong>{t(`${T}.header.route`)}:</strong> {jobDetail.origin_city || '—'} → {jobDetail.destination_city || '—'}</p>}
          </div>
          <div className="delivery-stop-grid">
            <p><strong>{t(`${T}.header.assignment`)}:</strong> {assignment ? `${t(`${T}.header.driver`)} ${assignment.driver_user_id || '—'} · ${t(`${T}.header.vehicle`)} ${assignment.vehicle_id || '—'}` : t(`${T}.header.noAssignment`)}</p>
            <p><strong>{t(`${T}.header.device`)}:</strong> {device ? `${device.device_label || device.kind || ''} (${sourceLabel(device.kind === 'phone' ? 'driver_gps' : device.kind)})`.trim() : t(`${T}.header.noDevice`)}</p>
            <p><strong>{t(`${T}.header.consent`)}:</strong> {consent ? t(`${T}.header.consentRecorded`, { version: consent.consent_version || '—' }) : t(`${T}.header.noConsent`)}</p>
          </div>
          <div className="delivery-stop-grid">
            <p><strong>{t(`${T}.health.title`)}:</strong> <span className="delivery-status">{t(`${T}.health.${health}`)}</span></p>
            <p><strong>{t(`${T}.health.lastUpdate`)}:</strong> {staleMs == null ? t(`${T}.health.never`) : date(tracking.lastLocationAt)}</p>
            {isStale && <p><strong>{t(`${T}.health.staleFor`)}:</strong> {t(`${T}.health.minutes`, { count: Math.round(staleMs / 60000) })}</p>}
          </div>
        </Section>

        <nav className="delivery-dispatch-actions" aria-label={t(`${T}.title`)}>
          {TABS.map((key) => <button key={key} className={`delivery-button ${tab === key ? 'delivery-button--primary' : 'delivery-button--secondary'}`} aria-pressed={tab === key} onClick={() => setTab(key)}>{t(`${T}.tabs.${key}`)}</button>)}
        </nav>

        {tab === 'location' && <Section title={t(`${T}.location.title`)}>
          {!latest && <p>{t(`${T}.location.noPoints`)}</p>}
          {latest && <div className="delivery-stop-grid">
            <p><strong>{t(`${T}.location.latitude`)}:</strong> {latest.latitude}</p>
            <p><strong>{t(`${T}.location.longitude`)}:</strong> {latest.longitude}</p>
            <p><strong>{t(`${T}.location.accuracy`)}:</strong> {latest.accuracy_meters != null ? t(`${T}.location.accuracyMeters`, { count: latest.accuracy_meters }) : '—'}</p>
            <p><strong>{t(`${T}.location.source`)}:</strong> {sourceLabel(latest.source)}</p>
            <p><strong>{t(`${T}.location.recordedAt`)}:</strong> {date(latest.recorded_at)}</p>
            <p><strong>{t(`${T}.location.receivedAt`)}:</strong> {date(latest.received_at)}</p>
            <p><strong>{t(`${T}.location.speed`)}:</strong> {latest.speed_mps != null ? t(`${T}.location.speedMps`, { count: latest.speed_mps }) : '—'}</p>
            <p><strong>{t(`${T}.location.heading`)}:</strong> {latest.heading_degrees != null ? t(`${T}.location.headingDegrees`, { count: latest.heading_degrees }) : '—'}</p>
          </div>}
        </Section>}

        {tab === 'eta' && <Section title={t(`${T}.eta.title`)}>
          <div className="delivery-dispatch-actions"><button className="delivery-button delivery-button--primary" disabled={busy} onClick={() => run(() => refreshTrackingEta(id), `${T}.eta.refreshed`)}>{busy ? t(`${T}.eta.refreshing`) : t(`${T}.eta.refreshEta`)}</button></div>
          {!etaHistory.length && <p>{t(`${T}.eta.empty`)}</p>}
          {!!etaHistory.length && <div className="delivery-table-wrap"><table className="delivery-table"><thead><tr>
            {['etaAt', 'source', 'confidence', 'basis', 'createdAt'].map((key) => <th key={key}>{t(`${T}.eta.columns.${key}`)}</th>)}
          </tr></thead><tbody>{etaHistory.map((row) => <tr key={row.id}>
            <td>{date(row.eta_at)}</td><td>{row.source || '—'}</td><td>{row.confidence ?? '—'}</td><td>{row.basis || '—'}</td><td>{date(row.created_at)}</td>
          </tr>)}</tbody></table></div>}
        </Section>}

        {tab === 'geofences' && <Section title={t(`${T}.geofences.title`)}>
          <h3>{t(`${T}.geofences.definitions`)}</h3>
          {!geofences.length && <p>{t(`${T}.geofences.empty`)}</p>}
          {!!geofences.length && <div className="delivery-table-wrap"><table className="delivery-table"><thead><tr>
            {['kind', 'center', 'radius', 'status'].map((key) => <th key={key}>{t(`${T}.geofences.columns.${key}`)}</th>)}
          </tr></thead><tbody>{geofences.map((row) => <tr key={row.id}>
            <td>{t(`${T}.geofences.kinds.${row.kind}`, { defaultValue: row.kind })}</td>
            <td>{row.center_lat}, {row.center_lng}</td>
            <td>{row.radius_meters} m</td>
            <td>{row.active ? t(`${T}.geofences.active`) : t(`${T}.geofences.inactive`)}</td>
          </tr>)}</tbody></table></div>}
          <h3>{t(`${T}.geofences.observations`)}</h3>
          {!observations.length && <p>{t(`${T}.geofences.noObservations`)}</p>}
          {!!observations.length && <div className="delivery-table-wrap"><table className="delivery-table"><thead><tr>
            {['event', 'kind', 'observedAt'].map((key) => <th key={key}>{t(`${T}.geofences.columns.${key}`)}</th>)}
          </tr></thead><tbody>{observations.map((row) => <tr key={row.id}>
            <td>{t(`${T}.geofences.events.${row.observation}`, { defaultValue: row.observation })}</td>
            <td>{t(`${T}.geofences.kinds.${row.geofence_kind}`, { defaultValue: row.geofence_kind })}</td>
            <td>{date(row.observed_at)}</td>
          </tr>)}</tbody></table></div>}
        </Section>}

        {tab === 'scans' && <Section title={t(`${T}.scans.title`)}>
          {!scans.length && <p>{t(`${T}.scans.empty`)}</p>}
          {!!scans.length && <div className="delivery-table-wrap"><table className="delivery-table"><thead><tr>
            {['type', 'code', 'format', 'scannedBy', 'scannedAt'].map((key) => <th key={key}>{t(`${T}.scans.columns.${key}`)}</th>)}
          </tr></thead><tbody>{scans.map((row) => <tr key={row.id}>
            <td>{t(`${T}.scans.types.${row.scan_type}`, { defaultValue: row.scan_type })}</td>
            <td>{row.code_value || '—'}</td><td>{row.code_format || '—'}</td>
            <td>{row.scanned_by_user_id || '—'}</td><td>{date(row.scanned_at)}</td>
          </tr>)}</tbody></table></div>}
        </Section>}

        {tab === 'events' && <Section title={t(`${T}.events.title`)}>
          {!events.length && <p>{t(`${T}.events.empty`)}</p>}
          {!!events.length && <div className="delivery-table-wrap"><table className="delivery-table"><thead><tr>
            {['type', 'actor', 'provider', 'version', 'occurredAt'].map((key) => <th key={key}>{t(`${T}.events.columns.${key}`)}</th>)}
          </tr></thead><tbody>{events.map((row) => <tr key={row.id}>
            <td>{t(`${T}.events.types.${row.event_type}`, { defaultValue: row.event_type })}</td>
            <td>{row.actor_user_id || '—'}</td><td>{row.provider || '—'}</td>
            <td>{row.event_version ?? '—'}</td><td>{date(row.created_at)}</td>
          </tr>)}</tbody></table></div>}
        </Section>}

        {tab === 'review' && <Section title={t(`${T}.review.title`)}>
          <label className="delivery-field">{t(`${T}.review.stateFilter`)}
            <select className="delivery-input" value={reviewState} disabled={busy} onChange={(event) => setReviewState(event.target.value)}>
              {['suspicious', 'rejected'].map((value) => <option key={value} value={value}>{t(`${T}.review.states.${value}`)}</option>)}
            </select>
          </label>
          {!reviewPoints.length && <p>{t(`${T}.review.empty`)}</p>}
          {reviewPoints.map((point) => <article key={point.id} className="delivery-review-item">
            <p><strong>{date(point.recorded_at)}</strong> · {sourceLabel(point.source)} · {point.latitude}, {point.longitude} · {point.accuracy_meters != null ? t(`${T}.location.accuracyMeters`, { count: point.accuracy_meters }) : '—'}</p>
            {point.validation_notes && <p>{point.validation_notes}</p>}
            <label className="delivery-field">{t(`${T}.review.notesLabel`)}
              <input className="delivery-input" maxLength={2000} disabled={busy} value={notes[point.id] || ''} placeholder={t(`${T}.review.notesPlaceholder`)} onChange={(event) => setNotes({ ...notes, [point.id]: event.target.value })} />
            </label>
            <div className="delivery-dispatch-actions">
              <button className="delivery-button delivery-button--primary" disabled={busy} onClick={() => run(() => reviewTrackingPoint(point.id, { validationState: 'valid', notes: notes[point.id] || '' }), `${T}.review.reviewed`)}>{busy ? t(`${T}.review.reviewing`) : t(`${T}.review.validate`)}</button>
              <button className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => run(() => reviewTrackingPoint(point.id, { validationState: 'rejected', notes: notes[point.id] || '' }), `${T}.review.reviewed`)}>{t(`${T}.review.reject`)}</button>
            </div>
          </article>)}
        </Section>}

        {tab === 'provider' && <Section title={t(`${T}.provider.title`)}>
          <label><input type="checkbox" checked={showAllConnections} onChange={(event) => setShowAllConnections(event.target.checked)} /> {t(`${T}.provider.showAll`)}</label>
          {!showAllConnections && vehicleId && <p>{t(`${T}.provider.forVehicle`)}</p>}
          {!visibleConnections.length && <p>{t(`${T}.provider.empty`)}</p>}
          {visibleConnections.map((conn) => <article key={conn.id} className="delivery-review-item">
            <p><strong>{conn.provider}</strong> · {t(`${T}.provider.columns.vehicle`)}: {conn.vehicleId ?? '—'} · <span className="delivery-status">{t(`${T}.provider.statuses.${conn.status}`, { defaultValue: conn.status })}</span></p>
            <p>{t(`${T}.provider.columns.cursor`)}: {conn.cursor ?? '—'} · {t(`${T}.provider.columns.lastSync`)}: {date(conn.lastSyncAt)} · {t(`${T}.provider.columns.errors`)}: {conn.errorCount ?? 0}</p>
            {conn.lastError && <p>{t(`${T}.provider.columns.lastError`)}: {conn.lastError}</p>}
            <div className="delivery-dispatch-actions">
              <button className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => run(() => pauseTelematicsConnection(conn.id), `${T}.provider.updated`)}>{t(`${T}.provider.pause`)}</button>
              <button className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => run(() => resumeTelematicsConnection(conn.id), `${T}.provider.updated`)}>{t(`${T}.provider.resume`)}</button>
              <button className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => { if (window.confirm(t(`${T}.provider.confirmRevoke`))) run(() => revokeTelematicsConnection(conn.id), `${T}.provider.updated`); }}>{t(`${T}.provider.revoke`)}</button>
            </div>
            <form className="delivery-form" onSubmit={(event) => { event.preventDefault(); run(() => reconcileTelematicsConnection(conn.id, cursorInputs[conn.id] || ''), `${T}.provider.updated`); }}>
              <label className="delivery-field">{t(`${T}.provider.reconcile`)}
                <input className="delivery-input" disabled={busy} required value={cursorInputs[conn.id] || ''} placeholder={t(`${T}.provider.reconcilePlaceholder`)} onChange={(event) => setCursorInputs({ ...cursorInputs, [conn.id]: event.target.value })} />
              </label>
              <button className="delivery-button delivery-button--secondary" disabled={busy || !(cursorInputs[conn.id] || '').trim()}>{t(`${T}.provider.reconcile`)}</button>
            </form>
          </article>)}
          <h3>{t(`${T}.provider.createTitle`)}</h3>
          <p>{t(`${T}.provider.refsHint`)}</p>
          <form onSubmit={(event) => { event.preventDefault(); run(() => createTelematicsConnection({ provider: newConnection.provider.trim(), vehicleId: newConnection.vehicleId.trim() || null, credentialRef: newConnection.credentialRef.trim() || null, webhookSecretRef: newConnection.webhookSecretRef.trim() || null }).then((result) => { if (result) setNewConnection({ provider: '', vehicleId: '', credentialRef: '', webhookSecretRef: '' }); }), `${T}.provider.created`); }}>
            <fieldset className="delivery-form-fields" disabled={busy}>
              <div className="delivery-stop-grid">
                <label className="delivery-field">{t(`${T}.provider.providerLabel`)}<input className="delivery-input" required maxLength={60} value={newConnection.provider} placeholder={t(`${T}.provider.providerPlaceholder`)} onChange={(event) => setNewConnection({ ...newConnection, provider: event.target.value })} /></label>
                <label className="delivery-field">{t(`${T}.provider.vehicleIdLabel`)}<input className="delivery-input" maxLength={120} value={newConnection.vehicleId} onChange={(event) => setNewConnection({ ...newConnection, vehicleId: event.target.value })} /></label>
                <label className="delivery-field">{t(`${T}.provider.credentialRefLabel`)}<input className="delivery-input" maxLength={200} value={newConnection.credentialRef} onChange={(event) => setNewConnection({ ...newConnection, credentialRef: event.target.value })} /></label>
                <label className="delivery-field">{t(`${T}.provider.webhookSecretRefLabel`)}<input className="delivery-input" maxLength={200} value={newConnection.webhookSecretRef} onChange={(event) => setNewConnection({ ...newConnection, webhookSecretRef: event.target.value })} /></label>
              </div>
              <button className="delivery-button delivery-button--primary" disabled={!newConnection.provider.trim()}>{busy ? t(`${T}.provider.creating`) : t(`${T}.provider.create`)}</button>
            </fieldset>
          </form>
        </Section>}

        {tab === 'links' && <Section title={t(`${T}.links.title`)}>
          {!links.length && <p>{t(`${T}.links.empty`)}</p>}
          {!!links.length && <div className="delivery-table-wrap"><table className="delivery-table"><thead><tr>
            {['prefix', 'expiresAt', 'uses', 'lastUsed', 'createdAt'].map((key) => <th key={key}>{t(`${T}.links.columns.${key}`)}</th>)}
            <th>{t(`${T}.provider.columns.status`)}</th><th>{t(`${T}.common.actions`)}</th>
          </tr></thead><tbody>{links.map((link) => <tr key={link.id}>
            <td>{link.token_prefix || '—'}</td><td>{date(link.expires_at)}</td>
            <td>{link.use_count ?? 0}</td><td>{date(link.last_used_at)}</td><td>{date(link.created_at)}</td>
            <td>{t(`${T}.links.status.${linkStatus(link)}`)}</td>
            <td>{!link.revoked_at && <form className="delivery-form" onSubmit={(event) => { event.preventDefault(); if (window.confirm(t(`${T}.links.confirmRevoke`))) run(() => revokeTrackingLink(id, link.id, revokeReason[link.id] || ''), `${T}.links.revoked`); }}>
              <input className="delivery-input" disabled={busy} maxLength={500} value={revokeReason[link.id] || ''} placeholder={t(`${T}.links.revokeReasonPlaceholder`)} onChange={(event) => setRevokeReason({ ...revokeReason, [link.id]: event.target.value })} />
              <button className="delivery-button delivery-button--secondary" disabled={busy}>{t(`${T}.links.revoke`)}</button>
            </form>}</td>
          </tr>)}</tbody></table></div>}
          <h3>{t(`${T}.links.createTitle`)}</h3>
          <form className="delivery-form" onSubmit={(event) => { event.preventDefault(); run(async () => { const result = await createTrackingLink(id, ttlHours ? { ttlHours: Number(ttlHours) } : {}); if (result?.link) setNewToken(result.link); }, null); }}>
            <fieldset className="delivery-form-fields" disabled={busy}>
              <label className="delivery-field">{t(`${T}.links.ttlLabel`)}<input className="delivery-input" type="number" min="1" max="720" value={ttlHours} onChange={(event) => setTtlHours(event.target.value)} /></label>
              <p>{t(`${T}.links.ttlHint`)}</p>
              <button className="delivery-button delivery-button--primary">{busy ? t(`${T}.links.creating`) : t(`${T}.links.create`)}</button>
            </fieldset>
          </form>
          {newToken && <article className="delivery-review-item">
            <h4>{t(`${T}.links.newTokenTitle`)}</h4>
            <p>{t(`${T}.links.newTokenHint`)}</p>
            <p><code>{newToken.token}</code></p>
            <div className="delivery-dispatch-actions">
              <button className="delivery-button delivery-button--secondary" type="button" onClick={copyToken}>{copied ? t(`${T}.links.copied`) : t(`${T}.links.copy`)}</button>
              <a className="delivery-button delivery-button--secondary" href={trackingLinkUrl(newToken.token)} target="_blank" rel="noreferrer">{t(`${T}.links.openLink`)}</a>
              <button className="delivery-button delivery-button--secondary" type="button" onClick={() => setNewToken(null)}>{t(`${T}.common.close`)}</button>
            </div>
          </article>}
        </Section>}
      </>}
    </div>
  </PageShell>;
}
