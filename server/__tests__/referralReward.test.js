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

test('a failed grant records a reconciliation exception for retry instead of failing silently (P2-6-F11)', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/INSERT INTO platform_ledger/.test(sql)) throw new Error('db blip');
    if (/FROM reconciliation_exceptions/.test(sql)) return { rows: [] };
    if (/INSERT INTO reconciliation_exceptions/.test(sql)) return { rows: [{ id: 9 }] };
    return { rows: [], rowCount: 0 };
  });
  // Never throws: callers fire-and-forget.
  await expect(grantReferralReward('ref', 'new')).resolves.toBe(false);
  const exCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO reconciliation_exceptions/.test(sql));
  expect(exCall).toBeDefined();
  expect(exCall[1][0]).toBe('credit');
  expect(exCall[1][1]).toBe('referral-reward:new');
});

test('self-referral never earns (P2-6-F12)', async () => {
  mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  await expect(grantReferralReward('same-user', 'same-user')).resolves.toBe(false);
  expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO platform_ledger/.test(sql))).toBe(false);
});

test('velocity cap withholds the reward and records a visible exception (P2-6-F12)', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM platform_ledger/.test(sql) && /referral_credit/.test(sql)) return { rows: [{ count: 10 }] };
    if (/FROM reconciliation_exceptions/.test(sql)) return { rows: [] };
    if (/INSERT INTO reconciliation_exceptions/.test(sql)) return { rows: [{ id: 10 }] };
    return { rows: [], rowCount: 0 };
  });
  await expect(grantReferralReward('ref', 'new')).resolves.toBe(false);
  // No reward posted...
  expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO platform_ledger/.test(sql))).toBe(false);
  // ...but the refusal is visible, not silent.
  const exCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO reconciliation_exceptions/.test(sql));
  expect(exCall).toBeDefined();
  expect(exCall[1][1]).toBe('referral-velocity:ref:new');
});
