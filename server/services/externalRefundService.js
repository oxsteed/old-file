'use strict';

const pool = require('../db');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const AppError = require('../utils/appError');
const { withTransaction } = require('../utils/transaction');

function normalizeRequestId(requestId) {
  const value = String(requestId || '').trim();
  if (!/^[A-Za-z0-9:._-]{8,255}$/.test(value)) {
    throw new AppError('A valid refund request ID is required', 400, 'external_refund_idempotency_invalid');
  }
  return value;
}

function providerStatus(refund) {
  if (refund?.status === 'succeeded') return 'succeeded';
  if (refund?.status === 'canceled' || refund?.status === 'cancelled') return 'canceled';
  if (refund?.status === 'failed') return 'failed';
  return 'pending';
}

function verifyProviderRefund(refund, attempt) {
  const paymentIntentId = typeof refund?.payment_intent === 'string'
    ? refund.payment_intent
    : refund?.payment_intent?.id;
  if (!refund?.id || (paymentIntentId && paymentIntentId !== attempt.provider_payment_intent_id)) {
    throw new AppError('Refund provider identity could not be verified', 503, 'external_refund_reconciliation_required');
  }
  if (Number(refund.amount) !== Number(attempt.amount_cents)) {
    throw new AppError('Refund provider amount could not be verified', 503, 'external_refund_reconciliation_required');
  }
  if (refund.currency && String(refund.currency).toUpperCase() !== String(attempt.currency).toUpperCase()) {
    throw new AppError('Refund provider currency could not be verified', 503, 'external_refund_reconciliation_required');
  }
}

async function reserveExternalRefund({
  rail, referenceId, paymentIntentId, stripeAccountId, amountCents, currency = 'USD',
  reason, actorUserId, requestId, metadata = {},
}) {
  const idempotencyKey = normalizeRequestId(requestId);
  if (!rail || !referenceId || !paymentIntentId || !Number.isSafeInteger(Number(amountCents)) || Number(amountCents) <= 0) {
    throw new AppError('Refund reservation is incomplete', 400, 'external_refund_invalid');
  }
  return withTransaction(pool, async (client) => {
    const existing = await client.query(
      'SELECT * FROM external_refund_attempts WHERE idempotency_key = $1 FOR UPDATE',
      [idempotencyKey]
    );
    if (existing.rows.length) {
      const attempt = existing.rows[0];
      if (attempt.rail !== rail || String(attempt.reference_id) !== String(referenceId)
        || String(attempt.provider_payment_intent_id) !== String(paymentIntentId)
        || Number(attempt.amount_cents) !== Number(amountCents)) {
        throw new AppError('Refund request ID was already used for a different refund', 409, 'external_refund_idempotency_conflict');
      }
      return { attempt, replay: true };
    }
    const inserted = await client.query(
      `INSERT INTO external_refund_attempts
        (rail, reference_id, provider_payment_intent_id, provider_account_id,
         amount_cents, currency, reason, idempotency_key, actor_user_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [String(rail).slice(0, 64), String(referenceId).slice(0, 255), String(paymentIntentId).slice(0, 255),
        stripeAccountId ? String(stripeAccountId).slice(0, 255) : null, Number(amountCents), String(currency).toUpperCase().slice(0, 3),
        reason ? String(reason).trim().slice(0, 1000) : null, idempotencyKey, actorUserId || null, JSON.stringify(metadata || {})]
    );
    return { attempt: inserted.rows[0], replay: false };
  }, 'external_refund_reservation');
}

async function providerRefund(attempt) {
  if (!stripe) throw new AppError('Refunds are temporarily unavailable. Please contact support', 503, 'refund_unavailable');
  const options = {
    idempotencyKey: attempt.idempotency_key,
    ...(attempt.provider_account_id ? { stripeAccount: attempt.provider_account_id } : {}),
  };
  if (attempt.provider_refund_id) return stripe.refunds.retrieve(attempt.provider_refund_id, options);
  return stripe.refunds.create({
    payment_intent: attempt.provider_payment_intent_id,
    amount: Number(attempt.amount_cents),
  }, options);
}

async function settleExternalRefund(attempt, providerResult) {
  verifyProviderRefund(providerResult, attempt);
  const status = providerStatus(providerResult);
  return withTransaction(pool, async (client) => {
    const locked = await client.query('SELECT * FROM external_refund_attempts WHERE id = $1 FOR UPDATE', [attempt.id]);
    if (!locked.rows.length) throw new AppError('Refund reservation was not found', 503, 'external_refund_reconciliation_required');
    if (locked.rows[0].status === 'succeeded') return { attempt: locked.rows[0], replay: true };
    const updated = await client.query(
      `UPDATE external_refund_attempts
          SET provider_refund_id = COALESCE(provider_refund_id, $2),
              status = $3, provider_payload = $4,
              settled_at = CASE WHEN $3 = 'succeeded' THEN CURRENT_TIMESTAMP ELSE settled_at END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [attempt.id, providerResult.id, status, JSON.stringify(providerResult)]
    );
    return { attempt: updated.rows[0], replay: false };
  }, 'external_refund_settlement');
}

async function recordProviderError(attemptId, error) {
  await pool.query(
    `UPDATE external_refund_attempts
        SET last_error = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'pending'`,
    [attemptId, String(error.message || 'Provider result requires reconciliation').slice(0, 1000)]
  );
}

async function processExternalRefund(params) {
  const reservation = await reserveExternalRefund(params);
  if (reservation.attempt.status === 'succeeded') return reservation;
  let providerResult;
  try {
    providerResult = await providerRefund(reservation.attempt);
  } catch (error) {
    await recordProviderError(reservation.attempt.id, error);
    throw new AppError('Refund provider result requires reconciliation before retry', 503, 'external_refund_reconciliation_required');
  }
  return settleExternalRefund(reservation.attempt, providerResult);
}

async function reconcileExternalRefundAttempt(attempt) {
  let providerResult;
  try {
    providerResult = await providerRefund(attempt);
  } catch (error) {
    await recordProviderError(attempt.id, error);
    throw new AppError('Refund provider result requires reconciliation before retry', 503, 'external_refund_reconciliation_required');
  }
  return settleExternalRefund(attempt, providerResult);
}

module.exports = {
  processExternalRefund,
  reconcileExternalRefundAttempt,
  reserveExternalRefund,
  settleExternalRefund,
};
