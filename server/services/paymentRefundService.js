'use strict';

const pool = require('../db');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const AppError = require('../utils/appError');
const { withTransaction } = require('../utils/transaction');
const { logAdminAction } = require('./auditService');
const { verifiedChargeRefundTotal } = require('./paymentRefundStateService');

function centsFromDollars(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && Number.isSafeInteger(Math.round(number * 100))
    ? Math.round(number * 100)
    : null;
}

function dollarsFromCents(value) {
  return (Number(value) / 100).toFixed(2);
}

function providerPaymentIntentId(value) {
  return typeof value === 'string' ? value : value?.id || null;
}

function refundIdempotencyKey(paymentId, requestId) {
  const candidate = String(requestId || '').trim();
  if (!candidate) {
    throw new AppError('Idempotency-Key is required for payment refunds', 400, 'payment_refund_idempotency_required');
  }
  if (!/^[A-Za-z0-9:._-]{8,255}$/.test(candidate)) {
    throw new AppError('A valid refund request ID is required', 400, 'payment_refund_idempotency_invalid');
  }
  return `payment:${paymentId}:${candidate}`;
}

function providerStatus(refund) {
  if (refund?.status === 'succeeded') return 'succeeded';
  if (refund?.status === 'canceled' || refund?.status === 'cancelled') return 'canceled';
  if (refund?.status === 'failed') return 'failed';
  return 'pending';
}

function verifyProviderRefund(refund, reservation) {
  const paymentIntentId = providerPaymentIntentId(refund?.payment_intent);
  if (!refund?.id || (paymentIntentId && paymentIntentId !== reservation.payment.stripe_payment_intent_id)) {
    throw new AppError('Refund provider identity could not be verified', 503, 'payment_refund_reconciliation_required');
  }
  if (Number(refund.amount) !== Number(reservation.attempt.amount_cents)) {
    throw new AppError('Refund provider amount could not be verified', 503, 'payment_refund_reconciliation_required');
  }
  if (refund.currency && String(refund.currency).toLowerCase() !== String(reservation.payment.currency || 'usd').toLowerCase()) {
    throw new AppError('Refund provider currency could not be verified', 503, 'payment_refund_reconciliation_required');
  }
}

