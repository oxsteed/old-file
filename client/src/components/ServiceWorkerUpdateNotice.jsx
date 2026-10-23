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
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    const unsubscribe = subscribeWorkerUpdate(setWorker);
    setWorker(getWaitingWorker());
    return unsubscribe;
  }, []);
  if (!worker) return null;
  return (
    <aside
      role="status"
      className="pwa-update-notice fixed bottom-4 inset-x-4 z-[10000] mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-xl border border-orange-500/40 bg-white p-4 text-gray-900 shadow-xl dark:bg-gray-900 dark:text-white"
    >
      <p className="flex-1 text-sm">{t('pwaShell.updateReady')}</p>
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
