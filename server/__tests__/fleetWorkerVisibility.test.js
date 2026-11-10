'use strict';

// Background-jobs audit #47 + Oct 30 items 30(b) and 30(d).
//
// Fenced aborts and skipped fleet runs were invisible (a warn log for the
// fence, no runner log line at all for a skip), there was no fleet
// heartbeat, and a lock-store failure read as contention. The runner now
// keeps per-worker in-memory run state (the fleet heartbeat), logs every
// lock skip with its streak, raises one deduped incident per worker on N
// consecutive lock skips and resolves it on recovery, and logs/counts
// lock-acquisition errors distinctly from contention.

jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn(async (_name, fn) => fn()),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ persisted: true }),
  resolveOpenIncidentsByDedupeKeys: jest.fn().mockResolvedValue([]),
}));
jest.mock('../utils/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

const { withFencedJobLock } = require('../jobs/jobLockingService');
const incidentStore = require('../services/incidentStore');
const {
  runScheduledWorkerOnce,
  getFleetWorkerHeartbeat,
  getFleetWorkerHeartbeats,
  resetFleetWorkerState,
  SKIPPED_STREAK_ALERT_THRESHOLD,
} = require('../workers/scheduledWorkerSchedule');

const log = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  resetFleetWorkerState();
  withFencedJobLock.mockImplementation(async (_name, fn) => fn());
});

function lockError(message = 'db down') {
  const err = new Error(message);
  err.name = 'JobLockAcquisitionError';
  err.code = 'LOCK_ACQUISITION_ERROR';
  return err;
}

test('a lock-skipped run logs a warn with the streak but raises no incident below the threshold', async () => {
  expect(SKIPPED_STREAK_ALERT_THRESHOLD).toBe(3);
  withFencedJobLock.mockResolvedValue({ skipped: true, lockSkipped: true });
  const workerFn = jest.fn();

  const first = await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}], { log });
  const second = await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}], { log });

  expect(first).toMatchObject({ skipped: true });
  expect(second).toMatchObject({ skipped: true });
  expect(workerFn).not.toHaveBeenCalled();
  expect(log.warn).toHaveBeenCalledWith(
    'Scheduled worker skipped (lock held by another instance)',
    expect.objectContaining({ worker: 'demo-worker', consecutiveSkips: 1 }),
  );
  expect(log.warn).toHaveBeenCalledWith(
    'Scheduled worker skipped (lock held by another instance)',
    expect.objectContaining({ worker: 'demo-worker', consecutiveSkips: 2 }),
  );
  expect(incidentStore.recordIncident).not.toHaveBeenCalled();
  expect(getFleetWorkerHeartbeat('demo-worker')).toMatchObject({
    consecutiveSkips: 2,
    lastOutcome: 'skipped',
  });
});

test('N consecutive lock skips raise one deduped skipped-streak incident, refreshed on later ticks', async () => {
  withFencedJobLock.mockResolvedValue({ skipped: true, lockSkipped: true });
  const workerFn = jest.fn();

  for (let i = 0; i < SKIPPED_STREAK_ALERT_THRESHOLD; i += 1) {
    await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}], { log });
  }

  expect(incidentStore.recordIncident).toHaveBeenCalledTimes(1);
  expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'scheduled_worker_skipped_streak',
    severity: 'warning',
    dedupeKey: 'scheduled-worker:demo-worker:skipped-streak',
  }));
  expect(incidentStore.recordIncident.mock.calls[0][0].details).toMatchObject({
    worker: 'demo-worker',
    consecutiveSkips: SKIPPED_STREAK_ALERT_THRESHOLD,
    intervalMs: 60000,
  });

  // A fourth consecutive skip refreshes the same open incident (same
  // dedupe key) instead of opening a second row.
  await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}], { log });
  expect(incidentStore.recordIncident).toHaveBeenCalledTimes(2);
  expect(incidentStore.recordIncident.mock.calls[1][0].dedupeKey)
    .toBe('scheduled-worker:demo-worker:skipped-streak');
});

test('a worker that runs again resolves the open skipped-streak incident', async () => {
  withFencedJobLock.mockResolvedValue({ skipped: true, lockSkipped: true });
  const workerFn = jest.fn().mockResolvedValue({ processed: 1 });
  for (let i = 0; i < SKIPPED_STREAK_ALERT_THRESHOLD; i += 1) {
    await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}], { log });
  }
  expect(incidentStore.recordIncident).toHaveBeenCalledTimes(1);

  withFencedJobLock.mockImplementation(async (_name, fn) => fn());
  const result = await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}], { log });

  expect(result).toMatchObject({ processed: 1 });
  expect(incidentStore.resolveOpenIncidentsByDedupeKeys).toHaveBeenCalledWith(
    ['scheduled-worker:demo-worker:skipped-streak'],
    expect.stringContaining('demo-worker'),
  );
  expect(getFleetWorkerHeartbeat('demo-worker')).toMatchObject({
    consecutiveSkips: 0,
    lastOutcome: 'completed',
  });
});

