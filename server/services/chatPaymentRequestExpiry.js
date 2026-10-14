'use strict';

/**
 * services/chatPaymentRequestExpiry.js
 *
 * Review P2-10-F01 (open-forever half): chat_payment_requests never expired,
 * so an abandoned request card could be paid or POP-confirmed arbitrarily
 * far in the future. Requests now carry an expires_at TTL (set at creation;
 * default 72h via CHAT_PAYMENT_REQUEST_TTL_HOURS, backfilled by migration
 * 830). Pay/confirm paths enforce the expiry inline AND close through
 * closePaymentRequestAsPaid, so a past-expiry request cannot settle even
 * before the expiry sweeper runs.
 */

const pool = require('../db');

const DEFAULT_TTL_HOURS = 72;

function paymentRequestTtlHours() {
  const value = Number.parseInt(process.env.CHAT_PAYMENT_REQUEST_TTL_HOURS, 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TTL_HOURS;
}

function paymentRequestExpiresAt(from = new Date()) {
  return new Date(new Date(from).getTime() + paymentRequestTtlHours() * 3600 * 1000);
}

function isPaymentRequestExpired(row, now = new Date()) {
  if (!row || !row.expires_at) return false;
  return new Date(row.expires_at).getTime() <= now.getTime();
}

// Close an open, unexpired request as paid. Returns the updated row, or null
// when the request was already settled, cancelled, or expired (race-safe:
// the expiry guard lives in the UPDATE, not in a preceding SELECT).
async function closePaymentRequestAsPaid(client, requestId, { popId = null, creditTxnId = null } = {}) {
  const db = client || pool;
  const { rows } = await db.query(
    `UPDATE chat_payment_requests
        SET status = 'paid',
            paid_pop_id = COALESCE($2, paid_pop_id),
            paid_at = NOW(),
            credit_txn_id = COALESCE($3, credit_txn_id),
            updated_at = NOW()
      WHERE id = $1
        AND status = 'open'
        AND (expires_at IS NULL OR expires_at > NOW())
      RETURNING *`,
    [requestId, popId, creditTxnId]
  );
  return rows[0] || null;
}

module.exports = {
  DEFAULT_TTL_HOURS,
  paymentRequestTtlHours,
  paymentRequestExpiresAt,
  isPaymentRequestExpired,
  closePaymentRequestAsPaid,
};
