'use strict';

// P2-6-F11: the referral-reward-retry worker retried failed grants and
// resolves the reconciliation exception once the reward posts.

const { mockQuery, resetMocks } = require('./setup');

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../jobs/jobLockingService', () => {
  const fence = {
    isActive: () => true,
    assertActive: () => {},
    db: { query: (...args) => require('../db').query(...args) },
  };
  return {
    withFencedJobLock: jest.fn(async (_jobName, handler) => handler(fence)),
    LeaseLostError: class LeaseLostError extends Error {},
  };
});
jest.mock('../controllers/referralController', () => ({
  grantReferralReward: jest.fn(),
}));

const { grantReferralReward } = require('../controllers/referralController');
const { runReferralRewardRetry, JOB_NAME } = require('../jobs/referralRewardRetry');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

const exceptionRow = {
  id: 5,
  reference_id: 'referral-reward:new1',
  details: { referrer_id: 'ref1', new_user_id: 'new1', error: 'db blip' },
  severity: 'warning',
};

function queueScenario({ grantResult, ledgerPosted }) {
  grantReferralReward.mockResolvedValue(grantResult);
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM reconciliation_exceptions/.test(sql) && /WHERE domain = 'credit'/.test(sql)) {
      return { rows: [exceptionRow] };
    }
    if (/FROM platform_ledger WHERE idempotency_key/.test(sql)) {
      return { rows: ledgerPosted ? [{ id: 1 }] : [] };
    }
    return { rows: [], rowCount: 0 };
  });
}

test('resolves the exception when the retry grants the reward', async () => {
  queueScenario({ grantResult: true, ledgerPosted: true });
  const result = await runReferralRewardRetry();
  expect(result.granted).toBe(1);
  expect(grantReferralReward).toHaveBeenCalledWith('ref1', 'new1');
  const resolveCall = mockQuery.mock.calls.find(([sql]) =>
    /UPDATE reconciliation_exceptions/.test(sql) && /'resolved'/.test(sql));
  expect(resolveCall).toBeDefined();
  expect(resolveCall[1][0]).toBe(5);
});

test('resolves when the reward already posted (idempotent no-op), without double-granting', async () => {
  queueScenario({ grantResult: false, ledgerPosted: true });
  const result = await runReferralRewardRetry();
  expect(result.granted).toBe(1);
  expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO platform_ledger/.test(sql))).toHaveLength(0);
});

test('bumps attempts and keeps the exception open when the retry fails', async () => {
  queueScenario({ grantResult: false, ledgerPosted: false });
  const result = await runReferralRewardRetry();
  expect(result.failed).toBe(1);
  const bumpCall = mockQuery.mock.calls.find(([sql]) =>
    /UPDATE reconciliation_exceptions/.test(sql) && /retry_attempts/.test(sql));
  expect(bumpCall).toBeDefined();
  expect(bumpCall[1]).toEqual([5, 1, 10]);
});

test('uses the documented job name and cron schedule', async () => {
  expect(JOB_NAME).toBe('referral-reward-retry');
  const { CRON_EXPRESSION } = require('../jobs/referralRewardRetry');
  expect(CRON_EXPRESSION).toBe('*/5 * * * *');
});
