import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  applyWorkerUpdate,
  getWaitingWorker,
  subscribeWorkerUpdate,
} from '../utils/serviceWorkerRegistration';

export default function ServiceWorkerUpdateNotice() {
  const { t } = useTranslation();
  const [worker, setWorker] = useState(getWaitingWorker);
  const [dismissedWorker, setDismissedWorker] = useState(null);
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    const unsubscribe = subscribeWorkerUpdate(setWorker);
    setWorker(getWaitingWorker());
    return unsubscribe;
  }, []);
  if (!worker || worker === dismissedWorker) return null;
  return (
    <aside
      role="status"
      className="pwa-update-notice fixed bottom-4 inset-x-4 z-[10000] mx-auto flex max-w-lg flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 text-gray-900 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-white"
    >
      <p className="flex-1 text-sm">{t('pwaShell.updateReady')}</p>
      <button
        type="button"
        disabled={updating}
        onClick={() => setDismissedWorker(worker)}
        className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-60 dark:hover:bg-gray-800"
      >
        {t('pwaShell.later')}
      </button>
      <button
        type="button"
        disabled={updating}
        onClick={() => {
          setUpdating(true);
          applyWorkerUpdate();
        }}
        className="rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
        data-track="pwa.refresh-update"
      >
        {t(updating ? 'pwaShell.updating' : 'pwaShell.refresh')}
      </button>
    </aside>
  );
}
