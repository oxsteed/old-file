'use strict';

/**
 * Credit rail: when the helper marked the job complete, the held Credit is
 * released to them after a review window (CREDIT_AUTO_RELEASE_HOURS, default
 * 72) unless the customer opened a dispute.
 */

const db = require('../../db');
const logger = require('../../utils/logger');
const { withTransaction } = require('../../utils/transaction');
const flags = require('../paymentLayerFlags');
const creditRail = require('./creditRail');

function reviewHours() {
  const value = Number(process.env.CREDIT_AUTO_RELEASE_HOURS || 72);
  return Number.isFinite(value) && value >= 24 ? value : 72;
}

async function releaseDueCreditPayments(limit = 50) {
  if (!flags.isEnabled('PAYMENT_RAILS') || !flags.isEnabled('CREDIT_RAIL')) return { released: 0 };
  const { rows } = await db.query(
    `SELECT j.id
       FROM jobs j
       JOIN job_credit_payments p ON p.job_id = j.id AND p.status = 'held'
      WHERE j.payment_rail = 'credit'
        AND j.status = 'completed'
        AND j.completed_at < NOW() - make_interval(hours => $1::int)
        AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.job_id = j.id AND d.status IN ('open', 'in_progress'))
      ORDER BY j.completed_at
      LIMIT $2`,
    [Math.round(reviewHours()), limit]
  );
  let released = 0;
  for (const { id } of rows) {
    try {
      await withTransaction(db, async (client) => {
        const { rows: jobRows } = await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [id]);
        if (!jobRows[0] || !(await creditRail.activePayment(client, id))) return;
        await creditRail.capturePayment(client, { job: jobRows[0], actorUserId: null });
        released += 1;
      }, 'credit_auto_release');
    } catch (error) {
      logger.error('credit_rail.auto_release_failed', { jobId: id, error: error.message });
    }
  }
  return { released };
}

module.exports = { releaseDueCreditPayments, reviewHours };
