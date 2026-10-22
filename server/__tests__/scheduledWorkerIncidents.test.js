'use strict';

// Background-jobs audit (finding J1): a failing scheduled-fleet worker was
// invisible (one log line, no heartbeat). runScheduledWorkerOnce now
// records an incident via incidentStore on non-skipped failure.
jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn(async (_name, fn) => fn()),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ persisted: true }),
}));
jest.mock('../utils/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

const { withFencedJobLock } = require('../jobs/jobLockingService');
const incidentStore = require('../services/incidentStore');
const { runScheduledWorkerOnce } = require('../workers/scheduledWorkerSchedule');

beforeEach(() => {
  jest.clearAllMocks();
  withFencedJobLock.mockImplementation(async (_name, fn) => fn());
});

test('a failing fleet worker records an incident, not just a log line', async () => {
  const workerFn = jest.fn().mockRejectedValue(new Error('db down'));
  const result = await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}]);
  expect(result).toMatchObject({ failed: true, error: 'db down' });
  expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'scheduled_worker_failed',
    severity: 'critical',
    dedupeKey: 'scheduled-worker:demo-worker:failed',
  }));
  const details = incidentStore.recordIncident.mock.calls[0][0].details;
  expect(details.worker).toBe('demo-worker');
  expect(details.error).toContain('db down');
});

test('a skipped worker (lock held elsewhere) records no incident', async () => {
  withFencedJobLock.mockResolvedValueOnce({ skipped: true });
  const workerFn = jest.fn();
  const result = await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}]);
  expect(result).toMatchObject({ skipped: true });
  expect(workerFn).not.toHaveBeenCalled();
  expect(incidentStore.recordIncident).not.toHaveBeenCalled();
});

test('a successful worker records no incident', async () => {
  const workerFn = jest.fn().mockResolvedValue({ processed: 3 });
  const result = await runScheduledWorkerOnce(['demo-worker', workerFn, 60000, {}]);
  expect(result).toMatchObject({ processed: 3 });
  expect(incidentStore.recordIncident).not.toHaveBeenCalled();
});
