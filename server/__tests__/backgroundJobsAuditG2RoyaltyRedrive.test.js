'use strict';

// Background-jobs audit #45 (Group 2): the franchise royalty
// re-drive job runs fenced, through the fence's handle, so a worker
// that lost its lease cannot keep accruing. All mocked: no real
// database, no real lock service.

jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn(),
}));
jest.mock('../services/franchiseRoyaltyService', () => ({
  retryFailedRoyalties: jest.fn(async () => ({ attempted: 2, resolved: 2, failed: 0, errors: [] })),
}));

const { withFencedJobLock } = require('../jobs/jobLockingService');
const { retryFailedRoyalties } = require('../services/franchiseRoyaltyService');
const pool = require('../db');
const { runFranchiseRoyaltyRedriveJob } = require('../jobs/franchiseRoyaltyRedriveJob');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Background-jobs audit #45: royalty re-drive runs on fence.db', () => {
  test('the redrive routes through the fence handle, never the raw pool', async () => {
    const fakeFenceDb = { query: jest.fn(async () => ({ rows: [] })) };
    const fakeFence = { assertActive: jest.fn(), db: fakeFenceDb };
    withFencedJobLock.mockImplementation(async (_name, handler) => {
      await handler(fakeFence);
      return { completed: true };
    });
    const result = await runFranchiseRoyaltyRedriveJob(pool);
    expect(result).toMatchObject({ locked: true, attempted: 2, resolved: 2 });
    expect(retryFailedRoyalties).toHaveBeenCalledTimes(1);
    expect(retryFailedRoyalties).toHaveBeenCalledWith(fakeFenceDb);
  });

  test('a lost lease refuses the redrive before any retry lands', async () => {
    const { LeaseLostError } = jest.requireActual('../jobs/jobLockingService');
    withFencedJobLock.mockRejectedValue(new LeaseLostError('franchise-royalty-redrive'));
    await expect(runFranchiseRoyaltyRedriveJob(pool)).rejects.toThrow('lease lost');
    expect(retryFailedRoyalties).not.toHaveBeenCalled();
  });
});
