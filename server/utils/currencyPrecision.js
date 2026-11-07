'use strict';

// Per-currency minor-unit precision (ISO 4217).
//
// Money is integer minor units everywhere in the payroll path. How many
// minor units make one major unit depends on the currency, never on the
// country the code happens to run in: JPY has 0 decimals, BHD has 3,
// most currencies have 2. This module is the single place that knows.
//
// No currency is the default: an unknown or missing code resolves to
// the ISO default of 2 decimals, and formatting falls back to a plain
// decimal number rather than assuming any one currency.

const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
  'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

const THREE_DECIMAL_CURRENCIES = new Set([
  'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
]);

function normalizeCurrencyCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

// Number of decimal places (minor-unit digits) for a currency code.
function minorUnitDecimals(currencyCode) {
  const code = normalizeCurrencyCode(currencyCode);
  if (!code) return 2;
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

function minorUnitsPerMajor(currencyCode) {
  return 10 ** minorUnitDecimals(currencyCode);
}

// Format an integer-minor-unit amount in its own currency, using the
// currency's own precision (e.g. 100500 JPY minor units render as
// ¥100,500 with no decimals; 123456 BHD minor units as 123.456).
// Falls back to a plain decimal rendering when the code is not a real
// ISO 4217 code, instead of throwing or assuming another currency.
function formatMinorUnits(amountMinor, currencyCode, locale = 'en-US') {
  const code = normalizeCurrencyCode(currencyCode);
  const decimals = minorUnitDecimals(code);
  const major = (Number(amountMinor) || 0) / 10 ** decimals;
  if (!code) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }).format(major);
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency: code,
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }).format(major);
  } catch {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }).format(major);
  }
}

module.exports = {
  ZERO_DECIMAL_CURRENCIES,
  THREE_DECIMAL_CURRENCIES,
  normalizeCurrencyCode,
  minorUnitDecimals,
  minorUnitsPerMajor,
  formatMinorUnits,
};
