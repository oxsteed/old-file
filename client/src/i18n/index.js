import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'ht', name: 'Haitian Creole', nativeName: 'Kreyòl ayisyen', flag: '🇭🇹' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'zh', name: 'Mandarin', nativeName: '中文', flag: '🇨🇳' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', flag: '🇰🇪' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', flag: '🇵🇰' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', flag: '🇧🇩' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', flag: '🇹🇭' },
];

const LANGUAGE_QUERY_PARAMS = ['lang', 'lng', 'locale'];
const NAMESPACES = ['translation', 'common', 'translator', 'credit', 'support', 'adminQuoteRequests', 'attention', 'statements'];

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
    optionalLocaleModule(import('./locales/en/attention.json')),
    optionalLocaleModule(import('./locales/en/statements.json')),
  ]),
  es: () => Promise.all([
    import('../locales/generated/es-0.json'),
    import('../locales/generated/es-1.json'),
    import('../locales/generated/es-2.json'),
    optionalLocaleModule(import('./locales/es/common.json')),
    optionalLocaleModule(import('./locales/es/translator.json')),
    optionalLocaleModule(import('./locales/es/credit.json')),
    optionalLocaleModule(import('./locales/es/attention.json')),
    optionalLocaleModule(import('./locales/es/statements.json')),
  ]),
  fr: () => Promise.all([
    import('../locales/generated/fr-0.json'),
    import('../locales/generated/fr-1.json'),
    import('../locales/generated/fr-2.json'),
    optionalLocaleModule(import('./locales/fr/common.json')),
    optionalLocaleModule(import('./locales/fr/translator.json')),
    optionalLocaleModule(import('./locales/fr/credit.json')),
    optionalLocaleModule(import('./locales/fr/attention.json')),
    optionalLocaleModule(import('./locales/fr/statements.json')),
  ]),
  ht: () => Promise.all([
    import('../locales/generated/ht-0.json'),
    import('../locales/generated/ht-1.json'),
    import('../locales/generated/ht-2.json'),
    optionalLocaleModule(import('./locales/ht/common.json')),
    optionalLocaleModule(import('./locales/ht/translator.json')),
    optionalLocaleModule(import('./locales/ht/credit.json')),
    optionalLocaleModule(import('./locales/ht/attention.json')),
    optionalLocaleModule(import('./locales/ht/statements.json')),
  ]),
  ar: () => Promise.all([
    import('../locales/generated/ar-0.json'),
    import('../locales/generated/ar-1.json'),
    import('../locales/generated/ar-2.json'),
    import('../locales/generated/ar-3.json'),
    optionalLocaleModule(import('./locales/ar/common.json')),
    optionalLocaleModule(import('./locales/ar/translator.json')),
    optionalLocaleModule(import('./locales/ar/credit.json')),
    optionalLocaleModule(import('./locales/ar/attention.json')),
    optionalLocaleModule(import('./locales/ar/statements.json')),
  ]),
  zh: () => Promise.all([
    import('../locales/generated/zh-0.json'),
    import('../locales/generated/zh-1.json'),
    import('../locales/generated/zh-2.json'),
    optionalLocaleModule(import('./locales/zh/common.json')),
    optionalLocaleModule(import('./locales/zh/translator.json')),
    optionalLocaleModule(import('./locales/zh/credit.json')),
    optionalLocaleModule(import('./locales/zh/attention.json')),
    optionalLocaleModule(import('./locales/zh/statements.json')),
  ]),
  ko: () => Promise.all([
    import('../locales/generated/ko-0.json'),
    import('../locales/generated/ko-1.json'),
    import('../locales/generated/ko-2.json'),
    optionalLocaleModule(import('./locales/ko/common.json')),
    optionalLocaleModule(import('./locales/ko/translator.json')),
    optionalLocaleModule(import('./locales/ko/credit.json')),
    optionalLocaleModule(import('./locales/ko/attention.json')),
    optionalLocaleModule(import('./locales/ko/statements.json')),
  ]),
  sw: () => Promise.all([
    import('../locales/generated/sw-0.json'),
    import('../locales/generated/sw-1.json'),
    import('../locales/generated/sw-2.json'),
    optionalLocaleModule(import('./locales/sw/common.json')),
    optionalLocaleModule(import('./locales/sw/translator.json')),
    optionalLocaleModule(import('./locales/sw/credit.json')),
    optionalLocaleModule(import('./locales/sw/attention.json')),
    optionalLocaleModule(import('./locales/sw/statements.json')),
  ]),
  pt: () => Promise.all([
    import('../locales/generated/pt-0.json'),
    import('../locales/generated/pt-1.json'),
    import('../locales/generated/pt-2.json'),
    optionalLocaleModule(import('./locales/pt/common.json')),
    optionalLocaleModule(import('./locales/pt/translator.json')),
    optionalLocaleModule(import('./locales/pt/credit.json')),
    optionalLocaleModule(import('./locales/pt/attention.json')),
    optionalLocaleModule(import('./locales/pt/statements.json')),
  ]),
  hi: () => Promise.all([
    import('../locales/generated/hi-0.json'),
    import('../locales/generated/hi-1.json'),
    import('../locales/generated/hi-2.json'),
    import('../locales/generated/hi-3.json'),
    import('../locales/generated/hi-4.json'),
    optionalLocaleModule(import('./locales/hi/common.json')),
    optionalLocaleModule(import('./locales/hi/translator.json')),
    optionalLocaleModule(import('./locales/hi/credit.json')),
    optionalLocaleModule(import('./locales/hi/attention.json')),
    optionalLocaleModule(import('./locales/hi/statements.json')),
  ]),
  vi: () => Promise.all([
    import('../locales/generated/vi-0.json'),
    import('../locales/generated/vi-1.json'),
    import('../locales/generated/vi-2.json'),
    optionalLocaleModule(import('./locales/vi/common.json')),
    optionalLocaleModule(import('./locales/vi/translator.json')),
    optionalLocaleModule(import('./locales/vi/credit.json')),
    optionalLocaleModule(import('./locales/vi/attention.json')),
    optionalLocaleModule(import('./locales/vi/statements.json')),
  ]),
  ru: () => Promise.all([
    import('../locales/generated/ru-0.json'),
    import('../locales/generated/ru-1.json'),
    import('../locales/generated/ru-2.json'),
    import('../locales/generated/ru-3.json'),
    optionalLocaleModule(import('./locales/ru/common.json')),
    optionalLocaleModule(import('./locales/ru/translator.json')),
    optionalLocaleModule(import('./locales/ru/credit.json')),
    optionalLocaleModule(import('./locales/ru/attention.json')),
    optionalLocaleModule(import('./locales/ru/statements.json')),
  ]),
  ja: () => Promise.all([
    import('../locales/generated/ja-0.json'),
    import('../locales/generated/ja-1.json'),
    import('../locales/generated/ja-2.json'),
    optionalLocaleModule(import('./locales/ja/common.json')),
    optionalLocaleModule(import('./locales/ja/translator.json')),
    optionalLocaleModule(import('./locales/ja/credit.json')),
    optionalLocaleModule(import('./locales/ja/attention.json')),
    optionalLocaleModule(import('./locales/ja/statements.json')),
  ]),
  de: () => Promise.all([
    import('../locales/generated/de-0.json'),
    import('../locales/generated/de-1.json'),
    import('../locales/generated/de-2.json'),
    optionalLocaleModule(import('./locales/de/common.json')),
    optionalLocaleModule(import('./locales/de/translator.json')),
    optionalLocaleModule(import('./locales/de/credit.json')),
    optionalLocaleModule(import('./locales/de/attention.json')),
    optionalLocaleModule(import('./locales/de/statements.json')),
  ]),
  id: () => Promise.all([
    import('../locales/generated/id-0.json'),
    import('../locales/generated/id-1.json'),
    import('../locales/generated/id-2.json'),
    optionalLocaleModule(import('./locales/id/common.json')),
    optionalLocaleModule(import('./locales/id/translator.json')),
    optionalLocaleModule(import('./locales/id/credit.json')),
    optionalLocaleModule(import('./locales/id/attention.json')),
    optionalLocaleModule(import('./locales/id/statements.json')),
  ]),
  ur: () => Promise.all([
    import('../locales/generated/ur-0.json'),
    import('../locales/generated/ur-1.json'),
    import('../locales/generated/ur-2.json'),
    import('../locales/generated/ur-3.json'),
    optionalLocaleModule(import('./locales/ur/common.json')),
    optionalLocaleModule(import('./locales/ur/translator.json')),
    optionalLocaleModule(import('./locales/ur/credit.json')),
    optionalLocaleModule(import('./locales/ur/attention.json')),
    optionalLocaleModule(import('./locales/ur/statements.json')),
  ]),
  bn: () => Promise.all([
    import('../locales/generated/bn-0.json'),
    import('../locales/generated/bn-1.json'),
    import('../locales/generated/bn-2.json'),
    import('../locales/generated/bn-3.json'),
    import('../locales/generated/bn-4.json'),
    optionalLocaleModule(import('./locales/bn/common.json')),
    optionalLocaleModule(import('./locales/bn/translator.json')),
    optionalLocaleModule(import('./locales/bn/credit.json')),
    optionalLocaleModule(import('./locales/bn/attention.json')),
    optionalLocaleModule(import('./locales/bn/statements.json')),
  ]),
  it: () => Promise.all([
    import('../locales/generated/it-0.json'),
    import('../locales/generated/it-1.json'),
    import('../locales/generated/it-2.json'),
    optionalLocaleModule(import('./locales/it/common.json')),
    optionalLocaleModule(import('./locales/it/translator.json')),
    optionalLocaleModule(import('./locales/it/credit.json')),
    optionalLocaleModule(import('./locales/it/attention.json')),
    optionalLocaleModule(import('./locales/it/statements.json')),
  ]),
  tr: () => Promise.all([
    import('../locales/generated/tr-0.json'),
    import('../locales/generated/tr-1.json'),
    import('../locales/generated/tr-2.json'),
    optionalLocaleModule(import('./locales/tr/common.json')),
    optionalLocaleModule(import('./locales/tr/translator.json')),
    optionalLocaleModule(import('./locales/tr/credit.json')),
    optionalLocaleModule(import('./locales/tr/attention.json')),
    optionalLocaleModule(import('./locales/tr/statements.json')),
  ]),
  th: () => Promise.all([
    import('../locales/generated/th-0.json'),
    import('../locales/generated/th-1.json'),
    import('../locales/generated/th-2.json'),
    import('../locales/generated/th-3.json'),
    import('../locales/generated/th-4.json'),
    optionalLocaleModule(import('./locales/th/common.json')),
    optionalLocaleModule(import('./locales/th/translator.json')),
    optionalLocaleModule(import('./locales/th/credit.json')),
    optionalLocaleModule(import('./locales/th/attention.json')),
    optionalLocaleModule(import('./locales/th/statements.json')),
  ]),
};

