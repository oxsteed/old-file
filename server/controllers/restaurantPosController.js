'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

function parsePositiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeString(value, max = 255) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

const RECEIPT_CHANNELS = new Set(['Counter', 'Payment update', 'Printed', 'SMS', 'Email']);
const RECEIPT_EVENT_TYPES = new Set([
  'receipt',
  'order_created',
  'payment_recorded',
  'payment_refunded',
  'ticket_voided',
  'ticket_held',
  'ticket_reopened',
  'receipt_reprinted',
]);

const DEFAULT_POS_DISCOUNTS = [
  { code: 'WELCOME10', title: 'Welcome 10%', percentOff: 0.10 },
  { code: 'LUNCH15', title: 'Lunch 15%', percentOff: 0.15 },
  { code: 'VIP20', title: 'VIP 20%', percentOff: 0.20 },
];

async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [restaurantId, userId]
  );
  const restaurant = rows[0];
  if (!restaurant || !restaurant.effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  return restaurant;
}

exports.listDiscounts = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    res.json({ discounts: DEFAULT_POS_DISCOUNTS });
  } catch (err) {
    next(err);
  }
};

exports.listReceiptEvents = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const limit = Math.min(parsePositiveInt(req.query.limit) || 30, 100);

    const { rows } = await pool.query(
      `SELECT *
         FROM restaurant_pos_receipt_events
        WHERE restaurant_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [restaurantId, limit]
    );

    res.json({ receiptEvents: rows });
  } catch (err) {
    next(err);
  }
};

exports.createReceiptEvent = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);

    const orderId = parsePositiveInt(req.body.orderId || req.body.order_id);
    const queueNumber = parsePositiveInt(req.body.queueNumber || req.body.queue_number);
    const totalCents = Number.parseInt(req.body.totalCents ?? req.body.total_cents, 10);
    const paymentStatus = normalizeString(req.body.paymentStatus || req.body.payment_status, 32);
    const channel = normalizeString(req.body.channel, 32);
    const guestName = normalizeString(req.body.guestName || req.body.guest_name, 140);
    const eventType = normalizeString(req.body.eventType || req.body.event_type, 64) || 'receipt';
    const idempotencyKey = normalizeString(
      req.get('Idempotency-Key') || req.body.idempotencyKey || req.body.idempotency_key,
      200
    );

    if (!orderId) throw new AppError('Validation failed', 400, 'validation_failed', { orderId: 'Order is required' });
    if (!queueNumber) throw new AppError('Validation failed', 400, 'validation_failed', { queueNumber: 'Queue number is required' });
    if (!Number.isInteger(totalCents) || totalCents < 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', { totalCents: 'Total cents must be a non-negative integer' });
    }
    if (!paymentStatus) throw new AppError('Validation failed', 400, 'validation_failed', { paymentStatus: 'Payment status is required' });
    if (!channel || !RECEIPT_CHANNELS.has(channel)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { channel: 'Unsupported receipt channel' });
    }
    if (!RECEIPT_EVENT_TYPES.has(eventType)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { eventType: 'Unsupported receipt event type' });
    }

    const { rows: [order] } = await pool.query(
      `SELECT id
         FROM food_orders
        WHERE id = $1
          AND restaurant_id = $2`,
      [orderId, restaurantId]
    );
    if (!order) throw new AppError('Order not found', 404, 'order_not_found');

    const { rows: [receiptEvent] } = await pool.query(
      `INSERT INTO restaurant_pos_receipt_events
         (restaurant_id, food_order_id, queue_number, guest_name, total_cents,
          payment_status, channel, event_type, reason, metadata, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
       ON CONFLICT (restaurant_id, idempotency_key)
         WHERE idempotency_key IS NOT NULL
       DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING *`,
      [
        restaurantId,
        orderId,
        queueNumber,
        guestName,
        totalCents,
        paymentStatus,
        channel,
        eventType,
        normalizeString(req.body.reason || req.body.note, 1000),
        JSON.stringify(req.body.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
          ? req.body.metadata
          : {}),
        idempotencyKey,
        req.user.id,
      ]
    );

    res.status(idempotencyKey ? 200 : 201).json({ receiptEvent });
  } catch (err) {
    next(err);
  }
};
