// Format integer minor units without converting the balance to a floating
// point major-unit amount. In particular, MAX_SAFE_INTEGER must retain cents.
export function formatStatementMoney(amountMinor, currencyCode, language = 'en') {
  if (!Number.isSafeInteger(amountMinor) || !/^[A-Z]{3}$/.test(currencyCode)) return '—';
  const formatter = new Intl.NumberFormat(language, { style: 'currency', currency: currencyCode, currencyDisplay: 'code' });
  const digits = formatter.resolvedOptions().maximumFractionDigits;
  const minor = BigInt(amountMinor);
  const absolute = minor < 0n ? -minor : minor;
  const scale = 10n ** BigInt(digits);
  const whole = absolute / scale;
  const signedWhole = minor < 0n ? (whole === 0n ? -0 : -whole) : whole;
  const digitFormat = new Intl.NumberFormat(language, { useGrouping: false });
  const fraction = String(absolute % scale).padStart(digits, '0')
    .split('').map(digit => digitFormat.format(Number(digit))).join('');
  return formatter.formatToParts(signedWhole).map(part => part.type === 'fraction' ? fraction : part.value).join('');
}
