'use strict';

const cron = require('node-cron');
const db = require('../db');
const logger = require('../utils/logger');
const incidentStore = require('../services/incidentStore');
const { withJobLock } = require('./jobLockingService');

const CRON_EXPRESSION = '*/5 * * * *';
const JOB_NAME = 'oxsteed-credit-worker-watchdog';
const NOTIFICATION_WORKER_NAME = 'oxsteed-credit-notification-outbox';
const STALE_AFTER_MINUTES = 10;

async function checkNotificationWorker() {
  const result = await db.query(
    `SELECT job_name, last_run_at, last_success_at, last_error,
            run_count, consecutive_failures,
            last_run_at IS NOT NULL
              AND last_run_at < NOW() - ($2::integer * INTERVAL '1 minute') AS stale
       FROM oxsteed_credit_worker_heartbeats
      WHERE job_name = $1`,
    [NOTIFICATION_WORKER_NAME, STALE_AFTER_MINUTES],
  );
  const heartbeat = result.rows[0] || null;
  if (!heartbeat?.last_run_at) {
    return { status: 'awaiting_first_run', heartbeat };
  }
  if (heartbeat.stale) {
    const incident = await incidentStore.recordIncident({
      type: 'oxsteed_credit_worker_stale',
      severity: 'critical',
      message: 'OxSteed Credit notification worker has not completed recently',
      dedupeKey: `oxsteed-credit-worker:${NOTIFICATION_WORKER_NAME}:stale`,
      details: {
        jobName: NOTIFICATION_WORKER_NAME,
        lastRunAt: heartbeat.last_run_at,
        lastSuccessAt: heartbeat.last_success_at,
        consecutiveFailures: Number(heartbeat.consecutive_failures || 0),
        staleAfterMinutes: STALE_AFTER_MINUTES,
      },
    });
    return { status: 'stale', heartbeat, incident };
  }
  return { status: 'healthy', heartbeat };
}

async function runOxsteedCreditWorkerWatchdog() {
  let locked = false;
  let result = { status: 'skipped', heartbeat: null, incident: null };
  try {
    await withJobLock(JOB_NAME, async () => {
      locked = true;
      result = await checkNotificationWorker();
      if (result.status !== 'healthy') logger.warn('OxSteed Credit worker watchdog detected attention state', result);
    }, 120, { throwOnLockError: true });
  } catch (error) {
    const incident = await incidentStore.recordIncident({
      type: 'oxsteed_credit_worker_watchdog_failed',
      severity: 'critical',
      message: 'OxSteed Credit worker watchdog could not complete',
      dedupeKey: `oxsteed-credit-worker-watchdog:${NOTIFICATION_WORKER_NAME}:failed`,
      details: { error: error.message, worker: NOTIFICATION_WORKER_NAME },
    });
    logger.error('OxSteed Credit worker watchdog failed', { error: error.message });
    result = { status: 'error', heartbeat: null, incident };
  }
  return { locked, ...result };
}

function startOxsteedCreditWorkerWatchdog() {
  cron.schedule(CRON_EXPRESSION, () => {
    runOxsteedCreditWorkerWatchdog().catch((error) => {
      logger.error('OxSteed Credit worker watchdog failed unexpectedly', { error: error.message });
    });
  });
  logger.info('OxSteed Credit worker watchdog scheduled', {
    cron: CRON_EXPRESSION,
    monitoredWorker: NOTIFICATION_WORKER_NAME,
    staleAfterMinutes: STALE_AFTER_MINUTES,
  });
}

module.exports = {
  CRON_EXPRESSION,
  JOB_NAME,
  NOTIFICATION_WORKER_NAME,
  STALE_AFTER_MINUTES,
  checkNotificationWorker,
  runOxsteedCreditWorkerWatchdog,
  startOxsteedCreditWorkerWatchdog,
};
