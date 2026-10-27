'use strict';

/**
 * Live FX rate provider for OxSteed Credit currency quotes.
 *
 * Providers:
 *   - Frankfurter (https://api.frankfurter.app/latest, ECB data), free, no
 *     API key, for every currency the ECB publishes;
 *   - official central-bank reference rates for currencies the ECB does not
 *     cover (HTG: Banque de la République d'Haïti), fetched by an in-house
 *     adapter into credit_fx_reference_rates and used only while fresh
 *     (FX_REFERENCE_MAX_AGE_DAYS, default 4). Crosses go through USD.
 *
 * Environment:
 *   FX_RATE_PROVIDER   - logical provider name. Informational only; this
 *                        module only implements 'frankfurter'. Reserved so a
 *                        future provider can be selected without a schema change.
 *   FX_RATE_TIMEOUT_MS - per-request timeout in milliseconds. Default 8000,
 *                        minimum 1000. Read on every call.
 *
 * Design rules:
 *   - Fail closed: ANY provider failure (network error, timeout/abort,
 *     non-200 status, malformed payload, unsupported currency) throws
 *     AppError 502 'fx_rate_unavailable'. There is no fallback rate; the
 *     only stored rates are dated official reference rates, refused once
 *     stale.
 *   - Never logs or throws secrets: Frankfurter needs no API key, and no
 *     request/response field handled here is secret.
 */

const { AppError } = require('../middleware/errorHandler');

const PROVIDER_NAME = 'frankfurter';
const FRANKFURTER_BASE_URL = 'https://api.frankfurter.app/latest';
const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 1000;
// The rate is expressed as an integer ratio with a fixed 1e8 denominator so
// the existing quote math (BigInt half-up rounding in
// oxsteedCreditCurrencyConversionService) can consume it exactly.
const RATE_DENOMINATOR = 100000000;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

function getTimeoutMs() {
  const parsed = Number(process.env.FX_RATE_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed > 0) return Math.max(MIN_TIMEOUT_MS, Math.floor(parsed));
  return DEFAULT_TIMEOUT_MS;
}

function assertCurrencyPair(fromCurrency, toCurrency) {
  if (typeof fromCurrency !== 'string'
    || typeof toCurrency !== 'string'
    || !CURRENCY_CODE_PATTERN.test(fromCurrency)
    || !CURRENCY_CODE_PATTERN.test(toCurrency)
    || fromCurrency === toCurrency) {
    throw new AppError('FX currency codes must be two different ISO 4217 codes', 400, 'fx_invalid_currency', {
      fromCurrency: String(fromCurrency ?? ''),
      toCurrency: String(toCurrency ?? ''),
    });
  }
}

/**
 * Fetch a live FX quote from Frankfurter.
 *
 * @param {string} fromCurrency - ISO 4217 source code, e.g. 'USD'
 * @param {string} toCurrency   - ISO 4217 target code, e.g. 'EUR'
 * @returns {Promise<{rateNumerator:string, rateDenominator:string, quotedAt:string, provider:string}>}
 * @throws {AppError} 400 'fx_invalid_currency' on bad input,
 *                    502 'fx_rate_unavailable' on any provider failure.
 */
async function getFxQuote(fromCurrency, toCurrency) {
  assertCurrencyPair(fromCurrency, toCurrency);
  if (OFFICIAL_SOURCES[fromCurrency] || OFFICIAL_SOURCES[toCurrency]) {
    return getOfficialCrossQuote(fromCurrency, toCurrency);
  }
  return getFrankfurterQuote(fromCurrency, toCurrency);
}

// ── Official central-bank reference rates (licence readiness bug 7) ─────
// Currencies the ECB feed does not cover are priced from the issuing
// central bank's published reference rate, stored by an in-house adapter.
// HTG: Banque de la République d'Haïti (services/fx/brhReferenceRate.js).
const OFFICIAL_SOURCES = Object.freeze({ HTG: 'brh' });

function referenceMaxAgeDays() {
  const parsed = Number(process.env.FX_REFERENCE_MAX_AGE_DAYS);
  // BRH publishes on business days; 4 days covers a long weekend.
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 14) : 4;
}

function decimalToFraction(text) {
  const m = String(text).trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const frac = m[2] || '';
  return { n: BigInt(m[1] + frac), d: 10n ** BigInt(frac.length) };
}

function roundDiv(n, d) {
  return (2n * n + d) / (2n * d);
}

