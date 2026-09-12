'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { reconcileCreditLedger } = require('../services/oxsteedCreditAdminService');
const { SUPPORTED_CREDIT_CURRENCIES = ['USD'] } = require('../services/oxsteedCreditService');
const incidentStore = require('../services/incidentStore');
const { withJobLock } = require('./jobLockingService');

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

async function runOxsteedCreditReconciliation({ now = new Date(), currencyCode = CURRENCY_CODE } = {}) {
  const period = previousUtcDay(now);
  const outcome = { locked: false, run: null, error: null, incident: null };

  await withJobLock(JOB_NAME, async () => {
    outcome.locked = true;
    try {
      const result = await reconcileCreditLedger({
        currencyCode,
        periodStart: period.start,
        periodEnd: period.end,
        actorUserId: null,
      });
      outcome.run = result.run;

      if (result.run.status === 'difference') {
        const alert = await incidentStore.recordIncident({
          type: 'oxsteed_credit_reconciliation_difference',
          severity: 'critical',
          message: 'OxSteed Credit ledger reconciliation found a balance difference',
          dedupeKey: `oxsteed-credit-reconciliation:${currencyCode}`,
          details: {
            runId: result.run.id,
            currencyCode: result.run.currencyCode,
            periodStart: result.run.periodStart,
            periodEnd: result.run.periodEnd,
            accountBalanceCents: result.run.accountBalanceCents,
            journalBalanceCents: result.run.journalBalanceCents,
            differenceCents: result.run.differenceCents,
            accountCount: result.run.accountCount,
            entryCount: result.run.entryCount,
          },
        });
        outcome.incident = alert;
        logger.error('OxSteed Credit reconciliation difference', {
          runId: result.run.id,
          differenceCents: result.run.differenceCents,
        });
      } else {
        logger.info('OxSteed Credit reconciliation balanced', {
          runId: result.run.id,
          accountCount: result.run.accountCount,
          entryCount: result.run.entryCount,
        });
      }
    } catch (error) {
      outcome.error = error;
      await incidentStore.recordIncident({
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
    }
  }, 300);

  return {
    currencyCode,
    locked: outcome.locked,
    run: outcome.run,
    error: outcome.error ? outcome.error.message : null,
    incident: outcome.incident,
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    },
  };
}

async function runOxsteedCreditReconciliations({ now = new Date() } = {}) {
  const runs = [];
  for (const currencyCode of CURRENCY_CODES) {
    runs.push(await runOxsteedCreditReconciliation({ now, currencyCode }));
  }
  return {
    locked: runs.some((result) => result.locked),
    runs: runs.flatMap((result) => result.run ? [result.run] : []),
    errors: runs.flatMap((result) => result.error ? [{ currencyCode: result.currencyCode, error: result.error }] : []),
    incidents: runs.flatMap((result) => result.incident ? [result.incident] : []),
    period: runs[0]?.period || previousUtcDay(now),
  };
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