const localeLegacyShardCounts = { ar: 4 };

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
  ko: () => Promise.all([
    import('../locales/terms/ko.content.json'),
    import('../locales/privacy/ko.content.json'),
  ]),
  zh: () => Promise.all([
    import('../locales/terms/zh.content.json'),
    import('../locales/privacy/zh.content.json'),
  ]),
  sw: () => Promise.all([
    import('../locales/terms/sw.content.json'),
    import('../locales/privacy/sw.content.json'),
  ]),
  pt: () => Promise.all([
    import('../locales/terms/pt.content.json'),
    import('../locales/privacy/pt.content.json'),
  ]),
  hi: () => Promise.all([
    import('../locales/terms/hi.content.json'),
    import('../locales/privacy/hi.content.json'),
  ]),
  vi: () => Promise.all([
    import('../locales/terms/vi.content.json'),
    import('../locales/privacy/vi.content.json'),
  ]),
  ru: () => Promise.all([
    import('../locales/terms/ru.content.json'),
    import('../locales/privacy/ru.content.json'),
  ]),
  ja: () => Promise.all([
    import('../locales/terms/ja.content.json'),
    import('../locales/privacy/ja.content.json'),
  ]),
  de: () => Promise.all([
    import('../locales/terms/de.content.json'),
    import('../locales/privacy/de.content.json'),
  ]),
  id: () => Promise.all([
    import('../locales/terms/id.content.json'),
    import('../locales/privacy/id.content.json'),
  ]),
  ur: () => Promise.all([
    import('../locales/terms/ur.content.json'),
    import('../locales/privacy/ur.content.json'),
  ]),
  bn: () => Promise.all([
    import('../locales/terms/bn.content.json'),
    import('../locales/privacy/bn.content.json'),
  ]),
  it: () => Promise.all([
    import('../locales/terms/it.content.json'),
    import('../locales/privacy/it.content.json'),
  ]),
  tr: () => Promise.all([
    import('../locales/terms/tr.content.json'),
    import('../locales/privacy/tr.content.json'),
  ]),
  th: () => Promise.all([
    import('../locales/terms/th.content.json'),
    import('../locales/privacy/th.content.json'),
  ]),
};

