'use strict';

// Design-review fix, item 50 (punch closeout job): the sweep runs
// hourly instead of nightly at 03:15, a throwing sweep is retried
// once after a short delay, and a final failure best-effort alerts
// the managers of businesses with stale open punches. All mocked:
// no real database, no real lock service (withFencedJobLock is a
// jest.fn; the LeaseLostError class is the real one via
// requireActual, so the #48 lock-failure match is tested against the
// class the job itself matches on).

jest.mock('../jobs/jobLockingService', () => {
  const actual = jest.requireActual('../jobs/jobLockingService');
  return { ...actual, withFencedJobLock: jest.fn() };
});
jest.mock('../services/restaurantPunchCloseout', () => ({
  closeStalePunches: jest.fn(),
  notifyCloseoutFailure: jest.fn(),
}));

const { withFencedJobLock, LeaseLostError } = require('../jobs/jobLockingService');
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

let fakeFence;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: the fence runs the handler immediately, handing it a
  // fence whose db handle is distinct from the raw pool.
  fakeFence = {
    assertActive: jest.fn(),
    db: { query: jest.fn(async () => ({ rows: [] })) },
  };
  withFencedJobLock.mockImplementation(async (_name, handler) => {
    await handler(fakeFence);
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
    // Background-jobs audit #43: the sweep runs on the fence's handle,
    // with the fence itself, never on the raw pool passed to the job.
    expect(closeStalePunches).toHaveBeenCalledWith(
      expect.objectContaining({ db: fakeFence.db, fence: fakeFence }),
    );
    expect(notifyCloseoutFailure).not.toHaveBeenCalled();
  });

  test('a throwing sweep is retried once and succeeds on the retry', async () => {
    withFencedJobLock
      .mockRejectedValueOnce(new Error('connection dropped'))
      .mockImplementationOnce(async (_name, handler) => {
        await handler(fakeFence);
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

describe('Background-jobs audit #48: lock failures never alert managers', () => {
  test('a lease lost mid-run (LeaseLostError) sends no failure alert and is not retried', async () => {
    withFencedJobLock.mockRejectedValue(new LeaseLostError('restaurant-punch-closeout'));
    const result = await job.runRestaurantPunchCloseoutJob(pool, { retryDelayMs: 0 });
    // A fenced run is a normal outcome, not a failure: another process
    // may be running the sweep fine, so there is no alarm and no
    // retry (the next hourly tick picks up anything left open).
    expect(result).toEqual({ locked: false, fenced: true });
    expect(withFencedJobLock).toHaveBeenCalledTimes(1);
    expect(closeStalePunches).not.toHaveBeenCalled();
    expect(notifyCloseoutFailure).not.toHaveBeenCalled();
  });

  test('a lock-acquisition failure sends no failure alert, but is still retried once and rethrown', async () => {
    // The lock store failed (Oct 30 item 30(d) JobLockAcquisitionError,
    // code LOCK_ACQUISITION_ERROR): the sweep never ran and the lock
    // state is unknown, so alerting managers would be a false alarm.
    // Matched by code here, exactly as the job matches it, so the test
    // does not depend on the error class existing in the module.
    const acquisitionError = new Error(
      'Job lock acquisition failed for "restaurant-punch-closeout": connection refused'
    );
    acquisitionError.code = 'LOCK_ACQUISITION_ERROR';
    withFencedJobLock.mockRejectedValue(acquisitionError);
    await expect(job.runRestaurantPunchCloseoutJob(pool, { retryDelayMs: 0 }))
      .rejects.toThrow('Job lock acquisition failed');
    // One retry for the transient store blip, then the error is the
    // record (rethrown so the cron wrapper logs it) — but managers
    // are never alerted.
    expect(withFencedJobLock).toHaveBeenCalledTimes(2);
    expect(notifyCloseoutFailure).not.toHaveBeenCalled();
  });

  test('a skipped run (lock already held) sends no failure alert', async () => {
    withFencedJobLock.mockResolvedValue({ skipped: true, lockSkipped: true });
    const result = await job.runRestaurantPunchCloseoutJob(pool, { retryDelayMs: 0 });
    expect(result).toEqual({ locked: false, skipped: true });
    expect(withFencedJobLock).toHaveBeenCalledTimes(1);
    expect(closeStalePunches).not.toHaveBeenCalled();
    expect(notifyCloseoutFailure).not.toHaveBeenCalled();
  });

  test('a fenced outcome (lease lost mid-run) sends no failure alert', async () => {
    withFencedJobLock.mockResolvedValue({ fenced: true });
    const result = await job.runRestaurantPunchCloseoutJob(pool, { retryDelayMs: 0 });
    expect(result).toEqual({ locked: false, fenced: true });
    expect(withFencedJobLock).toHaveBeenCalledTimes(1);
    expect(notifyCloseoutFailure).not.toHaveBeenCalled();
  });

  test('a non-lock failure still alerts managers (contrast case)', async () => {
    // A plain database error that merely mentions a lock is NOT a
    // lock failure: the match is on the error class/code, never on
    // the message text, so this must still alert.
    withFencedJobLock.mockRejectedValue(new Error('database down: lock table unavailable'));
    await expect(job.runRestaurantPunchCloseoutJob(pool, { retryDelayMs: 0 }))
      .rejects.toThrow('database down');
    expect(withFencedJobLock).toHaveBeenCalledTimes(2);
    expect(notifyCloseoutFailure).toHaveBeenCalledTimes(1);
  });
});
