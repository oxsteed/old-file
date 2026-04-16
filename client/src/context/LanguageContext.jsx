import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import i18n from '../i18n';
import { getSupportedLanguages } from '../api/translate';

const LS_KEY = 'oxs:language';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(
    () => localStorage.getItem(LS_KEY) || 'en'
  );
  const [availableLanguages, setAvailableLanguages] = useState([
    { code: 'en', name: 'English' },
  ]);

  // Fetch the list of languages our LibreTranslate instance supports.
  // This drives the LanguageSelector dropdown — i18next itself doesn't know
  // which languages are available since locale files are loaded lazily.
  useEffect(() => {
    getSupportedLanguages()
      .then(langs => {
        if (Array.isArray(langs) && langs.length > 0) setAvailableLanguages(langs);
      })
      .catch(() => {});
  }, []);

  const setLanguage = useCallback((code) => {
    localStorage.setItem(LS_KEY, code);
    setLanguageState(code);
    // i18next fetches the locale JSON from /public/locales/<code>.json if not
    // already loaded, then re-renders all components using useTranslation().
    i18n.changeLanguage(code);
  }, []);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, availableLanguages }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return ctx;
}
