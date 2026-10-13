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
  mockQuery
    .mockResolvedValueOnce({ rows: [user] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ has_credit_records: true }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

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

test('P3-11-F03: audit rows are reassigned to the sentinel, never nulled, so a user with audit history can be hard-deleted', async () => {
  const SENTINEL = '00000000-0000-0000-0000-000000000000';
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
