'use strict';

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../jobs/jobLockingService', () => {
  // E03: fenced lock mock. The fence is healthy by default; db calls pass
  // through to the (mocked) db module so job logic is exercised.
  const fence = {
    isActive: () => true,
    assertActive: () => {},
    db: {
      query: (...args) => require('../db').query(...args),
      tx: (work) => work({ query: (...args) => require('../db').query(...args) }),
    },
    fencedQuery: (...args) => require('../db').query(...args),
    fencedTransaction: (work) => work({ query: (...args) => require('../db').query(...args) }),
  };
  return {
    withJobLock: jest.fn(async (_jobName, handler) => handler(fence)),
    withFencedJobLock: jest.fn(async (_jobName, handler) => handler(fence)),
    LeaseLostError: class LeaseLostError extends Error {},
  };
});
jest.mock('../services/directSlotEngine', () => ({
  expireHolds: jest.fn(),
  HOLD_TTL_MS: 4 * 60 * 1000,
}));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const cron = require('node-cron');
const { withFencedJobLock } = require('../jobs/jobLockingService');
const { expireHolds, HOLD_TTL_MS } = require('../services/directSlotEngine');
const {
  CRON_EXPRESSION,
  JOB_NAME,
  runDirectSlotHoldExpiry,
  startDirectSlotHoldExpiryJob,
} = require('../jobs/directSlotHoldExpiry');

beforeEach(() => {
  jest.clearAllMocks();
});

test('runs every minute at :55 under a durable job lock', async () => {
  expireHolds.mockResolvedValueOnce({ count: 2, ids: ['a', 'b'] });

  await expect(runDirectSlotHoldExpiry({ limit: 25 })).resolves.toEqual({
    count: 2,
    ids: ['a', 'b'],
  });
  expect(withFencedJobLock).toHaveBeenCalledWith(JOB_NAME, expect.any(Function), 120, {
    throwOnLockError: true,
  });
  expect(expireHolds).toHaveBeenCalledWith(expect.anything(), { limit: 25 });
  expect(CRON_EXPRESSION).toBe('55 * * * * *');
  expect(HOLD_TTL_MS).toBe(4 * 60 * 1000);
});

test('returns skipped when another worker owns the lock', async () => {
  withFencedJobLock.mockImplementationOnce(async () => {});

  await expect(runDirectSlotHoldExpiry()).resolves.toEqual({ count: 0, skipped: true });
  expect(expireHolds).not.toHaveBeenCalled();
});

test('startDirectSlotHoldExpiryJob registers the cron callback', () => {
  startDirectSlotHoldExpiryJob();
  expect(cron.schedule).toHaveBeenCalledWith(CRON_EXPRESSION, expect.any(Function));
});
