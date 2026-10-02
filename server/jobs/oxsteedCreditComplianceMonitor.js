'use strict';

// Nightly transaction-monitoring job for the OxSteed Credit compliance
// perimeter (Phase 5, gap 8).
//
// Runs the rules engine in transactionMonitoringService over the previous
// UTC day, then sweeps compliance cases for SLA breaches. Rule hits open
// cases; SLA breaches raise critical incidents. The job never resolves or
// auto-clears anything: money and case outcomes stay human-decided.
//
// Mirrors the scheduling skeleton of oxsteedCreditExternalReconciliation:
// cron, distributed lock, worker heartbeat, and a fail-open skip when the
// rail is disabled (a scheduled job must not page nightly while the rail is
// intentionally off).

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const { isCreditRailEnabled, SUPPORTED_CREDIT_CURRENCIES } = require('../services/oxsteedCreditService');
const {
  runTransactionMonitoring,
  checkComplianceCaseSla,
} = require('../services/transactionMonitoringService');
const incidentStore = require('../services/incidentStore');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');
const { skipCreditJobWhenRailDisabled } = require('../services/oxsteedCreditService');

const CRON_EXPRESSION = process.env.OXSTEED_CREDIT_COMPLIANCE_MONITOR_CRON || '45 3 * * *';
const CRON_TIMEZONE = 'UTC';
const JOB_NAME = 'oxsteed-credit-compliance-monitor';
const CURRENCY_CODES = [...SUPPORTED_CREDIT_CURRENCIES];

function previousUtcDay(now = new Date()) {
  const current = new Date(now);
  if (Number.isNaN(current.getTime())) throw new TypeError('Invalid monitoring clock');
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
      type: 'oxsteed_credit_compliance_monitor_lock_failed',
      severity: 'critical',
      message: 'OxSteed Credit compliance monitor could not acquire its distributed lock',
      dedupeKey: 'oxsteed-credit-compliance-monitor:lock-failed',
      details: { error: error.message, periodStart: period.start.toISOString(), periodEnd: period.end.toISOString() },
    });
  } catch (incidentError) {
    logger.error('OxSteed Credit compliance monitor lock failure incident could not be persisted', { error: incidentError.message });
    return null;
  }
}

async function runOxsteedCreditComplianceMonitor({ now = new Date(), getPool = null } = {}) {
  if (await skipCreditJobWhenRailDisabled(JOB_NAME)) {
    return { skipped: 'rail_disabled' };
  }
  // Fail-open on the rail toggle: checked before the lock so an off rail
  // never contends or records heartbeats.
  const poolToUse = getPool || pool;
  if (!(await isCreditRailEnabled(poolToUse))) {
    logger.info('OxSteed Credit compliance monitor skipped: credit rail disabled');
    return { locked: false, skipped: 'rail_disabled' };
  }
  const period = previousUtcDay(now);
  let locked = false;
  let outcome = null;
  try {
    await withFencedJobLock(JOB_NAME, async (fence) => {
      fence.assertActive(); // E03: abort the run if the job lease was lost
      locked = true;
      const monitoring = await runTransactionMonitoring({ periodStart: period.start, periodEnd: period.end });
      const sla = await checkComplianceCaseSla({ now });
      outcome = { monitoring, sla };
    }, 300, { throwOnLockError: true });
  } catch (error) {
    const incident = await recordLockFailure(error, period);
    logger.error('OxSteed Credit compliance monitor lock acquisition failed', { error: error.message });
    const failure = {
      locked,
      error: error.message,
      incidents: incident ? [incident] : [],
      period: { start: period.start.toISOString(), end: period.end.toISOString() },
    };
    if (locked) await recordOxsteedCreditWorkerRun({ jobName: JOB_NAME, error });
    return failure;
  }
  const result = {
    locked,
    monitoring: outcome?.monitoring || null,
    sla: outcome?.sla || null,
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    },
  };
  if (locked) {
    const casesOpened = Number(result.monitoring?.casesOpened || 0);
    const breached = Number(result.sla?.breachedCount || 0);
    await recordOxsteedCreditWorkerRun({
      jobName: JOB_NAME,
      result: { casesOpened, slaBreached: breached },
      error: null,
    });
  }
  return result;
}

function startOxsteedCreditComplianceMonitorJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runOxsteedCreditComplianceMonitor().catch((error) => {
      logger.error('OxSteed Credit compliance monitor worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('OxSteed Credit compliance monitor job scheduled', {
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
  runOxsteedCreditComplianceMonitor,
  startOxsteedCreditComplianceMonitorJob,
};
