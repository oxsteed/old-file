'use strict';

/**
 * Audit T4 (items 5 & 7) — credential rotation must revoke passkeys and
 * clear planted TOTP.
 *
 * Item 5: a planted admin passkey is a standalone admin login credential
 * (passkeyController). It must be revoked (revoked_at) by all four
 * credential-rotation flows: password reset, password change, super-admin
 * password set, and force logout.
 *
 * Item 7: a planted TOTP (enrolled via stolen session) must not survive a
 * password reset/change. totp_secret/totp_enabled/totp_verified_at/
 * backup_codes are cleared so the holder re-enrolls 2FA. Force logout does
 * NOT change the password, so it revokes passkeys but leaves TOTP alone.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('bcrypt', () => ({
  compare: jest.fn().mockResolvedValue(true),
  hash: jest.fn().mockResolvedValue('$2b$12$mockedhashfortests'),
}));
jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
  logUserAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/socketService', () => ({
  disconnectUserSockets: jest.fn(),
}));

const authController = require('../controllers/authController');
const superAdminController = require('../controllers/superAdminController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function sqlCalls(fragment) {
  return mockQuery.mock.calls.filter(([sql]) => new RegExp(fragment, 'i').test(String(sql)));
}

beforeEach(() => {
  resetMocks();
});

describe('item 5: admin_passkeys revoked by every rotation flow', () => {
  test('resetPassword revokes admin_passkeys for the user', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT id FROM users/i.test(sql)) return Promise.resolve({ rows: [{ id: 'u1' }] });
      if (/^UPDATE users/i.test(sql)) return Promise.resolve({ rows: [{ id: 'u1' }] });
      return Promise.resolve({ rows: [{}] });
    });
    const res = mockRes();
    await authController.resetPassword(
      { body: { token: 'reset-token', password: 'NewPass123!' }, headers: {}, ip: '127.0.0.1' },
      res
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Password reset successful.' })
    );
    const calls = sqlCalls('UPDATE admin_passkeys SET revoked_at');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual(['u1']);
    // user_passkeys revocation still happens alongside
    expect(sqlCalls('UPDATE user_passkeys SET revoked_at')).toHaveLength(1);
  });

  test('changePassword revokes admin_passkeys for the user', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT password_hash FROM users/i.test(sql)) {
        return Promise.resolve({ rows: [{ password_hash: 'old-hash' }] });
      }
      return Promise.resolve({ rows: [{}] });
    });
    const res = mockRes();
    await authController.changePassword(
      { body: { currentPassword: 'OldPass123!', newPassword: 'NewPass123!' }, user: { id: 'u1' }, headers: {} },
      res
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Password changed successfully' })
    );
    const calls = sqlCalls('UPDATE admin_passkeys SET revoked_at');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual(['u1']);
    expect(sqlCalls('UPDATE user_passkeys SET revoked_at')).toHaveLength(1);
  });

  test('setUserPasswordBySuperAdmin revokes both passkey tables', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT id, email, role FROM users/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'u9', email: 'u9@example.com', role: 'customer' }] });
      }
      return Promise.resolve({ rows: [{}] });
    });
    const res = mockRes();
    await superAdminController.setUserPasswordBySuperAdmin(
      {
        params: { userId: 'u9' },
        body: { password: 'NewPass123!' },
        user: { id: 'super-1', role: 'super_admin' },
        ip: '127.0.0.1',
      },
      res
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Password updated successfully') })
    );
    // this flow previously revoked neither passkey table
    expect(sqlCalls('UPDATE user_passkeys SET revoked_at')).toHaveLength(1);
    const adminCalls = sqlCalls('UPDATE admin_passkeys SET revoked_at');
    expect(adminCalls).toHaveLength(1);
    expect(adminCalls[0][1]).toEqual(['u9']);
  });

  test('forceLogout revokes both passkey tables', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT id, email, role FROM users/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'u7', email: 'u7@example.com', role: 'customer' }] });
      }
      return Promise.resolve({ rows: [{}] });
    });
    const res = mockRes();
    await superAdminController.forceLogout(
      {
        params: { userId: 'u7' },
        body: { reason: 'suspected compromise' },
        user: { id: 'super-1', role: 'super_admin' },
        ip: '127.0.0.1',
      },
      res
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('invalidated') })
    );
    expect(sqlCalls('UPDATE user_passkeys SET revoked_at')).toHaveLength(1);
    const adminCalls = sqlCalls('UPDATE admin_passkeys SET revoked_at');
    expect(adminCalls).toHaveLength(1);
    expect(adminCalls[0][1]).toEqual(['u7']);
  });
});

describe('item 7: TOTP cleared on password reset/change', () => {
  function totpClearCalls() {
    return sqlCalls('totp_secret = NULL');
  }

  test('resetPassword clears totp_secret/totp_enabled/backup_codes', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT id FROM users/i.test(sql)) return Promise.resolve({ rows: [{ id: 'u1' }] });
      if (/^UPDATE users/i.test(sql)) return Promise.resolve({ rows: [{ id: 'u1' }] });
      return Promise.resolve({ rows: [{}] });
    });
    const res = mockRes();
    await authController.resetPassword(
      { body: { token: 'reset-token', password: 'NewPass123!' }, headers: {}, ip: '127.0.0.1' },
      res
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Password reset successful.' })
    );
    const calls = totpClearCalls();
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    expect(sql).toMatch(/totp_enabled = false/);
    expect(sql).toMatch(/backup_codes = NULL/);
    expect(sql).toMatch(/totp_verified_at = NULL/);
    expect(params).toEqual(['u1']);
  });

  test('changePassword clears totp_secret/totp_enabled/backup_codes', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT password_hash FROM users/i.test(sql)) {
        return Promise.resolve({ rows: [{ password_hash: 'old-hash' }] });
      }
      return Promise.resolve({ rows: [{}] });
    });
    const res = mockRes();
    await authController.changePassword(
      { body: { currentPassword: 'OldPass123!', newPassword: 'NewPass123!' }, user: { id: 'u1' }, headers: {} },
      res
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Password changed successfully' })
    );
    expect(totpClearCalls()).toHaveLength(1);
  });

  test('setUserPasswordBySuperAdmin clears TOTP (credential rotation)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT id, email, role FROM users/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'u9', email: 'u9@example.com', role: 'customer' }] });
      }
      return Promise.resolve({ rows: [{}] });
    });
    const res = mockRes();
    await superAdminController.setUserPasswordBySuperAdmin(
      {
        params: { userId: 'u9' },
        body: { password: 'NewPass123!' },
        user: { id: 'super-1', role: 'super_admin' },
        ip: '127.0.0.1',
      },
      res
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Password updated successfully') })
    );
    expect(totpClearCalls()).toHaveLength(1);
  });

  test('forceLogout revokes passkeys but does NOT clear TOTP (no password change)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT id, email, role FROM users/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'u7', email: 'u7@example.com', role: 'customer' }] });
      }
      return Promise.resolve({ rows: [{}] });
    });
    const res = mockRes();
    await superAdminController.forceLogout(
      {
        params: { userId: 'u7' },
        body: { reason: 'suspected compromise' },
        user: { id: 'super-1', role: 'super_admin' },
        ip: '127.0.0.1',
      },
      res
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('invalidated') })
    );
    // sessions revoked, passkeys revoked, but 2FA enrollment untouched:
    // the user is only logged out, not credential-rotated.
    expect(totpClearCalls()).toHaveLength(0);
  });
});
