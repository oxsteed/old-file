'use strict';

// Daily settlement-reconciliation sweep for payout_transactions.
//
// Settlement evidence: a completed payout_transaction is considered settled
// only when a matching, explicitly reconciled bank-statement entry exists in
// payout_reconciliation (payout_reconciliation.payout_id references the same
// affiliate_payouts row as payout_transactions.payout_id). A mere
// external_transaction_id on the payout_transaction row proves the processor
// accepted the transfer, not that the funds actually settled against a bank
// statement, so it is NOT treated as settlement evidence.

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const { withJobLock } = require('./jobLockingService');

const CRON_EXPRESSION = '30 3 * * *';
const CRON_TIMEZONE = 'UTC';
const JOB_NAME = 'payout-settlement-reconciliation';
const BATCH_SIZE = 100;
const SETTLEMENT_GRACE_INTERVAL = '48 hours';
const EXCEPTION_DOMAIN = 'payout_settlement';

async function runPayoutSettlementReconciliation({ limit = BATCH_SIZE } = {}) {
  const boundedLimit = Math.min(BATCH_SIZE, Math.max(1, Number(limit) || BATCH_SIZE));
  const result = { locked: false, inspected: 0, raised: 0, failed: 0 };
  await withJobLock(JOB_NAME, async () => {
    result.locked = true;
    const unsettled = await pool.query(
      `SELECT t.id, t.payout_id, t.external_transaction_id, t.transaction_status,
              t.updated_at AS completed_at
         FROM payout_transactions t
         LEFT JOIN payout_reconciliation pr
                ON pr.payout_id = t.payout_id
               AND pr.reconciled = TRUE
        WHERE t.transaction_status = 'completed'
          AND t.updated_at < CURRENT_TIMESTAMP - INTERVAL '48 hours'
          AND pr.id IS NULL
        ORDER BY t.updated_at ASC, t.id ASC
        LIMIT $1`,
      [boundedLimit]
    );
    result.inspected = unsettled.rows.length;
    for (const row of unsettled.rows) {
      try {
        const referenceId = String(row.id);
        // Dedupe explicitly with a SELECT so an already open/acknowledged
        // exception never raises again; never rely on unique-violation errors
        // as control flow.
        const existing = await pool.query(
          `SELECT 1
             FROM reconciliation_exceptions
            WHERE domain = $1
              AND reference_id = $2
              AND status IN ('open', 'acknowledged')
            LIMIT 1`,
          [EXCEPTION_DOMAIN, referenceId]
        );
        if (existing.rowCount > 0) {
          continue;
        }
        await pool.query(
          `INSERT INTO reconciliation_exceptions
             (domain, reference_id, severity, summary, details, source_run_id)
           VALUES ($1, $2, 'warning', $3, $4, $5)`,
          [
            EXCEPTION_DOMAIN,
            referenceId,
            'Payout completed 48h+ ago with no settlement evidence',
            JSON.stringify({
              payout_id: row.payout_id,
              external_transaction_id: row.external_transaction_id,
              completed_at: row.completed_at,
            }),
            JOB_NAME,
          ]
        );
        result.raised += 1;
      } catch (error) {
        result.failed += 1;
        logger.warn('Payout settlement reconciliation exception insert failed', {
          transactionId: row.id,
          error: error.message,
        });
      }
    }
  }, 300, { throwOnLockError: true });
  return result;
}

function startPayoutSettlementReconciliationJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runPayoutSettlementReconciliation().catch((error) => {
      logger.error('Payout settlement reconciliation worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('Payout settlement reconciliation job scheduled', {
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
  runPayoutSettlementReconciliation,
  startPayoutSettlementReconciliationJob,
};
