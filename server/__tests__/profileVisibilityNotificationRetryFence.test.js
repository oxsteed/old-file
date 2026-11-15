'use strict';

/**
 * Notifications audit item 29 (this track's share): the
 * profile-visibility notification retry starter is called bare from
 * bootstrap/backgroundWorkers.js, so overlapping ticks on two replicas
 * can run the same retry sweep concurrently. Like the outbox jobs it
 * must run inside withFencedJobLock.
 */

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn(async (_name, fn) => fn({})),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));

const cron = require('node-cron');
const { withFencedJobLock } = require('../jobs/jobLockingService');
const { mockQuery, resetMocks } = require('./setup');
const { startProfileVisibilityNotificationRetryJob } = require('../jobs/profileVisibilityNotificationRetry');

beforeEach(() => {
  jest.clearAllMocks();
  resetMocks();
});

test('item 29: the retry tick runs inside the fenced job lock', async () => {
  // No pending rows: BEGIN, empty claim, COMMIT.
  mockQuery.mockResolvedValue({ rows: [] });

  startProfileVisibilityNotificationRetryJob();

  expect(cron.schedule).toHaveBeenCalledTimes(1);
  const tick = cron.schedule.mock.calls[0][1];
  await tick();

  expect(withFencedJobLock).toHaveBeenCalledTimes(1);
  expect(withFencedJobLock).toHaveBeenCalledWith(
    'profile-visibility-notification-retry',
    expect.any(Function)
  );
});
