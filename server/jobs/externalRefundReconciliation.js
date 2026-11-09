'use strict';

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const { reconcileExternalRefundAttempt } = require('../services/externalRefundService');
const { recordException } = require('../services/reconciliationExceptions');

const CRON_EXPRESSION = '*/5 * * * *';
const CRON_TIMEZONE = 'UTC';
const JOB_NAME = 'external-refund-reconciliation';
const BATCH_SIZE = 50;
// 5-minute cadence: 48 attempts is about four hours of retries. Mirrors
// the payment refund cap (Oct 30 item 9): without it a failing attempt
// re-queues forever with no terminal state and no escalation.
const MAX_RECONCILIATION_ATTEMPTS = Number(process.env.EXTERNAL_REFUND_MAX_RECONCILIATION_ATTEMPTS || 48);

async function runExternalRefundReconciliation({ limit = BATCH_SIZE } = {}) {
  const boundedLimit = Math.min(BATCH_SIZE, Math.max(1, Number(limit) || BATCH_SIZE));
  const result = { locked: false, inspected: 0, settled: 0, failed: 0 };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive(); // E03: abort the run if the job lease was lost
    result.locked = true;
    const pending = await fence.db.query(
      `SELECT * FROM external_refund_attempts
        WHERE status = 'pending'
          AND updated_at < CURRENT_TIMESTAMP - INTERVAL '30 seconds'
        ORDER BY updated_at ASC, id ASC
        LIMIT $1`,
      [boundedLimit]
    );
    result.inspected = pending.rows.length;
    for (const row of pending.rows) {
      await fence.db.query(
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
        const errorMessage = String(error.message || 'Reconciliation failed').slice(0, 1000);
        // Terminal cap, mirroring payment refunds: after the cap the
        // attempt is terminal 'failed' and an operator exception is raised
        // instead of re-queueing forever.
        const terminal = attempts >= MAX_RECONCILIATION_ATTEMPTS;
        await fence.db.query(
          `UPDATE external_refund_attempts
              SET last_error = $2, updated_at = CURRENT_TIMESTAMP,
                  status = CASE WHEN $3 THEN 'failed' ELSE status END
            WHERE id = $1 AND status = 'pending'`,
          [row.id, errorMessage, terminal]
        );
        logger.warn('External refund reconciliation attempt failed', { refundId: row.id, error: error.message });
        await recordException({
          domain: 'external_refund',
          referenceId: row.id,
          severity: terminal || attempts >= 3 ? 'critical' : 'warning',
          summary: terminal
            ? `External refund attempt ${row.id} failed permanently after ${attempts} tries; manual action required`
            : `External refund reconciliation attempt failed for attempt ${row.id}`,
          details: { error: errorMessage, attempts },
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
