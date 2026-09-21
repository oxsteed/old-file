'use strict';

/**
 * Pure helpers for in-chat OxSteed Credit payments + payment-request markers.
 * Marker: [payment_req:id|amount_cents|currency|status|memo_enc|quote_kind|quote_id]
 *
 * Ledger moves call oxsteedCreditService — never invent a second ledger here.
 */

const MAX_AMOUNT_CENTS = 1000000000;
const PAYMENT_REQ_STATUSES = new Set(['open', 'paid', 'cancelled', 'refunded']);
const CREDIT_PAY_METHOD = 'oxsteed_credit';

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

function parsePositiveAmountCents(value, { fieldName = 'amountCents', allowZero = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { error: `Invalid ${fieldName}`, code: 'invalid_amount' };
  }
  if (allowZero ? n < 0 : n <= 0) {
    return { error: `${fieldName} must be ${allowZero ? 'non-negative' : 'positive'}`, code: 'invalid_amount' };
  }
  if (n > MAX_AMOUNT_CENTS) {
    return { error: `${fieldName} exceeds maximum`, code: 'invalid_amount' };
  }
  return { amountCents: n };
}

function normalizeCurrency(value) {
  const c = String(value || 'USD').trim().toUpperCase().slice(0, 3);
  if (!/^[A-Z]{3}$/.test(c)) return { error: 'Invalid currency', code: 'invalid_currency' };
  return { currency: c };
}

function normalizeIdempotencyKey(value) {
  const key = String(value || '').trim().slice(0, 160);
  if (!key || key.length < 8) {
    return { error: 'idempotencyKey is required (min 8 chars)', code: 'idempotency_required' };
  }
  return { idempotencyKey: key };
}

/**
 * Normalize POST /api/chat/payments/oxsteed-credit body.
 */
function normalizeCreditPayPayload(body = {}) {
  const conversationId = body.conversationId || body.conversation_id || null;
  if (!conversationId) {
    return { error: 'conversationId is required', code: 'validation_failed' };
  }

  const amountSource =
    body.amount_cents !== undefined
      ? body.amount_cents
      : body.amountCents !== undefined
        ? body.amountCents
        : body.amount !== undefined
          ? Math.round(Number(body.amount) * 100)
          : undefined;
  const amount = parsePositiveAmountCents(amountSource);
  if (amount.error) return amount;

  const currency = normalizeCurrency(body.currency);
  if (currency.error) return currency;

  const idem = normalizeIdempotencyKey(body.idempotencyKey || body.idempotency_key);
  if (idem.error) return idem;

  const quoteKind = body.quoteKind || body.quote_kind || null;
  const quoteId = body.quoteId || body.quote_id || null;
  if (quoteKind && !['business', 'helper'].includes(String(quoteKind))) {
    return { error: 'Invalid quoteKind', code: 'validation_failed' };
  }

  const payeeBusinessIdRaw = body.payeeBusinessId ?? body.payee_business_id ?? null;
  let payeeBusinessId = null;
  if (payeeBusinessIdRaw !== null && payeeBusinessIdRaw !== undefined && String(payeeBusinessIdRaw).trim() !== '') {
    const n = Number.parseInt(String(payeeBusinessIdRaw), 10);
    if (!Number.isSafeInteger(n) || n <= 0) {
      return { error: 'Invalid payeeBusinessId', code: 'validation_failed' };
    }
    payeeBusinessId = n;
  }

  const payeeHelperId = body.payeeHelperId || body.payee_helper_id || null;
  const paymentRequestId = body.paymentRequestId || body.payment_request_id || null;
  const memo = String(body.memo || '').trim().slice(0, 500) || null;

  return {
    conversationId: String(conversationId),
    amountCents: amount.amountCents,
    currency: currency.currency,
    idempotencyKey: idem.idempotencyKey,
    quoteKind: quoteKind ? String(quoteKind) : null,
    quoteId: quoteId != null && String(quoteId).trim() ? String(quoteId).trim() : null,
    payeeBusinessId,
    payeeHelperId: payeeHelperId ? String(payeeHelperId) : null,
    paymentRequestId: paymentRequestId ? String(paymentRequestId) : null,
    memo,
  };
}

/**
 * Normalize provider "Request payment" body.
 */
