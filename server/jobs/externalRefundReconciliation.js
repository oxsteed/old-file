'use strict';

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const { withJobLock } = require('./jobLockingService');
const { reconcileExternalRefundAttempt } = require('../services/externalRefundService');
const { recordException } = require('../services/reconciliationExceptions');

const CRON_EXPRESSION = '*/5 * * * *';
const CRON_TIMEZONE = 'UTC';
const JOB_NAME = 'external-refund-reconciliation';
const BATCH_SIZE = 50;

async function runExternalRefundReconciliation({ limit = BATCH_SIZE } = {}) {
  const boundedLimit = Math.min(BATCH_SIZE, Math.max(1, Number(limit) || BATCH_SIZE));
  const result = { locked: false, inspected: 0, settled: 0, failed: 0 };
  await withJobLock(JOB_NAME, async () => {
    result.locked = true;
    const pending = await pool.query(
      `SELECT * FROM external_refund_attempts
        WHERE status = 'pending'
          AND updated_at < CURRENT_TIMESTAMP - INTERVAL '30 seconds'
        ORDER BY updated_at ASC, id ASC
        LIMIT $1`,
      [boundedLimit]
    );
    result.inspected = pending.rows.length;
    for (const row of pending.rows) {
      await pool.query(
        `UPDATE external_refund_attempts
            SET reconciliation_attempts = reconciliation_attempts + 1,
                last_attempt_at = CURRENT_TIMESTAMP, last_error = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status = 'pending'`,
        [row.id]
      );
      try {
        await reconcileExternalRefundAttempt(row);
        result.settled += 1;
      } catch (error) {
        result.failed += 1;
        const attempts = (Number(row.reconciliation_attempts) || 0) + 1;
        logger.warn('External refund reconciliation attempt failed', { refundId: row.id, error: error.message });
        await recordException({
          domain: 'external_refund',
          referenceId: row.id,
          severity: attempts >= 3 ? 'critical' : 'warning',
          summary: `External refund reconciliation attempt failed for attempt ${row.id}`,
          details: { error: String(error.message || 'Reconciliation failed').slice(0, 1000), attempts },
          sourceRunId: JOB_NAME,
        });
      }
    }
  }, 300, { throwOnLockError: true });
  return result;
}

function startExternalRefundReconciliationJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runExternalRefundReconciliation().catch((error) => {
      logger.error('External refund reconciliation worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('External refund reconciliation job scheduled', {
    cron: CRON_EXPRESSION, timezone: CRON_TIMEZONE, batchSize: BATCH_SIZE,
  });
}

module.exports = {
  CRON_EXPRESSION,
  CRON_TIMEZONE,
  JOB_NAME,
  BATCH_SIZE,
  runExternalRefundReconciliation,
  startExternalRefundReconciliationJob,
};
