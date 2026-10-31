'use strict';

// Admin food orders 360: list, detail, refund with purpose-bound audit.
// Separate from marketplace orders (adminOrders.js).

const pool = require('../db');
const logger = require('../utils/logger');
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;
const { refundWalletDebitForReference } = require('../services/foodWalletService');
const { refundCreditForReferenceInTransaction } = require('../services/oxsteedCreditService');
const { notifyRefundIssued } = require('../services/refundNotification');

// Canonical wallet/credit payment modes for food orders, mirroring
// PAYMENT_MODE_ALIASES in agentFoodRefundActions.js. Orders store the legacy
// form (restaurant_credit -> 'wallet_credit', oxsteed_credit -> 'oxsteed_credit').
const ADMIN_REFUND_MODE_ALIASES = {
  wallet_credit: 'restaurant_credit',
  restaurant_credit: 'restaurant_credit',
  oxsteed_credit: 'oxsteed_credit',
  oxsteedCredit: 'oxsteed_credit',
  credit: 'oxsteed_credit',
};

function normalizeAdminRefundMode(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return ADMIN_REFUND_MODE_ALIASES[trimmed] || null;
}

function readAdminRefundedCents(metadata) {
  if (!metadata || typeof metadata !== 'object') return 0;
  const n = Number(metadata.admin_refunded_cents);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

async function auditAdminRead(adminId, orderId, purpose) {
  await pool.query(
    `INSERT INTO admin_audit_log (admin_id, admin_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $1, 'food_order_read', 'food_order', $2, $3)`,
    [adminId, String(orderId), JSON.stringify({ purpose })]
  );
}

async function listFoodOrders(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const status = req.query.status || null;
    const restaurantId = req.query.restaurant_id || null;

    const conditions = [];
    const params = [];
    let idx = 1;
    if (status) {
      conditions.push(`fo.status = $${idx++}`);
      params.push(status);
    }
    if (restaurantId) {
      conditions.push(`fo.restaurant_id = $${idx++}`);
      params.push(restaurantId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT fo.id, fo.restaurant_id, fo.status, fo.total_cents, fo.currency_code,
              fo.queue_number, fo.fulfillment_type, fo.payment_status,
              fo.created_at, fr.display_name AS restaurant_name
         FROM food_orders fo
         JOIN food_restaurants fr ON fr.id = fo.restaurant_id
        ${where}
        ORDER BY fo.created_at DESC
        LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );
    const { rows: count } = await pool.query(
      `SELECT COUNT(*) AS total FROM food_orders fo ${where}`,
      params
    );
    res.json({ orders: rows, total: parseInt(count[0].total, 10), limit, offset });
  } catch (err) {
    logger.error('adminFoodOrders.list error', { message: err.message });
    res.status(500).json({ error: 'Failed to load food orders' });
  }
}

async function getFoodOrder(req, res) {
  try {
    const orderId = parseInt(req.params.id, 10);
    const purpose = req.query.purpose || 'investigation';

    const { rows } = await pool.query(
      `SELECT fo.*, fr.display_name AS restaurant_name
         FROM food_orders fo
         JOIN food_restaurants fr ON fr.id = fo.restaurant_id
        WHERE fo.id = $1`,
      [orderId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });

    const { rows: items } = await pool.query(
      `SELECT * FROM food_order_items WHERE order_id = $1 ORDER BY id`,
      [orderId]
    );

    // Purpose-bound audit for PII/payment access.
    await auditAdminRead(req.user.id, orderId, purpose);

    res.json({ order: rows[0], items });
  } catch (err) {
    logger.error('adminFoodOrders.get error', { message: err.message });
    res.status(500).json({ error: 'Failed to load order' });
  }
}

function refundError(status, payload) {
  const err = new (require('../utils/appError'))(payload.error, status, payload.code || 'food_refund_failed');
  err.publicPayload = payload;
  return err;
}

async function executeFoodOrderRefund(client, { req, orderId, requestedAmount, reason, skipDualApproval = false, expectedRefundedCents }) {
    // ADM-030/ADM-031: lock the order row for the whole refund so two
    // concurrent admins serialize and the second replays instead of
    // double-refunding. Eligibility is checked inside the lock.
    const { rows } = await client.query(
      'SELECT * FROM food_orders WHERE id = $1 FOR UPDATE',
      [orderId]
    );
    if (!rows[0]) {
      throw refundError(404, { error: 'Order not found' });
    }
    const order = rows[0];

    // Idempotent replay: an already-refunded order returns a clean non-error
    // and never touches money again.
    if (order.payment_status === 'refunded') {
      return { ok: true, order_id: orderId, already_refunded: true };
    }
    if (!['paid', 'partially_refunded'].includes(order.payment_status)) {
      throw refundError(400, { error: 'Order is not refundable' });
    }

    const totalCents = Math.max(0, Math.round(Number(order.total_cents || 0)));
    const alreadyRefundedCents = readAdminRefundedCents(order.metadata);
    const refundAmount = requestedAmount == null ? totalCents - alreadyRefundedCents : requestedAmount;
    if (refundAmount <= 0) {
      throw refundError(400, { error: 'Order has already been fully refunded' });
    }
    if (alreadyRefundedCents + refundAmount > totalCents) {
      throw refundError(400, { error: 'Refund amount exceeds the remaining order total' });
    }

    // ADM-030: the idempotency key is per (order, amount), NOT per admin, so
    // two admins refunding the same order concurrently dedupe instead of
    // double-refunding. The FOR UPDATE lock above makes the second request
    // see the updated payment_status and replay.
    const idempotencyKey = `admin-food-refund:${orderId}:${refundAmount}`;
    if (!skipDualApproval) {
      const gate = await require('../services/dualApprovalService').requestMoneyMovementApproval({
        movementType: 'food_refund', referenceKey: `food_order:${orderId}`,
        amountCents: refundAmount, currencyCode: order.currency_code || 'USD', requestedBy: req.user.id,
        idempotencyKey: `${idempotencyKey}:${alreadyRefundedCents}`,
        payload: { orderId, amountCents: refundAmount, expectedRefundedCents: alreadyRefundedCents, reason: reason.trim(), makerAdminId: req.user.id },
      });
      if (gate.queued) return { gate };
    } else if (expectedRefundedCents !== undefined && alreadyRefundedCents !== expectedRefundedCents) {
      throw refundError(409, { error: 'Order refund state changed since approval was requested', code: 'food_refund_state_changed' });
    }
    const trimmedReason = reason.trim();
    let refundResult = null;

    // Route by payment method.
    if (order.stripe_payment_intent_id) {
      // Card payment: Stripe refund.
      const connectedAccountId = order.metadata?.stripeCheckout?.connectedAccountId
        || order.metadata?.stripe_checkout?.connectedAccountId;
      try {
        const refund = await stripe.refunds.create(
          {
            payment_intent: order.stripe_payment_intent_id,
            amount: refundAmount,
          },
          {
            stripeAccount: connectedAccountId || undefined,
            idempotencyKey,
          }
        );
        refundResult = { provider: 'stripe', refund_id: refund.id, amount: refund.amount };
      } catch (refundErr) {
        logger.error('Admin Stripe refund failed', { orderId, error: refundErr.message });
        throw refundError(502, { error: 'Stripe refund failed', code: 'stripe_refund_failed' });
      }
    } else {
      const mode = normalizeAdminRefundMode(order.payment_mode);
      if (mode === 'restaurant_credit' && order.customer_id) {
        // Restaurant wallet credit: reverse the ledger debit. ADM-029: the
        // requested partial amount is honored (not the full original debit);
        // cumulative refunds are capped at the original debit.
        const walletRefund = await refundWalletDebitForReference(client, {
          restaurantId: order.restaurant_id,
          customerId: order.customer_id,
          currencyCode: order.currency_code || 'USD',
          orderReferenceId: String(order.id),
          description: `Admin refund for order #${order.queue_number || order.id}: ${trimmedReason}`,
          createdByUserId: req.user.id,
          correlationId: idempotencyKey,
          actorType: 'admin',
          amountCents: refundAmount,
          metadata: { orderId: order.id, reason: trimmedReason },
        });
        // ADM-002: fail closed. refundWalletDebitForReference reports (not
        // throws) when nothing moved; never mark the order refunded then.
        if (!walletRefund.refunded) {
          logger.error('Admin wallet refund reported failure', { orderId, reason: walletRefund.reason });
          throw refundError(409, {
            error: 'Wallet refund could not be completed; the order was not marked refunded',
            code: 'wallet_refund_failed',
            wallet_reason: walletRefund.reason || null,
          });
        }
        refundResult = {
          provider: 'wallet',
          refund_id: walletRefund.entry?.id != null ? String(walletRefund.entry.id) : null,
          amount: walletRefund.amountCents,
        };
      } else if (mode === 'oxsteed_credit') {
        // ADM-044: OxSteed Credit orders are refunded through the credit
        // journal, not the restaurant-wallet ledger. Cumulative refunds are
        // capped at the original purchase by the credit service; any throw
        // rolls the transaction back and the order is NOT marked refunded.
        try {
          const creditRefund = await refundCreditForReferenceInTransaction(client, {
            referenceType: 'food_order',
            referenceId: String(order.id),
            amountCents: refundAmount,
            // Shared with the kitchen/agent refund paths so the two dedupe.
            idempotencyKey: `admin-food-refund:${orderId}:${refundAmount}:oxsteed-credit`,
            actorUserId: req.user.id,
            actorType: 'admin',
            reason: trimmedReason,
            correlationId: idempotencyKey,
            requestIp: req.ip || null,
            metadata: { orderId: order.id, adminRefund: true },
          });
          refundResult = {
            provider: 'oxsteed_credit',
            refund_id: creditRefund?.transaction?.id != null ? String(creditRefund.transaction.id) : null,
            amount: refundAmount,
          };
        } catch (creditErr) {
          logger.error('Admin OxSteed credit refund failed', { orderId, error: creditErr.message });
          const status = Number.isSafeInteger(creditErr.statusCode) ? creditErr.statusCode : 502;
          throw refundError(status, {
            error: creditErr.message || 'OxSteed Credit refund failed',
            code: creditErr.code || 'credit_refund_failed',
          });
        }
      } else {
        throw refundError(400, {
          error: 'No refundable payment found (no Stripe intent, wallet debit, or OxSteed Credit purchase)',
          code: 'no_refundable_payment',
        });
      }
    }

    // Update order payment status from the cumulative refunded total.
    // ADM-003: 'partially_refunded' is now a legal payment_status (migration 832).
    const cumulativeRefundedCents = alreadyRefundedCents + refundAmount;
    const newStatus = cumulativeRefundedCents >= totalCents ? 'refunded' : 'partially_refunded';
    const nextMetadata = order.metadata && typeof order.metadata === 'object' ? { ...order.metadata } : {};
    nextMetadata.admin_refunded_cents = cumulativeRefundedCents;
    await client.query(
      `UPDATE food_orders SET payment_status = $1, metadata = $2::jsonb, updated_at = NOW() WHERE id = $3`,
      [newStatus, JSON.stringify(nextMetadata), orderId]
    );

    // P3-9-F02: a full admin refund must restore redeemed loyalty points and
    // claw back earned points, like the kitchen status-transition path does.
    // Partial refunds leave loyalty alone (the order is still live).
    if (newStatus === 'refunded' && order.customer_id) {
      try {
        const { _clawBackFoodLoyaltyOnRefund } = require('./foodController');
        await _clawBackFoodLoyaltyOnRefund(client, order);
      } catch (loyaltyErr) {
        logger.warn('Admin refund loyalty reconciliation failed', {
          orderId,
          error: loyaltyErr.message,
        });
      }
    }

    // Audit trail, in-transaction: the mutation and its audit row commit or
    // roll back together (fail-closed audit).
    await client.query(
      `INSERT INTO admin_audit_log (admin_id, admin_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $1, 'food_order_refund', 'food_order', $2, $3)`,
      [req.user.id, String(orderId), JSON.stringify({
        amount_cents: refundAmount,
        cumulative_refunded_cents: cumulativeRefundedCents,
        reason: trimmedReason,
        provider: refundResult.provider,
        refund_id: refundResult.refund_id || null,
        previous_status: order.payment_status,
        new_status: newStatus,
      })]
    );
    if (newStatus === 'refunded' && order.customer_id) {
      await require('../growth/emit').emitDomainEvent(client, 'food.order_refunded', require('../growth/emit').foodEventProps(order), { userId: order.customer_id });
    }

    logger.info('adminFoodOrders.refund completed', {
      orderId, adminId: req.user.id, amount_cents: refundAmount,
      provider: refundResult.provider, new_status: newStatus,
    });
    // P3-3-F07: the customer learns the admin-issued refund went through
    // (in-app + email). Best-effort: the refund is settled.
    const result = { ok: true, order_id: orderId, amount_cents: refundAmount, provider: refundResult.provider, new_status: newStatus };
    Object.defineProperty(result, 'afterCommit', { value: async () => {
    if (order.customer_id) {
      await notifyRefundIssued({
        userId: order.customer_id,
        idempotencyKey: `admin-food-refund:${orderId}:${refundAmount}:issued`,
        amountCents: refundAmount,
        currency: order.currency_code,
        surface: 'food_order',
        referenceId: orderId,
        refundId: refundResult.refund_id || null,
        actionUrl: order.tracking_token ? `/food/track/${order.tracking_token}` : null,
      }).catch((err) => logger.warn('adminFoodOrders.refund notification failed', {
        orderId,
        error: err.message,
      }));
    }
    } });
    return result;
}

async function issueRefundStepupChallenge(req, res, next) {
  try {
    // Auth audit item 6: issue for the real refund amount, not 1. The
    // body carries orderId and, for a partial refund, amountCents; for
    // a full refund the amount is the order total minus what admin
    // refunds already covered (the same figure the verify side binds).
    const orderId = Number(req.body?.orderId ?? req.body?.order_id);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      throw refundError(400, { error: 'Order id is required' });
    }
    const { rows } = await pool.query('SELECT total_cents, metadata FROM food_orders WHERE id = $1', [orderId]);
    if (!rows.length) throw refundError(404, { error: 'Order not found' });
    let amountCents;
    const supplied = Number(req.body?.amountCents ?? req.body?.amount_cents);
    if (Number.isSafeInteger(supplied) && supplied > 0) {
      amountCents = supplied;
    } else {
      amountCents = Number(rows[0].total_cents) - readAdminRefundedCents(rows[0].metadata);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        throw refundError(400, { error: 'Refund amount must be a positive whole number of cents' });
      }
    }
    const { challenge, delivery } = await require('../services/stepupChallengeService').issueStepupChallenge({
      actorUserId: req.user.id, actorEmail: req.user.email, actionType: 'food_refund', amountCents,
    });
    res.status(201).json({ challenge: { id: challenge.id, method: challenge.method, expiresAt: challenge.expiresAt }, delivery });
  } catch (err) { next(err); }
}

