'use strict';

const cron = require('node-cron');
const db = require('../db');
const logger = require('../utils/logger');
const incidentStore = require('../services/incidentStore');
const { withFencedJobLock } = require('./jobLockingService');
const { skipCreditJobWhenRailDisabled } = require('../services/oxsteedCreditService');
const {
  NOTIFICATION_WORKER_NAME,
  HOLD_EXPIRY_WORKER_NAME,
  ENTITLEMENT_EXPIRY_WORKER_NAME,
  RECONCILIATION_WORKER_NAME,
  INTEGRITY_WORKER_NAME,
  STALE_AFTER_MINUTES,
  DAILY_WORKER_STALE_AFTER_MINUTES,
  NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES,
  WORKER_CONFIG,
} = require('../services/oxsteedCreditWorkerConfig');

const CRON_EXPRESSION = '50 */5 * * * *';
const JOB_NAME = 'oxsteed-credit-worker-watchdog';
const NOTIFICATION_BACKLOG_DEDUPE_KEY = 'oxsteed-credit-notifications:backlog-stale';

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
  if (heartbeat.last_error || Number(heartbeat.consecutive_failures || 0) > 0) {
    const incident = await incidentStore.recordIncident({
      type: 'oxsteed_credit_worker_failed',
      severity: 'critical',
      message: `OxSteed Credit ${label} reported a failure`,
      dedupeKey: `oxsteed-credit-worker:${jobName}:failed`,
      details: {
        jobName,
        lastRunAt: heartbeat.last_run_at,
        lastSuccessAt: heartbeat.last_success_at,
        lastError: heartbeat.last_error,
        consecutiveFailures: Number(heartbeat.consecutive_failures || 0),
        staleAfterMinutes,
      },
    });
    return { status: 'failed', heartbeat, incident };
  }
  return { status: 'healthy', heartbeat };
}

async function checkNotificationWorker() {
  return checkWorker(WORKER_CONFIG[0]);
}

async function checkAllWorkers() {
  return Promise.all(WORKER_CONFIG.map((worker) => checkWorker(worker)));
}

async function checkNotificationBacklog() {
  const result = await db.query(
    `SELECT COUNT(*) FILTER (
              WHERE (status = 'pending' AND next_attempt_at <= NOW())
              OR (status = 'sending' AND (locked_at IS NULL OR locked_at < NOW() - (${NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES} * INTERVAL '1 minute')))
            )::int AS active_count,
            MIN(created_at) FILTER (
              WHERE (status = 'pending' AND next_attempt_at <= NOW())
              OR (status = 'sending' AND (locked_at IS NULL OR locked_at < NOW() - (${NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES} * INTERVAL '1 minute')))
            ) AS oldest_active_at
       FROM oxsteed_credit_notification_outbox`,
  );
  const row = result.rows[0] || {};
  const activeCount = Number(row.active_count || 0);
  const oldestActiveAt = row.oldest_active_at || null;
  const oldestTimestamp = oldestActiveAt ? new Date(oldestActiveAt).getTime() : NaN;
  const ageMinutes = Number.isFinite(oldestTimestamp)
    ? Math.max(0, (Date.now() - oldestTimestamp) / 60000)
    : 0;
  if (oldestActiveAt && Number.isFinite(ageMinutes) && ageMinutes >= NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES) {
    const incident = await incidentStore.recordIncident({
      type: 'oxsteed_credit_notification_backlog_stale',
      severity: 'critical',
      message: 'OxSteed Credit notifications are waiting beyond the delivery threshold',
      dedupeKey: NOTIFICATION_BACKLOG_DEDUPE_KEY,
      details: {
        activeCount,
        oldestActiveAt,
        ageMinutes,
        staleAfterMinutes: NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES,
      },
    });
    return { status: 'stale', activeCount, oldestActiveAt, ageMinutes, incident };
  }
  return { status: 'healthy', activeCount, oldestActiveAt, ageMinutes, incident: null };
}

async function runOxsteedCreditWorkerWatchdog() {
  if (await skipCreditJobWhenRailDisabled(JOB_NAME)) {
    return { skipped: 'rail_disabled' };
  }
  let locked = false;
  let result = {
    status: 'skipped',
    heartbeat: null,
    incident: null,
    incidents: [],
    recoveredIncidents: [],
    workers: [],
    notificationBacklog: null,
  };
  try {
    await withFencedJobLock(JOB_NAME, async (fence) => {
      fence.assertActive(); // E03: abort the run if the job lease was lost
      locked = true;
      const workers = await checkAllWorkers();
      const notificationWorker = workers[0] || { heartbeat: null, incident: null };
      const notificationBacklog = await checkNotificationBacklog();
      const incidents = [
        ...workers.flatMap((worker) => worker.incident ? [worker.incident] : []),
        ...(notificationBacklog.incident ? [notificationBacklog.incident] : []),
      ];
      const status = notificationBacklog.status === 'stale'
        ? 'stale'
        : workers.some((worker) => worker.status === 'stale')
        ? 'stale'
        : workers.some((worker) => worker.status === 'failed')
          ? 'failed'
        : workers.some((worker) => worker.status === 'awaiting_first_run')
          ? 'awaiting_first_run'
          : 'healthy';
      const recoveredWorkerNames = workers
        .filter((worker) => worker.status === 'healthy')
        .map((worker) => worker.heartbeat?.job_name || worker.heartbeat?.jobName)
        .filter(Boolean);
      const recoveredIncidents = await incidentStore.resolveOpenIncidentsByDedupeKeys(
        [
          ...recoveredWorkerNames.flatMap((jobName) => [
            `oxsteed-credit-worker:${jobName}:stale`,
            `oxsteed-credit-worker:${jobName}:failed`,
          ]),
          ...(notificationBacklog.status === 'healthy' ? [NOTIFICATION_BACKLOG_DEDUPE_KEY] : []),
        ],
        'Auto-resolved after the Credit worker returned to a healthy checkpoint.',
      );
      result = {
        status,
        heartbeat: notificationWorker.heartbeat,
        incident: notificationWorker.incident || null,
        incidents,
        recoveredIncidents,
        workers,
        notificationBacklog,
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
    result = {
      status: 'error',
      heartbeat: null,
      incident,
      incidents: [incident],
      recoveredIncidents: [],
      workers: [],
      notificationBacklog: null,
    };
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
  NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES,
  NOTIFICATION_BACKLOG_DEDUPE_KEY,
  WORKER_CONFIG,
  checkWorker,
  checkNotificationWorker,
  checkAllWorkers,
  checkNotificationBacklog,
  runOxsteedCreditWorkerWatchdog,
  startOxsteedCreditWorkerWatchdog,
};
