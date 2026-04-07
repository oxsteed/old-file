import { useState, useEffect, useCallback } from 'react';
import { bootConsentedScripts, initAnalytics, disableAnalytics, initMarketing, initFunctional } from '../utils/consentScripts';

const COOKIE_KEY = 'oxsteed_cookie_consent';
const CONSENT_VERSION = '2025-06-01';

export interface CookiePreferences {
  essential: boolean;    // always true, cannot be disabled
  analytics: boolean;    // Google Analytics, Mixpanel, etc.
  marketing: boolean;    // ad pixels, retargeting
  functional: boolean;   // chat widgets, preferences
  version: string;
  timestamp: string;
}

const DEFAULT_PREFERENCES: CookiePreferences = {
  essential: true,
  analytics: false,
  marketing: false,
  functional: false,
  version: CONSENT_VERSION,
  timestamp: '',
};

export function useCookieConsent() {
  const [preferences, setPreferences] = useState<CookiePreferences | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Load saved preferences on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(COOKIE_KEY);
      if (stored) {
        const parsed: CookiePreferences = JSON.parse(stored);
        // Show banner again if version changed
        if (parsed.version !== CONSENT_VERSION) {
          setShowBanner(true);
          setPreferences(null);
        } else {
          setPreferences(parsed);
          setShowBanner(false);
          // Re-initialize scripts that user previously consented to
          bootConsentedScripts(parsed);
        }
      } else {
        setShowBanner(true);
      }
    } catch {
      setShowBanner(true);
    }
  }, []);

  const savePreferences = useCallback((prefs: Partial<CookiePreferences>) => {
    const full: CookiePreferences = {
      ...DEFAULT_PREFERENCES,
      ...prefs,
      essential: true, // always enforced
      version: CONSENT_VERSION,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem(COOKIE_KEY, JSON.stringify(full));
    setPreferences(full);
    setShowBanner(false);
    setShowSettings(false);

    // Load or disable scripts based on updated preferences
    if (full.analytics)  initAnalytics();
    else                 { disableAnalytics(); removeAnalyticsCookies(); }
    if (full.marketing)  initMarketing();
    else                 removeMarketingCookies();
    if (full.functional) initFunctional();
  }, []);

  const acceptAll = useCallback(() => {
    savePreferences({
      analytics: true,
      marketing: true,
      functional: true,
    });
  }, [savePreferences]);

  const rejectAll = useCallback(() => {
    savePreferences({
      analytics: false,
      marketing: false,
      functional: false,
    });
  }, [savePreferences]);

  const openSettings = useCallback(() => setShowSettings(true), []);
  const closeSettings = useCallback(() => setShowSettings(false), []);

  const hasConsent = useCallback(
    (category: keyof Omit<CookiePreferences, 'version' | 'timestamp'>) => {
      return preferences?.[category] ?? false;
    },
    [preferences]
  );

  return {
    preferences,
    showBanner,
    showSettings,
    acceptAll,
    rejectAll,
    savePreferences,
    openSettings,
    closeSettings,
    hasConsent,
  };
}

// ─── Cookie Cleanup Helpers ───────────────────────────────────
function removeAnalyticsCookies() {
  const patterns = ['_ga', '_gid', '_gat', 'mp_', 'mixpanel'];
  removeCookiesByPattern(patterns);
}

function removeMarketingCookies() {
  const patterns = ['_fbp', '_fbc', 'fr', '_gcl', '_uet'];
  removeCookiesByPattern(patterns);
}

function removeCookiesByPattern(patterns: string[]) {
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0].trim();
    if (patterns.some((p) => name.startsWith(p))) {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.oxsteed.com`;
    }
  });
}

export default useCookieConsent;
