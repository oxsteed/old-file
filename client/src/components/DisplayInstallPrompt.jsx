// "Add to Home Screen" install prompt for the public restaurant display
// pages. iPad Safari has no Fullscreen API, so installing the page is how a
// tablet gets a chromeless standalone display (the manifest already declares
// standalone). Shows once, dismissible, dismissal remembered in
// localStorage. Skipped entirely when already installed.
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import {
  detectDisplayStandalone,
  isIpadSafari,
  displayManifestHref,
  parseDisplayRoutePath,
  readInstallPromptDismissed,
  saveDisplayInstallDestination,
  shouldShowInstallPrompt,
  writeInstallPromptDismissed,
} from '../utils/displayInstall';

export default function DisplayInstallPrompt() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  // Remember where this installed display should land on next launch.
  // Only valid display routes are persisted (saveDisplayInstallDestination
  // refuses anything else).
  const persistDestination = () => {
    const parsed = parseDisplayRoutePath(pathname);
    if (!parsed) return;
    saveDisplayInstallDestination(parsed);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const manifestBase = manifestLink?.dataset?.oxsteedManifestBase
      || manifestLink?.getAttribute('href')?.split('?')[0]
      || '/manifest.json';
    const parsedPath = parseDisplayRoutePath(pathname);
    if (manifestLink && parsedPath) {
      manifestLink.href = displayManifestHref(parsedPath.path, manifestBase);
    }
    const standalone = detectDisplayStandalone({
      matchMedia: window.matchMedia?.bind(window),
      standalone: window.navigator?.standalone,
    });
    setVisible(false);
    if (parsedPath && isIpadSafari(window.navigator) && shouldShowInstallPrompt({ dismissed: readInstallPromptDismissed(), standalone })) {
      persistDestination();
      setVisible(true);
    }
    const onBeforeInstall = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      if (manifestLink) manifestLink.href = manifestBase;
    };
  }, [pathname]);

  if (!visible) return null;

  const dismiss = () => {
    writeInstallPromptDismissed();
    setVisible(false);
  };

  // Collapsed by default: a small floating button that never intercepts
  // taps meant for the page (kiosk ordering flow, kitchen tickets).
  if (!expanded) {
    return (
      <button
        type="button"
        className="fd-display-install-fab"
        aria-label={t('display.install.title')}
        title={t('display.install.title')}
        onClick={() => setExpanded(true)} data-track="ui.726bd2c264.1"
      >
        <span aria-hidden="true">⤓</span>
      </button>
    );
  }

  const installNow = async () => {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch {
      // The browser dismissed the prompt; keep our card up.
      return;
    }
    // Install accepted: remember the destination before the app relaunches.
    persistDestination();
    setDeferredPrompt(null);
    dismiss();
  };

  return (
    <div className="fd-display-install" role="dialog" aria-label={t('display.install.title')}>
      <button
        type="button"
        className="fd-display-install-close"
        aria-label={t('common.close')}
        onClick={() => setExpanded(false)} data-track="ui.726bd2c264.2"
      >
        <span aria-hidden="true">×</span>
      </button>
      <strong className="fd-display-install-title">{t('display.install.title')}</strong>
      <p>{t('display.install.body')}</p>
      {!deferredPrompt && (
        <ol className="fd-display-install-steps">
          <li>{t('display.install.stepShare')}</li>
          <li>{t('display.install.stepAdd')}</li>
        </ol>
      )}
      <div className="fd-display-install-actions">
        {deferredPrompt && (
          <button type="button" className="fd-btn fd-btn-sm" onClick={installNow} data-track="ui.726bd2c264.3">
            {t('display.install.installNow')}
          </button>
        )}
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={dismiss} data-track="ui.726bd2c264.4">
          {t('display.install.dismiss')}
        </button>
      </div>
    </div>
  );
}
