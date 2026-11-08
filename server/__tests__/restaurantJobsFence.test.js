'use strict';

// Background-jobs audit #43: the three new restaurant jobs asserted
// the fence once and then passed the raw pool into their sweep. The
// fenced run must route every write through fence.db instead, so a
// worker that lost its lease cannot keep writing. All mocked: no real
// database, no real lock service.
//
// The fake fence.db answers every select with zero rows, so both
// sweeps finish with nothing due and no downstream service is ever
// reached; the assertions are purely about which handle was queried.

jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn(),
}));

const { mockQuery, resetMocks } = require('./setup');
const { withFencedJobLock } = require('../jobs/jobLockingService');
const pool = require('../db');
const scheduledReportsJob = require('../jobs/restaurantScheduledReportsJob');
const retentionJob = require('../jobs/restaurantRetentionJob');

let fakeFence;
let fakeFenceDb;

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  fakeFenceDb = { query: jest.fn(async () => ({ rows: [] })) };
  fakeFence = { assertActive: jest.fn(), db: fakeFenceDb };
  withFencedJobLock.mockImplementation(async (_name, handler) => {
    await handler(fakeFence);
    return { completed: true };
  });
});

describe('Background-jobs audit #43: restaurant jobs run on fence.db', () => {
  test('scheduled reports run on the fence handle, never the raw pool', async () => {
    const result = await scheduledReportsJob.runRestaurantScheduledReportsJob(pool, {});
    expect(result).toMatchObject({ locked: true, due: 0, sent: 0 });
    expect(fakeFenceDb.query).toHaveBeenCalled();
    expect(fakeFenceDb.query.mock.calls[0][0]).toContain('FROM restaurant_scheduled_reports');
    // The raw pool the caller passed in was never queried.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('retention sweep runs on the fence handle, never the raw pool', async () => {
    const result = await retentionJob.runRestaurantRetentionJob(pool);
    expect(result).toMatchObject({
      locked: true, completedRequests: 0, autoAnonymized: 0, skipped: 0,
    });
    expect(fakeFenceDb.query).toHaveBeenCalled();
    expect(fakeFenceDb.query.mock.calls[0][0]).toContain('FROM restaurant_erasure_requests');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('a lost lease refuses the scheduled-reports sweep before any query lands', async () => {
    const { LeaseLostError } = jest.requireActual('../jobs/jobLockingService');
    fakeFenceDb.query.mockRejectedValue(new LeaseLostError('restaurant-scheduled-reports'));
    await expect(scheduledReportsJob.runRestaurantScheduledReportsJob(pool, {}))
      .rejects.toThrow('lease lost');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('a lost lease refuses the retention sweep before any query lands', async () => {
    const { LeaseLostError } = jest.requireActual('../jobs/jobLockingService');
    fakeFenceDb.query.mockRejectedValue(new LeaseLostError('restaurant-retention-sweep'));
    await expect(retentionJob.runRestaurantRetentionJob(pool))
      .rejects.toThrow('lease lost');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
