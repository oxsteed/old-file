'use strict';

/**
 * Live FX rate provider for OxSteed Credit currency quotes.
 *
 * Current provider: Frankfurter (https://api.frankfurter.app/latest).
 * It is free and needs no API key.
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
 *     AppError 502 'fx_rate_unavailable'. There is no fallback rate and no
 *     cached rate.
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

module.exports = { getFxQuote };
