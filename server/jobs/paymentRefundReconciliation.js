'use strict';

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const { reconcilePaymentRefundAttempt } = require('../services/paymentRefundService');
const { recordException } = require('../services/reconciliationExceptions');

const CRON_EXPRESSION = '*/5 * * * *';
const CRON_TIMEZONE = 'UTC';
const JOB_NAME = 'payment-refund-reconciliation';
const BATCH_SIZE = 50;

async function runPaymentRefundReconciliation({ limit = BATCH_SIZE } = {}) {
  const boundedLimit = Math.min(BATCH_SIZE, Math.max(1, Number(limit) || BATCH_SIZE));
  const result = { locked: false, inspected: 0, settled: 0, failed: 0 };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive(); // E03: abort the run if the job lease was lost
    result.locked = true;
    const pending = await fence.db.query(
      `SELECT r.*, p.stripe_payment_intent_id, p.stripe_account_id, p.amount AS payment_amount,
              p.refunded_amount, p.currency, p.status AS payment_status
         FROM payment_refund_attempts r
         JOIN payments p ON p.id = r.payment_id
        WHERE r.status = 'pending'
          AND r.updated_at < CURRENT_TIMESTAMP - INTERVAL '30 seconds'
        ORDER BY r.updated_at ASC, r.id ASC
        LIMIT $1`,
      [boundedLimit]
    );
    result.inspected = pending.rows.length;
    for (const row of pending.rows) {
      await fence.db.query(
        `UPDATE payment_refund_attempts
            SET reconciliation_attempts = reconciliation_attempts + 1,
                last_attempt_at = CURRENT_TIMESTAMP, last_error = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status = 'pending'`,
        [row.id]
      );
      const reservation = {
        payment: {
          id: row.payment_id,
          stripe_payment_intent_id: row.stripe_payment_intent_id,
          stripe_account_id: row.stripe_account_id,
          amount: row.payment_amount,
          refunded_amount: row.refunded_amount,
          currency: row.currency,
          status: row.payment_status,
        },
        attempt: row,
      };
      try {
        await reconcilePaymentRefundAttempt(reservation);
        result.settled += 1;
      } catch (error) {
        result.failed += 1;
        const attempts = (Number(row.reconciliation_attempts) || 0) + 1;
        const errorMessage = String(error.message || 'Reconciliation failed').slice(0, 1000);
        await fence.db.query(
          `UPDATE payment_refund_attempts
              SET last_error = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'pending'`,
          [row.id, errorMessage]
        );
        logger.warn('Payment refund reconciliation attempt failed', { refundId: row.id, error: error.message });
        await recordException({
          domain: 'payment_refund',
          referenceId: row.id,
          severity: attempts >= 3 ? 'critical' : 'warning',
          summary: `Payment refund reconciliation attempt failed for attempt ${row.id}`,
          details: { error: errorMessage, attempts },
          sourceRunId: JOB_NAME,
        });
      }
    }
  }, 300, { throwOnLockError: true });
  return result;
}

function startPaymentRefundReconciliationJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runPaymentRefundReconciliation().catch((error) => {
      logger.error('Payment refund reconciliation worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('Payment refund reconciliation job scheduled', {
    cron: CRON_EXPRESSION,
    timezone: CRON_TIMEZONE,
    batchSize: BATCH_SIZE,
  });
}

module.exports = {
  CRON_EXPRESSION,
  CRON_TIMEZONE,
  JOB_NAME,
  BATCH_SIZE,
  runPaymentRefundReconciliation,
  startPaymentRefundReconciliationJob,
};
