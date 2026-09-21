/**
 * PageMeta.jsx - per-page <title>, description, Open Graph / Twitter, canonical.
 * Canonical base: VITE_PUBLIC_SITE_URL (build-time) or window.location.origin.
 */

import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { getPublicSiteUrl, toAbsoluteUrl } from '../utils/seoDescription';

const SITE_NAME = 'OxSteed';
const TWITTER_HANDLE = '@oxsteed';
const SEO_LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar']);
const OG_LOCALES = { en: 'en_US', es: 'es_ES', fr: 'fr_FR', ht: 'ht_HT', ar: 'ar_AR' };
const LOCALIZED_PATHS = new Set([
  '/', '/about', '/careers', '/join', '/jobs', '/helpers', '/how-it-works', '/restaurants',
  '/consulting-intake', '/direct', '/direct/services', '/direct/request-quote',
  '/direct/view-quote',
  '/support/escalation', '/terms', '/privacy', '/security', '/accessibility',
  '/enforcement-policy', '/do-not-sell', '/cookie-policy',
  '/legal/background-check', '/legal/arbitration', '/legal/escrow-policy',
  '/legal/account-termination', '/legal/dispute-resolution',
  '/legal/independent-contractor',
]);

function getLocalizedPath(pathname) {
  const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\/+$/, '') || '/';
  return normalizedPath === '/'
    || normalizedPath.startsWith('/help/')
    || LOCALIZED_PATHS.has(normalizedPath)
    || /^\/(helpers\/public|businesses\/public|jobs\/public|restaurants\/r|tool-rentals|logistics\/campaigns)\/[^/]+$/i.test(normalizedPath);
}

function normalizePathname(pathname) {
  return pathname === '/' ? '/' : pathname.replace(/\/+$/, '') || '/';
}

function getRequestedLanguage() {
  if (typeof window === 'undefined') return 'en';
  const raw = new URLSearchParams(window.location.search).get('lang') || '';
  const language = raw.trim().toLowerCase().split(/[-_]/)[0];
  return SEO_LANGUAGES.has(language) ? language : 'en';
}

function addLanguageToUrl(url, language) {
  try {
    const localizedUrl = new URL(url, getPublicSiteUrl());
    localizedUrl.pathname = normalizePathname(localizedUrl.pathname);
    ['lang', 'lng', 'locale'].forEach((key) => localizedUrl.searchParams.delete(key));
    if (language !== 'en') localizedUrl.searchParams.set('lang', language);
    return localizedUrl.toString();
  } catch {
    return url;
  }
}

export default function PageMeta({
  title,
  description,
  image = undefined,
  url = undefined,
  type = 'website',
  noIndex = false,
}) {
  const { t } = useTranslation('common');
  const defaultTitle = t('pageMeta.defaults.title');
  const defaultDescription = t('pageMeta.defaults.description');
  const resolvedTitle = title || defaultTitle;
  const resolvedDescription = description || defaultDescription;
  const base = getPublicSiteUrl();
  const currentPath = typeof window !== 'undefined' && window.location?.pathname
    ? window.location.pathname
    : '/';
  const normalizedCurrentPath = normalizePathname(currentPath);
  const language = getRequestedLanguage();
  const isLocalizedPage = getLocalizedPath(normalizedCurrentPath);
  const localizedPath = isLocalizedPage && language !== 'en';
  const defaultUrl = addLanguageToUrl(`${base}${normalizedCurrentPath}`, localizedPath ? language : 'en');
  const resolvedUrl = url
    ? addLanguageToUrl(toAbsoluteUrl(url), localizedPath ? language : 'en')
    : defaultUrl;
  const resolvedImage = toAbsoluteUrl(image || '/icons/icon-512.png');
  const fullTitle = resolvedTitle.includes(SITE_NAME)
    ? resolvedTitle
    : `${resolvedTitle} | ${SITE_NAME}`;
  const alternateLanguageLinks = isLocalizedPage
    ? [...SEO_LANGUAGES].map((code) => ({
        code,
        href: addLanguageToUrl(resolvedUrl, code),
      })).concat({ code: 'x-default', href: addLanguageToUrl(resolvedUrl, 'en') })
    : [];

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={resolvedDescription} />
      {noIndex && <meta name="robots" content="noindex, nofollow" />}

      <link rel="canonical" href={resolvedUrl} />
      {alternateLanguageLinks.map(({ code, href }) => (
        <link key={code} rel="alternate" hrefLang={code} href={href} />
      ))}

      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={type} />
      <meta property="og:locale" content={OG_LOCALES[language] || OG_LOCALES.en} />
      {Object.entries(OG_LOCALES)
        .filter(([code]) => code !== language)
        .map(([, locale]) => <meta key={locale} property="og:locale:alternate" content={locale} />)}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={resolvedDescription} />
      <meta property="og:image" content={resolvedImage} />
      <meta property="og:url" content={resolvedUrl} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={TWITTER_HANDLE} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={resolvedDescription} />
      <meta name="twitter:image" content={resolvedImage} />
    </Helmet>
  );
}
