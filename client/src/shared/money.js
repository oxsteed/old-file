// Shared money module. Amounts are integers in the currency's minor unit
// (cents for USD, yen for JPY, fils for KWD). The server keeps a generated,
// behaviourally identical CommonJS copy in server/validation/money.js
// (client/scripts/paymentLayers.test.mjs proves parity). Never use floats
// for money: parse decimal strings exactly and do rate math in BigInt.

export const CURRENCY_EXPONENTS = Object.freeze({
  USD: 2, CAD: 2, GBP: 2, EUR: 2, AUD: 2, NZD: 2, CHF: 2, MXN: 2, BRL: 2, KES: 2,
  HTG: 2, DOP: 2, JMD: 2, NGN: 2, GHS: 2, ZAR: 2, INR: 2, PHP: 2, SGD: 2, HKD: 2,
  SEK: 2, NOK: 2, DKK: 2, PLN: 2, CZK: 2, MAD: 2, HUF: 2, TWD: 2,
  XOF: 0, XAF: 0, JPY: 0, KRW: 0, VND: 0, CLP: 0, PYG: 0, RWF: 0, UGX: 0, ISK: 0,
  KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3,
});

export const DEFAULT_CURRENCY = 'USD';
export const MAX_MINOR_AMOUNT = 1_000_000_000_000;

export function normalizeCurrency(code) {
  if (typeof code !== 'string') return null;
  const upper = code.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENTS, upper) ? upper : null;
}

export function currencyExponent(code) {
  const currency = normalizeCurrency(code);
  return currency ? CURRENCY_EXPONENTS[currency] : 2;
}

export function isMinorAmount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_MINOR_AMOUNT;
}

/** "12.5" → 1250 (USD), "1200" → 1200 (JPY). Null when not representable. */
export function toMinor(input, currency) {
  const exp = currencyExponent(currency);
  let text;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    text = input.toFixed(Math.min(exp + 2, 6));
  } else if (typeof input === 'string') {
    text = input.trim().replace(/[\s,_]/g, '');
  } else {
    return null;
  }
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const whole = match[1];
  let fraction = (match[2] || '').replace(/0+$/, '');
  if (fraction.length > exp) return null;
  fraction = fraction.padEnd(exp, '0');
  const value = Number(`${whole}${fraction}`);
  return isMinorAmount(value) ? value : null;
}

/** 1250, 'USD' → "12.50"; 1200, 'JPY' → "1200". */
export function fromMinor(minor, currency) {
  if (!Number.isSafeInteger(minor)) return null;
  const exp = currencyExponent(currency);
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exp + 1, '0');
  const text = exp === 0 ? digits : `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
  return negative ? `-${text}` : text;
}

export function formatMoney(minor, currency, locale = 'en') {
  const code = normalizeCurrency(currency) || DEFAULT_CURRENCY;
  const exp = currencyExponent(code);
  if (!Number.isSafeInteger(minor)) return '';
  const major = Number(fromMinor(minor, code));
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency: code, minimumFractionDigits: exp, maximumFractionDigits: exp,
    }).format(major);
  } catch {
    return `${fromMinor(minor, code)} ${code}`;
  }
}

function bigDiv(numerator, denominator, rounding) {
  const q = numerator / denominator;
  const r = numerator % denominator;
  if (r === 0n) return q;
  if (rounding === 'up') return q + 1n;
  if (rounding === 'down') return q;
  return r * 2n >= denominator ? q + 1n : q;
}

/** Basis points of an amount, half-up by default. */
export function bpsOf(minor, bps, rounding = 'half_up') {
  if (!Number.isSafeInteger(minor) || !Number.isSafeInteger(bps)) return null;
  return Number(bigDiv(BigInt(minor) * BigInt(bps), 10000n, rounding));
}

/**
 * Convert minor units across currencies with an exact rational rate
 * (1 major `from` = numerator/denominator major `to`), adjusting for the
 * exponent difference. Rounds half-up unless told otherwise.
 */
export function convertMinor(minor, from, to, rateNumerator, rateDenominator, rounding = 'half_up') {
  if (!Number.isSafeInteger(minor) || minor < 0) return null;
  let num;
  let den;
  try {
    num = BigInt(String(rateNumerator));
    den = BigInt(String(rateDenominator));
  } catch {
    return null;
  }
  if (num <= 0n || den <= 0n) return null;
  const shift = currencyExponent(to) - currencyExponent(from);
  let n = BigInt(minor) * num;
  let d = den;
  if (shift > 0) n *= 10n ** BigInt(shift);
  if (shift < 0) d *= 10n ** BigInt(-shift);
  const value = Number(bigDiv(n, d, rounding));
  return isMinorAmount(value) ? value : null;
}

/** What the customer pays when an FX spread (bps) is added, rounded up. */
export function withSpread(minor, spreadBps) {
  if (!Number.isSafeInteger(minor) || !Number.isSafeInteger(spreadBps) || spreadBps < 0) return null;
  return Number(bigDiv(BigInt(minor) * BigInt(10000 + spreadBps), 10000n, 'up'));
}

/** Legacy USD decimal (dollars) → cents; kept for the existing US paths. */
export function dollarsToCents(value) {
  return toMinor(typeof value === 'number' ? value : String(value ?? ''), 'USD');
}
