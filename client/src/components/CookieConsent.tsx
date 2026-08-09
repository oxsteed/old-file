import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCookieConsentContext } from '../context/CookieConsentContext';
import type { CookiePreferences } from '../hooks/useCookieConsent';
import '../styles/CookieConsent.css';

export default function CookieConsent() {
  const { t } = useTranslation();
  const {
    showBanner,
    showSettings,
    acceptAll,
    rejectAll,
    savePreferences,
    openSettings,
    closeSettings,
    preferences,
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
    if (showSettings && preferences) {
      setLocal({
        analytics: preferences.analytics ?? false,
        marketing: preferences.marketing ?? false,
        functional: preferences.functional ?? false,
      });
    }
  }, [showSettings, preferences]);

  if (!showBanner && !showSettings) return null;

  // ─── Settings Panel ──────────────────────────────────────────────
  if (showSettings) {
    return (
      <div className="cookie-consent-overlay" role="presentation">
        <div className="cookie-consent-settings" role="dialog" aria-modal="true" aria-labelledby="cookie-consent-title">
          <div className="cookie-consent-settings__header">
            <h3 id="cookie-consent-title">{t('cookieConsent.title')}</h3>
            <button className="cookie-consent-close" onClick={closeSettings} aria-label={t('common.close', 'Close')}>&times;</button>
          </div>
          <p className="cookie-consent-description">{t('cookieConsent.desc')}</p>

          <div className="cookie-consent-category">
            <div className="cookie-consent-category__header">
              <span className="cookie-consent-category__title">{t('cookieConsent.essential')}</span>
              <span className="cookie-consent-always-on">{t('cookieConsent.essentialAlwaysOn')}</span>
            </div>
            <p className="cookie-consent-category__description">{t('cookieConsent.essentialDesc')}</p>
          </div>

          <div className="cookie-consent-category">
            <label className="cookie-consent-category__header">
              <span className="cookie-consent-category__title">{t('cookieConsent.analytics')}</span>
              <input type="checkbox" checked={local.analytics}
                onChange={(e) => setLocal((p) => ({ ...p, analytics: e.target.checked }))}
                className="cookie-consent-checkbox" />
            </label>
            <p className="cookie-consent-category__description">{t('cookieConsent.analyticsDesc')}</p>
          </div>

          <div className="cookie-consent-category">
            <label className="cookie-consent-category__header">
              <span className="cookie-consent-category__title">{t('cookieConsent.marketing')}</span>
              <input type="checkbox" checked={local.marketing}
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
