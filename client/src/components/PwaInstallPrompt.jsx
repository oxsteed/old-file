/**
 * PwaInstallPrompt.jsx — global install prompt host
 *
 * Mounted once in App.jsx. Listens to utils/pwaInstall for `show` events
 * fired only at money moments (never on page load):
 *  - native: bottom snackbar with Install / Not now, auto-dismisses after 8s
 *  - iOS: coach-marks card with the real Share-icon steps (iOS never fires
 *    beforeinstallprompt, so this is its only install path)
 *
 * Follows app light/dark tokens; all copy localized in 5 languages.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  subscribePwaInstall,
  promptInstall,
  dismissPwaPrompt,
} from '../utils/pwaInstall';

const AUTO_DISMISS_MS = 8000;

function ShareGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V3" />
      <path d="M7 8l5-5 5 5" />
      <path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
    </svg>
  );
}

function InstallGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 21h16" />
    </svg>
  );
}

export default function PwaInstallPrompt() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(null); // null | { native: bool }
  const timerRef = useRef(null);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(null);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribePwaInstall((change) => {
      if (change.type === 'show') {
        setVisible({ native: !!change.native });
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          dismissPwaPrompt();
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

  const onInstall = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await promptInstall();
    hide();
  };

  const onNotNow = () => {
    dismissPwaPrompt();
    hide();
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[90] flex justify-center px-4 pb-5"
      role="dialog"
      aria-live="polite"
      aria-label={t('pwa.installTitle')}
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-2xl backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
        {visible.native ? (
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500">
              <InstallGlyph />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-gray-900 dark:text-white">{t('pwa.installTitle')}</p>
              <p className="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">{t('pwa.installBody')}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={onInstall}
                  className="rounded-lg bg-orange-500 px-4 py-2 text-xs font-bold text-white hover:bg-orange-600"
                >
                  {t('pwa.installCta')}
                </button>
                <button
                  type="button"
                  onClick={onNotNow}
                  className="rounded-lg px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  {t('pwa.notNow')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500">
              <ShareGlyph />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-gray-900 dark:text-white">{t('pwa.iosTitle')}</p>
              <ol className="mt-1.5 space-y-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                <li>1. {t('pwa.iosStep1')}</li>
                <li>2. {t('pwa.iosStep2')}</li>
                <li>3. {t('pwa.iosStep3')}</li>
              </ol>
              <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">{t('pwa.iosNote')}</p>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={onNotNow}
                  className="rounded-lg px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  {t('pwa.notNow')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
