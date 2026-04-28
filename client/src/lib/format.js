/**
 * Locale & currency-aware formatting helpers.
 *
 * `formatMoney` is the international replacement for the various ad-hoc
 * `'$' + n.toLocaleString(...)` patterns sprinkled across the client. It pulls
 * the user's locale from the browser (with optional override) and the currency
 * from the user object, defaulting to USD for backwards compatibility.
 *
 * Pair with `getDefaultCurrency(country)` from `lib/countries.js` to derive a
 * sensible currency when the user record doesn't have `preferred_currency`.
 */

import { getDefaultCurrency } from './countries';

const DEFAULT_CURRENCY = 'USD';

/**
 * Best-effort detection of the visitor's locale (e.g. 'en-US', 'fr-FR').
 * Falls back to 'en-US' if the runtime can't tell us.
 */
export function detectLocale() {
  if (typeof navigator !== 'undefined') {
    return navigator.language || navigator.languages?.[0] || 'en-US';
  }
  return 'en-US';
}

/**
 * Format a money value with the appropriate currency symbol and locale.
 *
 *   formatMoney(1234.5)                          // '$1,234.50' (US locale)
 *   formatMoney(1234.5, { currency: 'EUR' })     // '€1,234.50' (US locale)
 *   formatMoney(1234.5, { currency: 'EUR', locale: 'fr-FR' })  // '1 234,50 €'
 *   formatMoney(null)                            // '—'
 *
 * Options:
 *   currency           – ISO-4217 code. Default 'USD'.
 *   country            – ISO-2 code (used to derive currency if not set).
 *   locale             – BCP 47 tag. Default = detectLocale().
 *   minimumFractionDigits / maximumFractionDigits – override decimals.
 *   fallback           – string returned for null/undefined/NaN. Default '—'.
 */
export function formatMoney(value, opts = {}) {
  const {
    currency,
    country,
    locale = detectLocale(),
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
    fallback = '—',
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
    // Some unusual currency codes / locale combos throw — fall back to USD.
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

/**
 * Format a plain number with locale separators (no currency).
 */
export function formatNumber(value, opts = {}) {
  const { locale = detectLocale(), minimumFractionDigits = 0, maximumFractionDigits = 0, fallback = '—' } = opts;
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits }).format(n);
}
