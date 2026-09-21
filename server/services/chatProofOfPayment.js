'use strict';

/**
 * Proof-of-payment markers + pure helpers for in-chat POP cards.
 * Marker: [pop:id|status|amount_cents|method_enc|txn_enc|paid_on|quote_kind|quote_id]
 */

const POP_STATUSES = new Set(['submitted', 'confirmed', 'rejected']);
const CONFIRM_ACTIONS = new Set(['confirm', 'reject']);
const MAX_AMOUNT_CENTS = 1000000000;
const ALLOWED_POP_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

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

function buildPopMarker(opts = {}) {
  const id = opts.id != null ? String(opts.id).trim() : '';
  if (!id) return '';
  const status = POP_STATUSES.has(String(opts.status || '').toLowerCase())
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

function parsePopMarker(text) {
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

function stripPopMarkers(text) {
  return String(text || '')
    .replace(/\[pop:[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildPopShareContent({ marker, amountCents, paymentMethod, preface } = {}) {
  if (!marker) return '';
  const dollars = ((Number(amountCents) || 0) / 100).toFixed(2);
  const method = paymentMethod ? ` via ${paymentMethod}` : '';
  const head =
    typeof preface === 'string' && preface.trim()
      ? preface.trim()
      : `Proof of payment: $${dollars}${method}`;
  return `${head}\n${marker}`;
}

function normalizePopPayload(body = {}) {
  const amountCents =
    body.amount_cents !== undefined
      ? Number(body.amount_cents)
      : body.amount !== undefined
        ? Math.round(Number(body.amount) * 100)
        : 0;
  if (!Number.isFinite(amountCents) || !Number.isInteger(amountCents) || amountCents < 0 || amountCents > MAX_AMOUNT_CENTS) {
    return { error: 'Invalid amount' };
  }
  const paymentMethod = String(body.payment_method || body.paymentMethod || '').trim().slice(0, 80);
  const transactionId = String(body.transaction_id || body.transactionId || '').trim().slice(0, 200);
  const paidOnRaw = body.paid_on || body.paidOn || null;
  let paidOn = null;
  if (paidOnRaw) {
    const s = String(paidOnRaw).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: 'paid_on must be YYYY-MM-DD' };
    paidOn = s;
  }
  const notes = String(body.notes || '').trim().slice(0, 2000);
  const quoteKind = body.quote_kind || body.quoteKind || null;
  const quoteId = body.quote_id || body.quoteId || null;
  if (quoteKind && !['business', 'helper'].includes(String(quoteKind))) {
    return { error: 'Invalid quote_kind' };
  }
  if (!paymentMethod && !transactionId && !body.attachment_key && !body.hasFile) {
    return { error: 'Provide payment details or an attachment' };
  }
  return {
    amountCents,
    currency: String(body.currency || 'USD').toUpperCase().slice(0, 3),
    paymentMethod: paymentMethod || null,
    transactionId: transactionId || null,
    paidOn,
    notes: notes || null,
    quoteKind: quoteKind ? String(quoteKind) : null,
    quoteId: quoteId != null && String(quoteId).trim() ? String(quoteId).trim() : null,
    bookingRequestId: body.booking_request_id || body.bookingRequestId || null,
  };
}

function toPublicPopCard(row, { includeAttachmentMeta = true } = {}) {
  if (!row) return null;
  return {
    id: String(row.id),
    status: row.status,
    amount_cents: row.amount_cents,
    currency: row.currency || 'USD',
    payment_method: row.payment_method,
    transaction_id: row.transaction_id,
    paid_on: row.paid_on ? String(row.paid_on).slice(0, 10) : null,
    notes: row.notes,
    quote_kind: row.quote_kind,
    quote_id: row.quote_id,
    booking_request_id: row.booking_request_id,
    conversation_id: row.conversation_id,
    guest_session_id: row.guest_session_id,
    has_attachment: Boolean(row.attachment_key),
    attachment_name: includeAttachmentMeta ? row.attachment_name : undefined,
    attachment_mime: includeAttachmentMeta ? row.attachment_mime : undefined,
    attachment_size: includeAttachmentMeta ? row.attachment_size : undefined,
    confirmed_at: row.confirmed_at,
    reject_reason: row.reject_reason,
    created_at: row.created_at,
    sensitive: row.sensitive !== false,
  };
}

/** Redact for non-admin application logs. */
function redactPopForLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    conversation_id: row.conversation_id,
    guest_session_id: row.guest_session_id,
    has_attachment: Boolean(row.attachment_key),
    amount_cents: '[redacted]',
    transaction_id: row.transaction_id ? '[redacted]' : null,
  };
}

module.exports = {
  POP_STATUSES,
  CONFIRM_ACTIONS,
  ALLOWED_POP_MIMES,
  MAX_AMOUNT_CENTS,
  buildPopMarker,
  parsePopMarker,
  stripPopMarkers,
  buildPopShareContent,
  normalizePopPayload,
  toPublicPopCard,
  redactPopForLog,
  encodeField,
  decodeField,
};
