'use strict';

// Design-review fix, item 50 (punch closeout job): the sweep runs
// hourly instead of nightly at 03:15, a throwing sweep is retried
// once after a short delay, and a final failure best-effort alerts
// the managers of businesses with stale open punches. All mocked:
// no real database, no real lock service.

jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn(),
}));
jest.mock('../services/restaurantPunchCloseout', () => ({
  closeStalePunches: jest.fn(),
  notifyCloseoutFailure: jest.fn(),
}));

const { withFencedJobLock } = require('../jobs/jobLockingService');
const { closeStalePunches, notifyCloseoutFailure } = require('../services/restaurantPunchCloseout');
const pool = require('../db');
const job = require('../jobs/restaurantPunchCloseoutJob');

const SWEEP_RESULT = {
  closed: [{ entryId: 11 }],
  notified: 1,
  notifyErrors: 0,
  missing: [{ shiftId: 21 }],
  missingNotified: 1,
  missingNotifyErrors: 0,
  errors: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: the fence runs the handler immediately.
  withFencedJobLock.mockImplementation(async (_name, handler) => {
    await handler({ assertActive: jest.fn() });
    return { completed: true };
  });
  closeStalePunches.mockResolvedValue(SWEEP_RESULT);
  notifyCloseoutFailure.mockResolvedValue({ alerted: 2, alertErrors: 0, businesses: [42] });
});

describe('Item 50: punch closeout job', () => {
  test('the cron is hourly, not nightly at 03:15', () => {
    expect(job.cronExpression).toBe('0 0 * * * *');
    expect(job.cronExpression).not.toBe('0 15 3 * * *');
  });

  test('a successful sweep runs once and never alerts', async () => {
    const result = await job.runRestaurantPunchCloseoutJob(pool, { retryDelayMs: 0 });
    expect(result).toMatchObject({ locked: true, closed: 1, missing: 1, missingNotified: 1 });
    expect(withFencedJobLock).toHaveBeenCalledTimes(1);
    expect(closeStalePunches).toHaveBeenCalledTimes(1);
    expect(notifyCloseoutFailure).not.toHaveBeenCalled();
  });

  test('a throwing sweep is retried once and succeeds on the retry', async () => {
    withFencedJobLock
      .mockRejectedValueOnce(new Error('connection dropped'))
      .mockImplementationOnce(async (_name, handler) => {
        await handler({ assertActive: jest.fn() });
        return { completed: true };
      });
    const result = await job.runRestaurantPunchCloseoutJob(pool, { retryDelayMs: 0 });
    expect(result).toMatchObject({ locked: true, closed: 1 });
    expect(withFencedJobLock).toHaveBeenCalledTimes(2);
    expect(closeStalePunches).toHaveBeenCalledTimes(1);
    expect(notifyCloseoutFailure).not.toHaveBeenCalled();
  });

  test('a final failure alerts managers and rethrows', async () => {
    withFencedJobLock.mockRejectedValue(new Error('database down'));
    await expect(job.runRestaurantPunchCloseoutJob(pool, { retryDelayMs: 0 }))
      .rejects.toThrow('database down');
    expect(withFencedJobLock).toHaveBeenCalledTimes(2);
    expect(closeStalePunches).not.toHaveBeenCalled();
    expect(notifyCloseoutFailure).toHaveBeenCalledTimes(1);
    expect(notifyCloseoutFailure).toHaveBeenCalledWith(pool);
  });

  test('sweep maps the missing-punch counts through', async () => {
    const result = await job.sweep(pool);
    expect(result).toEqual({
      closed: 1, notified: 1, notifyErrors: 0,
      missing: 1, missingNotified: 1, missingNotifyErrors: 0, errors: 0,
    });
  });
});
