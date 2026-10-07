'use strict';

// Admin food orders 360: list, detail, refund with purpose-bound audit.
// Separate from marketplace orders (adminOrders.js).

const { pool } = require('../db');
const logger = require('../utils/logger');

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

    // TODO: wire to actual Stripe/wallet refund based on payment_mode.
    // For now, record the refund intent with audit.
    await pool.query(
      `INSERT INTO admin_audit_log (admin_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'food_order_refund', 'food_order', $2, $3)`,
      [req.user.id, String(orderId), JSON.stringify({
        amount_cents: refundAmount,
        reason,
        payment_status: order.payment_status,
      })]
    );

    logger.info('adminFoodOrders.refund', {
      orderId, adminId: req.user.id, amount_cents: refundAmount,
    });
    res.json({ ok: true, order_id: orderId, amount_cents: refundAmount });
  } catch (err) {
    logger.error('adminFoodOrders.refund error', { message: err.message });
    res.status(500).json({ error: 'Failed to process refund' });
  }
}

module.exports = { listFoodOrders, getFoodOrder, refundFoodOrder };
