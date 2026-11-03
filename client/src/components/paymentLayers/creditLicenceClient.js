// Small helpers shared by the helper-facing OxSteed Credit licence panels
// (cash-out, payout destinations, disclosures, wage consent, wind-down,
// erasure). Error text always comes from the paymentRail.reasons catalog.

export function newIdempotencyKey() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

const CODE_PATTERN = /^[a-z0-9_]{1,80}$/;

export function reasonMessage(t, err) {
  const data = err?.response?.data || {};
  const code = data.code || err?.code || null;
  const fallback = t('paymentRail.genericError');
  // Field-level reasons (validation_failed) are more useful than the
  // generic code, so the first one that has copy wins.
  const fieldReasons = Object.values(data.fields || {}).filter((v) => typeof v === 'string' && CODE_PATTERN.test(v));
  const generic = !code || typeof code !== 'string' || !CODE_PATTERN.test(code)
    ? fallback
    : t(`paymentRail.reasons.${code}`, { defaultValue: fallback });
  for (const reason of fieldReasons) {
    const text = t(`paymentRail.reasons.${reason}`, { defaultValue: '' });
    if (text) return text;
  }
  return generic;
}

export function formatDay(value, language) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(language || undefined, { dateStyle: 'medium' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

// Statuses a helper can still cancel before the bank instruction leaves.
export const CANCELABLE_CASHOUT_STATUSES = Object.freeze(['requested', 'held_for_review']);
// Disputes stay "open" for these statuses (one at a time per cash-out).
export const OPEN_DISPUTE_STATUSES = Object.freeze(['open', 'investigating']);