async function loadOfficialUnitsPerUsd(currency) {
  const db = require('../db');
  const maxAge = referenceMaxAgeDays();
  const latest = async () => {
    const { rows } = await db.query(
      `SELECT units_per_base, rate_date, source FROM credit_fx_reference_rates
        WHERE quote_currency = $1 AND base_currency = 'USD'
          AND rate_date >= (CURRENT_DATE - $2::int)
        ORDER BY rate_date DESC, fetched_at DESC LIMIT 1`,
      [currency, maxAge]
    );
    return rows && rows[0] ? rows[0] : null;
  };
  let row = await latest().catch(() => null);
  if (!row && OFFICIAL_SOURCES[currency] === 'brh') {
    try {
      await require('./fx/brhReferenceRate').refreshBrhReferenceRate(db);
      row = await latest();
    } catch (error) {
      row = null;
    }
  }
  if (!row) {
    throw new AppError(`No fresh official reference rate for ${currency}`, 502, 'fx_rate_unavailable', { currency, source: OFFICIAL_SOURCES[currency] });
  }
  const fraction = decimalToFraction(String(row.units_per_base));
  if (!fraction || fraction.n <= 0n) throw new AppError('Stored reference rate is invalid', 502, 'fx_rate_unavailable');
  return { ...fraction, source: row.source, rateDate: row.rate_date };
}

async function getOfficialCrossQuote(fromCurrency, toCurrency) {
  // rate = units of `to` per 1 unit of `from`, as an exact fraction.
  let n = 1n;
  let d = 1n;
  const sources = [];
  if (fromCurrency !== 'USD') {
    if (OFFICIAL_SOURCES[fromCurrency]) {
      const f = await loadOfficialUnitsPerUsd(fromCurrency); // from per USD
      n *= f.d; d *= f.n; sources.push(`${f.source}:${fromCurrency}`);
    } else {
      const q = await getFrankfurterQuote(fromCurrency, 'USD');
      n *= BigInt(q.rateNumerator); d *= BigInt(q.rateDenominator); sources.push(PROVIDER_NAME);
    }
  }
  if (toCurrency !== 'USD') {
    if (OFFICIAL_SOURCES[toCurrency]) {
      const f = await loadOfficialUnitsPerUsd(toCurrency); // to per USD
      n *= f.n; d *= f.d; sources.push(`${f.source}:${toCurrency}`);
    } else {
      const q = await getFrankfurterQuote('USD', toCurrency);
      n *= BigInt(q.rateNumerator); d *= BigInt(q.rateDenominator); sources.push(PROVIDER_NAME);
    }
  }
  const rateNumerator = roundDiv(n * BigInt(RATE_DENOMINATOR), d);
  if (rateNumerator <= 0n || rateNumerator > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError('FX reference rate is out of range', 502, 'fx_rate_unavailable');
  }
  return {
    rateNumerator: rateNumerator.toString(),
    rateDenominator: String(RATE_DENOMINATOR),
    quotedAt: new Date().toISOString(),
    provider: sources.join('+'),
  };
}

async function getFrankfurterQuote(fromCurrency, toCurrency) {
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${FRANKFURTER_BASE_URL}?from=${encodeURIComponent(fromCurrency)}&to=${encodeURIComponent(toCurrency)}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new AppError(`FX rate provider returned HTTP ${res.status}`, 502, 'fx_rate_unavailable');
    }
    let data;
    try {
      data = await res.json();
    } catch (jsonError) {
      throw new AppError('FX rate provider returned an unreadable payload', 502, 'fx_rate_unavailable');
    }
    const rate = data && typeof data === 'object' && data.rates ? data.rates[toCurrency] : undefined;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new AppError('FX rate provider returned an invalid rate', 502, 'fx_rate_unavailable');
    }
    const rateNumerator = Math.round(rate * RATE_DENOMINATOR);
    if (!Number.isSafeInteger(rateNumerator) || rateNumerator <= 0) {
      throw new AppError('FX rate provider returned an out-of-range rate', 502, 'fx_rate_unavailable');
    }
    return {
      rateNumerator: String(rateNumerator),
      rateDenominator: String(RATE_DENOMINATOR),
      quotedAt: new Date().toISOString(),
      provider: PROVIDER_NAME,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error && error.name === 'AbortError') {
      throw new AppError(`FX rate request timed out after ${timeoutMs}ms`, 502, 'fx_rate_unavailable');
    }
    throw new AppError('FX rate provider is unavailable', 502, 'fx_rate_unavailable');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { getFxQuote, OFFICIAL_SOURCES, decimalToFraction };
