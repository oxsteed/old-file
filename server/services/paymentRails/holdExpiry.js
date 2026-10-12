'use strict';

/**
 * Card-hold expiry (decision #17). Manual-capture authorizations lapse after
 * the country's window (Stripe: ~7 days for most cards). Before that, the
 * customer is asked to renew: the job gets paymentHoldRenewalRequired and the
 * existing re-authorization flow replaces the authorization with a fresh one
 * for the same amount. Jobs scheduled more than 5 days out avoid this by
 * being charged now and held on the platform (stripeRail.planIntent).
 */

const pool = require('../../db');
const logger = require('../../utils/logger');
const flags = require('../paymentLayerFlags');
const { withTransaction } = require('../../utils/transaction');
const { enqueueJobEvent, EVENT_TYPES } = require('../jobEventOutbox');

function leadHours() {
  const value = Number(process.env.JOB_HOLD_REAUTH_LEAD_HOURS || 36);
  return Number.isFinite(value) && value >= 1 && value <= 144 ? value : 36;
}

async function flagExpiringHolds(limit = 200) {
  if (!flags.isEnabled('HOLD_EXPIRY_REAUTH')) return 0;
  const { rows } = await pool.query(
    `SELECT p.id AS payment_id, p.job_id, p.authorization_expires_at
       FROM payments p
       JOIN jobs j ON j.id = p.job_id
      WHERE p.status = 'authorized'
        AND p.charge_model IN ('direct', 'destination')
        AND p.authorization_expires_at IS NOT NULL
        AND p.authorization_expires_at <= NOW() + ($1::numeric * INTERVAL '1 hour')
        AND p.authorization_expires_at > NOW()
        AND j.status::text IN ('accepted', 'in_progress')
        AND NOT (COALESCE(j.metadata, '{}'::jsonb) ? 'paymentHoldRenewalRequired')
      ORDER BY p.authorization_expires_at
      LIMIT $2`,
    [leadHours(), Math.max(1, Math.min(Number(limit) || 200, 1000))]
  );
  let flagged = 0;
  for (const row of rows) {
    try {
      await withTransaction(pool, async (client) => {
        const { rowCount } = await client.query(
          `UPDATE jobs SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('paymentHoldRenewalRequired', true, 'paymentHoldExpiresAt', $2::text)
            WHERE id = $1 AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'paymentHoldRenewalRequired')`,
          [row.job_id, new Date(row.authorization_expires_at).toISOString()]
        );
        if (!rowCount) return;
        await enqueueJobEvent(client, {
          jobId: row.job_id, eventType: EVENT_TYPES.PAYMENT_HOLD_EXPIRING, coalesce: false,
          payload: { payment_id: String(row.payment_id), expires_at: new Date(row.authorization_expires_at).toISOString() },
        });
        flagged += 1;
      }, 'payment_hold_expiry_flag');
    } catch (err) {
      logger.warn('payment_hold_expiry.flag_failed', { jobId: row.job_id, error: err.message });
    }
  }
  return flagged;
}

module.exports = { flagExpiringHolds, leadHours };