const localePromises = new Map();
const legalLocalePromises = new Map();

function getLocaleResources(modules, legacyShardCount = 3) {
  const legacyModules = modules.slice(0, legacyShardCount);
  const [common, translator, credit, attention, statements] = modules.slice(legacyShardCount);
  const translation = Object.assign(
    {},
    ...legacyModules.map((legacyModule) => legacyModule.default),
  );
  return {
    translation,
    common: common.default,
    translator: translator.default,
    credit: credit.default,
    attention: attention.default,
    statements: statements.default,
    // Project canonical catalogs into explicit namespaces as well as the
    // legacy dotted paths. Both lookup styles share one translation source.
    support: translation.support || {},
    adminQuoteRequests: translation.adminQuoteRequests || {},
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
    const legacyShardCount = localeLegacyShardCounts[normalizedCode] || 3;
    localePromises.set(normalizedCode, loader().then((modules) => getLocaleResources(modules, legacyShardCount)));
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
    ns: [...NAMESPACES],
    defaultNS: 'translation',
    fallbackNS: ['common'],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

export function ensureLanguageLoaded(code) {
  const normalizedCode = normalizeInitialLanguage(code);
  return i18nReady.then(() => {
    if (NAMESPACES.every((namespace) => i18n.hasResourceBundle(normalizedCode, namespace))) return;
    return loadLanguageResources(normalizedCode).then((resourcesForLanguage) => {
      Object.entries(resourcesForLanguage).forEach(([namespace, resources]) => {
        i18n.addResourceBundle(normalizedCode, namespace, resources, true, true);
      });
    });
  });
}

/**
 * Last-resort bootstrap for an asset-cache failure. English is reassembled
 * from the same split shards as the normal startup path, so the bundler
 * never emits a monolithic catalog chunk and every locale asset stays under
 * the size budget. Each shard fails soft; when no shard loads at all the
 * promise rejects so the caller renders the safe retry state. The affected
 * admin catalogs must also be available before mounting the admin shell.
 */
export function initializeEnglishFallback() {
  return Promise.all([
    optionalLocaleModule(import('../locales/generated/en-0.json')),
    optionalLocaleModule(import('../locales/generated/en-1.json')),
    optionalLocaleModule(import('../locales/generated/en-2.json')),
    optionalLocaleModule(import('./locales/en/common.json')),
    optionalLocaleModule(import('./locales/en/translator.json')),
    optionalLocaleModule(import('./locales/en/credit.json')),
    optionalLocaleModule(import('./locales/en/attention.json')),
    optionalLocaleModule(import('./locales/en/statements.json')),
  ]).then((modules) => {
    const resources = getLocaleResources(modules);
    if (!resources.support.workspace || !resources.adminQuoteRequests.statusNew) {
      throw new Error('English fallback resources unavailable');
    }
    return i18n.use(initReactI18next).init({
      resources: { en: resources },
      lng: 'en',
      fallbackLng: 'en',
      supportedLngs: ['en'],
      ns: [...NAMESPACES],
      defaultNS: 'translation',
      fallbackNS: ['common'],
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
