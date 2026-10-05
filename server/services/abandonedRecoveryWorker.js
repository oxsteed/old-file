/**
 * abandonedRecoveryWorker.js — win back abandoned checkouts and job drafts
 *
 * Polls every 15 minutes for:
 *  1. Food card checkouts abandoned mid-flow: a Stripe PaymentIntent was
 *     minted (food_card_payment_intents.status = 'created') 60-120 minutes
 *     ago but no order was ever placed against it. One push, deep-linked
 *     to the restaurant, capped at 1/day by the delivery key.
 *  2. Stale job drafts: job_drafts touched 24-48h ago with wizard content
 *     (step > 1) and never submitted. One push, deep-linked to /post-job.
 *
 * Idempotency is enforced by notificationService delivery keys
 * (cart-recovery:<id>, draft-recovery:<id>), so replays are free.
 * Money never moves here; these are pure re-engagement nudges.
 * Transactional by nature (user-initiated intent), exempt from the promo cap.
 */
const db = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');

const POLL_MS = 15 * 60 * 1000;
const BATCH_LIMIT = 100;

let timer = null;
let running = false;

async function recoverAbandonedCheckouts() {
  const { rows } = await db.query(
    `SELECT i.id, i.customer_id, i.restaurant_id, i.amount_cents, i.currency_code,
            r.display_name AS restaurant_name
       FROM food_card_payment_intents i
       JOIN food_restaurants r ON r.id = i.restaurant_id
      WHERE i.status = 'created'
        AND i.customer_id IS NOT NULL
        AND i.created_at >= NOW() - INTERVAL '120 minutes'
        AND i.created_at <  NOW() - INTERVAL '60 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM food_orders o
          WHERE o.stripe_payment_intent_id = i.stripe_payment_intent_id
        )
      ORDER BY i.created_at ASC
      LIMIT $1`,
    [BATCH_LIMIT]
  );

  for (const row of rows) {
    try {
      await sendNotification({
        userId: row.customer_id,
        type: 'cart_recovery',
        data: {
          restaurant_id: String(row.restaurant_id),
          restaurant_name: row.restaurant_name,
          amount_cents: row.amount_cents,
          currency_code: row.currency_code,
        },
        action_url: `/food/restaurants/${row.restaurant_id}`,
        idempotencyKey: `cart-recovery:${row.id}`,
      });
    } catch (err) {
      logger.warn('[AbandonedRecovery] cart push failed', { intentId: row.id, error: err.message });
    }
  }
  if (rows.length) logger.info('[AbandonedRecovery] cart recovery batch', { count: rows.length });
}

async function recoverStaleDrafts() {
  const { rows } = await db.query(
    `SELECT d.id, d.client_id, d.wizard_step, d.updated_at
       FROM job_drafts d
      WHERE d.wizard_step > 1
        AND d.updated_at >= NOW() - INTERVAL '48 hours'
        AND d.updated_at <  NOW() - INTERVAL '24 hours'
      ORDER BY d.updated_at ASC
      LIMIT $1`,
    [BATCH_LIMIT]
  );

  for (const row of rows) {
    try {
      await sendNotification({
        userId: row.client_id,
        type: 'draft_recovery',
        data: { draft_id: String(row.id), wizard_step: row.wizard_step },
        action_url: '/post-job',
        idempotencyKey: `draft-recovery:${row.id}`,
      });
    } catch (err) {
      logger.warn('[AbandonedRecovery] draft push failed', { draftId: row.id, error: err.message });
    }
  }
  if (rows.length) logger.info('[AbandonedRecovery] draft recovery batch', { count: rows.length });
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await recoverAbandonedCheckouts();
    await recoverStaleDrafts();
  } catch (err) {
    logger.error('[AbandonedRecovery] tick failed', { error: err.message });
  } finally {
    running = false;
  }
}

function startAbandonedRecoveryWorker() {
  if (timer) return;
  // Stagger the first run so boot isn't thundered.
  timer = setTimeout(() => {
    tick();
    timer = setInterval(tick, POLL_MS);
    if (timer.unref) timer.unref();
  }, 60 * 1000);
  if (timer.unref) timer.unref();
  logger.info('[AbandonedRecovery] worker started');
}

function stopAbandonedRecoveryWorker() {
  if (timer) {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  startAbandonedRecoveryWorker,
  stopAbandonedRecoveryWorker,
  // Exported for tests.
  _recoverAbandonedCheckouts: recoverAbandonedCheckouts,
  _recoverStaleDrafts: recoverStaleDrafts,
};
