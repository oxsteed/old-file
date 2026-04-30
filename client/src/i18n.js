import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import ht from './locales/ht.json';
import enTerms from './locales/terms/en.content.json';
import esTerms from './locales/terms/es.content.json';
import frTerms from './locales/terms/fr.content.json';
import htTerms from './locales/terms/ht.content.json';

export const LANGUAGES = [
  { code: 'en', name: 'English',  flag: '🇬🇧' },
  { code: 'es', name: 'Español',  flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'ht', name: 'Kreyòl',   flag: '🇭🇹' },
];

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: { ...en, termsContent: enTerms } },
      es: { translation: { ...es, termsContent: esTerms } },
      fr: { translation: { ...fr, termsContent: frTerms } },
      ht: { translation: { ...ht, termsContent: htTerms } },
    },
    lng: localStorage.getItem('oxs:language') || 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    react: { useSuspense: false }, // Prevent Suspense errors during initialization
  });

export default i18n;
