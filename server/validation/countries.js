'use strict';
// GENERATED from client/src/shared/countries.js by server/scripts/generate-shared-cjs.cjs. Do not edit.
// ISO 3166-1 alpha-2 country data used by payments, phones and privacy.
// The server keeps a generated CommonJS copy (server/validation/countries.js).

const COUNTRIES = Object.freeze({
  US: { calling: '1', currency: 'USD', region: 'NA' }, CA: { calling: '1', currency: 'CAD', region: 'NA' },
  MX: { calling: '52', currency: 'MXN', region: 'LATAM' }, BR: { calling: '55', currency: 'BRL', region: 'LATAM' },
  HT: { calling: '509', currency: 'HTG', region: 'CARIB' }, DO: { calling: '1', currency: 'DOP', region: 'CARIB' },
  JM: { calling: '1', currency: 'JMD', region: 'CARIB' }, CL: { calling: '56', currency: 'CLP', region: 'LATAM' },
  PY: { calling: '595', currency: 'PYG', region: 'LATAM' },
  GB: { calling: '44', currency: 'GBP', region: 'UK' }, IE: { calling: '353', currency: 'EUR', region: 'EU' },
  FR: { calling: '33', currency: 'EUR', region: 'EU' }, DE: { calling: '49', currency: 'EUR', region: 'EU' },
  ES: { calling: '34', currency: 'EUR', region: 'EU' }, IT: { calling: '39', currency: 'EUR', region: 'EU' },
  PT: { calling: '351', currency: 'EUR', region: 'EU' }, NL: { calling: '31', currency: 'EUR', region: 'EU' },
  BE: { calling: '32', currency: 'EUR', region: 'EU' }, LU: { calling: '352', currency: 'EUR', region: 'EU' },
  AT: { calling: '43', currency: 'EUR', region: 'EU' }, FI: { calling: '358', currency: 'EUR', region: 'EU' },
  GR: { calling: '30', currency: 'EUR', region: 'EU' }, EE: { calling: '372', currency: 'EUR', region: 'EU' },
  LV: { calling: '371', currency: 'EUR', region: 'EU' }, LT: { calling: '370', currency: 'EUR', region: 'EU' },
  SK: { calling: '421', currency: 'EUR', region: 'EU' }, SI: { calling: '386', currency: 'EUR', region: 'EU' },
  MT: { calling: '356', currency: 'EUR', region: 'EU' }, CY: { calling: '357', currency: 'EUR', region: 'EU' },
  HR: { calling: '385', currency: 'EUR', region: 'EU' }, SE: { calling: '46', currency: 'SEK', region: 'EU' },
  DK: { calling: '45', currency: 'DKK', region: 'EU' }, PL: { calling: '48', currency: 'PLN', region: 'EU' },
  CZ: { calling: '420', currency: 'CZK', region: 'EU' }, HU: { calling: '36', currency: 'HUF', region: 'EU' },
  RO: { calling: '40', currency: 'EUR', region: 'EU' }, BG: { calling: '359', currency: 'EUR', region: 'EU' },
  NO: { calling: '47', currency: 'NOK', region: 'EEA' }, IS: { calling: '354', currency: 'ISK', region: 'EEA' },
  LI: { calling: '423', currency: 'CHF', region: 'EEA' }, CH: { calling: '41', currency: 'CHF', region: 'EUROPE' },
  KE: { calling: '254', currency: 'KES', region: 'AFRICA' }, NG: { calling: '234', currency: 'NGN', region: 'AFRICA' },
  GH: { calling: '233', currency: 'GHS', region: 'AFRICA' }, ZA: { calling: '27', currency: 'ZAR', region: 'AFRICA' },
  UG: { calling: '256', currency: 'UGX', region: 'AFRICA' }, RW: { calling: '250', currency: 'RWF', region: 'AFRICA' },
  SN: { calling: '221', currency: 'XOF', region: 'AFRICA' }, CI: { calling: '225', currency: 'XOF', region: 'AFRICA' },
  CM: { calling: '237', currency: 'XAF', region: 'AFRICA' }, MA: { calling: '212', currency: 'MAD', region: 'AFRICA' },
  TN: { calling: '216', currency: 'TND', region: 'AFRICA' },
  KW: { calling: '965', currency: 'KWD', region: 'MENA' }, BH: { calling: '973', currency: 'BHD', region: 'MENA' },
  OM: { calling: '968', currency: 'OMR', region: 'MENA' }, JO: { calling: '962', currency: 'JOD', region: 'MENA' },
  IN: { calling: '91', currency: 'INR', region: 'APAC' }, PH: { calling: '63', currency: 'PHP', region: 'APAC' },
  SG: { calling: '65', currency: 'SGD', region: 'APAC' }, HK: { calling: '852', currency: 'HKD', region: 'APAC' },
  JP: { calling: '81', currency: 'JPY', region: 'APAC' }, KR: { calling: '82', currency: 'KRW', region: 'APAC' },
  VN: { calling: '84', currency: 'VND', region: 'APAC' }, TW: { calling: '886', currency: 'TWD', region: 'APAC' },
  AU: { calling: '61', currency: 'AUD', region: 'APAC' }, NZ: { calling: '64', currency: 'NZD', region: 'APAC' },
});

