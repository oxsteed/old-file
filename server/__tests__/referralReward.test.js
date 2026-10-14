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
  // P3-11-F12: the grant writes an audit row attributed to the system actor.
  const auditInsert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO admin_audit_log/.test(sql));
  expect(auditInsert).toBeDefined();
  expect(auditInsert[1][0]).toBe('00000000-0000-0000-0000-000000000000');
  expect(auditInsert[1][1]).toBe('referral_reward_granted');
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

test('shared-IP farming pattern withholds the reward and records a visible exception (P2-6-F12)', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM platform_ledger/.test(sql) && /referral_credit/.test(sql)) return { rows: [{ count: 0 }] };
    if (/SELECT terms_acceptance_ip FROM users/.test(sql)) return { rows: [{ terms_acceptance_ip: '203.0.113.7' }] };
    if (/FROM users/.test(sql) && /referred_by/.test(sql)) return { rows: [{ count: 5 }] };
    if (/FROM reconciliation_exceptions/.test(sql)) return { rows: [] };
    if (/INSERT INTO reconciliation_exceptions/.test(sql)) return { rows: [{ id: 11 }] };
    return { rows: [], rowCount: 0 };
  });
  await expect(grantReferralReward('ref', 'new')).resolves.toBe(false);
  expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO platform_ledger/.test(sql))).toBe(false);
  const exCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO reconciliation_exceptions/.test(sql));
  expect(exCall).toBeDefined();
  expect(exCall[1][1]).toBe('referral-ip-farm:ref:new');
});

test('IP check fails open when the signup IP is missing (P2-6-F12)', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM platform_ledger/.test(sql) && /referral_credit/.test(sql)) return { rows: [{ count: 0 }] };
    if (/SELECT terms_acceptance_ip FROM users/.test(sql)) return { rows: [{ terms_acceptance_ip: null }] };
    if (/INSERT INTO platform_ledger/.test(sql)) return { rows: [{ id: 2 }] };
    return { rows: [], rowCount: 0 };
  });
  await expect(grantReferralReward('ref', 'new')).resolves.toBe(true);
  expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO platform_ledger/.test(sql))).toBe(true);
});

test('IP check passes below the per-IP weekly threshold (P2-6-F12)', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM platform_ledger/.test(sql) && /referral_credit/.test(sql)) return { rows: [{ count: 0 }] };
    if (/SELECT terms_acceptance_ip FROM users/.test(sql)) return { rows: [{ terms_acceptance_ip: '203.0.113.7' }] };
    if (/FROM users/.test(sql) && /referred_by/.test(sql)) return { rows: [{ count: 2 }] };
    if (/INSERT INTO platform_ledger/.test(sql)) return { rows: [{ id: 3 }] };
    return { rows: [], rowCount: 0 };
  });
  await expect(grantReferralReward('ref', 'new')).resolves.toBe(true);
});

test('shared-device farming pattern withholds the reward and records a visible exception (P2-6-F12 v7 residual)', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM platform_ledger/.test(sql) && /referral_credit/.test(sql)) return { rows: [{ count: 0 }] };
    if (/SELECT terms_acceptance_ip FROM users/.test(sql)) return { rows: [{ terms_acceptance_ip: '203.0.113.7' }] };
    if (/FROM users/.test(sql) && /referred_by/.test(sql) && /terms_acceptance_ip/.test(sql)) return { rows: [{ count: 0 }] };
    if (/SELECT signup_device_fingerprint FROM users/.test(sql)) return { rows: [{ signup_device_fingerprint: 'device-abc' }] };
    if (/FROM users/.test(sql) && /referred_by/.test(sql)) return { rows: [{ count: 5 }] };
    if (/FROM reconciliation_exceptions/.test(sql)) return { rows: [] };
    if (/INSERT INTO reconciliation_exceptions/.test(sql)) return { rows: [{ id: 12 }] };
    return { rows: [], rowCount: 0 };
  });
  await expect(grantReferralReward('ref', 'new')).resolves.toBe(false);
  expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO platform_ledger/.test(sql))).toBe(false);
  const exCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO reconciliation_exceptions/.test(sql));
  expect(exCall).toBeDefined();
  expect(exCall[1][1]).toBe('referral-device-farm:ref:new');
});

test('device check fails open when the fingerprint is missing (P2-6-F12 v7 residual)', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM platform_ledger/.test(sql) && /referral_credit/.test(sql) && !/DISTINCT/.test(sql)) return { rows: [{ count: 0 }] };
    if (/SELECT terms_acceptance_ip FROM users/.test(sql)) return { rows: [{ terms_acceptance_ip: '203.0.113.7' }] };
    if (/FROM users/.test(sql) && /referred_by/.test(sql)) return { rows: [{ count: 0 }] };
    if (/SELECT signup_device_fingerprint FROM users/.test(sql)) return { rows: [{ signup_device_fingerprint: null }] };
    if (/COUNT\(DISTINCT/.test(sql)) return { rows: [{ count: 0 }] };
    if (/INSERT INTO platform_ledger/.test(sql)) return { rows: [{ id: 4 }] };
    return { rows: [], rowCount: 0 };
  });
  await expect(grantReferralReward('ref', 'new')).resolves.toBe(true);
});

test('cross-referrer IP ring withholds the reward when the ring cap is hit (P2-6-F12 v7 residual)', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM platform_ledger/.test(sql) && /referral_credit/.test(sql) && !/DISTINCT/.test(sql)) return { rows: [{ count: 0 }] };
    if (/SELECT terms_acceptance_ip FROM users/.test(sql)) return { rows: [{ terms_acceptance_ip: '203.0.113.7' }] };
    if (/FROM users/.test(sql) && /referred_by/.test(sql)) return { rows: [{ count: 0 }] };
    if (/SELECT signup_device_fingerprint FROM users/.test(sql)) return { rows: [{ signup_device_fingerprint: null }] };
    if (/COUNT\(DISTINCT/.test(sql)) return { rows: [{ count: 5 }] };
    if (/FROM reconciliation_exceptions/.test(sql)) return { rows: [] };
    if (/INSERT INTO reconciliation_exceptions/.test(sql)) return { rows: [{ id: 13 }] };
    return { rows: [], rowCount: 0 };
  });
  await expect(grantReferralReward('ref', 'new')).resolves.toBe(false);
  expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO platform_ledger/.test(sql))).toBe(false);
  const exCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO reconciliation_exceptions/.test(sql));
  expect(exCall).toBeDefined();
  expect(exCall[1][1]).toBe('referral-ring-ip:new');
});
