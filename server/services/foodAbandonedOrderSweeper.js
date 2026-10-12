'use strict';

// Review P1-236: pay_now orders are created before the Stripe Checkout
// session. If the customer abandons checkout, the order used to sit in
// received/requires_payment forever. Stripe Checkout sessions expire after
// at most 24h, so anything older than the grace window can never be paid.

const pool = require('../db');
const logger = require('../utils/logger');

const ABANDONED_PAY_NOW_HOURS = Number(process.env.FOOD_ABANDONED_PAY_NOW_HOURS || 25);

async function cancelAbandonedPayNowOrders(db = pool, { hours = ABANDONED_PAY_NOW_HOURS } = {}) {
  const { rows } = await db.query(
    `UPDATE food_orders
        SET status = 'cancelled',
            cancelled_at = COALESCE(cancelled_at, NOW()),
            payment_status = 'failed',
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cancelReason', 'payment_abandoned'),
            updated_at = NOW()
      WHERE status = 'received'
        AND payment_status = 'requires_payment'
        AND COALESCE(metadata->>'paymentMode', '') = 'pay_now'
        AND created_at < NOW() - ($1::int * INTERVAL '1 hour')
      RETURNING id, restaurant_id`,
    [hours]
  );
  if (rows.length) logger.info('Cancelled abandoned pay_now food orders', { count: rows.length });
  return { cancelled: rows.length, orderIds: rows.map((r) => r.id) };
}

module.exports = { ABANDONED_PAY_NOW_HOURS, cancelAbandonedPayNowOrders };
