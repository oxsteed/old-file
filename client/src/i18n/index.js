import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enLegacy from '../locales/en.json';
import esLegacy from '../locales/es.json';
import frLegacy from '../locales/fr.json';
import htLegacy from '../locales/ht.json';
import enTerms from '../locales/terms/en.content.json';
import esTerms from '../locales/terms/es.content.json';
import frTerms from '../locales/terms/fr.content.json';
import htTerms from '../locales/terms/ht.content.json';
import enPrivacy from '../locales/privacy/en.content.json';
import esPrivacy from '../locales/privacy/es.content.json';
import frPrivacy from '../locales/privacy/fr.content.json';
import htPrivacy from '../locales/privacy/ht.content.json';

import enCommon from './locales/en/common.json';
import esCommon from './locales/es/common.json';
import frCommon from './locales/fr/common.json';
import htCommon from './locales/ht/common.json';
import enTranslator from './locales/en/translator.json';
import esTranslator from './locales/es/translator.json';
import frTranslator from './locales/fr/translator.json';
import htTranslator from './locales/ht/translator.json';

export const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'ht', name: 'Kreyòl', flag: '🇭🇹' },
];

const resources = {
  en: {
    translation: {
      ...enLegacy,
      termsContent: enTerms,
      privacyContent: enPrivacy,
    },
    common: enCommon,
    translator: enTranslator,
  },
  es: {
    translation: {
      ...esLegacy,
      termsContent: esTerms,
      privacyContent: esPrivacy,
    },
    common: esCommon,
    translator: esTranslator,
  },
  fr: {
    translation: {
      ...frLegacy,
      termsContent: frTerms,
      privacyContent: frPrivacy,
    },
    common: frCommon,
    translator: frTranslator,
  },
  ht: {
    translation: {
      ...htLegacy,
      termsContent: htTerms,
      privacyContent: htPrivacy,
    },
    common: htCommon,
    translator: htTranslator,
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem('oxs:language') || 'en',
  fallbackLng: 'en',
  supportedLngs: LANGUAGES.map((language) => language.code),
  ns: ['translation', 'common', 'translator'],
  defaultNS: 'translation',
  fallbackNS: ['common'],
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