function normalizePaymentRequestPayload(body = {}) {
  const conversationId = body.conversationId || body.conversation_id || null;
  const guestSessionId = body.guestSessionId || body.guest_session_id || null;
  if (!conversationId && !guestSessionId) {
    return { error: 'conversationId or guestSessionId required', code: 'validation_failed' };
  }

  const amountSource =
    body.amount_cents !== undefined
      ? body.amount_cents
      : body.amountCents !== undefined
        ? body.amountCents
        : body.amount !== undefined
          ? Math.round(Number(body.amount) * 100)
          : undefined;
  const amount = parsePositiveAmountCents(amountSource);
  if (amount.error) return amount;

  const currency = normalizeCurrency(body.currency);
  if (currency.error) return currency;

  const quoteKind = body.quoteKind || body.quote_kind || null;
  const quoteId = body.quoteId || body.quote_id || null;
  if (quoteKind && !['business', 'helper'].includes(String(quoteKind))) {
    return { error: 'Invalid quoteKind', code: 'validation_failed' };
  }

  return {
    conversationId: conversationId ? String(conversationId) : null,
    guestSessionId: guestSessionId ? String(guestSessionId) : null,
    amountCents: amount.amountCents,
    currency: currency.currency,
    memo: String(body.memo || '').trim().slice(0, 500) || null,
    quoteKind: quoteKind ? String(quoteKind) : null,
    quoteId: quoteId != null && String(quoteId).trim() ? String(quoteId).trim() : null,
    preface: typeof body.preface === 'string' ? body.preface.trim().slice(0, 500) : null,
    idempotencyKey: body.idempotencyKey || body.idempotency_key
      ? String(body.idempotencyKey || body.idempotency_key).trim().slice(0, 160)
      : null,
  };
}

