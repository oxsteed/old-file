import { createContext, useContext } from 'react';
import { useCookieConsent } from '../hooks/useCookieConsent';
import type { CookiePreferences } from '../hooks/useCookieConsent';

interface CookieConsentContextValue {
  preferences: CookiePreferences | null;
  showBanner: boolean;
  showSettings: boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  savePreferences: (prefs: Partial<CookiePreferences>) => void;
  openSettings: () => void;
  closeSettings: () => void;
  hasConsent: (category: keyof Omit<CookiePreferences, 'version' | 'timestamp'>) => boolean;
}

export const CookieConsentContext = createContext<CookieConsentContextValue | null>(null);

/**
 * Provides a single shared instance of useCookieConsent() to the entire tree.
 * Both <CookieConsent> and <Footer> must consume this context via
 * useCookieConsentContext() so they operate on the same state.
 */
export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
  const consent = useCookieConsent();
  return (
    <CookieConsentContext.Provider value={consent}>
      {children}
    </CookieConsentContext.Provider>
  );
}

export function useCookieConsentContext(): CookieConsentContextValue {
  const ctx = useContext(CookieConsentContext);
  if (!ctx) {
    throw new Error('useCookieConsentContext must be used within <CookieConsentProvider>');
  }
  return ctx;
}
