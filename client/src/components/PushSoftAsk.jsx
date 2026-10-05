/**
 * PushSoftAsk.jsx — branded pre-permission card for web push
 *
 * Shown once per value moment (never on page load). Names the exact alerts
 * the user will get, then fires the native prompt only on "Enable".
 * Mounted globally in App.jsx next to PwaInstallPrompt.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribePushPrompt, dismissPushAsk, resolvePushAsk } from '../utils/pushPrompt';
import { useWebPush } from '../hooks/useWebPush';

const AUTO_DISMISS_MS = 12000;

function BellGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export default function PushSoftAsk() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(null);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef(null);
  const { subscribe, isSupported, serverEnabled, ready } = useWebPush();

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(null);
    setBusy(false);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribePushPrompt((change) => {
      if (change.type === 'show') {
        setVisible({ kind: change.kind });
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          dismissPushAsk();
        }, AUTO_DISMISS_MS);
      } else {
        hide();
      }
    });
    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hide]);

  if (!visible) return null;

  const onEnable = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!isSupported || !serverEnabled) {
      dismissPushAsk();
      hide();
      return;
    }
    setBusy(true);
    try {
      const ok = await subscribe('soft-ask');
      resolvePushAsk(ok ? 'subscribed' : 'dismissed');
    } catch {
      resolvePushAsk('dismissed');
    }
    hide();
  };

  const onLater = () => {
    dismissPushAsk();
    hide();
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[90] flex justify-center px-4 pb-5"
      role="dialog"
      aria-live="polite"
      aria-label={t('push.title')}
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-2xl backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500">
            <BellGlyph />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900 dark:text-white">{t('push.title')}</p>
            <p className="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">{t('push.body')}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onEnable}
                disabled={busy || !ready}
                className="rounded-lg bg-orange-500 px-4 py-2 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-60"
              >
                {busy ? t('push.enabling') : t('push.enable')}
              </button>
              <button
                type="button"
                onClick={onLater}
                disabled={busy}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                {t('push.later')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