const COUNTRY_ALIASES = Object.freeze({
  USA: 'US', 'UNITED STATES': 'US', 'UNITED STATES OF AMERICA': 'US', 'U.S.': 'US', 'U.S.A.': 'US',
  CANADA: 'CA', MEXICO: 'MX', 'MÉXICO': 'MX', BRAZIL: 'BR', BRASIL: 'BR',
  HAITI: 'HT', 'HAÏTI': 'HT', AYITI: 'HT', 'DOMINICAN REPUBLIC': 'DO', JAMAICA: 'JM',
  'UNITED KINGDOM': 'GB', UK: 'GB', 'GREAT BRITAIN': 'GB', ENGLAND: 'GB', SCOTLAND: 'GB', WALES: 'GB',
  IRELAND: 'IE', FRANCE: 'FR', GERMANY: 'DE', DEUTSCHLAND: 'DE', SPAIN: 'ES', 'ESPAÑA': 'ES',
  ITALY: 'IT', PORTUGAL: 'PT', NETHERLANDS: 'NL', BELGIUM: 'BE', KENYA: 'KE', NIGERIA: 'NG',
  GHANA: 'GH', 'SOUTH AFRICA': 'ZA', INDIA: 'IN', PHILIPPINES: 'PH', JAPAN: 'JP', AUSTRALIA: 'AU',
  'NEW ZEALAND': 'NZ', KUWAIT: 'KW', 'SÉNÉGAL': 'SN', SENEGAL: 'SN', MOROCCO: 'MA', 'MAROC': 'MA',
});

const GDPR_REGIONS = new Set(['EU', 'EEA']);

function normalizeCountryCode(input) {
  if (typeof input !== 'string') return null;
  const upper = input.trim().toUpperCase();
  if (!upper) return null;
  if (Object.prototype.hasOwnProperty.call(COUNTRIES, upper)) return upper;
  if (Object.prototype.hasOwnProperty.call(COUNTRY_ALIASES, upper)) return COUNTRY_ALIASES[upper];
  return null;
}

function isIsoCountryCode(input) {
  return typeof input === 'string' && /^[A-Z]{2}$/.test(input) && Object.prototype.hasOwnProperty.call(COUNTRIES, input);
}

/** 'gdpr' | 'uk_gdpr' | 'default' */
function privacyRegime(code) {
  const country = normalizeCountryCode(code);
  if (!country) return 'default';
  if (COUNTRIES[country].region === 'UK') return 'uk_gdpr';
  return GDPR_REGIONS.has(COUNTRIES[country].region) ? 'gdpr' : 'default';
}

function defaultCurrencyFor(code) {
  const country = normalizeCountryCode(code);
  return country ? COUNTRIES[country].currency : 'USD';
}

function isValidTimeZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

module.exports = { COUNTRIES, COUNTRY_ALIASES, normalizeCountryCode, isIsoCountryCode, privacyRegime, defaultCurrencyFor, isValidTimeZone };
