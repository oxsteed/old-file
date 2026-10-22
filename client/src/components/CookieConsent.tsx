import { useState, useEffect, useRef, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useCookieConsentContext } from '../context/CookieConsentContext';
import { hasGlobalPrivacyControl } from '../utils/consentScripts';
import '../styles/CookieConsent.css';

export default function CookieConsent() {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const gpc = hasGlobalPrivacyControl();
  const {
    showBanner,
    showSettings,
    acceptAll,
    rejectAll,
    savePreferences,
    openSettings,
    closeSettings,
    preferences,
    growthPolicyEffective,
  } = useCookieConsentContext();

  const [local, setLocal] = useState({
    analytics: false,
    marketing: false,
    functional: false,
  });

  // Seed the local toggle state from saved preferences each time the settings
  // panel opens, so returning users see their existing choices rather than
  // all-false - which would silently revoke prior consent on "Save".
  useEffect(() => {
    if (showSettings) {
      setLocal({
        analytics: preferences?.analytics ?? false,
        marketing: !gpc && (preferences?.marketing ?? false),
        functional: preferences?.functional ?? false,
      });
    }
  }, [showSettings, preferences, gpc]);

  useEffect(() => {
    if (!showSettings) return;
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeSettings(); }
      if (event.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]') || [])];
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [showSettings, closeSettings]);

  if (!showBanner && !showSettings) return null;

  // ─── Settings Panel ──────────────────────────────────────────────
  if (showSettings) {
    return (
      <div className="cookie-consent-overlay" role="presentation">
        <div ref={dialog} className="cookie-consent-settings" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="cookie-consent-settings__header">
            <h3 id={titleId}>{t('cookieConsent.title')}</h3>
            <button className="cookie-consent-close" onClick={closeSettings} aria-label={t('common.close', 'Close')}>&times;</button>
          </div>
          <p className="cookie-consent-description">{t('cookieConsent.desc')}</p>
          {gpc && <p role="status" className="cookie-consent-description">{t('cookieConsent.gpc')}</p>}

          <div className="cookie-consent-category">
            <div className="cookie-consent-category__header">
              <span className="cookie-consent-category__title">{t('cookieConsent.essential')}</span>
              <span className="cookie-consent-always-on">{t('cookieConsent.essentialAlwaysOn')}</span>
            </div>
            <p className="cookie-consent-category__description">{t('cookieConsent.essentialDesc')}</p>
          </div>

          <div className="cookie-consent-category">
            <label className="cookie-consent-category__header">
              <span className="cookie-consent-category__title">{t(growthPolicyEffective?'growthInsights.analyticsStorage':'cookieConsent.analytics')}</span>
              <input type="checkbox" checked={local.analytics}
                onChange={(e) => setLocal((p) => ({ ...p, analytics: e.target.checked }))}
                className="cookie-consent-checkbox" />
            </label>
            <p className="cookie-consent-category__description">{t(growthPolicyEffective?'growthInsights.analyticsStorageDescription':'cookieConsent.analyticsDesc')}</p>
          </div>

          <div className="cookie-consent-category">
            <label className="cookie-consent-category__header">
              <span className="cookie-consent-category__title">{t('cookieConsent.marketing')}</span>
              <input type="checkbox" checked={local.marketing} disabled={gpc}
                onChange={(e) => setLocal((p) => ({ ...p, marketing: e.target.checked }))}
                className="cookie-consent-checkbox" />
            </label>
            <p className="cookie-consent-category__description">{t('cookieConsent.marketingDesc')}</p>
          </div>

          <div className="cookie-consent-category">
            <label className="cookie-consent-category__header">
              <span className="cookie-consent-category__title">{t('cookieConsent.functional')}</span>
              <input type="checkbox" checked={local.functional}
                onChange={(e) => setLocal((p) => ({ ...p, functional: e.target.checked }))}
                className="cookie-consent-checkbox" />
            </label>
            <p className="cookie-consent-category__description">{t('cookieConsent.functionalDesc')}</p>
          </div>

          <div className="cookie-consent-settings__actions">
            <button onClick={() => savePreferences(local)} className="cookie-consent-button cookie-consent-button--primary">{t('cookieConsent.savePreferences')}</button>
            <button onClick={rejectAll} className="cookie-consent-button cookie-consent-button--secondary">{t('cookieConsent.rejectAll')}</button>
            <button onClick={acceptAll} className="cookie-consent-button cookie-consent-button--secondary">{t('cookieConsent.acceptAll')}</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Banner ────────────────────────────────────────────────────
  return (
    <div className="cookie-consent-banner" role="region" aria-label={t('cookieConsent.title')}>
      <div className="cookie-consent-banner__inner">
        <div className="cookie-consent-banner__copy">
          <p>
            {t('cookieConsent.bannerText')}{' '}
            <a href="/cookie-policy">{t('cookieConsent.cookiePolicy')}</a>
          </p>
        </div>
        <div className="cookie-consent-banner__actions">
          <button onClick={rejectAll} className="cookie-consent-button cookie-consent-button--secondary">{t('cookieConsent.rejectAll')}</button>
          <button onClick={openSettings} className="cookie-consent-button cookie-consent-button--outline">{t('cookieConsent.customize')}</button>
          <button onClick={acceptAll} className="cookie-consent-button cookie-consent-button--primary">{t('cookieConsent.acceptAll')}</button>
        </div>
      </div>
    </div>
  );
}
