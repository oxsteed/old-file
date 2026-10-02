'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { reconcileCreditLedger, reconcileSubBankAggregates } = require('../services/oxsteedCreditAdminService');
const { SUPPORTED_CREDIT_CURRENCIES = ['USD'] } = require('../services/oxsteedCreditService');
const incidentStore = require('../services/incidentStore');
const { withFencedJobLock } = require('./jobLockingService');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');

const CRON_EXPRESSION = '10 2 * * *';
const CRON_TIMEZONE = 'UTC';
const JOB_NAME = 'oxsteed-credit-reconciliation';
const CURRENCY_CODE = 'USD';
const CURRENCY_CODES = SUPPORTED_CREDIT_CURRENCIES;

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

async function recordReconciliationLockFailure(error, period) {
  try {
    return await incidentStore.recordIncident({
      type: 'oxsteed_credit_reconciliation_lock_failed',
      severity: 'critical',
      message: 'OxSteed Credit reconciliation could not acquire its distributed lock',
      dedupeKey: 'oxsteed-credit-reconciliation:lock-failed',
      details: { error: error.message, periodStart: period.start.toISOString(), periodEnd: period.end.toISOString() },
    });
  } catch (incidentError) {
    logger.error('OxSteed Credit reconciliation lock failure incident could not be persisted', { error: incidentError.message });
    return null;
  }
}

async function reconcileCurrency({ currencyCode, period }) {
  try {
    const result = await reconcileCreditLedger({
      currencyCode,
      periodStart: period.start,
      periodEnd: period.end,
      actorUserId: null,
    });
    const run = result.run;
    let incident = null;
    if (run.status === 'difference') {
      incident = await incidentStore.recordIncident({
        type: 'oxsteed_credit_reconciliation_difference',
        severity: 'critical',
        message: 'OxSteed Credit ledger reconciliation found a balance or reservation difference',
        dedupeKey: `oxsteed-credit-reconciliation:${currencyCode}`,
        details: {
          runId: run.id,
          currencyCode: run.currencyCode,
          periodStart: run.periodStart,
          periodEnd: run.periodEnd,
          accountBalanceCents: run.accountBalanceCents,
          journalBalanceCents: run.journalBalanceCents,
          differenceCents: run.differenceCents,
          accountCount: run.accountCount,
          entryCount: run.entryCount,
          // Phase 7 (gap 11): reserved_cents vs active holds+reservations.
          reservationDifferenceCents: run.reservationDifferenceCents || 0,
          reservationDivergentAccounts: run.reservationDivergentAccounts || 0,
          reservationDivergences: run.reservationDivergences || [],
        },
      });
      logger.error('OxSteed Credit reconciliation difference', {
        runId: run.id,
        differenceCents: run.differenceCents,
        reservationDifferenceCents: run.reservationDifferenceCents || 0,
      });
    } else {
      logger.info('OxSteed Credit reconciliation balanced', {
        runId: run.id,
        accountCount: run.accountCount,
        entryCount: run.entryCount,
      });
    }
    // Phase 1 central-bank invariant: each restaurant sub-bank balance must
    // equal the aggregate outstanding food-wallet balances at that restaurant.
    const subBankCheck = await reconcileSubBankAggregates({ currencyCode });
    const subBankDivergent = subBankCheck.divergences.length > 0 || subBankCheck.missingSubBanks.length > 0;
    if (subBankDivergent) {
      const subBankIncident = await incidentStore.recordIncident({
        type: 'oxsteed_credit_sub_bank_divergence',
        severity: 'critical',
        message: 'OxSteed Credit restaurant sub-bank balances diverge from food-wallet outstanding',
        dedupeKey: `oxsteed-credit-sub-bank-divergence:${currencyCode}`,
        details: {
          currencyCode,
          periodStart: period.start.toISOString(),
          periodEnd: period.end.toISOString(),
          checkedCount: subBankCheck.checkedCount,
          divergences: subBankCheck.divergences,
          missingSubBanks: subBankCheck.missingSubBanks,
        },
      });
      logger.error('OxSteed Credit sub-bank divergence', {
        currencyCode,
        divergenceCount: subBankCheck.divergences.length,
        missingCount: subBankCheck.missingSubBanks.length,
      });
      incident = incident || subBankIncident;
    } else {
      logger.info('OxSteed Credit sub-bank aggregates balanced', {
        currencyCode,
        checkedCount: subBankCheck.checkedCount,
      });
    }
    return { currencyCode, run, error: null, incident, subBankCheck };
  } catch (error) {
    const incident = await incidentStore.recordIncident({
      type: 'oxsteed_credit_reconciliation_failed',
      severity: 'critical',
      message: 'OxSteed Credit ledger reconciliation failed to complete',
      dedupeKey: `oxsteed-credit-reconciliation-failed:${currencyCode}`,
      details: {
        currencyCode,
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
        error: error.message,
      },
    });
    logger.error('OxSteed Credit reconciliation failed', { error: error.message });
    return { currencyCode, run: null, error: error.message, incident };
  }
}

async function runOxsteedCreditReconciliation({ now = new Date(), currencyCode = CURRENCY_CODE } = {}) {
  const period = previousUtcDay(now);
  let result = { currencyCode, run: null, error: null, incident: null };
  let locked = false;
  try {
    await withFencedJobLock(JOB_NAME, async (fence) => {
      fence.assertActive(); // E03: abort the run if the job lease was lost
      locked = true;
      result = await reconcileCurrency({ currencyCode, period });
    }, 300, { throwOnLockError: true });
  } catch (error) {
    const incident = await recordReconciliationLockFailure(error, period);
    return {
      currencyCode,
      locked,
      run: null,
      error: error.message,
      incident,
      period: { start: period.start.toISOString(), end: period.end.toISOString() },
    };
  }

  return {
    currencyCode,
    locked,
    run: result.run,
    error: result.error,
    incident: result.incident,
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    },
  };
}

async function runOxsteedCreditReconciliations({ now = new Date(), currencyCodes = CURRENCY_CODES } = {}) {
  const period = previousUtcDay(now);
  const results = [];
  let locked = false;
  try {
    await withFencedJobLock(JOB_NAME, async (fence) => {
      fence.assertActive(); // E03: abort the run if the job lease was lost
      locked = true;
      for (const currencyCode of currencyCodes) {
        results.push(await reconcileCurrency({ currencyCode, period }));
      }
    }, 300, { throwOnLockError: true });
  } catch (error) {
    const incident = await recordReconciliationLockFailure(error, period);
    logger.error('OxSteed Credit reconciliation lock acquisition failed', { error: error.message });
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
    runs: results.flatMap((result) => result.run ? [result.run] : []),
    errors: results.flatMap((result) => result.error ? [{ currencyCode: result.currencyCode, error: result.error }] : []),
    incidents: results.flatMap((result) => result.incident ? [result.incident] : []),
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    },
  };
  if (locked) {
    await recordOxsteedCreditWorkerRun({
      jobName: JOB_NAME,
      result: { currencyCount: currencyCodes.length, completedRuns: result.runs.length, errorCount: result.errors.length },
      error: result.errors.length ? new Error('One or more Credit reconciliation currencies failed') : null,
    });
  }
  return result;
}

function startOxsteedCreditReconciliationJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runOxsteedCreditReconciliations().catch((error) => {
      logger.error('OxSteed Credit reconciliation worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('OxSteed Credit reconciliation job scheduled', {
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
  runOxsteedCreditReconciliation,
  runOxsteedCreditReconciliations,
  startOxsteedCreditReconciliationJob,
};
