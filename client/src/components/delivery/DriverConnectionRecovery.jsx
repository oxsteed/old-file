import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { flushOutbox } from './driverOfflineOutbox';

// Group 9 Slice G (item 497): the explicit connection-recovery flow
// for the assigned driver. Recovery used to be implicit — a socket
// reconnect reloaded the page and the GPS queue flushed on `online`
// — with no visible state and no reconciliation. This component
// shows the connection state (online / offline / reconnecting) on
// the driver job screen and offers one explicit "reconnect and
// resync" action: it re-fetches the job, replays the offline queue
// from item 496, and reconciles any server-side changes that
// happened while the driver was offline.
//
// Reconciliation compares the last known snapshot (status and
// assigned driver) with the fresh job: if the job changed hands
// while the driver was offline, the notice says so plainly; if only
// the status moved, it names the new status. If the re-fetch itself
// 404s/403s for the driver, the job has moved on without them —
// that is the same reassigned signal. One explicit resync plus the
// existing automatic flush; there is no endless auto-retry loop.

function snapshotOf(job) {
  if (!job) return null;
  return {
    status: job.status,
    driverIds: [job.helper_user_id, job.internal_driver_user_id].filter(Boolean).map(String),
    updatedAt: job.updated_at || null,
  };
}

function driverChanged(before, after) {
  if (!before) return false;
  const afterIds = [after?.helper_user_id, after?.internal_driver_user_id].filter(Boolean).map(String);
  return before.driverIds.length > 0
    && (afterIds.length === 0 || !before.driverIds.some((id) => afterIds.includes(id)));
}

export default function DriverConnectionRecovery({ job, executors, onResync }) {
  const { t } = useTranslation();
  const jobId = job?.id;
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [reconnecting, setReconnecting] = useState(false);
  const [notice, setNotice] = useState(null); // { type: 'resynced' | 'statusChanged' | 'reassigned' | 'error', status? }
  const [error, setError] = useState('');
  const snapshot = useRef(snapshotOf(job));

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Keep the snapshot at the last job the screen actually showed.
  // The snapshot only moves on a successful resync, so a change
  // that lands while offline is always caught by the comparison.
  useEffect(() => {
    if (job && !reconnecting) snapshot.current = snapshotOf(job);
  }, [job, reconnecting]);

  const handleResync = useCallback(async () => {
    if (!jobId || reconnecting) return;
    const before = snapshot.current;
    setReconnecting(true); setError(''); setNotice(null);
    try {
      const fresh = await onResync();
      if (executors) await flushOutbox(window.localStorage, jobId, executors);
      if (driverChanged(before, fresh)) {
        setNotice({ type: 'reassigned' });
      } else if (before && fresh && before.status !== fresh.status) {
        setNotice({ type: 'statusChanged', status: fresh.status });
      } else {
        setNotice({ type: 'resynced' });
      }
      snapshot.current = snapshotOf(fresh);
    } catch (failure) {
      const status = failure?.response?.status;
      if ([401, 403, 404].includes(status)) {
        setNotice({ type: 'reassigned' });
      } else {
        setError(t('delivery.connection.resyncFailed'));
      }
    } finally {
      setReconnecting(false);
    }
  }, [jobId, reconnecting, onResync, executors, t]);

  const state = reconnecting ? 'reconnecting' : online ? 'online' : 'offline';

  return (
    <section className="delivery-panel" aria-label={t('delivery.connection.title')}>
      <h2>{t('delivery.connection.title')}</h2>
      <p role="status">
        <span className={`delivery-tracking-pill delivery-tracking-pill--${state === 'online' ? 'active' : state === 'offline' ? 'none' : 'paused'}`}>
          {t(`delivery.connection.states.${state}`)}
        </span>
      </p>
      {!online && <p>{t('delivery.connection.offlineHint')}</p>}
      {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
      {notice?.type === 'reassigned' && (
        <p className="delivery-alert delivery-alert--warning" role="alert">{t('delivery.connection.reassigned')}</p>
      )}
      {notice?.type === 'statusChanged' && (
        <p className="delivery-alert delivery-alert--warning" role="status">
          {t('delivery.connection.statusChanged', { status: t(`delivery.helper.status.${notice.status}`) })}
        </p>
      )}
      {notice?.type === 'resynced' && (
        <p className="delivery-alert delivery-alert--success" role="status">{t('delivery.connection.resynced')}</p>
      )}
      <button
        type="button"
        className="delivery-button delivery-button--primary"
        disabled={reconnecting}
        onClick={handleResync}
        data-track="ui.a91596fac8.1"
      >
        {reconnecting ? t('delivery.connection.resyncing') : t('delivery.connection.resync')}
      </button>
    </section>
  );
}
