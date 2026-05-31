import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import i18n, { LANGUAGES } from '../i18n';
import api from '../api/axios';

const LanguageContext = createContext(null);
const SUPPORTED = new Set(LANGUAGES.map((item) => item.code));

function normalizeLanguage(code) {
  return SUPPORTED.has(code) ? code : 'en';
}

function applyDocumentLanguage(code) {
  if (typeof document === 'undefined') return;
  const isRtl = code === 'ar';
  document.documentElement.setAttribute('lang', code);
  document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
  document.body?.classList.toggle('rtl', isRtl);
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(
    () => normalizeLanguage(localStorage.getItem('oxs:language') || 'en')
  );

  useEffect(() => {
    applyDocumentLanguage(language);
  }, [language]);

  const setLanguage = useCallback((code) => {
    const normalizedCode = normalizeLanguage(code);
    localStorage.setItem('oxs:language', normalizedCode);
    setLanguageState(normalizedCode);
    i18n.changeLanguage(normalizedCode);
    applyDocumentLanguage(normalizedCode);
    void api.patch('/users/me', { preferred_language: normalizedCode })
      .catch(() => {});
  }, []);

  const syncLanguageFromServer = useCallback((code) => {
    const normalizedCode = normalizeLanguage(code || 'en');
    localStorage.setItem('oxs:language', normalizedCode);
    setLanguageState(normalizedCode);
    i18n.changeLanguage(normalizedCode);
    applyDocumentLanguage(normalizedCode);
  }, []);

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
