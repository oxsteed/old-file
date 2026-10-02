'use strict';

// Nightly OxSteed Credit dispute SLA monitor (Phase 7, gap 10).
//
// Sweeps open/in_review disputes past their sla_due_at and raises a
// critical incident per breach (deduped per dispute). The sweep never
// resolves disputes or moves money: disputes are never auto-resolved in a
// customer's favor, and outcomes stay human-decided.
//
// Mirrors the scheduling skeleton of oxsteedCreditComplianceMonitor: cron,
// distributed lock, worker heartbeat, and a fail-open skip when the rail
// is disabled (a scheduled job must not page nightly while the rail is
// intentionally off).

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const { isCreditRailEnabled } = require('../services/oxsteedCreditService');
const { checkDisputeSla } = require('../services/oxsteedCreditDisputeService');
const incidentStore = require('../services/incidentStore');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');

const CRON_EXPRESSION = process.env.OXSTEED_CREDIT_DISPUTE_MONITOR_CRON || '30 4 * * *';
const CRON_TIMEZONE = 'UTC';
const JOB_NAME = 'oxsteed-credit-dispute-monitor';

async function recordLockFailure(error) {
  try {
    return await incidentStore.recordIncident({
      type: 'oxsteed_credit_dispute_monitor_lock_failed',
      severity: 'critical',
      message: 'OxSteed Credit dispute monitor could not acquire its distributed lock',
      dedupeKey: 'oxsteed-credit-dispute-monitor:lock-failed',
      details: { error: error.message },
    });
  } catch (incidentError) {
    logger.error('OxSteed Credit dispute monitor lock failure incident could not be persisted', { error: incidentError.message });
    return null;
  }
}

async function runOxsteedCreditDisputeMonitor({ now = new Date(), getPool = null } = {}) {
  // Fail-open on the rail toggle: checked before the lock so an off rail
  // never contends or records heartbeats.
  const poolToUse = getPool || pool;
  if (!(await isCreditRailEnabled(poolToUse))) {
    logger.info('OxSteed Credit dispute monitor skipped: credit rail disabled');
    return { locked: false, skipped: 'rail_disabled' };
  }
  let locked = false;
  let outcome = null;
  try {
    await withFencedJobLock(JOB_NAME, async (fence) => {
      fence.assertActive(); // E03: abort the run if the job lease was lost
      locked = true;
      outcome = await checkDisputeSla({ now });
    }, 300, { throwOnLockError: true });
  } catch (error) {
    const incident = await recordLockFailure(error);
    logger.error('OxSteed Credit dispute monitor lock acquisition failed', { error: error.message });
    const failure = {
      locked,
      error: error.message,
      incidents: incident ? [incident] : [],
    };
    if (locked) await recordOxsteedCreditWorkerRun({ jobName: JOB_NAME, error });
    return failure;
  }
  const result = { locked, sla: outcome || null };
  if (locked) {
    const breached = Number(result.sla?.breachedCount || 0);
    await recordOxsteedCreditWorkerRun({
      jobName: JOB_NAME,
      result: { slaBreached: breached },
      error: null,
    });
  }
  return result;
}

function startOxsteedCreditDisputeMonitorJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runOxsteedCreditDisputeMonitor().catch((error) => {
      logger.error('OxSteed Credit dispute monitor worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('OxSteed Credit dispute monitor job scheduled', {
    cron: CRON_EXPRESSION,
    timezone: CRON_TIMEZONE,
  });
}

module.exports = {
  CRON_EXPRESSION,
  CRON_TIMEZONE,
  JOB_NAME,
  runOxsteedCreditDisputeMonitor,
  startOxsteedCreditDisputeMonitorJob,
};
