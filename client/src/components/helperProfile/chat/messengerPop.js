/**
 * Proof-of-payment markers for messenger.
 * [pop:id|status|amount_cents|method_enc|txn_enc|paid_on|quote_kind|quote_id]
 */

export const POP_STATUSES = ['submitted', 'confirmed', 'rejected'];

function encodeField(value, max = 80) {
  return encodeURIComponent(String(value || '').trim().slice(0, max)) || 'none';
}

function decodeField(enc) {
  if (!enc || enc === 'none') return '';
  try {
    return decodeURIComponent(String(enc));
  } catch {
    return String(enc);
  }
}

export function buildPopMarker(opts = {}) {
  const id = opts.id != null ? String(opts.id).trim() : '';
  if (!id) return '';
  const status = POP_STATUSES.includes(String(opts.status || '').toLowerCase())
    ? String(opts.status).toLowerCase()
    : 'submitted';
  const amount = Number.isFinite(Number(opts.amountCents))
    ? Math.max(0, Math.round(Number(opts.amountCents)))
    : 0;
  const method = encodeField(opts.paymentMethod, 40);
  const txn = encodeField(opts.transactionId, 60);
  const paidOn = opts.paidOn ? String(opts.paidOn).slice(0, 10) : '';
  const quoteKind = opts.quoteKind && ['business', 'helper'].includes(opts.quoteKind)
    ? opts.quoteKind
    : 'none';
  const quoteId = opts.quoteId != null && String(opts.quoteId).trim()
    ? String(opts.quoteId).trim()
    : 'none';
  return `[pop:${id}|${status}|${amount}|${method}|${txn}|${paidOn}|${quoteKind}|${quoteId}]`;
}

export function parsePopMarker(text) {
  const match = String(text || '').match(
    /\[pop:([^|\]]+)\|([^|\]]+)\|(\d+)\|([^|\]]*)\|([^|\]]*)\|([^|\]]*)\|([^|\]]*)\|([^|\]]*)\]/i,
  );
  if (!match) return null;
  return {
    id: match[1],
    status: String(match[2] || 'submitted').toLowerCase(),
    amountCents: parseInt(match[3], 10) || 0,
    paymentMethod: decodeField(match[4]),
    transactionId: decodeField(match[5]),
    paidOn: match[6] || '',
    quoteKind: match[7] === 'none' ? '' : String(match[7]).toLowerCase(),
    quoteId: match[8] === 'none' ? '' : match[8],
    raw: match[0],
  };
}

export function stripPopMarkers(text) {
  return String(text || '')
    .replace(/\[pop:[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatPopAmount(cents, locale = 'en', currency = 'USD') {
  const n = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}
