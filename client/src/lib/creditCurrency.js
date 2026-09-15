const DEFAULT_MINOR_UNITS = 2;

// Keep the fallback admin selector aligned with the server's explicitly
// verified ISO 4217 allowlist when the overview request is unavailable.
export const DEFAULT_CREDIT_CURRENCIES = Object.freeze([
  'AED', 'AUD', 'BHD', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'CZK', 'DOP',
  'EGP', 'EUR', 'GBP', 'HKD', 'HTG', 'HUF', 'ILS', 'INR', 'IQD', 'ISK',
  'JOD', 'JPY', 'KRW', 'KWD', 'LYD', 'MAD', 'MXN', 'NGN', 'NOK', 'NZD',
  'OMR', 'PHP', 'PLN', 'PYG', 'RON', 'SAR', 'SEK', 'SGD', 'THB', 'TND',
  'TRY', 'UGX', 'USD', 'VND', 'VUV', 'XAF', 'XOF', 'XPF', 'ZAR',
]);

function normalizeCurrency(currency) {
  return String(currency || 'USD').trim().toUpperCase();
}

export function getCreditMinorUnits(currency, metadata = {}) {
  const code = normalizeCurrency(currency);
  const configuredUnits = Number(metadata?.[code]?.minorUnits);
  if (Number.isInteger(configuredUnits) && configuredUnits >= 0 && configuredUnits <= 3) {
    return configuredUnits;
  }

  // Intl carries the browser's ISO 4217 precision table for currencies that
  // were explicitly enabled by the server but are not in an older UI build.
  try {
    const resolved = new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).resolvedOptions();
    if (Number.isInteger(resolved.maximumFractionDigits) && resolved.maximumFractionDigits >= 0 && resolved.maximumFractionDigits <= 3) {
      return resolved.maximumFractionDigits;
    }
  } catch {
    // The caller still gets a safe two-decimal fallback for an invalid code.
  }
  return DEFAULT_MINOR_UNITS;
}

export function formatCreditMinorUnits(amountMinor, currency = 'USD', metadata = {}) {
  const code = normalizeCurrency(currency);
  const minorUnits = getCreditMinorUnits(code, metadata);
  const amount = (Number(amountMinor) || 0) / (10 ** minorUnits);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: minorUnits,
      maximumFractionDigits: minorUnits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(minorUnits)} ${code}`;
  }
}

export function parseCreditMajorAmount(value, currency = 'USD', metadata = {}) {
  const normalized = String(value ?? '').trim().replace(/[$,\s]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const minorUnits = getCreditMinorUnits(currency, metadata);
  const [wholePart, fractionPart = ''] = normalized.split('.');
  if (fractionPart.length > minorUnits) return null;

  // Parse decimal text exactly instead of multiplying a binary float. This
  // keeps values such as 0.29 USD and 1.005 KWD representable at the ledger
  // boundary while still enforcing the safe integer range.
  const scale = 10n ** BigInt(minorUnits);
  const wholeMinor = BigInt(wholePart) * scale;
  const fractionMinor = minorUnits === 0
    ? 0n
    : BigInt((fractionPart || '').padEnd(minorUnits, '0'));
  const amountMinor = wholeMinor + fractionMinor;
  const maxSafeMinor = BigInt(Number.MAX_SAFE_INTEGER);
  return amountMinor > 0n && amountMinor <= maxSafeMinor ? Number(amountMinor) : null;
}

export function parseOptionalCreditMajorAmount(value, currency = 'USD', metadata = {}) {
  if (String(value ?? '').trim() === '') return { value: null, valid: true };
  const parsed = parseCreditMajorAmount(value, currency, metadata);
  return { value: parsed, valid: parsed !== null };
}