test('a worker-declared skip is not a lock skip and never trips the streak', async () => {
  // e.g. emailDigestWeekly on a non-Monday, or a growth job whose day is
  // already complete: the worker ran and chose to skip its own work.
  const workerFn = jest.fn().mockResolvedValue({ skipped: true, reason: 'not_monday' });
  for (let i = 0; i < SKIPPED_STREAK_ALERT_THRESHOLD + 1; i += 1) {
    await runScheduledWorkerOnce(['demo-worker', workerFn, 24 * 60 * 60 * 1000, {}], { log });
  }

  expect(workerFn).toHaveBeenCalledTimes(SKIPPED_STREAK_ALERT_THRESHOLD + 1);
  expect(incidentStore.recordIncident).not.toHaveBeenCalled();
  expect(getFleetWorkerHeartbeat('demo-worker')).toMatchObject({
    consecutiveSkips: 0,
    lastOutcome: 'completed',
  });
  expect(getFleetWorkerHeartbeat('demo-worker').lastSuccessAt).not.toBeNull();
});

test('a fenced run is recorded in the heartbeat and does not count as success', async () => {
  withFencedJobLock.mockResolvedValueOnce({ fenced: true });
  const workerFn = jest.fn();

  const result = await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}], { log });

  expect(result).toMatchObject({ fenced: true });
  expect(incidentStore.recordIncident).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'scheduled_worker_failed' }),
  );
  expect(getFleetWorkerHeartbeat('demo-worker')).toMatchObject({
    lastOutcome: 'fenced',
    lastSuccessAt: null,
  });

  // A later clean run marks success and resolves the fenced incident the
  // lock layer recorded (dedupe key scheduled-worker:<name>:fenced).
  withFencedJobLock.mockImplementation(async (_name, fn) => fn());
  workerFn.mockResolvedValue({ processed: 1 });
  await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}], { log });
  expect(incidentStore.resolveOpenIncidentsByDedupeKeys).toHaveBeenCalledWith(
    ['scheduled-worker:demo-worker:fenced'],
    expect.stringContaining('demo-worker'),
  );
  expect(getFleetWorkerHeartbeat('demo-worker')).toMatchObject({
    lastOutcome: 'completed',
    consecutiveSkips: 0,
  });
  expect(getFleetWorkerHeartbeat('demo-worker').lastSuccessAt).not.toBeNull();
});

test('a lock-acquisition error is logged and counted distinctly from contention', async () => {
  withFencedJobLock.mockRejectedValueOnce(lockError('connection refused'));
  const workerFn = jest.fn();

  const result = await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}], { log });

  expect(result).toMatchObject({ lockError: true, error: 'connection refused' });
  expect(workerFn).not.toHaveBeenCalled();
  expect(log.error).toHaveBeenCalledWith(
    'Scheduled worker lock acquisition failed',
    expect.objectContaining({ worker: 'demo-worker', error: 'connection refused' }),
  );
  expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'scheduled_worker_lock_error',
    severity: 'critical',
    dedupeKey: 'scheduled-worker:demo-worker:lock-error',
  }));
  expect(incidentStore.recordIncident).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'scheduled_worker_failed' }),
  );
  // A lock error is not contention: it must not inflate the skip streak.
  expect(getFleetWorkerHeartbeat('demo-worker')).toMatchObject({
    consecutiveSkips: 0,
    lastOutcome: 'lock-error',
  });
});

test('a lock-error summary outcome is counted distinctly too', async () => {
  withFencedJobLock.mockResolvedValueOnce({ skipped: true, lockError: true, error: 'db down' });
  const workerFn = jest.fn();

  const result = await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}], { log });

  expect(result).toMatchObject({ skipped: true, lockError: true });
  expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'scheduled_worker_lock_error',
    dedupeKey: 'scheduled-worker:demo-worker:lock-error',
  }));
  expect(getFleetWorkerHeartbeat('demo-worker')).toMatchObject({
    consecutiveSkips: 0,
    lastOutcome: 'lock-error',
  });
});

test('a lock error does not poison the skip streak, and recovery resolves it', async () => {
  withFencedJobLock.mockRejectedValueOnce(lockError('db down'));
  const workerFn = jest.fn().mockResolvedValue({ processed: 1 });
  await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}], { log });

  withFencedJobLock.mockImplementation(async (_name, fn) => fn());
  await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}], { log });

  expect(incidentStore.resolveOpenIncidentsByDedupeKeys).toHaveBeenCalledWith(
    ['scheduled-worker:demo-worker:lock-error'],
    expect.stringContaining('demo-worker'),
  );
});

test('the heartbeat snapshot exposes per-worker run state (30(b))', async () => {
  const workerFn = jest.fn().mockResolvedValue({ processed: 2 });
  await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}], { log });
  withFencedJobLock.mockResolvedValue({ skipped: true, lockSkipped: true });
  await runScheduledWorkerOnce(['other-worker', jest.fn(), 5 * 60 * 1000, {}], { log });

  const heartbeats = getFleetWorkerHeartbeats();
  expect(heartbeats).toHaveLength(2);
  expect(heartbeats.find((h) => h.worker === 'demo-worker')).toMatchObject({
    intervalMs: 60000,
    consecutiveSkips: 0,
    consecutiveFailures: 0,
    lastOutcome: 'completed',
  });
  expect(heartbeats.find((h) => h.worker === 'demo-worker').lastRunAt).not.toBeNull();
  expect(heartbeats.find((h) => h.worker === 'demo-worker').lastSuccessAt).not.toBeNull();
  expect(heartbeats.find((h) => h.worker === 'other-worker')).toMatchObject({
    intervalMs: 5 * 60 * 1000,
    consecutiveSkips: 1,
    lastOutcome: 'skipped',
    lastSuccessAt: null,
  });
});
