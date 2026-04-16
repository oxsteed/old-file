import { createContext, useCallback, useContext, useState } from 'react';
import i18n, { LANGUAGES } from '../i18n';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(
    () => localStorage.getItem('oxs:language') || 'en'
  );

  const setLanguage = useCallback((code) => {
    localStorage.setItem('oxs:language', code);
    setLanguageState(code);
    i18n.changeLanguage(code);
  }, []);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, availableLanguages: LANGUAGES }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return ctx;
}
