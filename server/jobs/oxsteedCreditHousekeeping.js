'use strict';

// Review P1-249 / P1-252 / P1-253: OxSteed Credit housekeeping.
// - expires maker-checker requests past their deadline (no more lazy-only expiry)
// - raises an incident for cycle settlements left pending too long
// - raises an incident while dual-posting backfill rows sit parked as 'failed'

const cron = require('node-cron');
const db = require('../db');
const logger = require('../utils/logger');
const incidentStore = require('../services/incidentStore');
const { expireStalePendingActions } = require('../services/oxsteedCreditPendingActionService');

const CRON_EXPRESSION = '20 */15 * * * *';
const JOB_NAME = 'oxsteed-credit-housekeeping';
const PENDING_SETTLEMENT_AGING_HOURS = Number(process.env.CREDIT_PENDING_SETTLEMENT_AGING_HOURS || 72);

async function runOxsteedCreditHousekeeping(pool = db) {
  const { expired } = await expireStalePendingActions();

  const { rows: aging } = await pool.query(
    `SELECT id, partner_id, net_cents, created_at
       FROM oxsteed_credit_settlements
      WHERE status = 'pending' AND created_at < NOW() - ($1::int * INTERVAL '1 hour')
      ORDER BY created_at ASC
      LIMIT 50`,
    [PENDING_SETTLEMENT_AGING_HOURS]
  );
  if (aging.length) {
    await incidentStore.recordIncident({
      type: 'oxsteed_credit_settlement_pending_aging',
      severity: 'warning',
      message: `OxSteed Credit settlements pending longer than ${PENDING_SETTLEMENT_AGING_HOURS}h need approval`,
      dedupeKey: 'oxsteed-credit-settlement-pending-aging',
      details: { count: aging.length, settlementIds: aging.map((r) => String(r.id)) },
    });
  }

  const { rows: parkedRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM credit_dual_posting_backfill WHERE status = 'failed'`
  );
  const parked = Number(parkedRows[0]?.n || 0);
  if (parked > 0) {
    await incidentStore.recordIncident({
      type: 'oxsteed_credit_backfill_parked',
      severity: 'critical',
      message: 'OxSteed Credit dual-posting backfill rows are parked and need operator requeue',
      dedupeKey: 'oxsteed-credit-backfill-parked',
      details: { parked },
    });
  }
  return { expired, agingSettlements: aging.length, parkedBackfill: parked };
}

function startOxsteedCreditHousekeepingJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runOxsteedCreditHousekeeping().catch((error) => {
      logger.warn('OxSteed Credit housekeeping failed', { error: error.message });
    });
  });
  logger.info('OxSteed Credit housekeeping job scheduled', { cron: CRON_EXPRESSION, jobName: JOB_NAME });
}

module.exports = { CRON_EXPRESSION, JOB_NAME, PENDING_SETTLEMENT_AGING_HOURS, runOxsteedCreditHousekeeping, startOxsteedCreditHousekeepingJob };
