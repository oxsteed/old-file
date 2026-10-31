'use strict';

const pool = require('../db');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const AppError = require('../utils/appError');
const { withTransaction } = require('../utils/transaction');
const { notifyRefundIssued } = require('./refundNotification');
const logger = require('../utils/logger');

function cents(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function providerPaymentIntentId(value) {
  return typeof value === 'string' ? value : value?.id || null;
}

function stableIdempotencyKey(orderId, amountCents, supplied) {
  const candidate = String(supplied || '').trim();
  if (!candidate) {
    throw new AppError('Idempotency-Key is required for marketplace refunds', 400, 'refund_idempotency_required');
  }
  if (!/^[A-Za-z0-9:._-]{8,255}$/.test(candidate)) {
    throw new AppError('A valid refund request ID is required', 400, 'refund_idempotency_invalid');
  }
  return `marketplace:${orderId}:${candidate}`;
}

function providerStatus(refund) {
  if (refund?.status === 'succeeded') return 'succeeded';
  if (refund?.status === 'canceled' || refund?.status === 'cancelled') return 'canceled';
  if (refund?.status === 'failed') return 'failed';
  return 'pending';
}

async function reserveRefund({ orderId, requestedAmountCents, fullRefund, reason, actorUserId, requestId }) {
  return withTransaction(pool, async (client) => {
    const orderResult = await client.query(
      `SELECT id, customer_id, status, refund_reason
         FROM marketplace_orders
        WHERE id = $1
        FOR UPDATE`,
      [orderId]
    );
    if (!orderResult.rows.length) throw new AppError('Order not found', 404, 'order_not_found');
    const order = orderResult.rows[0];
    if (['cancelled', 'refunded'].includes(order.status)) {
      throw new AppError('Order is not refundable in its current state', 409, 'order_not_refundable');
    }

    const transactionResult = await client.query(
      `SELECT *
         FROM marketplace_transactions
        WHERE order_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE`,
      [orderId]
    );
    if (!transactionResult.rows.length) {
      throw new AppError('No payment transaction found for refund', 400, 'payment_not_found');
    }
    const transaction = transactionResult.rows[0];
    if (transaction.status !== 'succeeded' || !transaction.payment_intent_id) {
      throw new AppError('Payment is not in a refundable state', 409, 'payment_not_refundable');
    }

    const alreadyRefunded = Number(transaction.refunded_amount_cents || 0);
    const remaining = Number(transaction.amount_cents) - alreadyRefunded;
    // ADM-009: fail closed on ambiguous refund amounts. A cleared amount
    // input serializes as NaN -> null over JSON; null must never silently
    // mean "refund everything". An explicit amount in cents is required,
    // unless the caller explicitly declares fullRefund: true. Supplying
    // both is ambiguous and rejected.
    let amountCents;
    if (requestedAmountCents == null) {
      if (fullRefund !== true) {
        throw new AppError(
          'Refund amount is required. Provide an explicit amount in cents, or set fullRefund: true for a full refund of the remaining balance.',
          400,
          'invalid_refund_amount'
        );
      }
      amountCents = remaining;
    } else {
      if (fullRefund === true) {
        throw new AppError(
          'Ambiguous refund request: provide either an explicit amount or fullRefund: true, not both.',
          400,
          'invalid_refund_amount'
        );
      }
      amountCents = cents(requestedAmountCents);
    }
    if (!amountCents || !Number.isSafeInteger(Number(transaction.amount_cents)) || amountCents > remaining) {
      throw new AppError('Refund amount must be a positive whole-cent amount no greater than the remaining payment', 400, 'invalid_refund_amount');
    }
    const idempotencyKey = stableIdempotencyKey(orderId, amountCents, requestId);
    const existingResult = await client.query(
      `SELECT *
         FROM marketplace_transaction_refunds
        WHERE idempotency_key = $1
        FOR UPDATE`,
      [idempotencyKey]
    );
    if (existingResult.rows.length) {
      const existing = existingResult.rows[0];
      if (Number(existing.amount_cents) !== amountCents || Number(existing.transaction_id) !== Number(transaction.id)) {
        throw new AppError('Refund request ID was already used for different payment details', 409, 'refund_idempotency_conflict');
      }
      return { order, transaction, refund: existing, replay: true };
    }

    const inserted = await client.query(
      `INSERT INTO marketplace_transaction_refunds
        (order_id, transaction_id, payment_intent_id, amount_cents, reason, idempotency_key, actor_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [orderId, transaction.id, transaction.payment_intent_id, amountCents, String(reason).trim().slice(0, 1000), idempotencyKey, actorUserId || null]
    );
    return { order, transaction, refund: inserted.rows[0], replay: false };
  }, 'marketplace_refund_reservation');
}

function verifyProviderRefund(refund, reservation) {
  const paymentIntent = providerPaymentIntentId(refund?.payment_intent);
  if (!refund?.id || (paymentIntent && paymentIntent !== reservation.transaction.payment_intent_id)) {
    throw new AppError('Refund provider identity could not be verified', 503, 'refund_reconciliation_required');
  }
  if (Number(refund.amount) !== Number(reservation.refund.amount_cents)) {
    throw new AppError('Refund provider amount could not be verified', 503, 'refund_reconciliation_required');
  }
  if (refund.currency && String(refund.currency).toLowerCase() !== String(reservation.transaction.currency || 'usd').toLowerCase()) {
    throw new AppError('Refund provider currency could not be verified', 503, 'refund_reconciliation_required');
  }
}

async function settleRefund(reservation, providerRefund) {
  verifyProviderRefund(providerRefund, reservation);
  const status = providerStatus(providerRefund);
  return withTransaction(pool, async (client) => {
    const refundResult = await client.query(
      'SELECT * FROM marketplace_transaction_refunds WHERE id = $1 FOR UPDATE',
      [reservation.refund.id]
    );
    const refund = refundResult.rows[0];
    if (!refund) throw new AppError('Refund reservation was not found', 503, 'refund_reconciliation_required');
    if (refund.status === 'succeeded') return { refund, transaction: reservation.transaction, order: reservation.order, replay: true };

    const transactionResult = await client.query(
      'SELECT * FROM marketplace_transactions WHERE id = $1 FOR UPDATE',
      [refund.transaction_id]
    );
    const transaction = transactionResult.rows[0];
    if (!transaction) throw new AppError('Payment transaction was not found', 503, 'refund_reconciliation_required');

    if (status !== 'succeeded') {
      const updated = await client.query(
        `UPDATE marketplace_transaction_refunds
            SET provider_refund_id = COALESCE(provider_refund_id, $2), status = $3,
                provider_payload = $4, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *`,
        [refund.id, providerRefund.id, status, JSON.stringify(providerRefund)]
      );
      return { refund: updated.rows[0], transaction, order: reservation.order, replay: false };
    }

    const nextRefunded = Number(transaction.refunded_amount_cents || 0) + Number(refund.amount_cents);
    if (nextRefunded > Number(transaction.amount_cents)) {
      throw new AppError('Refund would exceed the payment total', 409, 'refund_amount_conflict');
    }
    const fullRefund = nextRefunded === Number(transaction.amount_cents);
    const updatedRefund = await client.query(
      `UPDATE marketplace_transaction_refunds
          SET provider_refund_id = $2, status = 'succeeded', provider_payload = $3,
              settled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [refund.id, providerRefund.id, JSON.stringify(providerRefund)]
    );
    const updatedTransaction = await client.query(
      `UPDATE marketplace_transactions
          SET refunded_amount_cents = $2,
              status = CASE WHEN $2 = amount_cents THEN 'refunded' ELSE status END,
              last_refund_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [transaction.id, nextRefunded]
    );
    const updatedOrder = await client.query(
      `UPDATE marketplace_orders
          SET status = CASE WHEN $2 THEN 'refunded' ELSE status END,
              refund_reason = $3,
              refunded_at = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE refunded_at END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [reservation.order.id, fullRefund, refund.reason]
    );
    if (fullRefund) {
      // Decision Q3 (2026-10-31): a full refund landing after payout
      // calculation but before transfer voids the claimed commission and
      // adjusts the payout total, in this same transaction. Partial
      // refunds never reach this branch; their commissions are handled by
      // the pro-rate track, not voided in full.
      const { voidClaimedCommissionsForRefund } = require('./affiliatePayoutVoidOnRefund');
      await voidClaimedCommissionsForRefund(client, reservation.order.id);
    }
    await client.query(
      `INSERT INTO order_action_log (order_id, action_type, action_details, performed_by)
       VALUES ($1, $2, $3, $4)`,
      [reservation.order.id, fullRefund ? 'refunded' : 'partially_refunded', JSON.stringify({
        refundId: providerRefund.id,
        refundAmountCents: Number(refund.amount_cents),
        cumulativeRefundedAmountCents: nextRefunded,
        reason: refund.reason,
      }), refund.actor_user_id || null]
    );
    return { refund: updatedRefund.rows[0], transaction: updatedTransaction.rows[0], order: updatedOrder.rows[0], replay: false };
  }, 'marketplace_refund_settlement');
}

async function notifyMarketplaceRefundSucceeded(result) {
  const refund = result?.refund;
  const order = result?.order;
  if (!refund || refund.status !== 'succeeded' || result.replay) return;
  // Fire-and-forget: the refund is settled; a notification outage must not
  // block the response or roll anything back.
  notifyRefundIssued({
    userId: order?.customer_id || null,
    idempotencyKey: `marketplace-refund:${refund.id}:succeeded`,
    amountCents: refund.amount_cents,
    currency: result?.transaction?.currency || 'USD',
    surface: 'marketplace_order',
    referenceId: order?.id,
    refundId: refund.provider_refund_id,
    actionUrl: order?.id != null ? `/orders/${order.id}` : null,
  }).catch((err) => logger.warn('[marketplaceRefund] refund notification failed', {
    orderId: order?.id,
    error: err.message,
  }));
}

async function processMarketplaceRefund({ orderId, requestedAmountCents, fullRefund, reason, actorUserId, requestId, dualApproval, skipDualApproval }) {
  if (!reason || !String(reason).trim()) throw new AppError('Refund reason required', 400, 'refund_reason_required');
  if (!stripe) throw new AppError('Refunds are temporarily unavailable. Please contact support.', 503, 'refund_unavailable');
  const reservation = await reserveRefund({ orderId, requestedAmountCents, fullRefund, reason, actorUserId, requestId });
  if (reservation.refund.status === 'succeeded') {
    return { ...reservation, replay: true };
  }
  // ADM-016: dual approval for above-threshold money movements. The gate
  // runs after the reservation (which pins the exact amount) but before any
  // provider call, so a queued movement never touches Stripe until a second
  // admin approves it. The executor re-runs this function with
  // skipDualApproval and replays the same reservation idempotently.
  if (dualApproval && !skipDualApproval) {
    const { requestMoneyMovementApproval } = require('./dualApprovalService');
    const gate = await requestMoneyMovementApproval({
      movementType: dualApproval.movementType,
      referenceKey: dualApproval.referenceKey,
      amountCents: Number(reservation.refund.amount_cents),
      currencyCode: reservation.transaction.currency || 'USD',
      requestedBy: dualApproval.requestedBy,
      idempotencyKey: dualApproval.idempotencyKey,
      payload: dualApproval.payload,
    });
    if (gate.queued) return { ...reservation, dualApproval: gate };
  }

  let providerRefund;
  try {
    providerRefund = reservation.refund.provider_refund_id
      ? await stripe.refunds.retrieve(reservation.refund.provider_refund_id)
      : await stripe.refunds.create({
        payment_intent: reservation.transaction.payment_intent_id,
        amount: Number(reservation.refund.amount_cents),
        metadata: {
          orderId: String(orderId),
          reason: String(reservation.refund.reason).slice(0, 500),
        },
      }, { idempotencyKey: reservation.refund.idempotency_key });
  } catch (error) {
    throw new AppError('Refund provider result requires reconciliation before retry', 503, 'refund_reconciliation_required');
  }
  const result = await settleRefund(reservation, providerRefund);
  await notifyMarketplaceRefundSucceeded(result);
  return result;
}

async function reconcileMarketplaceRefundReservation(reservation) {
  if (!reservation?.refund?.id || !reservation.transaction?.payment_intent_id) {
    throw new AppError('Refund reservation is incomplete', 503, 'refund_reconciliation_required');
  }
  if (reservation.refund.status === 'succeeded') return { ...reservation, replay: true };
  if (!stripe) throw new AppError('Refunds are temporarily unavailable. Please contact support.', 503, 'refund_unavailable');
  let providerRefund;
  try {
    providerRefund = reservation.refund.provider_refund_id
      ? await stripe.refunds.retrieve(reservation.refund.provider_refund_id)
      : await stripe.refunds.create({
        payment_intent: reservation.transaction.payment_intent_id,
        amount: Number(reservation.refund.amount_cents),
        metadata: { orderId: String(reservation.order.id), reason: String(reservation.refund.reason).slice(0, 500) },
      }, { idempotencyKey: reservation.refund.idempotency_key });
  } catch (error) {
    throw new AppError('Refund provider result requires reconciliation before retry', 503, 'refund_reconciliation_required');
  }
  const result = await settleRefund(reservation, providerRefund);
  await notifyMarketplaceRefundSucceeded(result);
  return result;
}

module.exports = {
  processMarketplaceRefund,
  reconcileMarketplaceRefundReservation,
  reserveRefund,
  settleRefund,
  stableIdempotencyKey,
};
