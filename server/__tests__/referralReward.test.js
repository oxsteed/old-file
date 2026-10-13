'use strict';

// Review P2-570: one referral reward per referred user.
const { mockQuery, resetMocks } = require('./setup');
const { grantReferralReward } = require('../controllers/referralController');

beforeEach(() => resetMocks());

test('first grant posts the reward and counts the conversion', async () => {
  mockQuery.mockImplementation(async (sql) => (/INSERT INTO platform_ledger/.test(sql) ? { rows: [{ id: 1 }] } : { rows: [] }));
  await expect(grantReferralReward('ref', 'new')).resolves.toBe(true);
  const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO platform_ledger/.test(sql));
  expect(insert[1]).toContain('referral:referrer:new');
  expect(mockQuery.mock.calls.some(([sql]) => /referral_conversions_count/.test(sql))).toBe(true);
});

test('a second grant (first-job value event) does not pay or count again', async () => {
  mockQuery.mockImplementation(async (sql) => (/INSERT INTO platform_ledger/.test(sql) ? { rows: [] } : { rows: [] }));
  await expect(grantReferralReward('ref', 'new')).resolves.toBe(false);
  expect(mockQuery.mock.calls.some(([sql]) => /referral_conversions_count/.test(sql))).toBe(false);
});
