import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import i18n, { LANGUAGES, detectInitialLanguage } from '../i18n';
import api from '../api/axios';

const LanguageContext = createContext(null);
const SUPPORTED = new Set(LANGUAGES.map((item) => item.code));

function normalizeLanguage(code) {
  const normalizedCode = String(code || '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return SUPPORTED.has(normalizedCode) ? normalizedCode : 'en';
}

function getStoredLanguage() {
  if (typeof localStorage === 'undefined') return detectInitialLanguage();
  return localStorage.getItem('oxs:language') || detectInitialLanguage();
}

function applyDocumentLanguage(code) {
  if (typeof document === 'undefined') return;
  const isRtl = code === 'ar';
  document.documentElement.setAttribute('lang', code);
  document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
  document.body?.classList.toggle('rtl', isRtl);
  document.body?.classList.toggle('is-rtl', isRtl);
  document.body?.classList.remove(...LANGUAGES.map((item) => `lang-${item.code}`));
  document.body?.classList.add(`lang-${code}`);
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(
    () => normalizeLanguage(getStoredLanguage())
  );

  useEffect(() => {
    applyDocumentLanguage(language);
    if (i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleStorage = (event) => {
      if (event.key !== 'oxs:language') return;
      const normalizedCode = normalizeLanguage(event.newValue);
      setLanguageState(normalizedCode);
      i18n.changeLanguage(normalizedCode);
      applyDocumentLanguage(normalizedCode);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setLanguage = useCallback((code) => {
    const normalizedCode = normalizeLanguage(code);
    if (normalizedCode === language) return;
    localStorage.setItem('oxs:language', normalizedCode);
    setLanguageState(normalizedCode);
    i18n.changeLanguage(normalizedCode);
    applyDocumentLanguage(normalizedCode);
    void api.patch('/users/me', { preferred_language: normalizedCode })
      .catch(() => {});
  }, [language]);

  const syncLanguageFromServer = useCallback((code) => {
    if (!code) return;
    const normalizedCode = normalizeLanguage(code);
    if (normalizedCode === language) return;
    localStorage.setItem('oxs:language', normalizedCode);
    setLanguageState(normalizedCode);
    i18n.changeLanguage(normalizedCode);
    applyDocumentLanguage(normalizedCode);
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, syncLanguageFromServer, availableLanguages: LANGUAGES }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return ctx;
}
