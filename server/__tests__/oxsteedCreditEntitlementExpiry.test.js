'use strict';

jest.mock('../services/oxsteedCreditAdminService', () => ({
  expireCreditAgreements: jest.fn(),
  expireCreditEntitlements: jest.fn(),
}));
jest.mock('../jobs/jobLockingService', () => ({
  withJobLock: jest.fn(async (_jobName, handler) => handler()),
}));

const { expireCreditAgreements, expireCreditEntitlements } = require('../services/oxsteedCreditAdminService');
const { withJobLock } = require('../jobs/jobLockingService');
const {
  CRON_EXPRESSION,
  JOB_NAME,
  runOxsteedCreditEntitlementExpiry,
} = require('../jobs/oxsteedCreditEntitlementExpiry');

beforeEach(() => {
  jest.clearAllMocks();
});

test('expires ended entitlements under a durable job lock', async () => {
  expireCreditAgreements.mockResolvedValueOnce({ count: 1, expired: [{ id: 'agreement-1' }] });
  expireCreditEntitlements.mockResolvedValueOnce({ count: 2, expired: [{ id: 'entitlement-1' }, { id: 'entitlement-2' }] });

  await expect(runOxsteedCreditEntitlementExpiry({ limit: 25 })).resolves.toEqual({
    count: 3,
    agreements: [{ id: 'agreement-1' }],
    entitlements: [{ id: 'entitlement-1' }, { id: 'entitlement-2' }],
  });
  expect(withJobLock).toHaveBeenCalledWith(JOB_NAME, expect.any(Function), 120, { throwOnLockError: true });
  expect(expireCreditAgreements).toHaveBeenCalledWith({ limit: 25, now: undefined });
  expect(expireCreditEntitlements).toHaveBeenCalledWith({ limit: 25, now: undefined });
});

test('returns an empty result when another worker owns the lock', async () => {
  withJobLock.mockImplementationOnce(async () => {});

  await expect(runOxsteedCreditEntitlementExpiry()).resolves.toEqual({ count: 0, agreements: [], entitlements: [] });
  expect(expireCreditAgreements).not.toHaveBeenCalled();
  expect(expireCreditEntitlements).not.toHaveBeenCalled();
});

test('runs every minute', () => {
  expect(CRON_EXPRESSION).toBe('* * * * *');
});
