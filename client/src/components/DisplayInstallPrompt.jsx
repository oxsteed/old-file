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
// Single owner for beforeinstallprompt: pwaInstall.js captures the
// one-shot event at boot. This component only subscribes to its state
// and fires the shared promptInstall(); it never adds its own listener
// or stashes its own copy of the event (M12).
import {
  subscribePwaInstall,
  hasNativePrompt,
  promptInstall,
} from '../utils/pwaInstall';

export default function DisplayInstallPrompt() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [nativeAvailable, setNativeAvailable] = useState(() => hasNativePrompt());

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
    const ipad = isIpadSafari(window.navigator);
    const dismissed = readInstallPromptDismissed();
    const showForNative = !ipad && !standalone && !dismissed && hasNativePrompt();
    if (parsedPath && ((ipad && shouldShowInstallPrompt({ dismissed, standalone })) || showForNative)) {
      persistDestination();
      setVisible(true);
    }
    setNativeAvailable(hasNativePrompt());
    // Subscribe to the single owner's state: the native prompt may arrive
    // after this page mounts, and firing it here must go through the
    // shared promptInstall() so no second holder can consume the event.
    const unsubscribe = subscribePwaInstall((change) => {
      setNativeAvailable(hasNativePrompt());
      if (change.type === 'eligible' && parsedPath && !ipad && !standalone && !readInstallPromptDismissed()) {
        persistDestination();
        setVisible(true);
      }
    });
    return () => {
      unsubscribe();
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
    if (!nativeAvailable) return;
    const outcome = await promptInstall();
    // Install accepted: remember the destination before the app relaunches.
    if (outcome === 'accepted') persistDestination();
    setNativeAvailable(hasNativePrompt());
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
      {!nativeAvailable && (
        <ol className="fd-display-install-steps">
          <li>{t('display.install.stepShare')}</li>
          <li>{t('display.install.stepAdd')}</li>
        </ol>
      )}
      <div className="fd-display-install-actions">
        {nativeAvailable && (
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
