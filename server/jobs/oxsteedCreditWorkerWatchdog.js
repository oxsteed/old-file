'use strict';

const cron = require('node-cron');
const db = require('../db');
const logger = require('../utils/logger');
const incidentStore = require('../services/incidentStore');
const { withJobLock } = require('./jobLockingService');

const CRON_EXPRESSION = '*/5 * * * *';
const JOB_NAME = 'oxsteed-credit-worker-watchdog';
const NOTIFICATION_WORKER_NAME = 'oxsteed-credit-notification-outbox';
const HOLD_EXPIRY_WORKER_NAME = 'oxsteed-credit-hold-expiry';
const ENTITLEMENT_EXPIRY_WORKER_NAME = 'oxsteed-credit-entitlement-expiry';
const RECONCILIATION_WORKER_NAME = 'oxsteed-credit-reconciliation';
const INTEGRITY_WORKER_NAME = 'oxsteed-credit-integrity';
const STALE_AFTER_MINUTES = 10;
const DAILY_WORKER_STALE_AFTER_MINUTES = 48 * 60;

const WORKER_CONFIG = Object.freeze([
  { jobName: NOTIFICATION_WORKER_NAME, label: 'notification worker', staleAfterMinutes: STALE_AFTER_MINUTES },
  { jobName: HOLD_EXPIRY_WORKER_NAME, label: 'hold expiry worker', staleAfterMinutes: STALE_AFTER_MINUTES },
  { jobName: ENTITLEMENT_EXPIRY_WORKER_NAME, label: 'entitlement expiry worker', staleAfterMinutes: STALE_AFTER_MINUTES },
  { jobName: RECONCILIATION_WORKER_NAME, label: 'reconciliation worker', staleAfterMinutes: DAILY_WORKER_STALE_AFTER_MINUTES },
  { jobName: INTEGRITY_WORKER_NAME, label: 'integrity worker', staleAfterMinutes: DAILY_WORKER_STALE_AFTER_MINUTES },
]);

async function checkWorker({ jobName, label, staleAfterMinutes }) {
  const result = await db.query(
    `SELECT job_name, last_run_at, last_success_at, last_error,
            run_count, consecutive_failures,
            last_run_at IS NOT NULL
              AND last_run_at < NOW() - ($2::integer * INTERVAL '1 minute') AS stale
       FROM oxsteed_credit_worker_heartbeats
      WHERE job_name = $1`,
    [jobName, staleAfterMinutes],
  );
  const heartbeat = result.rows[0] || null;
  if (!heartbeat?.last_run_at) {
    return { status: 'awaiting_first_run', heartbeat };
  }
  if (heartbeat.stale) {
    const incident = await incidentStore.recordIncident({
      type: 'oxsteed_credit_worker_stale',
      severity: 'critical',
      message: `OxSteed Credit ${label} has not completed recently`,
      dedupeKey: `oxsteed-credit-worker:${jobName}:stale`,
      details: {
        jobName,
        lastRunAt: heartbeat.last_run_at,
        lastSuccessAt: heartbeat.last_success_at,
        consecutiveFailures: Number(heartbeat.consecutive_failures || 0),
        staleAfterMinutes,
      },
    });
    return { status: 'stale', heartbeat, incident };
  }
  return { status: 'healthy', heartbeat };
}

async function checkNotificationWorker() {
  return checkWorker(WORKER_CONFIG[0]);
}

async function checkAllWorkers() {
  return Promise.all(WORKER_CONFIG.map((worker) => checkWorker(worker)));
}

async function runOxsteedCreditWorkerWatchdog() {
  let locked = false;
  let result = { status: 'skipped', heartbeat: null, incident: null, incidents: [], workers: [] };
  try {
    await withJobLock(JOB_NAME, async () => {
      locked = true;
      const workers = await checkAllWorkers();
      const notificationWorker = workers[0] || { heartbeat: null, incident: null };
      const incidents = workers.flatMap((worker) => worker.incident ? [worker.incident] : []);
      const status = workers.some((worker) => worker.status === 'stale')
        ? 'stale'
        : workers.some((worker) => worker.status === 'awaiting_first_run')
          ? 'awaiting_first_run'
          : 'healthy';
      result = {
        status,
        heartbeat: notificationWorker.heartbeat,
        incident: notificationWorker.incident || null,
        incidents,
        workers,
      };
      if (status !== 'healthy') logger.warn('OxSteed Credit worker watchdog detected attention state', result);
    }, 120, { throwOnLockError: true });
  } catch (error) {
    const incident = await incidentStore.recordIncident({
      type: 'oxsteed_credit_worker_watchdog_failed',
      severity: 'critical',
      message: 'OxSteed Credit worker watchdog could not complete',
      dedupeKey: `oxsteed-credit-worker-watchdog:all:failed`,
      details: { error: error.message, workers: WORKER_CONFIG.map(({ jobName }) => jobName) },
    });
    logger.error('OxSteed Credit worker watchdog failed', { error: error.message });
    result = { status: 'error', heartbeat: null, incident, incidents: [incident], workers: [] };
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
    monitoredWorkers: WORKER_CONFIG.map(({ jobName, staleAfterMinutes }) => ({ jobName, staleAfterMinutes })),
  });
}

module.exports = {
  CRON_EXPRESSION,
  JOB_NAME,
  NOTIFICATION_WORKER_NAME,
  HOLD_EXPIRY_WORKER_NAME,
  ENTITLEMENT_EXPIRY_WORKER_NAME,
  RECONCILIATION_WORKER_NAME,
  INTEGRITY_WORKER_NAME,
  STALE_AFTER_MINUTES,
  DAILY_WORKER_STALE_AFTER_MINUTES,
  WORKER_CONFIG,
  checkWorker,
  checkNotificationWorker,
  checkAllWorkers,
  runOxsteedCreditWorkerWatchdog,
  startOxsteedCreditWorkerWatchdog,
};
