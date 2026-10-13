'use strict';

/**
 * Stripe webhook branches for the payment layers. Each returns true when the
 * event belonged to it and was fully handled.
 */

const pool = require('../../db');
const logger = require('../../utils/logger');

/** Charge-now + platform hold: the job is funded, nothing is released yet. */
async function applyPlatformHoldSucceeded(pi) {
  if (pi?.metadata?.charge_model !== 'platform_hold' || !pi.metadata?.job_id) return false;
  if (pi.metadata.job_reauthorization === 'true' || pi.metadata.job_tip === 'true') return false;
  const { rows } = await pool.query(
    `UPDATE payments
        SET status = 'authorized', payment_hold_status = 'held', authorized_at = COALESCE(authorized_at, NOW()),
            stripe_charge_id = COALESCE($2, stripe_charge_id), updated_at = NOW()
      WHERE stripe_payment_intent_id = $1 AND status = 'pending'
      RETURNING id, job_id`,
    [pi.id, typeof pi.latest_charge === 'string' ? pi.latest_charge : null]
  );
  if (rows[0]) {
    const { withTransaction } = require('../../utils/transaction');
    const { enqueueJobEvent, EVENT_TYPES } = require('../jobEventOutbox');
    await withTransaction(pool, async (client) => {
      await client.query(`UPDATE jobs SET escrow_status = 'held', updated_at = NOW() WHERE id = $1`, [rows[0].job_id]);
      await enqueueJobEvent(client, {
        jobId: rows[0].job_id, eventType: EVENT_TYPES.PAYMENT_CHARGED_NOW, coalesce: false,
        payload: { payment_id: String(rows[0].id), amount_minor: Number(pi.amount_received ?? pi.amount), currency: String(pi.currency || 'usd').toUpperCase() },
      });
    }, 'platform_hold_funded').catch((err) => logger.warn('platform_hold.funded_side_effects_failed', { error: err.message }));
    logger.info('platform_hold.funded', { paymentIntentId: pi.id, jobId: rows[0].job_id });
  }
  return true;
}

const TIP_STATUS = Object.freeze({
  'payment_intent.succeeded': 'succeeded',
  'payment_intent.payment_failed': 'failed',
  'payment_intent.canceled': 'canceled',
});

async function applyTipIntent(type, pi) {
  if (pi?.metadata?.job_tip !== 'true') return false;
  const status = TIP_STATUS[type];
  if (!status) return true;
  const { rows } = await pool.query(
    `UPDATE job_tips SET status = $2, updated_at = NOW()
      WHERE stripe_payment_intent_id = $1 AND status = 'pending'
      RETURNING *`,
    [pi.id, status]
  );
  if (rows[0] && status === 'succeeded') {
    const { notifyTipReceived } = require('./tips');
    await notifyTipReceived(rows[0]).catch((err) => logger.warn('tips.notify_failed', { error: err.message }));
  }
  return true;
}

module.exports = { applyPlatformHoldSucceeded, applyTipIntent };
