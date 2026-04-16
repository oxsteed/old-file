import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import Backend from 'i18next-http-backend';

i18n
  .use(Backend)
  .use(initReactI18next)
  .init({
    // Locale JSON files are served from /public/locales/<lng>.json
    // They are NOT bundled — only the active language is fetched.
    backend: {
      loadPath: '/locales/{{lng}}.json',
    },

    lng: localStorage.getItem('oxs:language') || 'en',
    fallbackLng: 'en',

    // Disable suspense mode — components render with fallback text while
    // the locale file loads, rather than being hidden behind a Suspense boundary.
    react: { useSuspense: false },

    interpolation: {
      // React already escapes values — no need for i18next to double-escape.
      escapeValue: false,
    },
  });

export default i18n;
