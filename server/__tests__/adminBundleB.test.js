'use strict';

/**
 * adminBundleB.test.js
 *
 * Behavior contract for the Bundle B admin-audit fix wave (auth & access control):
 * - ADM-006/ADM-037: requireAdminTotp hard-block for admin-role sessions on
 *   authenticate+requireRole surfaces (logistics, pricing, product sync)
 * - ADM-037: login flags requiresTwoFactorSetup for TOTP-less admins
 * - ADM-142: setUserPasswordBySuperAdmin requires a mandatory reason when the
 *   target is a fellow admin/super_admin, recorded in the audit trail
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
jest.mock('../services/tokenRevocationService', () => ({
  revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/socketService', () => ({
  broadcastToUser: jest.fn(),
  disconnectUserSockets: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { requireAdminTotp } = require('../middleware/adminAuth');
const { logAdminAction, logUserAction } = require('../services/auditService');
const { revokeAllUserTokens } = require('../services/tokenRevocationService');
const superCtrl = require('../controllers/superAdminController');
const authRoutes = require('../routes/auth');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  resetMocks();
  mockQuery.mockResolvedValue({ rows: [] });
});

// ─── ADM-006 / ADM-037: requireAdminTotp ──────────────────────────────────────

describe('ADM-006/ADM-037: requireAdminTotp', () => {
  test('403s an admin without TOTP with the admin_2fa_required contract', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_enabled: false }] });
    const req = { user: { id: 'admin-1', role: 'admin' } };
    const res = mockRes();
    const next = jest.fn();
    await requireAdminTotp(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'admin_2fa_required',
      redirect: '/admin/2fa-setup',
    }));
  });

  test('403s a super_admin without TOTP', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_enabled: false }] });
    const req = { user: { id: 'super-1', role: 'super_admin' } };
    const res = mockRes();
    const next = jest.fn();
    await requireAdminTotp(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('passes an admin with TOTP enabled', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_enabled: true }] });
    const req = { user: { id: 'admin-1', role: 'admin' } };
    const res = mockRes();
    const next = jest.fn();
    await requireAdminTotp(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('passes non-admin roles through without a DB check', async () => {
    const req = { user: { id: 'op-1', role: 'customer' } };
    const res = mockRes();
    const next = jest.fn();
    await requireAdminTotp(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('passes unauthenticated requests through (authenticate owns the 401)', async () => {
    const req = {};
    const res = mockRes();
    const next = jest.fn();
    await requireAdminTotp(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('fails closed with 503 when the TOTP check errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const req = { user: { id: 'admin-1', role: 'admin' } };
    const res = mockRes();
    const next = jest.fn();
    await requireAdminTotp(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'totp_check_unavailable',
    }));
  });
});

// ─── ADM-037: login flags requiresTwoFactorSetup ─────────────────────────────

describe('ADM-037: login TOTP-setup funnel', () => {
  const adminRow = (overrides = {}) => ({
    id: 'admin-1',
    first_name: 'Ada',
    last_name: 'Admin',
    email: 'admin@example.com',
    phone: null,
    password_hash: 'irrelevant-bcrypt-mocked',
    role: 'admin',
    is_active: true,
    email_verified: true,
    is_verified: true,
    onboarding_status: 'onboarding_complete',
    onboarding_completed: true,
    contact_completed: true,
    profile_completed: true,
    tier_selected: true,
    w9_completed: true,
    terms_accepted: true,
    membership_tier: null,
    id_verified: true,
    background_check_passed: true,
    city: null,
    state: null,
    zip_code: null,
    totp_enabled: false,
    trial_started_at: null,
    trial_ends_at: null,
    didit_status: null,
    didit_verified_at: null,
    default_mode: null,
    failed_login_attempts: 0,
    login_locked_until: null,
    didit_enforcement_required: false,
    connect_stripe_account_id: null,
    connect_charges_enabled: null,
    connect_payouts_enabled: null,
    connect_onboarding_complete: null,
    ...overrides,
  });

  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    return app;
  };

  test('flags requiresTwoFactorSetup for a TOTP-less admin login', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }] })
      .mockResolvedValueOnce({ rows: [adminRow({ totp_enabled: false })] });

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'correct-password' });

    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFactorSetup).toBe(true);
    expect(res.body.requiresTwoFactor).toBeUndefined();
  });

  test('does not flag a customer login', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ role: 'customer' }] })
      .mockResolvedValueOnce({ rows: [adminRow({ role: 'customer', totp_enabled: false })] });

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({
        email: 'user@example.com',
        password: 'correct-password',
        termsAgreed: true,
        agreementName: 'Ada Admin',
      });

    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFactorSetup).toBeUndefined();
  });

  test('TOTP-enabled admin still goes through the MFA leg, not the setup flag', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }] })
      .mockResolvedValueOnce({ rows: [adminRow({ totp_enabled: true })] });

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'correct-password' });

    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFactor).toBe(true);
    expect(res.body.mfaToken).toBeTruthy();
    expect(res.body.requiresTwoFactorSetup).toBeUndefined();
  });
});

// ─── ADM-142: super-admin password reset target-role guard ───────────────────

describe('ADM-142: setUserPasswordBySuperAdmin target-role guard', () => {
  const CALLER = 'super-1';
  const TARGET = 'admin-2';

  const pwReq = (targetRole, body) => ({
    params: { userId: TARGET },
    body,
    user: { id: CALLER, role: 'super_admin' },
    ip: '127.0.0.1',
  });

  test('400s when resetting a fellow admin password without a reason', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TARGET, email: 'admin2@example.com', role: 'admin' }],
    });
    const res = mockRes();
    await superCtrl.setUserPasswordBySuperAdmin(
      pwReq('admin', { password: 'NewSecurePass123!' }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'admin_password_reset_reason_required',
    }));
    expect(revokeAllUserTokens).not.toHaveBeenCalled();
  });

  test('400s when resetting a super_admin password without a reason', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TARGET, email: 'super2@example.com', role: 'super_admin' }],
    });
    const res = mockRes();
    await superCtrl.setUserPasswordBySuperAdmin(
      pwReq('super_admin', { password: 'NewSecurePass123!' }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400s when the reason is blank or over 500 chars for an admin target', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TARGET, email: 'admin2@example.com', role: 'admin' }],
    });
    const res1 = mockRes();
    await superCtrl.setUserPasswordBySuperAdmin(
      pwReq('admin', { password: 'NewSecurePass123!', reason: '   ' }),
      res1
    );
    expect(res1.status).toHaveBeenCalledWith(400);

    resetMocks();
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TARGET, email: 'admin2@example.com', role: 'admin' }],
    });
    const res2 = mockRes();
    await superCtrl.setUserPasswordBySuperAdmin(
      pwReq('admin', { password: 'NewSecurePass123!', reason: 'x'.repeat(501) }),
      res2
    );
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  test('succeeds with a reason and records it in both audit logs', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TARGET, email: 'admin2@example.com', role: 'admin' }],
    });
    const res = mockRes();
    await superCtrl.setUserPasswordBySuperAdmin(
      pwReq('admin', { password: 'NewSecurePass123!', reason: 'Compromised credentials reported by the admin' }),
      res
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Password updated successfully'),
    }));
    expect(revokeAllUserTokens).toHaveBeenCalledWith(TARGET);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'super_admin_set_password',
      description: expect.stringContaining('Compromised credentials reported by the admin'),
    }));
    expect(logUserAction).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'edit_password',
      notes: expect.stringContaining('Compromised credentials reported by the admin'),
    }));
  });

  test('regular-user resets still work with no reason and no reason in the audit', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TARGET, email: 'user@example.com', role: 'customer' }],
    });
    const res = mockRes();
    await superCtrl.setUserPasswordBySuperAdmin(
      pwReq('customer', { password: 'NewSecurePass123!' }),
      res
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Password updated successfully'),
    }));
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Password set by super admin for user@example.com',
    }));
  });
});
