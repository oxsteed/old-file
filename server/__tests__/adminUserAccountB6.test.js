'use strict';

/**
 * adminUserAccountB6.test.js
 *
 * Behavior contract for the B6 admin-audit fix wave (user accounts + admin
 * identity):
 * - ADM-007: getUserDetail 403s for admin targets when caller isn't super-admin
 * - ADM-138: updateUserName 403s for admin targets when caller isn't super-admin
 * - ADM-038: editUserFull gates email changes (manage_admin_accounts or super)
 * - ADM-038: editUserFull resets email_verified on email change
 * - ADM-059: editUserFull rejects verification-flag flips by non-super admins
 * - ADM-109: toggleUserBan / reactivateUser revoke tokens
 * - ADM-140: updateUserProfile normalizes email + case-insensitive uniqueness
 * - ADM-171: hasGlobalGrant is the canonical adminAuth copy (delegation-aware)
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
  logUserAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/tokenRevocationService', () => ({
  revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/socketService', () => ({
  broadcastToUser: jest.fn(),
  disconnectUserSockets: jest.fn(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/schemaProbe', () => ({
  tableExists: jest.fn().mockResolvedValue(true),
  columnExists: jest.fn().mockResolvedValue(true),
  probeSchema: jest.fn().mockResolvedValue({}),
  userIdEq: jest.fn((c) => `${c} = $1`),
  ACTIVE_JOB_STATUS_SQL_IN: '',
}));
jest.mock('../middleware/adminAuth', () => {
  const actual = jest.requireActual('../middleware/adminAuth');
  return { ...actual, hasGlobalGrant: jest.fn().mockResolvedValue(false) };
});

const { hasGlobalGrant } = require('../middleware/adminAuth');
const { revokeAllUserTokens } = require('../services/tokenRevocationService');
const superCtrl = require('../controllers/superAdminController');

const ADMIN_ID = '00000000-0000-4000-8000-000000000999';

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const adminReq = (overrides = {}) => ({
  params: {},
  body: {},
  query: {},
  user: { id: ADMIN_ID, role: 'admin' },
  ip: '127.0.0.1',
  get: () => null,
  ...overrides,
});

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('ADM-007: getUserDetail hides admin accounts from delegated admins', () => {
  const adminTarget = {
    id: 'a1', first_name: 'A', last_name: 'B', email: 'a@x.com', role: 'admin',
    is_active: true, phone: null, created_at: new Date(), updated_at: new Date(),
    email_verified: true, is_verified: false,
  };
  test('403 when a manage_users admin requests an admin account', async () => {
    mockQuery.mockResolvedValue({ rows: [adminTarget] });
    const res = mockRes();
    await superCtrl.getUserDetail(adminReq({ params: { userId: 'a1' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
  test('200 when a super-admin requests an admin account', async () => {
    mockQuery.mockResolvedValue({ rows: [adminTarget] });
    const res = mockRes();
    await superCtrl.getUserDetail(
      adminReq({ params: { userId: 'a1' }, user: { id: ADMIN_ID, role: 'super_admin' } }),
      res
    );
    expect(res.json).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
  test('200 when a delegated admin requests a regular user', async () => {
    mockQuery.mockResolvedValue({ rows: [{ ...adminTarget, role: 'customer' }] });
    const res = mockRes();
    await superCtrl.getUserDetail(adminReq({ params: { userId: 'u1' } }), res);
    expect(res.json).toHaveBeenCalled();
  });
});

describe('ADM-138: updateUserName guards admin targets', () => {
  test('403 when renaming an admin account as a delegated admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ first_name: 'A', last_name: 'B', role: 'super_admin' }] });
    const res = mockRes();
    await superCtrl.updateUserName(
      adminReq({ params: { userId: 'a1' }, body: { first_name: 'X', last_name: 'Y' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery.mock.calls.some((c) => /UPDATE users SET first_name/i.test(c[0]))).toBe(false);
  });
});

describe('ADM-109: ban/reactivate revoke tokens', () => {
  test('toggleUserBan revokes tokens when banning', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_active: true, role: 'customer' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'u1' }] });
    const res = mockRes();
    await superCtrl.toggleUserBan(
      adminReq({ params: { userId: 'u1' }, body: { reason: 'spam' } }),
      res
    );
    expect(revokeAllUserTokens).toHaveBeenCalledWith('u1');
    expect(res.json).toHaveBeenCalled();
  });
  test('toggleUserBan does not revoke on unban (ban already revoked)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_active: false, role: 'customer' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'u1' }] });
    const res = mockRes();
    await superCtrl.toggleUserBan(adminReq({ params: { userId: 'u1' }, body: {} }), res);
    expect(revokeAllUserTokens).not.toHaveBeenCalled();
  });
});

describe('ADM-140: updateUserProfile normalizes email', () => {
  test('lowercases email and checks LOWER(email) for duplicates', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // no dup
      .mockResolvedValueOnce({ rows: [{ email: 'old@x.com', phone: null, bio: null, city: null, state: null, country: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'u1' }] });
    const res = mockRes();
    await superCtrl.updateUserProfile(
      adminReq({ params: { userId: 'u1' }, body: { email: '  FOO@X.COM ' } }),
      res
    );
    const dupCall = mockQuery.mock.calls[0];
    expect(dupCall[0]).toMatch(/LOWER\(email\)/);
    expect(dupCall[1][0]).toBe('foo@x.com');
  });
});

describe('ADM-038/ADM-059: editUserFull gates email and verification flags', () => {
  const userCtrl = require('../controllers/superAdminUserController');
  const customer = {
    id: 'u1', email: 'old@x.com', first_name: 'U', last_name: 'Ser', phone: null,
    role: 'customer', city: null, state: null, zip_code: null, country: 'US',
    latitude: null, longitude: null, logistics_role: null,
    membership_tier: null, subscription_status: 'none',
    email_verified: false, is_verified: false, background_check_passed: false,
    is_active: true,
  };
  const editReq = (body, role = 'admin') => adminReq({
    params: { userId: 'u1' },
    body,
    user: { id: ADMIN_ID, role },
    isSuper: role === 'super_admin',
  });

  test('403 when a delegated admin changes email without manage_admin_accounts', async () => {
    mockQuery.mockResolvedValue({ rows: [customer] });
    hasGlobalGrant.mockResolvedValue(false);
    const res = mockRes();
    await userCtrl.editUserFull(editReq({ email: 'evil@x.com' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'privilege_required' }));
  });

  test('403 when a delegated admin flips email_verified', async () => {
    mockQuery.mockResolvedValue({ rows: [customer] });
    const res = mockRes();
    await userCtrl.editUserFull(editReq({ email_verified: true }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('403 when a delegated admin flips background_check_passed', async () => {
    mockQuery.mockResolvedValue({ rows: [customer] });
    const res = mockRes();
    await userCtrl.editUserFull(editReq({ background_check_passed: true }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('super-admin can change email (verified flag resets)', async () => {
    // getUserSnapshot (pre-check) + getUserSnapshot (in-txn) + dup check + update
    mockQuery
      .mockResolvedValueOnce({ rows: [customer] })
      .mockResolvedValueOnce({ rows: [customer] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });
    const res = mockRes();
    await userCtrl.editUserFull(editReq({ email: 'new@x.com' }, 'super_admin'), res);
    // The update must force email_verified=false alongside the email change.
    const updateCall = mockQuery.mock.calls.find((c) => /UPDATE users SET/i.test(c[0]));
    expect(updateCall[0]).toMatch(/email_verified/);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('ADM-171: canonical hasGlobalGrant is delegation-aware', () => {
  test('superAdminUserController uses the adminAuth copy', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../controllers/superAdminUserController.js'), 'utf8'
    );
    expect(src).toMatch(/require\('\.\.\/middleware\/adminAuth'\)/);
    expect(src).not.toMatch(/FROM admin_permission_grants/);
  });
  test('investigationAccessService uses the adminAuth copy', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../services/investigationAccessService.js'), 'utf8'
    );
    expect(src).toMatch(/require\('\.\.\/middleware\/adminAuth'\)/);
    expect(src).not.toMatch(/FROM admin_permission_grants/);
  });
});
