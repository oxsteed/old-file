'use strict';

// Fail-closed contract for the legacy audit helpers (auditService.js):
// a transactional audit write (one made with a transaction client) must
// throw on failure so the caller's transaction rolls back, instead of
// letting a mutation commit with its audit row silently dropped.
// Standalone calls keep the historical best-effort behavior.

const { mockQuery, resetMocks } = require('./setup');
const auditService = require('../services/auditService');

const ADMIN_ID = '00000000-0000-4000-8000-000000000101';
const USER_ID = '00000000-0000-4000-8000-000000000102';

beforeEach(() => {
  resetMocks();
});

function failingClient() {
  return { query: jest.fn().mockRejectedValue(new Error('audit write failed')) };
}

describe('auditService fail-closed contract', () => {
  test('logAdminAction throws when a transactional (client) audit write fails', async () => {
    await expect(auditService.logAdminAction({
      client: failingClient(),
      adminId: ADMIN_ID,
      action: 'user_banned',
      targetType: 'user',
      targetId: USER_ID,
    })).rejects.toThrow('audit write failed');
  });

  test('logAdminAction throws when throwOnError is set, even without a client', async () => {
    mockQuery.mockRejectedValueOnce(new Error('audit write failed'));
    await expect(auditService.logAdminAction({
      adminId: ADMIN_ID,
      action: 'user_banned',
      targetType: 'user',
      targetId: USER_ID,
      throwOnError: true,
    })).rejects.toThrow('audit write failed');
  });

  test('logAdminAction keeps best-effort behavior for standalone calls', async () => {
    mockQuery.mockRejectedValueOnce(new Error('audit write failed'));
    await expect(auditService.logAdminAction({
      adminId: ADMIN_ID,
      action: 'user_banned',
      targetType: 'user',
      targetId: USER_ID,
    })).resolves.toBeUndefined();
  });

  test('logUserAction throws when a transactional (client) audit write fails', async () => {
    await expect(auditService.logUserAction({
      client: failingClient(),
      adminId: ADMIN_ID,
      targetUserId: USER_ID,
      actionType: 'edit_email',
      fieldName: 'email',
    })).rejects.toThrow('audit write failed');
  });

  test('logUserAction returns null for standalone calls that fail', async () => {
    mockQuery.mockRejectedValueOnce(new Error('audit write failed'));
    await expect(auditService.logUserAction({
      adminId: ADMIN_ID,
      targetUserId: USER_ID,
      actionType: 'edit_email',
      fieldName: 'email',
    })).resolves.toBeNull();
  });

  test('transactional audit failure rolls the mutation back instead of committing silently', async () => {
    // Bypass the test-setup withTransaction mock (it runs the callback
    // without real BEGIN/COMMIT/ROLLBACK); exercise the real wrapper.
    const { withTransaction } = jest.requireActual('../utils/transaction');
    const failClient = {
      query: jest.fn((sql) => {
        if (/^BEGIN/i.test(String(sql).trim())) return Promise.resolve({ rows: [] });
        if (/INSERT INTO admin_audit_log/i.test(sql)) return Promise.reject(new Error('audit write failed'));
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    const fakePool = { connect: jest.fn().mockResolvedValue(failClient) };

    await expect(withTransaction(fakePool, async (client) => {
      await client.query('UPDATE users SET first_name = $1', ['New']);
      await auditService.logAdminAction({ client, adminId: ADMIN_ID, action: 'user_edited' });
      return true;
    }, 'test_op')).rejects.toThrow('audit write failed');

    const statements = failClient.query.mock.calls.map(([sql]) => String(sql).trim().split('\n')[0]);
    expect(statements).toContain('BEGIN');
    expect(statements.some((s) => /^ROLLBACK/i.test(s))).toBe(true);
    expect(statements.some((s) => /^COMMIT/i.test(s))).toBe(false);
  });
});
