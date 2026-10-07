'use strict';

// Admin food orders 360: list, detail, refund with purpose-bound audit.
// Separate from marketplace orders (adminOrders.js).

const { pool } = require('../db');
const logger = require('../utils/logger');
const stripe = require('../utils/stripe');
const { refundWalletDebitForReference } = require('../services/foodWalletService');

async function auditAdminRead(adminId, orderId, purpose) {
  try {
    await pool.query(
      `INSERT INTO admin_audit_log (admin_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'food_order_read', 'food_order', $2, $3)`,
      [adminId, String(orderId), JSON.stringify({ purpose })]
    );
  } catch (err) {
    logger.warn('adminFoodOrders audit failed', { message: err.message });
  }
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

async function refundFoodOrder(req, res) {
  try {
    const orderId = parseInt(req.params.id, 10);
    const { amount_cents, reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Refund reason is required' });
    }

    const { rows } = await pool.query(
      `SELECT * FROM food_orders WHERE id = $1`,
      [orderId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    const order = rows[0];

    if (!['paid', 'partially_refunded'].includes(order.payment_status)) {
      return res.status(400).json({ error: 'Order is not refundable' });
    }

    const refundAmount = amount_cents || order.total_cents;
    if (refundAmount <= 0 || refundAmount > order.total_cents) {
      return res.status(400).json({ error: 'Invalid refund amount' });
    }

    const idempotencyKey = `admin-food-refund:${orderId}:${refundAmount}:${req.user.id}`;
    let refundResult = null;

    // Route by payment mode.
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
        return res.status(502).json({ error: 'Stripe refund failed', code: 'stripe_refund_failed' });
      }
    } else if (order.payment_mode === 'wallet_credit' && order.customer_id) {
      // Wallet credit: reverse the ledger debit.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        refundResult = await refundWalletDebitForReference(client, {
          restaurantId: order.restaurant_id,
          customerId: order.customer_id,
          currencyCode: order.currency_code || 'USD',
          orderReferenceId: String(order.id),
          description: `Admin refund for order #${order.queue_number || order.id}: ${reason}`,
          createdByUserId: req.user.id,
          correlationId: `admin-food-refund:${orderId}`,
          actorType: 'admin',
          metadata: { orderId: order.id, amount_cents: refundAmount, reason },
        });
        await client.query('COMMIT');
        refundResult = { provider: 'wallet', ...refundResult };
      } catch (walletErr) {
        await client.query('ROLLBACK');
        logger.error('Admin wallet refund failed', { orderId, error: walletErr.message });
        return res.status(502).json({ error: 'Wallet refund failed', code: 'wallet_refund_failed' });
      } finally {
        client.release();
      }
    } else {
      return res.status(400).json({
        error: 'No refundable payment found (no Stripe intent or wallet debit)',
        code: 'no_refundable_payment',
      });
    }

    // Update order payment status.
    const newStatus = refundAmount >= order.total_cents ? 'refunded' : 'partially_refunded';
    await pool.query(
      `UPDATE food_orders SET payment_status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, orderId]
    );

    // Audit trail.
    await pool.query(
      `INSERT INTO admin_audit_log (admin_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'food_order_refund', 'food_order', $2, $3)`,
      [req.user.id, String(orderId), JSON.stringify({
        amount_cents: refundAmount,
        reason,
        provider: refundResult.provider,
        refund_id: refundResult.refund_id || null,
        previous_status: order.payment_status,
        new_status: newStatus,
      })]
    );

    logger.info('adminFoodOrders.refund completed', {
      orderId, adminId: req.user.id, amount_cents: refundAmount,
      provider: refundResult.provider,
    });
    res.json({ ok: true, order_id: orderId, amount_cents: refundAmount, provider: refundResult.provider });
  } catch (err) {
    logger.error('adminFoodOrders.refund error', { message: err.message });
    res.status(500).json({ error: 'Failed to process refund' });
  }
}

module.exports = { listFoodOrders, getFoodOrder, refundFoodOrder };