async function reservePaymentRefund({ paymentId, requestedAmountCents, reason, reverseApplicationFee, actorUserId, requestId, allowOpenDisputeId }) {
  const idempotencyKey = refundIdempotencyKey(paymentId, requestId);
  return withTransaction(pool, async (client) => {
    const existingResult = await client.query(
      'SELECT * FROM payment_refund_attempts WHERE idempotency_key = $1 FOR UPDATE',
      [idempotencyKey]
    );
    const paymentResult = await client.query(
      'SELECT * FROM payments WHERE id = $1 FOR UPDATE',
      [paymentId]
    );
    if (!paymentResult.rows.length) throw new AppError('Payment not found', 404, 'payment_not_found');
    const payment = paymentResult.rows[0];

    if (existingResult.rows.length) {
      const attempt = existingResult.rows[0];
      if (Number(attempt.payment_id) !== Number(paymentId)) {
        throw new AppError('Refund request ID was already used for a different payment', 409, 'payment_refund_idempotency_conflict');
      }
      return { payment, attempt, replay: true };
    }

    if (!['authorized', 'captured', 'released'].includes(payment.status)) {
      throw new AppError(`Payment cannot be refunded in '${payment.status}' status`, 409, 'payment_refund_invalid_state');
    }
    if (!payment.stripe_payment_intent_id) {
      throw new AppError('Payment has no payment-processor reference and cannot be refunded automatically', 409, 'missing_payment_reference');
    }
    const dispute = await client.query(
      `SELECT id FROM disputes
        WHERE job_id = $1 AND status IN ('open', 'in_progress')
        LIMIT 1`,
      [payment.job_id]
    );
    if (dispute.rows.length && String(dispute.rows[0].id) !== String(allowOpenDisputeId || '')) {
      throw new AppError('Cannot refund payment while a dispute is open', 409, 'dispute_open');
    }

    const originalCents = centsFromDollars(payment.amount);
    const alreadyRefundedCents = centsFromDollars(payment.refunded_amount) || 0;
    const remainingCents = originalCents ? originalCents - alreadyRefundedCents : 0;
    const amountCents = requestedAmountCents == null ? remainingCents : Number(requestedAmountCents);
    if (!originalCents || !Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > remainingCents) {
      throw new AppError('Refund amount must be a positive whole-cent amount no greater than the remaining payment', 400, 'invalid_refund_amount');
    }

    const inserted = await client.query(
      `INSERT INTO payment_refund_attempts
        (payment_id, amount_cents, reason, reverse_application_fee, idempotency_key, actor_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [paymentId, amountCents, reason ? String(reason).trim().slice(0, 1000) : null,
        !!reverseApplicationFee, idempotencyKey, actorUserId || null]
    );
    return { payment, attempt: inserted.rows[0], replay: false };
  }, 'payment_refund_reservation');
}

async function settlePaymentRefund(reservation, providerRefund) {
  verifyProviderRefund(providerRefund, reservation);
  const status = providerStatus(providerRefund);
  let providerRefundedCents = null;
  if (status === 'succeeded') {
    const chargeId = providerPaymentIntentId(providerRefund.charge) || reservation.payment.stripe_charge_id;
    if (!chargeId || !stripe) {
      throw new AppError('Refund charge needs reconciliation', 503, 'payment_refund_reconciliation_required');
    }
    // Retrieve current cumulative evidence outside the DB transaction. Adding a
    // refund to refunded_amount double-counts when its webhook arrives first.
    const charge = await stripe.charges.retrieve(chargeId, reservation.payment.stripe_account_id
      ? { stripeAccount: reservation.payment.stripe_account_id } : {});
    if (charge?.id !== chargeId) {
      throw new AppError('Refund charge identity mismatch', 503, 'payment_refund_reconciliation_required');
    }
    providerRefundedCents = verifiedChargeRefundTotal(charge, reservation.payment);
    if (providerRefundedCents < Number(reservation.attempt.amount_cents)) {
      throw new AppError('Refund charge total needs reconciliation', 503, 'payment_refund_reconciliation_required');
    }
  }
  return withTransaction(pool, async (client) => {
    const attemptResult = await client.query(
      'SELECT * FROM payment_refund_attempts WHERE id = $1 FOR UPDATE',
      [reservation.attempt.id]
    );
    const attempt = attemptResult.rows[0];
    if (!attempt) throw new AppError('Refund reservation was not found', 503, 'payment_refund_reconciliation_required');
    if (attempt.status === 'succeeded') return { payment: reservation.payment, attempt, replay: true };

    const paymentResult = await client.query(
      'SELECT * FROM payments WHERE id = $1 FOR UPDATE',
      [attempt.payment_id]
    );
    const payment = paymentResult.rows[0];
    if (!payment) throw new AppError('Payment was not found during refund settlement', 503, 'payment_refund_reconciliation_required');

    if (status !== 'succeeded') {
      const updated = await client.query(
        `UPDATE payment_refund_attempts
            SET stripe_refund_id = COALESCE(stripe_refund_id, $2), status = $3,
                provider_payload = $4, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *`,
        [attempt.id, providerRefund.id, status, JSON.stringify(providerRefund)]
      );
      return { payment, attempt: updated.rows[0], replay: false };
    }

    const originalCents = centsFromDollars(payment.amount);
    const currentRefundedCents = centsFromDollars(payment.refunded_amount) || 0;
    const nextRefundedCents = Math.max(currentRefundedCents, providerRefundedCents);
    if (!originalCents || nextRefundedCents > originalCents) {
      throw new AppError('Refund would exceed the payment total', 409, 'payment_refund_amount_conflict');
    }
    const fullyRefunded = nextRefundedCents === originalCents;
    const updatedAttempt = await client.query(
      `UPDATE payment_refund_attempts
          SET stripe_refund_id = $2, status = 'succeeded', provider_payload = $3,
              settled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [attempt.id, providerRefund.id, JSON.stringify(providerRefund)]
    );
    const updatedPayment = await client.query(
      `UPDATE payments
          SET refunded_amount = $2,
              refund_amount = $3,
              refund_reason = $4,
              stripe_refund_id = $5,
              status = CASE WHEN $6 THEN 'refunded' ELSE status END,
              payment_hold_status = CASE WHEN $6 THEN 'refunded' ELSE payment_hold_status END,
              refunded_at = CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE refunded_at END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [payment.id, dollarsFromCents(nextRefundedCents), dollarsFromCents(nextRefundedCents), attempt.reason,
        providerRefund.id, fullyRefunded]
    );

    await logAdminAction({
      client, adminId: attempt.actor_user_id,
      action: fullyRefunded ? 'refund_payment' : 'partial_refund_payment',
      targetType: 'payment', targetId: payment.id,
      after: { amount_cents: Number(attempt.amount_cents), cumulative_refunded_amount_cents: nextRefundedCents,
        refund_id: providerRefund.id, reason: attempt.reason, reverse_application_fee: attempt.reverse_application_fee },
    });
    await client.query(
      `INSERT INTO platform_ledger (user_id, source_type, amount_cents, description, metadata)
       VALUES (NULL, 'payment_refunded', $1, $2, $3)`,
      [-Number(attempt.amount_cents), `Payment #${payment.id} refund ${providerRefund.id}`,
        JSON.stringify({ payment_id: payment.id, job_id: payment.job_id, refund_id: providerRefund.id,
          refund_amount_cents: Number(attempt.amount_cents), cumulative_refunded_amount_cents: nextRefundedCents })]
    );
    return { payment: updatedPayment.rows[0], attempt: updatedAttempt.rows[0], replay: false };
  }, 'payment_refund_settlement');
}

