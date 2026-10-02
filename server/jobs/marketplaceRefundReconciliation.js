'use strict';

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const { reconcileMarketplaceRefundReservation } = require('../services/marketplaceRefundService');
const { recordException } = require('../services/reconciliationExceptions');

const CRON_EXPRESSION = '*/5 * * * *';
const CRON_TIMEZONE = 'UTC';
const JOB_NAME = 'marketplace-refund-reconciliation';
const BATCH_SIZE = 50;

async function runMarketplaceRefundReconciliation({ limit = BATCH_SIZE } = {}) {
  const boundedLimit = Math.min(BATCH_SIZE, Math.max(1, Number(limit) || BATCH_SIZE));
  const result = { locked: false, inspected: 0, settled: 0, failed: 0 };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive(); // E03: abort the run if the job lease was lost
    result.locked = true;
    const pending = await fence.db.query(
      `SELECT r.*, o.id AS order_id, o.status AS order_status,
              t.payment_intent_id AS transaction_payment_intent_id,
              t.amount_cents AS transaction_amount_cents,
              t.refunded_amount_cents AS transaction_refunded_amount_cents,
              t.currency AS transaction_currency, t.status AS transaction_status
         FROM marketplace_transaction_refunds r
         JOIN marketplace_orders o ON o.id = r.order_id
         JOIN marketplace_transactions t ON t.id = r.transaction_id
        WHERE r.status = 'pending'
          AND r.updated_at < CURRENT_TIMESTAMP - INTERVAL '30 seconds'
        ORDER BY r.updated_at ASC, r.id ASC
        LIMIT $1`,
      [boundedLimit]
    );
    result.inspected = pending.rows.length;
    for (const row of pending.rows) {
      await fence.db.query(
        `UPDATE marketplace_transaction_refunds
            SET reconciliation_attempts = reconciliation_attempts + 1,
                last_attempt_at = CURRENT_TIMESTAMP, last_error = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status = 'pending'`,
        [row.id]
      );
      const reservation = {
        order: { id: row.order_id, status: row.order_status },
        transaction: {
          id: row.transaction_id,
          payment_intent_id: row.transaction_payment_intent_id,
          amount_cents: row.transaction_amount_cents,
          refunded_amount_cents: row.transaction_refunded_amount_cents,
          currency: row.transaction_currency,
          status: row.transaction_status,
        },
        refund: row,
      };
      try {
        await reconcileMarketplaceRefundReservation(reservation);
        result.settled += 1;
      } catch (error) {
        result.failed += 1;
        const attempts = (Number(row.reconciliation_attempts) || 0) + 1;
        const errorMessage = String(error.message || 'Reconciliation failed').slice(0, 1000);
        await fence.db.query(
          `UPDATE marketplace_transaction_refunds
              SET last_error = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'pending'`,
          [row.id, errorMessage]
        );
        logger.warn('Marketplace refund reconciliation attempt failed', { refundId: row.id, error: error.message });
        await recordException({
          domain: 'marketplace_refund',
          referenceId: row.id,
          severity: attempts >= 3 ? 'critical' : 'warning',
          summary: `Marketplace refund reconciliation attempt failed for refund ${row.id}`,
          details: { error: errorMessage, attempts },
          sourceRunId: JOB_NAME,
        });
      }
    }
  }, 300, { throwOnLockError: true });
  return result;
}

function startMarketplaceRefundReconciliationJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runMarketplaceRefundReconciliation().catch((error) => {
      logger.error('Marketplace refund reconciliation worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('Marketplace refund reconciliation job scheduled', {
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
  runMarketplaceRefundReconciliation,
  startMarketplaceRefundReconciliationJob,
};
