/**
 * OxSteed Credit pay + payment-request markers for messenger.
 * Runtime marker fields: payment request id, amount cents, currency, status,
 * encoded memo, quote kind, and quote id.
 */

export const PAYMENT_REQ_STATUSES = ['open', 'paid', 'cancelled'];
export const CREDIT_PAY_METHOD = 'oxsteed_credit';

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

export function buildPaymentRequestMarker(opts = {}) {
  const id = opts.id != null ? String(opts.id).trim() : '';
  if (!id) return '';
  const status = PAYMENT_REQ_STATUSES.includes(String(opts.status || '').toLowerCase())
    ? String(opts.status).toLowerCase()
    : 'open';
  const amount = Number.isFinite(Number(opts.amountCents))
    ? Math.max(0, Math.round(Number(opts.amountCents)))
    : 0;
  const currency = String(opts.currency || 'USD').toUpperCase().slice(0, 3) || 'USD';
  const memo = encodeField(opts.memo, 120);
  const quoteKind = opts.quoteKind && ['business', 'helper'].includes(opts.quoteKind)
    ? opts.quoteKind
    : 'none';
  const quoteId = opts.quoteId != null && String(opts.quoteId).trim()
    ? String(opts.quoteId).trim()
    : 'none';
  return `[payment_req:${id}|${amount}|${currency}|${status}|${memo}|${quoteKind}|${quoteId}]`;
}

export function parsePaymentRequestMarker(text) {
  const match = String(text || '').match(
    /\[payment_req:([^|\]]+)\|(\d+)\|([A-Za-z]{3})\|([^|\]]+)\|([^|\]]*)\|([^|\]]*)\|([^|\]]*)\]/i,
  );
  if (!match) return null;
  return {
    id: match[1],
    amountCents: parseInt(match[2], 10) || 0,
    currency: String(match[3] || 'USD').toUpperCase(),
    status: String(match[4] || 'open').toLowerCase(),
    memo: decodeField(match[5]),
    quoteKind: match[6] === 'none' ? '' : String(match[6]).toLowerCase(),
    quoteId: match[7] === 'none' ? '' : match[7],
    raw: match[0],
  };
}

export function stripPaymentRequestMarkers(text) {
  return String(text || '')
    .replace(/\[payment_req:[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function canPayWithOxsteedCredit({ isAuthenticated, guestVerified = false, guestCreditAvailable = false } = {}) {
  if (isAuthenticated) return { ok: true };
  if (guestVerified && guestCreditAvailable) return { ok: true };
  return {
    ok: false,
    reason: 'auth_required_for_credit',
    message: 'Sign in to pay with OxSteed Credit.',
  };
}

export function validateCreditPayAmount(amountCents) {
  const n = Number(amountCents);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { ok: false, code: 'invalid_amount', error: 'Amount must be a positive integer (cents)' };
  }
  if (n > 1000000000) {
    return { ok: false, code: 'invalid_amount', error: 'Amount exceeds maximum' };
  }
  return { ok: true, amountCents: n };
}

export function normalizeIdempotencyKey(value) {
  const key = String(value || '').trim().slice(0, 160);
  if (!key || key.length < 8) {
    return { ok: false, code: 'idempotency_required', error: 'idempotencyKey is required (min 8 chars)' };
  }
  return { ok: true, idempotencyKey: key };
}

export function makeCreditPayIdempotencyKey({ conversationId, quoteId, paymentRequestId, amountCents } = {}) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const base = [
    'chat-credit',
    conversationId || 'noconv',
    paymentRequestId || quoteId || 'open',
    amountCents != null ? String(amountCents) : '0',
    stamp,
  ].join(':');
  return base.slice(0, 160);
}

export function formatCreditBalanceHint(balanceCents, locale = 'en', currency = 'USD') {
  if (balanceCents == null || !Number.isFinite(Number(balanceCents))) return null;
  const n = Number(balanceCents) / 100;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function assertConversationMembershipHint({ userId, customerId } = {}) {
  if (!userId || !customerId) return { ok: false, code: 'forbidden' };
  if (String(userId) !== String(customerId)) return { ok: false, code: 'customer_only' };
  return { ok: true };
}


export function buildCreditRefundMarker({
  id,
  amountCents,
  currency = 'USD',
  status = 'posted',
  popId = null,
  refundTxnId = null,
} = {}) {
  if (!id) return '';
  const amount = Number.isFinite(Number(amountCents)) ? Math.max(0, Math.round(Number(amountCents))) : 0;
  const cur = String(currency || 'USD').toUpperCase().slice(0, 3) || 'USD';
  const st = String(status || 'posted').toLowerCase().slice(0, 32) || 'posted';
  const pop = popId != null && String(popId).trim() ? String(popId).trim() : 'none';
  const txn = refundTxnId != null && String(refundTxnId).trim() ? String(refundTxnId).trim() : 'none';
  return `[credit_refund:${id}|${amount}|${cur}|${st}|${pop}|${txn}]`;
}

export function parseCreditRefundMarker(text) {
  const match = String(text || '').match(
    /\[credit_refund:([^|\]]+)\|(\d+)\|([A-Za-z]{3})\|([^|\]]+)\|([^|\]]*)\|([^|\]]*)\]/i,
  );
  if (!match) return null;
  return {
    id: match[1],
    amountCents: parseInt(match[2], 10) || 0,
    currency: String(match[3] || 'USD').toUpperCase(),
    status: String(match[4] || 'posted').toLowerCase(),
    popId: match[5] === 'none' ? '' : match[5],
    refundTxnId: match[6] === 'none' ? '' : match[6],
    raw: match[0],
  };
}

export function stripCreditRefundMarkers(text) {
  return String(text || '')
    .replace(/\[credit_refund:[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
