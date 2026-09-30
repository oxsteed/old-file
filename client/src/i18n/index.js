import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'ht', name: 'Haitian Creole', nativeName: 'Kreyòl ayisyen', flag: '🇭🇹' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
];

const LANGUAGE_QUERY_PARAMS = ['lang', 'lng', 'locale'];

// Translation is split into independently cached chunks. The legacy catalog
// is required to render the application; these smaller namespaces are
// additive and can safely fall back to English if one chunk is temporarily
// unavailable during a deployment or cache transition.
const optionalLocaleModule = (modulePromise) => modulePromise.catch(() => ({ default: {} }));

// Keep the initial bundle small: the legacy catalogs are large, and visitors
// only need the selected language plus English fallback on first load.
const localeLoaders = {
  en: () => Promise.all([
    import('../locales/generated/en-0.json'),
    import('../locales/generated/en-1.json'),
    import('../locales/generated/en-2.json'),
    optionalLocaleModule(import('./locales/en/common.json')),
    optionalLocaleModule(import('./locales/en/translator.json')),
    optionalLocaleModule(import('./locales/en/credit.json')),
  ]),
  es: () => Promise.all([
    import('../locales/generated/es-0.json'),
    import('../locales/generated/es-1.json'),
    import('../locales/generated/es-2.json'),
    optionalLocaleModule(import('./locales/es/common.json')),
    optionalLocaleModule(import('./locales/es/translator.json')),
    optionalLocaleModule(import('./locales/es/credit.json')),
  ]),
  fr: () => Promise.all([
    import('../locales/generated/fr-0.json'),
    import('../locales/generated/fr-1.json'),
    import('../locales/generated/fr-2.json'),
    optionalLocaleModule(import('./locales/fr/common.json')),
    optionalLocaleModule(import('./locales/fr/translator.json')),
    optionalLocaleModule(import('./locales/fr/credit.json')),
  ]),
  ht: () => Promise.all([
    import('../locales/generated/ht-0.json'),
    import('../locales/generated/ht-1.json'),
    import('../locales/generated/ht-2.json'),
    optionalLocaleModule(import('./locales/ht/common.json')),
    optionalLocaleModule(import('./locales/ht/translator.json')),
    optionalLocaleModule(import('./locales/ht/credit.json')),
  ]),
  ar: () => Promise.all([
    import('../locales/generated/ar-0.json'),
    import('../locales/generated/ar-1.json'),
    import('../locales/generated/ar-2.json'),
    optionalLocaleModule(import('./locales/ar/common.json')),
    optionalLocaleModule(import('./locales/ar/translator.json')),
    optionalLocaleModule(import('./locales/ar/credit.json')),
  ]),
};

const legalLocaleLoaders = {
  en: () => Promise.all([
    import('../locales/terms/en.content.json'),
    import('../locales/privacy/en.content.json'),
  ]),
  es: () => Promise.all([
    import('../locales/terms/es.content.json'),
    import('../locales/privacy/es.content.json'),
  ]),
  fr: () => Promise.all([
    import('../locales/terms/fr.content.json'),
    import('../locales/privacy/fr.content.json'),
  ]),
  ht: () => Promise.all([
    import('../locales/terms/ht.content.json'),
    import('../locales/privacy/ht.content.json'),
  ]),
  ar: () => Promise.all([
    import('../locales/terms/ar.content.json'),
    import('../locales/privacy/ar.content.json'),
  ]),
};

const localePromises = new Map();
const legalLocalePromises = new Map();

function getLocaleResources(modules) {
  const [legacyPartOne, legacyPartTwo, legacyPartThree, common, translator, credit] = modules;
  return {
    translation: {
      ...legacyPartOne.default,
      ...legacyPartTwo.default,
      ...legacyPartThree.default,
    },
    common: common.default,
    translator: translator.default,
    credit: credit.default,
  };
}

function getLegalLocaleResources(modules) {
  const [terms, privacy] = modules;
  return {
    termsContent: terms.default,
    privacyContent: privacy.default,
  };
}