function buildPaymentRequestMarker(opts = {}) {
  const id = opts.id != null ? String(opts.id).trim() : '';
  if (!id) return '';
  const status = PAYMENT_REQ_STATUSES.has(String(opts.status || '').toLowerCase())
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

function parsePaymentRequestMarker(text) {
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

function stripPaymentRequestMarkers(text) {
  return String(text || '')
    .replace(/\[payment_req:[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildPaymentRequestShareContent({ marker, amountCents, currency, memo, preface } = {}) {
  if (!marker) return '';
  const dollars = ((Number(amountCents) || 0) / 100).toFixed(2);
  const cur = currency || 'USD';
  const memoBit = memo ? ` — ${memo}` : '';
  const head =
    typeof preface === 'string' && preface.trim()
      ? preface.trim()
      : `Payment request: ${cur} ${dollars}${memoBit}`;
  return `${head}\n${marker}`;
}

function toPublicPaymentRequestCard(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    status: row.status,
    amount_cents: row.amount_cents,
    currency: row.currency || 'USD',
    memo: row.memo,
    quote_kind: row.quote_kind,
    quote_id: row.quote_id,
    conversation_id: row.conversation_id,
    guest_session_id: row.guest_session_id,
    business_id: row.business_id != null ? String(row.business_id) : null,
    helper_id: row.helper_id != null ? String(row.helper_id) : null,
    paid_pop_id: row.paid_pop_id != null ? String(row.paid_pop_id) : null,
    paid_at: row.paid_at,
    credit_txn_id: row.credit_txn_id,
    created_at: row.created_at,
  };
}

/**
 * Decide whether a visitor can pay with OxSteed Credit in chat.
 * Guests: auth-only unless guestCreditAvailable (future) is true.
 */
function canPayWithOxsteedCredit({ isAuthenticated, guestVerified = false, guestCreditAvailable = false } = {}) {
  if (isAuthenticated) return { ok: true };
  if (guestVerified && guestCreditAvailable) return { ok: true };
  if (guestVerified) {
    return {
      ok: false,
      reason: 'auth_required_for_credit',
      message: 'Sign in to pay with OxSteed Credit. You can still upload proof of payment as a guest.',
    };
  }
  return {
    ok: false,
    reason: 'auth_required_for_credit',
    message: 'Sign in to pay with OxSteed Credit.',
  };
}

/**
 * Derive quote payment_status from totals.
 */
function deriveQuotePaymentStatus(totalCents, amountPaidCents) {
  const total = Math.max(0, Number(totalCents) || 0);
  const paid = Math.max(0, Number(amountPaidCents) || 0);
  if (paid <= 0) return 'unpaid';
  if (total > 0 && paid >= total) return 'paid';
  return 'partially_paid';
}


/**
 * Pick a ledger orderType compatible with partner agreement allow-lists.
 * Prefer `service` for chat; otherwise map onto the first allowed type
 * (documented fallback for restaurant agreements that only list
 * pickup/delivery/dine_in). Empty allow-list ⇒ treat as unrestricted.
 */
function resolveChatPurchaseOrderType(allowedOrderTypes) {
  const allowed = Array.isArray(allowedOrderTypes)
    ? allowedOrderTypes.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (!allowed.length || allowed.includes('service')) return 'service';
  return allowed[0];
}

/**
 * Normalize POST /api/chat/payments/:id/refund body.
 */
function normalizeCreditRefundPayload(body = {}) {
  const amountSource =
    body.amount_cents !== undefined
      ? body.amount_cents
      : body.amountCents !== undefined
        ? body.amountCents
        : body.amount !== undefined
          ? Math.round(Number(body.amount) * 100)
          : undefined;
  let amountCents = null;
  if (amountSource !== undefined && amountSource !== null && String(amountSource).trim() !== '') {
    const amount = parsePositiveAmountCents(amountSource);
    if (amount.error) return amount;
    amountCents = amount.amountCents;
  }
  const reason = String(body.reason || '').trim().slice(0, 500);
  if (!reason) return { error: 'reason is required', code: 'validation_failed' };
  const idem = normalizeIdempotencyKey(body.idempotencyKey || body.idempotency_key);
  if (idem.error) return idem;
  const popId = body.popId || body.pop_id || null;
  const paymentRequestId = body.paymentRequestId || body.payment_request_id || null;
  const creditTxnId = body.creditTxnId || body.credit_txn_id || body.purchaseTransactionId || null;
  return {
    amountCents,
    reason,
    idempotencyKey: idem.idempotencyKey,
    popId: popId ? String(popId) : null,
    paymentRequestId: paymentRequestId ? String(paymentRequestId) : null,
    creditTxnId: creditTxnId ? String(creditTxnId) : null,
  };
}

/**
 * Marker: [credit_refund:id|amount_cents|currency|status|pop_id|txn]
 */
function buildCreditRefundMarker(opts = {}) {
  const id = opts.id != null ? String(opts.id).trim() : '';
  if (!id) return '';
  const amount = Number.isFinite(Number(opts.amountCents))
    ? Math.max(0, Math.round(Number(opts.amountCents)))
    : 0;
  const currency = String(opts.currency || 'USD').toUpperCase().slice(0, 3) || 'USD';
  const status = String(opts.status || 'posted').toLowerCase().slice(0, 32) || 'posted';
  const popId = opts.popId != null && String(opts.popId).trim() ? String(opts.popId).trim() : 'none';
  const txn = opts.refundTxnId != null && String(opts.refundTxnId).trim()
    ? String(opts.refundTxnId).trim()
    : 'none';
  return `[credit_refund:${id}|${amount}|${currency}|${status}|${popId}|${txn}]`;
}

function parseCreditRefundMarker(text) {
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

function stripCreditRefundMarkers(text) {
  return String(text || '')
    .replace(/\[credit_refund:[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildCreditRefundShareContent({ marker, amountCents, currency, reason }) {
  const dollars = (Number(amountCents) / 100).toFixed(2);
  const cur = String(currency || 'USD').toUpperCase();
  const note = reason ? `\n${String(reason).slice(0, 200)}` : '';
  return `OxSteed Credit refund: ${cur} ${dollars}${note}\n${marker}`;
}

function toPublicCreditRefundCard(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    conversationId: row.conversation_id != null ? String(row.conversation_id) : null,
    paymentRequestId: row.payment_request_id != null ? String(row.payment_request_id) : null,
    popId: row.pop_id != null ? String(row.pop_id) : null,
    amountCents: Number(row.amount_cents || 0),
    currency: row.currency || 'USD',
    reason: row.reason || null,
    status: row.status || 'posted',
    purchaseTxnId: row.purchase_txn_id || null,
    refundTxnId: row.refund_txn_id || null,
    createdAt: row.created_at || null,
  };
}


function assertMembershipForCustomerPay(userId, conv) {
  if (!userId || !conv) return { ok: false, code: 'forbidden', error: 'Not a conversation participant' };
  if (String(conv.customer_id) !== String(userId)) {
    return { ok: false, code: 'customer_only', error: 'Only the customer can pay with OxSteed Credit' };
  }
  return { ok: true };
}

module.exports = {
  MAX_AMOUNT_CENTS,
  PAYMENT_REQ_STATUSES,
  CREDIT_PAY_METHOD,
  parsePositiveAmountCents,
  normalizeCurrency,
  normalizeIdempotencyKey,
  normalizeCreditPayPayload,
  normalizePaymentRequestPayload,
  buildPaymentRequestMarker,
  parsePaymentRequestMarker,
  stripPaymentRequestMarkers,
  buildPaymentRequestShareContent,
  toPublicPaymentRequestCard,
  canPayWithOxsteedCredit,
  deriveQuotePaymentStatus,
  assertMembershipForCustomerPay,
  resolveChatPurchaseOrderType,
  normalizeCreditRefundPayload,
  buildCreditRefundMarker,
  parseCreditRefundMarker,
  stripCreditRefundMarkers,
  buildCreditRefundShareContent,
  toPublicCreditRefundCard,
  encodeField,
  decodeField,
};
