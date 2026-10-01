'use strict';

// Daily external reconciliation for the OxSteed Credit rail (Phase 4).
//
// Compares fiat-side records against Stripe as the external source of
// truth: completed top-ups vs PaymentIntents, paid settlement payouts vs
// transfers, and partner-payable commitments vs payable balances. The core
// logic lives in server/services/oxsteedCreditExternalReconciliation.js;
// this file is the scheduling skeleton (cron, distributed lock, worker
// heartbeat), mirroring payoutSettlementReconciliation.js with the
// rail-disabled early skip from oxsteedCreditSettlementCycle.js.
//
// Material findings engage the operator freeze (money initiation fails
// closed with 503 credit_rail_frozen); the journal is never auto-corrected.

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const { withJobLock } = require('./jobLockingService');
const { isCreditRailEnabled, SUPPORTED_CREDIT_CURRENCIES } = require('../services/oxsteedCreditService');
const { reconcileCreditExternal } = require('../services/oxsteedCreditExternalReconciliation');
const incidentStore = require('../services/incidentStore');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');

const CRON_EXPRESSION = process.env.OXSTEED_CREDIT_EXTERNAL_RECON_CRON || '30 2 * * *';
const CRON_TIMEZONE = 'UTC';
const JOB_NAME = 'oxsteed-credit-external-reconciliation';
const CURRENCY_CODES = [...SUPPORTED_CREDIT_CURRENCIES];

function previousUtcDay(now = new Date()) {
  const current = new Date(now);
  if (Number.isNaN(current.getTime())) throw new TypeError('Invalid reconciliation clock');
  const end = new Date(Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate()
  ));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 1);
  return { start, end };
}

async function recordLockFailure(error, period) {
  try {
    return await incidentStore.recordIncident({
      type: 'oxsteed_credit_external_reconciliation_lock_failed',
      severity: 'critical',
      message: 'OxSteed Credit external reconciliation could not acquire its distributed lock',
      dedupeKey: 'oxsteed-credit-external-reconciliation:lock-failed',
      details: { error: error.message, periodStart: period.start.toISOString(), periodEnd: period.end.toISOString() },
    });
  } catch (incidentError) {
    logger.error('OxSteed Credit external reconciliation lock failure incident could not be persisted', { error: incidentError.message });
    return null;
  }
}

async function runOxsteedCreditExternalReconciliation({ now = new Date(), currencyCodes = CURRENCY_CODES, getStripe } = {}) {
  // Fail-open on the rail toggle: a scheduled job must not page nightly
  // while the rail is intentionally off. Checked before the lock so an
  // off rail never contends or records heartbeats. The operator freeze is
  // independent of this toggle and is enforced inside the money paths.
  if (!(await isCreditRailEnabled(pool))) {
    logger.info('OxSteed Credit external reconciliation skipped: credit rail disabled');
    return { locked: false, skipped: 'rail_disabled' };
  }
  const period = previousUtcDay(now);
  let locked = false;
  let outcome = null;
  try {
    await withJobLock(JOB_NAME, async () => {
      locked = true;
      outcome = await reconcileCreditExternal({
        periodStart: period.start,
        periodEnd: period.end,
        currencyCodes,
        actorUserId: null,
        getStripe,
      });
    }, 300, { throwOnLockError: true });
  } catch (error) {
    const incident = await recordLockFailure(error, period);
    logger.error('OxSteed Credit external reconciliation lock acquisition failed', { error: error.message });
    const failure = {
      locked,
      runs: [],
      errors: [{ currencyCode: 'all', error: error.message }],
      incidents: incident ? [incident] : [],
      period: { start: period.start.toISOString(), end: period.end.toISOString() },
    };
    if (locked) await recordOxsteedCreditWorkerRun({ jobName: JOB_NAME, error });
    return failure;
  }
  const result = {
    locked,
    runs: outcome?.runs || [],
    errors: outcome?.errors || [],
    incidents: outcome?.incidents || [],
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    },
  };
  if (locked) {
    await recordOxsteedCreditWorkerRun({
      jobName: JOB_NAME,
      result: {
        currencyCount: currencyCodes.length,
        completedRuns: result.runs.length,
        errorCount: result.errors.length,
      },
      error: result.errors.length ? new Error('One or more Credit external reconciliation currencies failed') : null,
    });
  }
  return result;
}

function startOxsteedCreditExternalReconciliationJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runOxsteedCreditExternalReconciliation().catch((error) => {
      logger.error('OxSteed Credit external reconciliation worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('OxSteed Credit external reconciliation job scheduled', {
    cron: CRON_EXPRESSION,
    timezone: CRON_TIMEZONE,
    currencies: CURRENCY_CODES,
  });
}

module.exports = {
  CRON_EXPRESSION,
  CRON_TIMEZONE,
  JOB_NAME,
  CURRENCY_CODES,
  previousUtcDay,
  runOxsteedCreditExternalReconciliation,
  startOxsteedCreditExternalReconciliationJob,
};
