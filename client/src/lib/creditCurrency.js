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
  const amount = Number(normalized);
  const minorUnits = getCreditMinorUnits(currency, metadata);
  const scale = 10 ** minorUnits;
  const amountMinor = amount * scale;
  return Number.isSafeInteger(amountMinor) && amountMinor > 0 ? amountMinor : null;
}
