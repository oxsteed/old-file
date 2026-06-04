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
import arLegacy from '../locales/ar.json';
import arTerms from '../locales/terms/ar.content.json';
import arPrivacy from '../locales/privacy/ar.content.json';

import enCommon from './locales/en/common.json';
import esCommon from './locales/es/common.json';
import frCommon from './locales/fr/common.json';
import htCommon from './locales/ht/common.json';
import arCommon from './locales/ar/common.json';
import enTranslator from './locales/en/translator.json';
import esTranslator from './locales/es/translator.json';
import frTranslator from './locales/fr/translator.json';
import htTranslator from './locales/ht/translator.json';
import arTranslator from './locales/ar/translator.json';

export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'ht', name: 'Haitian Creole', nativeName: 'Kreyòl ayisyen', flag: '🇭🇹' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
];

const LANGUAGE_QUERY_PARAMS = ['lang', 'lng', 'locale'];

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
  ar: {
    translation: {
      ...arLegacy,
      termsContent: arTerms,
      privacyContent: arPrivacy,
    },
    common: arCommon,
    translator: arTranslator,
  },
};

function normalizeInitialLanguage(code) {
  const normalizedCode = String(code || '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return LANGUAGES.some((language) => language.code === normalizedCode) ? normalizedCode : 'en';
}

function detectUrlLanguage() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  for (const param of LANGUAGE_QUERY_PARAMS) {
    const value = params.get(param);
    if (value) return normalizeInitialLanguage(value);
  }
  return null;
}

function detectBrowserLanguage() {
  if (typeof navigator === 'undefined') return 'en';
  const preferred = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language];
  for (const candidate of preferred) {
    const normalized = normalizeInitialLanguage(candidate);
    if (normalized !== 'en' || String(candidate || '').toLowerCase().startsWith('en')) {
      return normalized;
    }
  }
  return 'en';
}

export function detectInitialLanguage() {
  const urlLanguage = detectUrlLanguage();
  if (urlLanguage) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('oxs:language', urlLanguage);
    }
    return urlLanguage;
  }
  if (typeof localStorage !== 'undefined') {
    const storedLanguage = localStorage.getItem('oxs:language');
    if (storedLanguage) return normalizeInitialLanguage(storedLanguage);
  }
  return detectBrowserLanguage();
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLanguage(),
  fallbackLng: 'en',
  supportedLngs: LANGUAGES.map((language) => language.code),
  ns: ['translation', 'common', 'translator'],
  defaultNS: 'translation',
  fallbackNS: ['common'],
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