async function refundFoodOrder(req, res) {
  try {
    const orderId = /^[1-9][0-9]*$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
    const { amount_cents, reason } = req.body;

    if (!Number.isSafeInteger(orderId)) {
      throw refundError(400, { error: 'Invalid order id' });
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      throw refundError(400, { error: 'Refund reason is required' });
    }
    if (reason.trim().length > 1000) {
      throw refundError(400, { error: 'Refund reason is too long' });
    }

    // ADM-191: the server must validate the amount itself; the client is not
    // a trust boundary. Whole cents only.
    let requestedAmount = null;
    if (amount_cents !== undefined && amount_cents !== null) {
      const n = Number(amount_cents);
      if (!Number.isSafeInteger(n) || n <= 0) {
        throw refundError(400, { error: 'Refund amount must be a positive whole number of cents' });
      }
      requestedAmount = n;
    }

    // Auth audit item 6: bind to the refund amount being requested, or
    // for a full refund to the remaining total (the same figure the
    // issue endpoint binds). The executor re-validates under lock; this
    // pre-read only binds the challenge.
    let foodRefundExpectedAmount = requestedAmount;
    if (foodRefundExpectedAmount === null) {
      const { rows: orderRows } = await pool.query('SELECT total_cents, metadata FROM food_orders WHERE id = $1', [orderId]);
      if (orderRows.length) {
        const remaining = Number(orderRows[0].total_cents) - readAdminRefundedCents(orderRows[0].metadata);
        if (Number.isSafeInteger(remaining) && remaining > 0) foodRefundExpectedAmount = remaining;
      }
    }
    await require('../services/stepupChallengeService').verifyStepupChallenge({
      challengeId: req.body.stepupChallengeId, actorUserId: req.user.id, actionType: 'food_refund', code: req.body.stepupCode,
      ...(foodRefundExpectedAmount !== null ? { expectedAmountCents: foodRefundExpectedAmount } : {}),
    });
    const result = await require('../utils/transaction').withTransaction(pool, client =>
      executeFoodOrderRefund(client, { req, orderId, requestedAmount, reason }), 'admin_food_refund');
    if (result.gate) return require('../utils/dualApprovalHttp').sendMoneyMovementGateResult(res, result.gate);
    await result.afterCommit?.();
    return res.json(result);
  } catch (err) {
    logger.error('adminFoodOrders.refund error', { error: err.message });
    return res.status(err.statusCode || 500).json(err.publicPayload || { error: err.statusCode ? err.message : 'Failed to process refund', code: err.code });
  }
}

module.exports = { listFoodOrders, getFoodOrder, refundFoodOrder, executeFoodOrderRefund, issueRefundStepupChallenge };
