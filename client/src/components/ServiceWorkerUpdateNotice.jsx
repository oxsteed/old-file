import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  applyWorkerUpdate,
  getWaitingWorker,
  subscribeWorkerUpdate,
} from '../utils/serviceWorkerRegistration';
import { appUpdatesDeferred, subscribeUpdateSafety } from '../utils/appUpdateSafety';

const DISMISSED_WORKER_KEY = 'oxsteed:pwa-update-dismissed';

// Item 37: the "Later" dismissal is persisted per tab session as the
// dismissed worker's id (its scriptURL). A reload re-prompts for the same
// worker only if it was never dismissed; a NEW waiting worker (different
// id) clears the dismissal so the user is prompted again.
function readDismissedWorkerId() {
  try { return sessionStorage.getItem(DISMISSED_WORKER_KEY); } catch { return null; }
}
function workerId(worker) {
  return (worker && worker.scriptURL) || 'waiting';
}

export default function ServiceWorkerUpdateNotice() {
  const { t } = useTranslation();
  const [worker, setWorker] = useState(getWaitingWorker);
  const [dismissedWorkerId, setDismissedWorkerId] = useState(readDismissedWorkerId);
  const [updating, setUpdating] = useState(false);
  const deferred = useSyncExternalStore(subscribeUpdateSafety, appUpdatesDeferred, appUpdatesDeferred);
  useEffect(() => {
    const unsubscribe = subscribeWorkerUpdate(setWorker);
    setWorker(getWaitingWorker());
    return unsubscribe;
  }, []);
  // A new waiting worker clears a stale dismissal from an older worker.
  useEffect(() => {
    if (!worker || !dismissedWorkerId) return;
    if (dismissedWorkerId !== workerId(worker)) {
      try { sessionStorage.removeItem(DISMISSED_WORKER_KEY); } catch { /* dismissal is best-effort */ }
      setDismissedWorkerId(null);
    }
  }, [worker, dismissedWorkerId]);
  const handleLater = () => {
    const id = workerId(worker);
    try { sessionStorage.setItem(DISMISSED_WORKER_KEY, id); } catch { /* dismissal is best-effort */ }
    setDismissedWorkerId(id);
  };
  if (!worker || (dismissedWorkerId && dismissedWorkerId === workerId(worker)) || deferred) return null;
  return (
    <aside
      role="status"
      className="pwa-update-notice fixed bottom-4 inset-x-4 z-[10000] mx-auto flex max-w-lg flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 text-gray-900 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-white"
    >
      <p className="flex-1 text-sm">{t('pwaShell.updateReady')}</p>
      <button
        type="button"
        disabled={updating}
        onClick={handleLater}
        className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-60 dark:hover:bg-gray-800"
      >
        {t('pwaShell.later')}
      </button>
      <button
        type="button"
        disabled={updating}
        onClick={() => {
          if (applyWorkerUpdate()) setUpdating(true);
        }}
        className="rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
        data-track="pwa.refresh-update"
      >
        {t(updating ? 'pwaShell.updating' : 'pwaShell.refresh')}
      </button>
    </aside>
  );
}