async function providerRefund(reservation) {
  if (!stripe) throw new AppError('Refunds are temporarily unavailable. Please contact support', 503, 'refund_unavailable');
  const requestOptions = {
    idempotencyKey: reservation.attempt.idempotency_key,
    ...(reservation.payment.stripe_account_id ? { stripeAccount: reservation.payment.stripe_account_id } : {}),
  };
  if (reservation.attempt.stripe_refund_id) {
    return stripe.refunds.retrieve(reservation.attempt.stripe_refund_id, requestOptions);
  }
  return stripe.refunds.create({
    payment_intent: reservation.payment.stripe_payment_intent_id,
    amount: Number(reservation.attempt.amount_cents),
    ...(reservation.attempt.reverse_application_fee ? { refund_application_fee: true } : {}),
  }, requestOptions);
}

async function recordProviderError(attemptId, error) {
  await pool.query(
    `UPDATE payment_refund_attempts
        SET last_error = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'pending'`,
    [attemptId, String(error.message || 'Provider result requires reconciliation').slice(0, 1000)]
  );
}

async function processPaymentRefund(params) {
  const reservation = await reservePaymentRefund(params);
  if (reservation.attempt.status === 'succeeded') return { ...reservation, replay: true };
  let providerResult;
  try {
    providerResult = await providerRefund(reservation);
  } catch (error) {
    await recordProviderError(reservation.attempt.id, error);
    throw new AppError('Refund provider result requires reconciliation before retry', 503, 'payment_refund_reconciliation_required');
  }
  return settlePaymentRefund(reservation, providerResult);
}

async function reconcilePaymentRefundAttempt(reservation) {
  if (!reservation?.attempt?.id || !reservation?.payment?.stripe_payment_intent_id) {
    throw new AppError('Refund reservation is incomplete', 503, 'payment_refund_reconciliation_required');
  }
  if (reservation.attempt.status === 'succeeded') return { ...reservation, replay: true };
  let providerResult;
  try {
    providerResult = await providerRefund(reservation);
  } catch (error) {
    await recordProviderError(reservation.attempt.id, error);
    throw new AppError('Refund provider result requires reconciliation before retry', 503, 'payment_refund_reconciliation_required');
  }
  return settlePaymentRefund(reservation, providerResult);
}

module.exports = {
  processPaymentRefund,
  reconcilePaymentRefundAttempt,
  reservePaymentRefund,
  settlePaymentRefund,
  refundIdempotencyKey,
};
