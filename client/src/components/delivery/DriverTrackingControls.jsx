import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deliveryError,
  getTrackingStatus,
  grantTrackingConsent,
  listTrackingDevices,
  pauseTracking,
  postTrackingLocations,
  postTrackingScan,
  registerTrackingDevice,
  reportDeviceStrands,
  resumeTracking,
  revokeTrackingConsent,
  revokeTrackingDevice,
  startTracking,
  stopTracking,
  transferTrackingDevice,
} from '../../api/delivery';
import { countStrandedOutbox, TRACKING_QUEUE_PREFIX } from './driverOfflineOutbox';

const CONSENT_VERSION = 'v1';
const CAPTURE_INTERVAL_MS = 15000;
const STATUS_REFRESH_MS = 30000;
const STALE_POINT_MS = 5 * 60 * 1000;
const ACCURACY_WARNING_METERS = 100;

const deviceKey = (userId) => `tracking-device:${userId}`;
const consentKey = (jobId) => `tracking-consent:${jobId}`;
const queueKey = (jobId) => `${TRACKING_QUEUE_PREFIX}${jobId}`;
const sequenceKey = (jobId) => `tracking-sequence:${jobId}`;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function DriverTrackingControls({ job, userId }) {
  const { t, i18n } = useTranslation();
  const jobId = job?.id;
  const [deviceId, setDeviceId] = useState(null);
  const [consentGranted, setConsentGranted] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [trackingState, setTrackingState] = useState('none'); // none | active | paused
  const [lastLocationAt, setLastLocationAt] = useState(null);
  const [lastLocationState, setLastLocationState] = useState(null);
  const [gpsState, setGpsState] = useState('idle'); // idle | ok | denied | unsupported | error
  const [accuracy, setAccuracy] = useState(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [stopReason, setStopReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Group 9 Slice G (item 499): device-change recovery. The current
  // device and the transfer notice (the old device's unsynced points
  // stay on the old device until it reconnects, D-92).
  const [devices, setDevices] = useState([]);
  const [transferNotice, setTransferNotice] = useState('');
  // Group 9 partials Wave 2 Batch Q (499, G9-B7, D-562): what this
  // device would strand on a transfer or a lost phone — queued
  // offline actions and unsent GPS points, counted per job from this
  // browser's localStorage. Shown before the driver confirms, so the
  // transfer is never a blind move.
  const [stranded, setStranded] = useState({ jobs: [], totalQueuedActions: 0, totalUnsyncedPoints: 0, totalJobs: 0 });
  const refreshStranded = useCallback(() => {
    const counted = countStrandedOutbox(localStorage);
    setStranded(counted);
    return counted;
  }, []);
  const lastAction = useRef(null);
  const watchId = useRef(null);
  const intervalId = useRef(null);
  const latestFix = useRef(null);
  const outbox = useRef([]);
  const sequence = useRef(0);
  const flushing = useRef(false);

  const showError = useCallback((failure) => {
    setError(deliveryError(failure, t, 'delivery.tracking.errors.generic'));
  }, [t]);

  const persistQueue = useCallback(() => {
    if (!jobId) return;
    writeJson(queueKey(jobId), outbox.current);
    setQueuedCount(outbox.current.length);
  }, [jobId]);

  const persistSequence = useCallback(() => {
    if (!jobId) return;
    writeJson(sequenceKey(jobId), sequence.current);
  }, [jobId]);

  const flush = useCallback(async () => {
    if (!jobId || flushing.current || outbox.current.length === 0) return;
    flushing.current = true;
    const batch = [...outbox.current].sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
    );
    try {
      await postTrackingLocations(jobId, { points: batch });
      const sent = new Set(batch);
      outbox.current = outbox.current.filter((point) => !sent.has(point));
      persistQueue();
    } catch {
      // Network or server failure: keep the points queued for the next attempt.
      persistQueue();
    } finally {
      flushing.current = false;
    }
  }, [jobId, persistQueue]);

  const clearCapture = useCallback(() => {
    if (watchId.current != null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchId.current);
    }
    watchId.current = null;
    // Cost audit 2026-11-13 P6: drop the last fix when capture stops so
    // a later resume never queues a stale pre-pause position as fresh.
    latestFix.current = null;
    if (intervalId.current) clearInterval(intervalId.current);
    intervalId.current = null;
  }, []);

  const captureTick = useCallback(() => {
    const fix = latestFix.current;
    if (!fix) return;
    const point = {
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracyMeters: fix.coords.accuracy ?? null,
      speedMps: fix.coords.speed ?? null,
      headingDegrees: fix.coords.heading ?? null,
      recordedAt: new Date(fix.timestamp).toISOString(),
      sequence: sequence.current,
    };
    sequence.current += 1;
    outbox.current.push(point);
    persistQueue();
    persistSequence();
    flush();
  }, [flush, persistQueue, persistSequence]);

  const beginCapture = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGpsState('unsupported');
      return;
    }
    clearCapture();
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        latestFix.current = position;
        setAccuracy(position.coords.accuracy ?? null);
        setGpsState('ok');
      },
      (failure) => {
        setGpsState(failure?.code === failure?.PERMISSION_DENIED ? 'denied' : 'error');
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    intervalId.current = setInterval(captureTick, CAPTURE_INTERVAL_MS);
  }, [captureTick, clearCapture]);

  const refreshStatus = useCallback(async () => {
    if (!jobId) return;
    try {
      const status = await getTrackingStatus(jobId);
      if (status?.assignment) {
        setTrackingState('active');
        setLastLocationAt(status.lastLocationAt || null);
        setLastLocationState(status.lastLocationState || null);
        if (status.consent) {
          setConsentGranted(true);
          writeJson(consentKey(jobId), true);
        }
      } else if (lastAction.current !== 'pause') {
        setTrackingState('none');
      }
    } catch {
      // Status refresh is best-effort; leave the current UI state as-is.
    }
  }, [jobId]);

  // Bootstrap: device, queued points, sequence, consent, and live status.
  useEffect(() => {
    if (!jobId || !userId) return;
    let cancelled = false;
    outbox.current = readJson(queueKey(jobId), []);
    sequence.current = readJson(sequenceKey(jobId), 0);
    setQueuedCount(outbox.current.length);
    setConsentGranted(readJson(consentKey(jobId), false));
    setConsentChecked(true);
    (async () => {
      try {
        const stored = localStorage.getItem(deviceKey(userId));
        const { devices: owned = [] } = await listTrackingDevices();
        setDevices(owned);
        const phone = owned.find((d) => d.kind === 'driver_phone' && String(d.id) === String(stored))
          || owned.find((d) => d.kind === 'driver_phone');
        let resolved = phone?.id || null;
        if (!resolved) {
          const { device } = await registerTrackingDevice({
            kind: 'driver_phone',
            deviceLabel: t('delivery.tracking.deviceLabel'),
            platform: navigator.platform || null,
          });
          resolved = device?.id || null;
          if (resolved) localStorage.setItem(deviceKey(userId), String(resolved));
        } else if (String(stored) !== String(resolved)) {
          localStorage.setItem(deviceKey(userId), String(resolved));
        }
        if (!cancelled) setDeviceId(resolved);
      } catch (failure) {
        if (!cancelled) showError(failure);
      }
      if (!cancelled) {
        await refreshStatus();
        refreshStranded();
        flush(); // replay any points buffered while offline
      }
    })();
    const handleOnline = () => flush();
    window.addEventListener('online', handleOnline);
    // Cost audit 2026-11-13 P6: the 30s status GET used to run with the
    // tab hidden. It now skips hidden tabs and refreshes once on return
    // to visible.
    const statusTimer = setInterval(() => { if (document.visibilityState !== 'hidden') refreshStatus(); }, STATUS_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') refreshStatus(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('online', handleOnline);
      clearInterval(statusTimer);
      document.removeEventListener('visibilitychange', onVisible);
      clearCapture();
    };
  }, [jobId, userId, clearCapture, flush, refreshStatus, refreshStranded, showError, t]);

  // Cost audit 2026-11-13 P6: while tracking is active, a backgrounded
  // tab used to keep burning high-accuracy GPS plus 4 location POSTs/min.
  // Capture now pauses when the tab hides and resumes on visible, flushing
  // any points queued before the tab hid so none are lost. Pause/stop
  // still own the tracking state; this only suspends the GPS watch.
  useEffect(() => {
    if (trackingState !== 'active') return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clearCapture();
      } else {
        beginCapture();
        flush();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [trackingState, beginCapture, clearCapture, flush]);

  const act = useCallback(async (operation, successKey) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await operation();
      if (successKey) setNotice(t(successKey));
      await refreshStatus();
    } catch (failure) {
      showError(failure);
    } finally {
      setBusy(false);
    }
  }, [refreshStatus, showError, t]);

  const handleGrantConsent = () => act(async () => {
    const { consent } = await grantTrackingConsent(jobId, { deviceId, consentVersion: CONSENT_VERSION });
    if (consent) {
      setConsentGranted(true);
      writeJson(consentKey(jobId), true);
    }
  }, 'delivery.tracking.consentGranted');

  const handleRevokeConsent = () => act(async () => {
    clearCapture();
    if (trackingState === 'active') {
      try { await stopTracking(jobId, { reason: 'consent_revoked' }); } catch { /* already stopped */ }
    }
    await revokeTrackingConsent(jobId);
    lastAction.current = 'stop';
    setConsentGranted(false);
    setTrackingState('none');
    writeJson(consentKey(jobId), false);
  }, 'delivery.tracking.consentRevoked');

  const handleStart = () => act(async () => {
    const { assignment } = await startTracking(jobId, { deviceId, sourcePolicy: 'driver_gps' });
    if (assignment) {
      lastAction.current = 'start';
      setTrackingState('active');
      beginCapture();
      flush();
    }
  }, 'delivery.tracking.started');

  const handlePause = () => act(async () => {
    await pauseTracking(jobId);
    lastAction.current = 'pause';
    setTrackingState('paused');
    clearCapture();
    flush();
  }, 'delivery.tracking.paused');

  const handleResume = () => act(async () => {
    await resumeTracking(jobId);
    lastAction.current = 'resume';
    setTrackingState('active');
    beginCapture();
    flush();
  }, 'delivery.tracking.resumed');

  const handleStop = () => act(async () => {
    await stopTracking(jobId, { reason: stopReason.trim() || 'manual' });
    lastAction.current = 'stop';
    setTrackingState('none');
    clearCapture();
    setStopReason('');
    flush();
  }, 'delivery.tracking.stopped');

  // Group 9 Slice G (item 499): device-change recovery. Registering
  // this browser as the new device moves the live tracking
  // assignments and consent to it and revokes the old device, so the
  // job keeps tracking without a restart. The old device's buffered,
  // unsynced points cannot move — they stay on the old device until
  // it reconnects — and the notice says so plainly (D-92).
  // Group 9 partials Wave 2 Batch Q (499, G9-B7, D-562): the queued
  // offline actions cannot move either, and now they are counted,
  // named in the notice, and recorded server-side with the transfer
  // so ops can reconcile each stranded job. The counts are
  // re-counted at confirm time, not read from state, so actions
  // queued after the page loaded are included.
  const handleTransferDevice = () => act(async () => {
    const fresh = refreshStranded();
    const result = await transferTrackingDevice({
      oldDeviceId: deviceId,
      deviceLabel: t('delivery.tracking.deviceLabel'),
      platform: navigator.platform || null,
      strandedOutbox: fresh.jobs,
    });
    const nextId = result?.device?.id || null;
    if (nextId) {
      setDeviceId(nextId);
      localStorage.setItem(deviceKey(userId), String(nextId));
    }
    setDevices(result?.device ? [...devices.filter((d) => String(d.id) !== String(deviceId)), result.device] : devices);
    const sessions = result?.transferredAssignments?.length || 0;
    setTransferNotice(fresh.totalQueuedActions > 0 || fresh.totalUnsyncedPoints > 0
      ? t('delivery.tracking.transferStrandedNotice', { count: sessions, actions: fresh.totalQueuedActions, points: fresh.totalUnsyncedPoints })
      : t('delivery.tracking.transferUnsyncedNotice', { count: sessions }));
    await refreshStatus();
  }, 'delivery.tracking.transferred');

  // Mark the old device lost/transferred: revoke it so it can no
  // longer ingest. Its local queue is untouched by the revoke — the
  // points stay on the old device until it reconnects.
  // Group 9 partials Wave 2 Batch Q (499, G9-B7, D-562): before the
  // revoke, the stranded queue counted in this browser is reported
  // to the server, so the lost phone leaves a reconcile record
  // instead of a silent gap. A report failure never blocks the
  // revoke itself.
  const handleMarkDeviceLost = () => act(async () => {
    clearCapture();
    const fresh = refreshStranded();
    if (fresh.totalQueuedActions > 0 || fresh.totalUnsyncedPoints > 0) {
      try { await reportDeviceStrands(deviceId, fresh.jobs); } catch { /* the revoke still lands */ }
    }
    await revokeTrackingDevice(deviceId);
    localStorage.removeItem(deviceKey(userId));
    setDeviceId(null);
    setDevices(devices.filter((d) => String(d.id) !== String(deviceId)));
    setTrackingState('none');
    setTransferNotice(fresh.totalQueuedActions > 0 || fresh.totalUnsyncedPoints > 0
      ? t('delivery.tracking.deviceLostStrandedNotice', { actions: fresh.totalQueuedActions, points: fresh.totalUnsyncedPoints, jobs: fresh.totalJobs })
      : t('delivery.tracking.deviceLostNotice'));
    await refreshStatus();
  }, 'delivery.tracking.deviceLost');

  const handleScan = (scanType) => {
    const codeValue = window.prompt(t('delivery.tracking.scanCodePrompt'));
    if (codeValue == null) { setNotice(t('delivery.tracking.scanCancelled')); return; }
    const value = codeValue.trim();
    if (!value) { setNotice(t('delivery.tracking.scanCancelled')); return; }
    act(async () => {
      await postTrackingScan(jobId, {
        scanType,
        codeValue: value,
        codeFormat: 'manual',
        idempotencyKey: newIdempotencyKey(),
      });
    }, 'delivery.tracking.scanRecorded');
  };

  const statusLabel = t(`delivery.tracking.status${trackingState === 'active' ? 'Active' : trackingState === 'paused' ? 'Paused' : 'None'}`);
  const lastPointDate = lastLocationAt ? new Date(lastLocationAt) : null;
  const isStale = !lastPointDate || Number.isNaN(lastPointDate.getTime())
    || (Date.now() - lastPointDate.getTime()) > STALE_POINT_MS
    || (lastLocationState && lastLocationState !== 'valid');
  const accuracyWarning = accuracy != null && accuracy > ACCURACY_WARNING_METERS;

  return (
    <section className="delivery-panel" aria-label={t('delivery.tracking.title')}>
      <h2>{t('delivery.tracking.title')}</h2>
      <p>{t('delivery.tracking.subtitle')}</p>
      {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
      {notice && <p className="delivery-alert delivery-alert--success" role="status">{notice}</p>}

      <div className="delivery-tracking-status">
        <span className={`delivery-tracking-pill delivery-tracking-pill--${trackingState}`} role="status">
          {statusLabel}
        </span>
        <div>
          <p>
            {t('delivery.tracking.lastPoint')}: {lastPointDate && !Number.isNaN(lastPointDate.getTime())
              ? lastPointDate.toLocaleString(i18n.language)
              : t('delivery.tracking.noPoints')}
          </p>
          <p className={isStale ? 'delivery-tracking-stale' : undefined} role="status">
            {isStale ? t('delivery.tracking.stale') : t('delivery.tracking.fresh')}
          </p>
          {queuedCount > 0 && <p>{t('delivery.tracking.buffered', { count: queuedCount })}</p>}
        </div>
      </div>

      {!consentChecked && <p role="status">{t('delivery.tracking.loading')}</p>}

      {consentChecked && !consentGranted && (
        <div className="delivery-tracking-consent">
          <h3>{t('delivery.tracking.consentTitle')}</h3>
          <p>{t('delivery.tracking.consentBody')}</p>
          <button
            className="delivery-button delivery-button--primary"
            disabled={busy || !deviceId}
            onClick={handleGrantConsent} data-track="ui.5f4e3d8edc.1"
          >
            {t('delivery.tracking.consentGrant')}
          </button>
        </div>
      )}

      {consentChecked && consentGranted && (
        <>
          {gpsState === 'denied' && (
            <div className="delivery-alert delivery-alert--warning" role="alert">
              <p>{t('delivery.tracking.gpsDenied')}</p>
              <p>{t('delivery.tracking.gpsDeniedHint')}</p>
              <button
                className="delivery-button delivery-button--secondary"
                disabled={busy}
                onClick={() => { if (trackingState === 'active') beginCapture(); }} data-track="ui.5f4e3d8edc.2"
              >
                {t('delivery.tracking.retryGps')}
              </button>
            </div>
          )}
          {gpsState === 'unsupported' && (
            <p className="delivery-alert delivery-alert--warning" role="alert">
              {t('delivery.tracking.gpsUnsupported')}
            </p>
          )}
          {accuracyWarning && trackingState === 'active' && (
            <p className="delivery-alert delivery-alert--warning" role="status">
              {t('delivery.tracking.accuracyWarning', { meters: Math.round(accuracy) })}
            </p>
          )}

          <div className="delivery-tracking-controls">
            {trackingState === 'none' && (
              <button className="delivery-button delivery-button--primary" disabled={busy || !deviceId} onClick={handleStart} data-track="ui.5f4e3d8edc.3">
                {t('delivery.tracking.start')}
              </button>
            )}
            {trackingState === 'active' && (
              <>
                <button className="delivery-button delivery-button--secondary" disabled={busy} onClick={handlePause} data-track="ui.5f4e3d8edc.4">
                  {t('delivery.tracking.pause')}
                </button>
                <button className="delivery-button delivery-button--secondary" disabled={busy} onClick={handleStop} data-track="ui.5f4e3d8edc.5">
                  {t('delivery.tracking.stop')}
                </button>
                <label className="delivery-field">
                  {t('delivery.tracking.stopReason')}
                  <input
                    className="delivery-input"
                    value={stopReason}
                    maxLength={200}
                    onChange={(event) => setStopReason(event.target.value)}
                    placeholder={t('delivery.tracking.stopReasonPlaceholder')}
                  />
                </label>
              </>
            )}
            {trackingState === 'paused' && (
              <>
                <button className="delivery-button delivery-button--primary" disabled={busy} onClick={handleResume} data-track="ui.5f4e3d8edc.6">
                  {t('delivery.tracking.resume')}
                </button>
                <button className="delivery-button delivery-button--secondary" disabled={busy} onClick={handleStop} data-track="ui.5f4e3d8edc.7">
                  {t('delivery.tracking.stop')}
                </button>
              </>
            )}
          </div>

          <div className="delivery-tracking-scans">
            <h3>{t('delivery.tracking.scansTitle')}</h3>
            <div className="delivery-tracking-controls">
              {['pickup', 'handoff', 'arrival'].map((scanType) => (
                <button
                  key={scanType}
                  className="delivery-button delivery-button--secondary"
                  disabled={busy}
                  onClick={() => handleScan(scanType)} data-track="ui.5f4e3d8edc.8"
                >
                  {t(`delivery.tracking.scan${scanType[0].toUpperCase()}${scanType.slice(1)}`)}
                </button>
              ))}
            </div>
          </div>

          <button className="delivery-button delivery-button--secondary" disabled={busy} onClick={handleRevokeConsent} data-track="ui.5f4e3d8edc.9">
            {t('delivery.tracking.consentRevoke')}
          </button>

          {/* Group 9 Slice G (item 499): device-change recovery. */}
          <div className="delivery-tracking-devices">
            <h3>{t('delivery.tracking.devicesTitle')}</h3>
            <p>{t('delivery.tracking.deviceCurrent', { label: devices.find((d) => String(d.id) === String(deviceId))?.device_label || deviceId || t('delivery.tracking.noDevice') })}</p>
            {/* Group 9 partials Wave 2 Batch Q (499, G9-B7, D-562):
              the pre-transfer warning: what this device would strand.
              Shown before the driver confirms, with the per-device
              counts, so the transfer is never a blind move. */}
            {(stranded.totalQueuedActions > 0 || stranded.totalUnsyncedPoints > 0) && (
              <p className="delivery-alert delivery-alert--warning" role="status">
                {t('delivery.tracking.transferStrandedWarning', { actions: stranded.totalQueuedActions, points: stranded.totalUnsyncedPoints, jobs: stranded.totalJobs })}
              </p>
            )}
            {transferNotice && <p className="delivery-alert delivery-alert--warning" role="status">{transferNotice}</p>}
            <div className="delivery-tracking-controls">
              <button className="delivery-button delivery-button--secondary" disabled={busy || !deviceId} onClick={handleTransferDevice} data-track="ui.5f4e3d8edc.10">
                {t('delivery.tracking.transferDevice')}
              </button>
              <button className="delivery-button delivery-button--secondary" disabled={busy || !deviceId} onClick={handleMarkDeviceLost} data-track="ui.5f4e3d8edc.11">
                {t('delivery.tracking.markDeviceLost')}
              </button>
            </div>
            <p>{t('delivery.tracking.transferHint')}</p>
          </div>
        </>
      )}
    </section>
  );
}
