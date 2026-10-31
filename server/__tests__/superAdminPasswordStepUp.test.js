'use strict';

/**
 * superAdminPasswordStepUp.test.js — self-audit 2026-10-31 item 1 (NEW HIGH):
 * super-admin password-set is a complete account takeover on session auth
 * alone unless it requires a fresh TOTP step-up.
 *
 * The route POST /admin/users/:userId/password must mount
 * requireFreshAuth('super_admin_password_set'), mirroring the
 * impersonation-start pattern: the admin first proves a current TOTP code
 * via POST /super/stepup/verify with purpose 'super_admin_password_set'
 * (15-minute fresh-auth event), and only then may the password-set run.
 * An event recorded for another purpose (e.g. impersonation_start) must
 * not authorize a password set. The victim-revocation behavior of the
 * handler itself (tokens, sessions, passkeys, TOTP) is unchanged.
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { requireFreshAuth } = require('../middleware/requireFreshAuth');

const SECRET = process.env.JWT_SECRET;

function routeHasMiddleware(router, method, routePath, name) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  expect(layer).toBeDefined();
  return layer.route.stack.some((l) => l.handle && l.handle.name === name);
}

function bearer(claims) {
  return `Bearer ${jwt.sign({ id: 'admin-1', ...claims }, SECRET, { algorithm: 'HS256' })}`;
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('item 1: password-set route mounts the fresh-auth middleware', () => {
  test('POST /users/:userId/password mounts requireFreshAuthMiddleware', () => {
    const router = require('../routes/admin');
    expect(
      routeHasMiddleware(router, 'post', '/users/:userId/password', 'requireFreshAuthMiddleware')
    ).toBe(true);
  });

  test('the middleware is purpose-scoped to super_admin_password_set', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const mw = requireFreshAuth('super_admin_password_set');
    const res = mockRes();
    const next = jest.fn();
    await mw({ user: { id: 'admin-1' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'fresh_auth_required' }));
    expect(next).not.toHaveBeenCalled();
    const askedPurpose = mockQuery.mock.calls[0][1][1];
    expect(askedPurpose).toBe('super_admin_password_set');
  });
});

describe('item 1: behavior through the admin router', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/admin', require('../routes/admin'));
    app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ code: err.code }));
  });

  const adminBearer = () => bearer({});

  // The purpose the stored fresh-auth event was recorded for, or null when
  // no event exists. The mock answers the middleware's purpose-filtered
  // lookup the way the real table would: only a matching purpose returns a row.
  let storedPurpose;
  const freshEvent = { completed_at: new Date(), auth_hash: 'hash-1', method: 'totp' };

  beforeEach(() => {
    resetMocks();
    jest.clearAllMocks();
    storedPurpose = null;
    mockQuery.mockImplementation(async (text, params) => {
      const sql = String(text);
      // requireSuperAdmin's admin lookup (TOTP-enrolled super-admin).
      if (sql.includes('COALESCE(totp_enabled')) {
        return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
      }
      // Fresh-auth step-up event lookup, purpose-filtered like the real table.
      if (sql.includes('logistics_fresh_auth_events')) {
        return { rows: params && params[1] === storedPurpose ? [freshEvent] : [] };
      }
      // Handler's target-user lookup.
      if (sql.includes('SELECT id, email, role FROM users WHERE id = $1')) {
        return { rows: [{ id: 'user-9', email: 'vic@example.invalid', role: 'customer' }] };
      }
      return { rows: [] };
    });
  });

  const targetLookups = () => mockQuery.mock.calls.filter(([sql]) =>
    String(sql).includes('SELECT id, email, role FROM users WHERE id = $1'));
  const passwordUpdates = () => mockQuery.mock.calls.filter(([sql]) =>
    String(sql).includes('UPDATE users SET password_hash'));
  const sessionRevokes = () => mockQuery.mock.calls.filter(([sql]) =>
    String(sql).includes('UPDATE sessions SET is_valid = false'));
  const totpClears = () => mockQuery.mock.calls.filter(([sql]) =>
    String(sql).includes('totp_secret = NULL'));

  test('without a fresh TOTP event: 401 fresh_auth_required, handler never runs', async () => {
    const res = await request(app)
      .post('/api/admin/users/user-9/password')
      .set('Authorization', adminBearer())
      .send({ password: 'NewPass123!' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('fresh_auth_required');
    expect(targetLookups()).toHaveLength(0);
    expect(passwordUpdates()).toHaveLength(0);
  });

  test('with an event for another purpose: still 401, handler never runs', async () => {
    storedPurpose = 'impersonation_start';
    const res = await request(app)
      .post('/api/admin/users/user-9/password')
      .set('Authorization', adminBearer())
      .send({ password: 'NewPass123!' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('fresh_auth_required');
    expect(targetLookups()).toHaveLength(0);
    expect(passwordUpdates()).toHaveLength(0);
  });

  test('with a fresh super_admin_password_set event: password set, victim revocations unchanged', async () => {
    storedPurpose = 'super_admin_password_set';
    const res = await request(app)
      .post('/api/admin/users/user-9/password')
      .set('Authorization', adminBearer())
      .send({ password: 'NewPass123!' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/signed out/);
    expect(targetLookups()).toHaveLength(1);
    expect(passwordUpdates()).toHaveLength(1);
    // Victim revocation behavior is unchanged by the gate.
    expect(sessionRevokes()).toHaveLength(1);
    expect(totpClears()).toHaveLength(1);
    const passkeyRevokes = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('passkeys SET revoked_at = NOW()'));
    expect(passkeyRevokes).toHaveLength(2);
  });
});
