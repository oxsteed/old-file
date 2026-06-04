/**
 * Locale & currency-aware formatting helpers.
 *
 * `formatMoney` is the international replacement for the various ad-hoc
 * `'$' + n.toLocaleString(...)` patterns sprinkled across the client. It pulls
 * the user's locale from the selected app language first, then the browser
 * (with optional override), and the currency from the user object, defaulting
 * to USD for backwards compatibility.
 *
 * Pair with `getDefaultCurrency(country)` from `lib/countries.js` to derive a
 * sensible currency when the user record doesn't have `preferred_currency`.
 */

import { getDefaultCurrency } from './countries';

const DEFAULT_CURRENCY = 'USD';
const LANGUAGE_STORAGE_KEY = 'oxs:language';
const APP_LANGUAGE_LOCALES = {
  en: 'en-US',
  es: 'es-US',
  fr: 'fr-FR',
  ht: 'ht-HT',
  ar: 'ar',
};

function normalizeLanguageCode(code) {
  return String(code || '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
}

function getStoredAppLocale() {
  if (typeof localStorage === 'undefined') return null;
  const languageCode = normalizeLanguageCode(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  return APP_LANGUAGE_LOCALES[languageCode] || null;
}

function cleanIntlOptions(options) {
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined)
  );
}

/**
 * Best-effort detection of the visitor's locale (e.g. 'en-US', 'fr-FR').
 * Prefers the language selected inside OxSteed so formatting follows the UI.
 * Falls back to the browser, then 'en-US' if the runtime can't tell us.
 */
export function detectLocale() {
  const storedLocale = getStoredAppLocale();
  if (storedLocale) return storedLocale;
  if (typeof navigator !== 'undefined') {
    return navigator.languages?.[0] || navigator.language || 'en-US';
  }
  return 'en-US';
}

/**
 * Format a money value with the appropriate currency symbol and locale.
 *
 *   formatMoney(1234.5)                          // '$1,234.50' (US locale)
 *   formatMoney(1234.5, { currency: 'EUR' })     // '€1,234.50' (US locale)
 *   formatMoney(1234.5, { currency: 'EUR', locale: 'fr-FR' })  // '1 234,50 €'
 *   formatMoney(null)                            // '-'
 *
 * Options:
 *   currency           – ISO-4217 code. Default 'USD'.
 *   country            – ISO-2 code (used to derive currency if not set).
 *   locale             – BCP 47 tag. Default = detectLocale().
 *   minimumFractionDigits / maximumFractionDigits – override decimals.
 *   fallback           – string returned for null/undefined/NaN. Default '-'.
 */
export function formatMoney(value, opts = {}) {
  const {
    currency,
    country,
    locale = detectLocale(),
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
    fallback = '-',
  } = opts;

  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return fallback;

  const ccy = currency
    || (country ? getDefaultCurrency(country) : null)
    || DEFAULT_CURRENCY;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: ccy,
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(n);
  } catch (_err) {
    // Some unusual currency codes / locale combos throw - fall back to USD.
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: DEFAULT_CURRENCY,
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(n);
  }
}

/**
 * Convenience wrapper that infers currency from a user object.
 * Reads `user.preferred_currency` first, then derives from `user.country`,
 * then defaults to USD.
 */
export function formatMoneyForUser(value, user, opts = {}) {
  const currency = user?.preferred_currency
    || (user?.country ? getDefaultCurrency(user.country) : null)
    || DEFAULT_CURRENCY;
  return formatMoney(value, { currency, ...opts });
}

export function formatCents(value, opts = {}) {
  const cents = Number(value || 0);
  return formatMoney((Number.isFinite(cents) ? cents : 0) / 100, opts);
}

/**
 * Format a plain number with locale separators (no currency).
 */
export function formatNumber(value, opts = {}) {
  const {
    locale = detectLocale(),
    minimumFractionDigits = 0,
    maximumFractionDigits = 0,
    fallback = '-',
    ...numberOptions
  } = opts;
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return new Intl.NumberFormat(locale, cleanIntlOptions({
    minimumFractionDigits,
    maximumFractionDigits,
    ...numberOptions,
  })).format(n);
}

export function formatDate(value, opts = {}) {
  const {
    locale = detectLocale(),
    fallback = '-',
    ...formatOptions
  } = opts;
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, cleanIntlOptions({
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...formatOptions,
  })).format(date);
}

export function formatDateTime(value, opts = {}) {
  return formatDate(value, {
    hour: '2-digit',
    minute: '2-digit',
    ...opts,
  });
}
