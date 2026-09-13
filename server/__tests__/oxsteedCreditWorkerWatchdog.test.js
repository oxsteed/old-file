'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ persisted: true, incident: { id: 'incident-1' } }),
  resolveOpenIncidentsByDedupeKeys: jest.fn().mockResolvedValue([]),
}));
jest.mock('../jobs/jobLockingService', () => ({
  withJobLock: jest.fn(async (_jobName, handler) => handler()),
}));

const db = require('../db');
const { recordIncident, resolveOpenIncidentsByDedupeKeys } = require('../services/incidentStore');
const { withJobLock } = require('../jobs/jobLockingService');
const {
  CRON_EXPRESSION,
  JOB_NAME,
  NOTIFICATION_WORKER_NAME,
  STALE_AFTER_MINUTES,
  NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES,
  NOTIFICATION_BACKLOG_DEDUPE_KEY,
  WORKER_CONFIG,
  checkNotificationWorker,
  checkAllWorkers,
  checkNotificationBacklog,
  runOxsteedCreditWorkerWatchdog,
} = require('../jobs/oxsteedCreditWorkerWatchdog');

beforeEach(() => jest.clearAllMocks());

test('does not alert before the notification worker has completed once', async () => {
  db.query.mockResolvedValueOnce({ rows: [] });

  await expect(checkNotificationWorker()).resolves.toEqual({ status: 'awaiting_first_run', heartbeat: null });
  expect(recordIncident).not.toHaveBeenCalled();
});

test('records one deduplicated incident when the notification worker is stale', async () => {
  db.query.mockResolvedValueOnce({ rows: [{
    job_name: NOTIFICATION_WORKER_NAME,
    last_run_at: '2026-09-12T12:00:00.000Z',
    last_success_at: '2026-09-12T12:00:00.000Z',
    last_error: null,
    run_count: 4,
    consecutive_failures: 0,
    stale: true,
  }] });

  await expect(checkNotificationWorker()).resolves.toMatchObject({ status: 'stale' });
  expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'oxsteed_credit_worker_stale',
    severity: 'critical',
    dedupeKey: `oxsteed-credit-worker:${NOTIFICATION_WORKER_NAME}:stale`,
  }));
});

test('alerts when a worker reports a recent failed run', async () => {
  db.query.mockResolvedValueOnce({ rows: [{
    job_name: NOTIFICATION_WORKER_NAME,
    last_run_at: '2026-09-13T12:00:00.000Z',
    last_success_at: '2026-09-13T11:59:00.000Z',
    last_error: 'provider unavailable',
    run_count: 4,
    consecutive_failures: 1,
    stale: false,
  }] });

  await expect(checkNotificationWorker()).resolves.toMatchObject({ status: 'failed' });
  expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'oxsteed_credit_worker_failed',
    severity: 'critical',
    dedupeKey: `oxsteed-credit-worker:${NOTIFICATION_WORKER_NAME}:failed`,
  }));
});

test('records one deduplicated incident when the notification backlog is stale', async () => {
  db.query.mockResolvedValueOnce({ rows: [{
    active_count: 2,
    oldest_active_at: new Date(Date.now() - (NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES + 1) * 60000).toISOString(),
  }] });

  await expect(checkNotificationBacklog()).resolves.toMatchObject({ status: 'stale', activeCount: 2 });
  expect(db.query.mock.calls[0][0]).toContain('next_attempt_at <= NOW()');
  expect(db.query.mock.calls[0][0]).toContain('locked_at < NOW() - INTERVAL');
  expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'oxsteed_credit_notification_backlog_stale',
    severity: 'critical',
    dedupeKey: NOTIFICATION_BACKLOG_DEDUPE_KEY,
  }));
});

test('runs the watchdog under its distributed lock', async () => {
  for (const worker of WORKER_CONFIG) {
    db.query.mockResolvedValueOnce({ rows: [{
      job_name: worker.jobName,
      last_run_at: '2026-09-13T12:00:00.000Z',
      last_success_at: '2026-09-13T12:00:00.000Z',
      last_error: null,
      run_count: 4,
      consecutive_failures: 0,
      stale: false,
    }] });
  }
  db.query.mockResolvedValueOnce({ rows: [{ active_count: 0, oldest_active_at: null }] });

  await expect(runOxsteedCreditWorkerWatchdog()).resolves.toMatchObject({
    locked: true,
    status: 'healthy',
    notificationBacklog: expect.objectContaining({ status: 'healthy', activeCount: 0 }),
    workers: expect.arrayContaining([
      expect.objectContaining({ status: 'healthy', heartbeat: expect.objectContaining({ job_name: NOTIFICATION_WORKER_NAME }) }),
    ]),
  });
  expect(withJobLock).toHaveBeenCalledWith(JOB_NAME, expect.any(Function), 120, { throwOnLockError: true });
  expect(resolveOpenIncidentsByDedupeKeys).toHaveBeenCalledWith(expect.arrayContaining([
    `oxsteed-credit-worker:${NOTIFICATION_WORKER_NAME}:stale`,
    `oxsteed-credit-worker:${NOTIFICATION_WORKER_NAME}:failed`,
    NOTIFICATION_BACKLOG_DEDUPE_KEY,
  ]), expect.any(String));
  expect(CRON_EXPRESSION).toBe('*/5 * * * *');
  expect(STALE_AFTER_MINUTES).toBe(10);
});

test('checks every Credit maintenance worker with its configured stale window', async () => {
  db.query.mockResolvedValue({ rows: [] });

  await expect(checkAllWorkers()).resolves.toHaveLength(WORKER_CONFIG.length);
  expect(db.query).toHaveBeenCalledTimes(WORKER_CONFIG.length);
  for (const worker of WORKER_CONFIG) {
    expect(db.query).toHaveBeenCalledWith(expect.any(String), [worker.jobName, worker.staleAfterMinutes]);
  }
});