function loadLanguageResources(code) {
  const normalizedCode = normalizeInitialLanguage(code);
  if (!localePromises.has(normalizedCode)) {
    const loader = localeLoaders[normalizedCode] || localeLoaders.en;
    localePromises.set(normalizedCode, loader().then(getLocaleResources));
  }
  return localePromises.get(normalizedCode);
}

function loadLegalLanguageResources(code) {
  const normalizedCode = normalizeInitialLanguage(code);
  if (!legalLocalePromises.has(normalizedCode)) {
    const loader = legalLocaleLoaders[normalizedCode] || legalLocaleLoaders.en;
    legalLocalePromises.set(normalizedCode, loader().then(getLegalLocaleResources));
  }
  return legalLocalePromises.get(normalizedCode);
}

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

const initialLanguage = detectInitialLanguage();

// Initialize before React mounts so the first render never flashes raw i18n
// keys. Other languages are added on demand by LanguageProvider.
export const i18nReady = Promise.all([
  loadLanguageResources('en'),
  initialLanguage === 'en' ? null : loadLanguageResources(initialLanguage),
]).then(([enResources, initialResources]) => {
  const initialResourcesMap = { en: enResources };
  if (initialLanguage !== 'en') initialResourcesMap[initialLanguage] = initialResources;
  return i18n.use(initReactI18next).init({
    resources: initialResourcesMap,
    lng: initialLanguage,
    fallbackLng: 'en',
    supportedLngs: LANGUAGES.map((language) => language.code),
    ns: ['translation', 'common', 'translator', 'credit'],
    defaultNS: 'translation',
    fallbackNS: ['common'],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

export function ensureLanguageLoaded(code) {
  const normalizedCode = normalizeInitialLanguage(code);
  return i18nReady.then(() => {
    if (i18n.hasResourceBundle(normalizedCode, 'translation')) return;
    return loadLanguageResources(normalizedCode).then((resourcesForLanguage) => {
      i18n.addResourceBundle(normalizedCode, 'translation', resourcesForLanguage.translation, true, true);
      i18n.addResourceBundle(normalizedCode, 'common', resourcesForLanguage.common, true, true);
      i18n.addResourceBundle(normalizedCode, 'translator', resourcesForLanguage.translator, true, true);
      i18n.addResourceBundle(normalizedCode, 'credit', resourcesForLanguage.credit, true, true);
    });
  });
}

/**
 * Last-resort bootstrap for an asset-cache failure. English is reassembled
 * from the same split shards as the normal startup path, so the bundler
 * never emits a monolithic catalog chunk and every locale asset stays under
 * the size budget. Each shard fails soft; when no shard loads at all the
 * promise rejects so the caller renders the safe retry state instead of an
 * admin full of raw keys.
 */
export function initializeEnglishFallback() {
  return Promise.all([
    optionalLocaleModule(import('../locales/generated/en-0.json')),
    optionalLocaleModule(import('../locales/generated/en-1.json')),
    optionalLocaleModule(import('../locales/generated/en-2.json')),
  ]).then((parts) => {
    const translation = Object.assign({}, ...parts.map((part) => part.default));
    if (Object.keys(translation).length === 0) {
      throw new Error('English fallback resources unavailable');
    }
    return i18n.use(initReactI18next).init({
      resources: { en: { translation } },
      lng: 'en',
      fallbackLng: 'en',
      supportedLngs: ['en'],
      ns: ['translation'],
      defaultNS: 'translation',
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
  });
}

export function ensureLegalContentLoaded(code) {
  const normalizedCode = normalizeInitialLanguage(code);
  return i18nReady.then(() => {
    if (i18n.exists('termsContent', { lng: normalizedCode })
      && i18n.exists('privacyContent', { lng: normalizedCode })) return;
    return loadLegalLanguageResources(normalizedCode).then((legalResources) => {
      Object.entries(legalResources).forEach(([key, value]) => {
        i18n.addResource(normalizedCode, 'translation', key, value);
      });
    });
  });
}

export default i18n;
