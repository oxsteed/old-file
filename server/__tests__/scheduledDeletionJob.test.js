'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { hardDeleteExpiredAccounts, cleanupExpiredSessionData, hardDeleteUser } = require('../jobs/scheduledDeletionJob');

beforeEach(resetMocks);

test('purges old read notifications with a bounded retention window', async () => {
  process.env.NOTIFICATION_RETENTION_DAYS = '120';
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

  await cleanupExpiredSessionData();

  const purge = mockQuery.mock.calls.find(([sql]) => String(sql).includes('DELETE FROM notifications'));
  expect(purge).toBeTruthy();
  expect(purge[1]).toEqual([120]);
  delete process.env.NOTIFICATION_RETENTION_DAYS;
});

test('anonymizes users with OxSteed Credit records instead of deleting financial identity', async () => {
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'customer@example.com',
    first_name: 'Customer',
    last_name: 'Example',
    deletion_scheduled_at: '2026-09-12T03:00:00.000Z',
  };
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('COUNT(*) OVER()')) return { rows: [user] };
    if (sql.includes('information_schema.tables')) return { rows: [{ exists: true }] };
    if (sql.includes('AS has_credit_records')) return { rows: [{ has_credit_records: true }] };
    return { rows: [], rowCount: 0 };
  });

  await hardDeleteExpiredAccounts();

  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM users'))).toBe(false);
  const anonymizeCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes("email = CONCAT('deleted_'"));
  expect(anonymizeCall).toBeTruthy();
  expect(anonymizeCall[1]).toEqual([user.id]);
  expect(mockQuery.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(true);
});

test('sweeps expired OTP challenges with the configured retention window', async () => {
  process.env.OTP_CHALLENGE_RETENTION_DAYS = '45';
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

  await cleanupExpiredSessionData();

  const phonePurge = mockQuery.mock.calls.find(([sql]) =>
    String(sql).includes('DELETE FROM admin_phone_verification_challenges')
  );
  expect(phonePurge).toBeTruthy();
  expect(phonePurge[1]).toEqual([45]);
  expect(String(phonePurge[0])).toContain('verified_at IS NOT NULL');

  const guestPurge = mockQuery.mock.calls.find(([sql]) =>
    String(sql).includes('DELETE FROM guest_profile_chat_verifications')
  );
  expect(guestPurge).toBeTruthy();
  expect(guestPurge[1]).toEqual([45]);
  expect(String(guestPurge[0])).toContain('consumed_at IS NOT NULL');

  delete process.env.OTP_CHALLENGE_RETENTION_DAYS;
});

test('OTP challenge retention defaults to 30 days and is bounded', async () => {
  process.env.OTP_CHALLENGE_RETENTION_DAYS = '99999';
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

  await cleanupExpiredSessionData();

  const phonePurge = mockQuery.mock.calls.find(([sql]) =>
    String(sql).includes('DELETE FROM admin_phone_verification_challenges')
  );
  expect(phonePurge[1]).toEqual([365]);

  delete process.env.OTP_CHALLENGE_RETENTION_DAYS;
});

test('P3-11-F03: audit rows are reassigned to the sentinel, never nulled, so a user with audit history can be hard-deleted', async () => {  const SENTINEL = '00000000-0000-0000-0000-000000000000';
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@example.com' };
  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('information_schema.tables')) return { rows: [{ exists: true }] };
    if (text.includes('AS has_credit_records')) return { rows: [{ has_credit_records: false }] };
    return { rows: [] };
  });

  await hardDeleteUser(user);

  const updates = mockQuery.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE'));
  // NOT NULL audit columns are reassigned to the sentinel system user.
  for (const [table, column] of [
    ['admin_audit_log', 'admin_id'],
    ['admin_user_action_log', 'admin_id'],
    ['admin_user_action_log', 'target_user_id'],
  ]) {
    const call = updates.find(([sql]) => sql.includes(`UPDATE ${table} SET ${column} =`));
    expect(call).toBeDefined();
    expect(call[0]).toContain(`SET ${column} = $2`);
    expect(call[0]).not.toContain('= NULL');
    expect(call[1]).toEqual([user.id, SENTINEL]);
  }
  // Nullable references still use plain nullify.
  const settingsNullify = updates.find(([sql]) => sql.includes('UPDATE platform_settings SET updated_by = NULL'));
  expect(settingsNullify).toBeDefined();
  // The user row itself is deleted and the transaction commits.
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM users'))).toBe(true);
  expect(mockQuery.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(true);
});

describe('growth erasure blocker when the pepper is unset (Oct 30 item 11)', () => {
  const user = { id: '22222222-2222-4222-8222-222222222222', email: 'growth@example.com' };
  const OLD_PEPPER = process.env.GROWTH_SUBJECT_PEPPER;

  function mockDeletionQueries({ growthRows }) {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('information_schema.tables')) return { rows: [{ exists: true }] };
      if (text.includes('AS has_credit_records')) return { rows: [{ has_credit_records: false }] };
      if (text.includes('FROM user_interest_profiles WHERE user_id')) {
        return { rows: growthRows ? [{ '?column?': 1 }] : [] };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  beforeEach(() => {
    resetMocks();
    delete process.env.GROWTH_SUBJECT_PEPPER;
  });

  afterAll(() => {
    if (OLD_PEPPER === undefined) delete process.env.GROWTH_SUBJECT_PEPPER;
    else process.env.GROWTH_SUBJECT_PEPPER = OLD_PEPPER;
  });

  test('hasGrowthRows finds the first user_id-keyed growth table with rows', async () => {
    const { hasGrowthRows } = require('../jobs/scheduledDeletionJob');
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('information_schema.tables')) return { rows: [{ exists: true }] };
      if (String(sql).includes('FROM user_interest_profiles WHERE user_id')) return { rows: [{ '?column?': 1 }] };
      return { rows: [] };
    });
    await expect(hasGrowthRows({ query: mockQuery }, user.id)).resolves.toBe('user_interest_profiles');
  });

  test('hasGrowthRows returns null when no growth table holds rows', async () => {
    const { hasGrowthRows } = require('../jobs/scheduledDeletionJob');
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('information_schema.tables')) return { rows: [{ exists: true }] };
      return { rows: [] };
    });
    await expect(hasGrowthRows({ query: mockQuery }, user.id)).resolves.toBeNull();
  });

  test('a user with growth rows is retained, rolled back, and incidented instead of deleted', async () => {
    mockDeletionQueries({ growthRows: true });
    await hardDeleteUser(user);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM users'))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql) === 'ROLLBACK')).toBe(true);
    const incident = mockQuery.mock.calls.find(
      ([sql, params]) => String(sql).includes('INSERT INTO incident_log')
        && Array.isArray(params) && params.includes(`account-deletion-growth-blocked:${user.id}`)
    );
    expect(incident).toBeTruthy();
    expect(incident[1][0]).toBe('account_deletion_growth_erasure_blocked');
    expect(incident[1][1]).toBe('high');
  });

  test('a user with no growth rows deletes normally while the pepper is unset', async () => {
    mockDeletionQueries({ growthRows: false });
    await hardDeleteUser(user);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM users'))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(true);
  });
});
