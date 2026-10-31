'use strict';

const pool = require('../db');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const AppError = require('../utils/appError');
const { withTransaction } = require('../utils/transaction');
const { logAdminAction } = require('./auditService');
const { verifiedChargeRefundTotal } = require('./paymentRefundStateService');
const { sendNotification } = require('./notificationService');

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

async function reservePaymentRefund({ paymentId, requestedAmountCents, fullRefund, reason, reverseApplicationFee, actorUserId, requestId, allowOpenDisputeId, req = null }) {
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

    // P3-1-F19: 'released' is never written to payments.status (release lives in
    // payment_hold_status), so it is not a valid refundable state here.
    if (!['authorized', 'captured'].includes(payment.status)) {
      throw new AppError(`Payment cannot be refunded in '${payment.status}' status`, 409, 'payment_refund_invalid_state');
    }
    if (!payment.stripe_payment_intent_id) {
      throw new AppError('Payment has no payment-processor reference and cannot be refunded automatically', 409, 'missing_payment_reference');
    }
    const dispute = await client.query(
      `SELECT id FROM disputes
        WHERE job_id = $1 AND status IN ('open', 'under_review', 'in_progress')
        LIMIT 1`,
      [payment.job_id]
    );
    if (dispute.rows.length && String(dispute.rows[0].id) !== String(allowOpenDisputeId || '')) {
      throw new AppError('Cannot refund payment while a dispute is open', 409, 'dispute_open');
    }

    const originalCents = centsFromDollars(payment.amount);
    const alreadyRefundedCents = centsFromDollars(payment.refunded_amount) || 0;
    const remainingCents = originalCents ? originalCents - alreadyRefundedCents : 0;
    // ADM-009: fail closed on ambiguous refund amounts. A null/NaN amount
    // must never silently mean "refund everything". Callers must pass an
    // explicit amount in cents, or explicitly declare fullRefund: true.
    // Supplying both is ambiguous and rejected.
    let amountCents;
    if (requestedAmountCents == null) {
      if (fullRefund !== true) {
        throw new AppError(
          'Refund amount is required. Provide an explicit amount in cents, or set fullRefund: true for a full refund of the remaining balance.',
          400,
          'invalid_refund_amount'
        );
      }
      amountCents = remainingCents;
    } else {
      if (fullRefund === true) {
        throw new AppError(
          'Ambiguous refund request: provide either an explicit amount or fullRefund: true, not both.',
          400,
          'invalid_refund_amount'
        );
      }
      amountCents = Number(requestedAmountCents);
    }
    if (!originalCents || !Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > remainingCents) {
      throw new AppError('Refund amount must be a positive whole-cent amount no greater than the remaining payment', 400, 'invalid_refund_amount');
    }

    // P3-788: an authorized (uncaptured) intent cannot be refunded; it is
    // voided in full instead.
    const kind = payment.status === 'authorized' ? 'void' : 'refund';
    if (kind === 'void' && amountCents !== remainingCents) {
      throw new AppError('An authorized payment can only be released in full', 400, 'partial_void_unsupported');
    }
    const inserted = await client.query(
      `INSERT INTO payment_refund_attempts
        (payment_id, amount_cents, reason, reverse_application_fee, idempotency_key, actor_user_id, kind, impersonated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [paymentId, amountCents, reason ? String(reason).trim().slice(0, 1000) : null,
        !!reverseApplicationFee, idempotencyKey, actorUserId || null, kind,
        // Service-layer request-context convention: the impersonating
        // admin, or NULL for direct sessions and system re-runs.
        req?.impersonatedBy || null]
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
    // Decision 2: a full refund reverses the job's platform-funded promo.
    if (fullyRefunded && payment.stripe_payment_intent_id) {
      await require('./promoRedemptionService').reversePromo(client, {
        surface: 'job', providerReference: payment.stripe_payment_intent_id, reason: 'payment_refunded' });
    }
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

async function providerVoid(reservation) {
  if (!stripe) throw new AppError('Refunds are temporarily unavailable. Please contact support', 503, 'refund_unavailable');
  const opts = reservation.payment.stripe_account_id ? { stripeAccount: reservation.payment.stripe_account_id } : {};
  const piId = reservation.payment.stripe_payment_intent_id;
  const current = await stripe.paymentIntents.retrieve(piId, opts);
  if (current?.status === 'canceled' || current?.status === 'succeeded') return current;
  return stripe.paymentIntents.cancel(piId, { cancellation_reason: 'requested_by_customer' }, {
    ...opts,
    idempotencyKey: reservation.attempt.idempotency_key,
  });
}

async function settlePaymentVoid(reservation, intent) {
  if (intent?.id !== reservation.payment.stripe_payment_intent_id) {
    throw new AppError('Void intent identity mismatch', 503, 'payment_refund_reconciliation_required');
  }
  return withTransaction(pool, async (client) => {
    const { rows: [attempt] } = await client.query(
      'SELECT * FROM payment_refund_attempts WHERE id = $1 FOR UPDATE', [reservation.attempt.id]
    );
    if (!attempt) throw new AppError('Refund reservation was not found', 503, 'payment_refund_reconciliation_required');
    if (attempt.status === 'succeeded') return { payment: reservation.payment, attempt, replay: true };

    if (intent.status === 'succeeded') {
      // Captured in the meantime: finish it as a normal refund next run.
      const { rows: [converted] } = await client.query(
        `UPDATE payment_refund_attempts SET kind = 'refund', updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 RETURNING *`, [attempt.id]
      );
      return { payment: reservation.payment, attempt: converted, replay: false, converted: true };
    }
    if (intent.status !== 'canceled') {
      throw new AppError('Void needs reconciliation', 503, 'payment_refund_reconciliation_required');
    }
    const { rows: [updatedAttempt] } = await client.query(
      `UPDATE payment_refund_attempts
          SET status = 'succeeded', provider_payload = $2,
              settled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 RETURNING *`,
      [attempt.id, JSON.stringify({ id: intent.id, status: intent.status, object: 'payment_intent' })]
    );
    const { rows: [updatedPayment] } = await client.query(
      `UPDATE payments
          SET status = 'canceled', payment_hold_status = 'released',
              refund_reason = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status IN ('authorized', 'pending')
        RETURNING *`,
      [attempt.payment_id, attempt.reason]
    );
    if (updatedPayment?.stripe_payment_intent_id) {
      await require('./promoRedemptionService').reversePromo(client, {
        surface: 'job', providerReference: updatedPayment.stripe_payment_intent_id, reason: 'payment_voided' });
    }
    await logAdminAction({
      client, adminId: attempt.actor_user_id,
      action: 'void_payment',
      targetType: 'payment', targetId: attempt.payment_id,
      after: { amount_cents: Number(attempt.amount_cents), payment_intent: intent.id, reason: attempt.reason },
    });
    return { payment: updatedPayment || reservation.payment, attempt: updatedAttempt, replay: false };
  }, 'payment_void_settlement');
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

async function notifyRefundResult(result) {
  const payerId = result?.payment?.payer_id;
  const attempt = result?.attempt;
  if (!payerId || !attempt || result.replay || !['succeeded', 'failed', 'canceled'].includes(attempt.status)) return;
  const type = attempt.status === 'succeeded' ? 'refund' : 'refund_failed';
  await sendNotification({
    userId: payerId,
    type,
    data: {
      job_id: result.payment.job_id,
      refund_id: attempt.stripe_refund_id || null,
      amount_cents: Number(attempt.amount_cents),
      status: attempt.status,
    },
    action_url: `/jobs/${result.payment.job_id}`,
    idempotencyKey: `payment-refund:${attempt.id}:${attempt.status}`,
  });
}

async function processPaymentRefund(params) {
  const reservation = await reservePaymentRefund(params);
  if (reservation.attempt.status === 'succeeded') return { ...reservation, replay: true };
  // ADM-016: dual approval for above-threshold money movements. The
  // reservation above pins the exact amount under a row lock; when the
  // gate queues the movement, the executor re-runs this function with
  // skipDualApproval and replays the same reservation idempotently.
  // The gate runs BEFORE any provider call, so a queued movement never
  // touches Stripe until a second admin approves it.
  if (params.dualApproval && !params.skipDualApproval) {
    const { requestMoneyMovementApproval } = require('./dualApprovalService');
    const gate = await requestMoneyMovementApproval({
      movementType: params.dualApproval.movementType,
      referenceKey: params.dualApproval.referenceKey,
      amountCents: Number(reservation.attempt.amount_cents),
      currencyCode: reservation.payment.currency || 'USD',
      requestedBy: params.dualApproval.requestedBy,
      idempotencyKey: params.dualApproval.idempotencyKey,
      payload: params.dualApproval.payload,
    });
    if (gate.queued) return { ...reservation, dualApproval: gate };
  }
  if (reservation.attempt.kind === 'void') {
    let intent;
    try {
      intent = await providerVoid(reservation);
    } catch (error) {
      await recordProviderError(reservation.attempt.id, error);
      throw new AppError('Refund provider result requires reconciliation before retry', 503, 'payment_refund_reconciliation_required');
    }
    const result = await settlePaymentVoid(reservation, intent);
    await notifyRefundResult(result);
    return result;
  }
  let providerResult;
  try {
    providerResult = await providerRefund(reservation);
  } catch (error) {
    await recordProviderError(reservation.attempt.id, error);
    throw new AppError('Refund provider result requires reconciliation before retry', 503, 'payment_refund_reconciliation_required');
  }
  const result = await settlePaymentRefund(reservation, providerResult);
  await notifyRefundResult(result);
  return result;
}

async function reconcilePaymentRefundAttempt(reservation) {
  if (!reservation?.attempt?.id || !reservation?.payment?.stripe_payment_intent_id) {
    throw new AppError('Refund reservation is incomplete', 503, 'payment_refund_reconciliation_required');
  }
  if (reservation.attempt.status === 'succeeded') return { ...reservation, replay: true };
  if (reservation.attempt.kind === 'void') {
    let intent;
    try {
      intent = await providerVoid(reservation);
    } catch (error) {
      await recordProviderError(reservation.attempt.id, error);
      throw new AppError('Refund provider result requires reconciliation before retry', 503, 'payment_refund_reconciliation_required');
    }
    const result = await settlePaymentVoid(reservation, intent);
    await notifyRefundResult(result);
    return result;
  }
  let providerResult;
  try {
    providerResult = await providerRefund(reservation);
  } catch (error) {
    await recordProviderError(reservation.attempt.id, error);
    throw new AppError('Refund provider result requires reconciliation before retry', 503, 'payment_refund_reconciliation_required');
  }
  const result = await settlePaymentRefund(reservation, providerResult);
  await notifyRefundResult(result);
  return result;
}

module.exports = {
  processPaymentRefund,
  reconcilePaymentRefundAttempt,
  reservePaymentRefund,
  settlePaymentRefund,
  settlePaymentVoid,
  refundIdempotencyKey,
};
