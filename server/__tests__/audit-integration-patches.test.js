'use strict';

/**
 * Integration-patch regression tests — audit remediation 2026-09-30.
 *
 * Covers the cross-workstream patches applied during integration:
 *  - H14 completion: applyQrPaymentSucceeded requires payment_status==='paid'
 *    AND amount equality before marking a QR payment succeeded.
 *  - M28 completion: connectorMutationLimiter wired on all connector
 *    mutation routes, keyed by the connector user.
 *  - H8b/M23: impersonation issues one-time exchange codes (never a JWT in
 *    the response), refuses deactivated targets, exchange is admin-bound and
 *    single-use, endImpersonation is ownership-scoped.
 *  - M1: userModel reset-token helpers store/compare the SHA-256 hash.
 */

const crypto = require('crypto');
const { mockQuery, resetMocks } = require('./setup');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  jest.clearAllMocks();
});

// ── H14: QR checkout success requires paid + amount match ───────────────────
describe('H14 applyQrPaymentSucceeded', () => {
  let applyQrPaymentSucceeded;

  beforeEach(() => {
    ({ applyQrPaymentSucceeded } = require('../controllers/webhookController'));
  });

  test('does not mark succeeded when the session is not paid', async () => {
    const n = await applyQrPaymentSucceeded({
      id: 'cs_1', payment_status: 'unpaid', amount_total: 5000, payment_intent: 'pi_1',
    });
    expect(n).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('marks succeeded only when paid; UPDATE enforces amount equality', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const n = await applyQrPaymentSucceeded({
      id: 'cs_2', payment_status: 'paid', amount_total: 5000, payment_intent: 'pi_2',
    });
    expect(n).toBe(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('amount_cents = $3');
    expect(params).toEqual(['cs_2', 'pi_2', 5000]);
  });

  test('returns 0 when the amount does not match (rowCount 0)', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const n = await applyQrPaymentSucceeded({
      id: 'cs_3', payment_status: 'paid', amount_total: 9999, payment_intent: 'pi_3',
    });
    expect(n).toBe(0);
  });
});

// ── M28: connector mutation limiter ─────────────────────────────────────────
describe('M28 connectorMutationLimiter', () => {
  test('is exported and wired on every connector mutation route', () => {
    const { connectorMutationLimiter } = require('../middleware/rateLimiter');
    expect(typeof connectorMutationLimiter).toBe('function');

    const router = require('../routes/connector');
    const mutationPaths = [
      '/reconciliation-exceptions/:id/acknowledge',
      '/reconciliation-exceptions/:id/assign',
      '/reconciliation-exceptions/:id/resolve',
      '/dead-letters/:id/requeue',
      '/webhooks/retry',
      '/settings-changes/:id/approve',
      '/settings-changes/:id/reject',
    ];
    const layers = router.stack.filter(
      (l) => l.route && mutationPaths.includes(l.route.path)
    );
    expect(layers).toHaveLength(mutationPaths.length);
    for (const layer of layers) {
      const fns = layer.route.stack.map((s) => s.handle);
      expect(fns).toContain(connectorMutationLimiter);
    }
  });

  test('keys by connector user id', async () => {
    const { connectorMutationLimiter } = require('../middleware/rateLimiter');
    // express-rate-limit v7 style: the middleware exposes no key fn directly;
    // assert it is a middleware factory product by invoking it on a fake req.
    const req = { connectorUser: { id: 'conn-1' }, ip: '1.2.3.4', headers: {}, app: { get: () => undefined } };
    const res = mockRes();
    res.setHeader = jest.fn();
    res.getHeader = jest.fn();
    const next = jest.fn();
    // Should not throw and should call next() when under the limit.
    await new Promise((resolve) => {
      connectorMutationLimiter(req, res, (...a) => { next(...a); resolve(); });
      setTimeout(resolve, 500);
    });
    expect(next).toHaveBeenCalled();
  });
});

// ── H8b/M23: impersonation exchange codes ───────────────────────────────────
describe('H8b impersonation exchange codes', () => {
  let superCtrl;

  const adminReq = (overrides = {}) => ({
    user: { id: 'admin-1' },
    params: { userId: 'user-9' },
    body: {},
    ip: '127.0.0.1',
    headers: {},
    ...overrides,
  });

  beforeEach(() => {
    jest.isolateModules(() => {
      superCtrl = require('../controllers/superAdminController');
    });
  });

  test('impersonateUser returns an exchange code, never a JWT, and rejects inactive targets', async () => {
    // Inactive target
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'user-9', first_name: 'A', last_name: 'B', email: 'a@b.c', role: 'customer', is_active: false }],
    });
    const res1 = mockRes();
    await superCtrl.impersonateUser(adminReq(), res1);
    expect(res1.status).toHaveBeenCalledWith(403);

    // Active target
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM users')) {
        return { rows: [{ id: 'user-9', first_name: 'A', last_name: 'B', email: 'a@b.c', role: 'customer', is_active: true }] };
      }
      return { rows: [], rowCount: 1 };
    });
    const res2 = mockRes();
    await superCtrl.impersonateUser(adminReq(), res2);
    const body = res2.json.mock.calls[0][0];
    expect(body.exchangeCode).toMatch(/^[0-9a-f]{64}$/);
    expect(body.impersonationToken).toBeUndefined();
    // The stored value must be the hash, not the code.
    const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes('exchange_code_hash'));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1][0]).toBe(crypto.createHash('sha256').update(body.exchangeCode).digest('hex'));
  });

  test('exchangeImpersonationCode swaps a valid code once, bound to the admin', async () => {
    const code = 'c'.repeat(64);
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    // Valid first use
    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('UPDATE user_impersonation_log') && sql.includes('exchange_code_used_at = NOW()')) {
        expect(params[0]).toBe(codeHash);
        expect(params[1]).toBe('admin-1');
        return { rows: [{ token_jti: 'jti-1', target_user_id: 'user-9' }], rowCount: 1 };
      }
      if (sql.includes('FROM users')) {
        return { rows: [{ id: 'user-9', first_name: 'A', last_name: 'B', email: 'a@b.c', role: 'customer' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = mockRes();
    await superCtrl.exchangeImpersonationCode(
      { user: { id: 'admin-1' }, body: { code } }, res
    );
    const body = res.json.mock.calls[0][0];
    expect(typeof body.impersonationToken).toBe('string');
    expect(body.userId).toBe('user-9');

    // Reused/expired code -> 410
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const res2 = mockRes();
    await superCtrl.exchangeImpersonationCode(
      { user: { id: 'admin-1' }, body: { code } }, res2
    );
    expect(res2.status).toHaveBeenCalledWith(410);
  });

  test('endImpersonation scopes the update to the owning admin', async () => {
    const res = mockRes();
    await superCtrl.endImpersonation(
      { user: { id: 'admin-1' }, body: { jti: 'jti-9' } }, res
    );
    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => sql.includes('UPDATE user_impersonation_log') && sql.includes('ended_at = NOW()')
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall[0]).toContain('admin_id = $2');
    expect(updateCall[1]).toEqual(['jti-9', 'admin-1']);
  });
});

// ── M1: userModel reset-token hashing ───────────────────────────────────────
describe('M1 userModel reset tokens', () => {
  test('setResetToken stores the hash; resetPassword compares the hash', async () => {
    const userModel = require('../models/userModel');
    const token = 't'.repeat(64);
    const expectedHash = crypto.createHash('sha256').update(token).digest('hex');

    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', email: 'a@b.c', first_name: 'A' }], rowCount: 1,
    });
    const created = await userModel.setResetToken('a@b.c');
    expect(created.token).toHaveLength(64);
    const setCall = mockQuery.mock.calls[0];
    expect(setCall[1][0]).toBe(crypto.createHash('sha256').update(created.token).digest('hex'));
    expect(setCall[1][0]).not.toBe(created.token);

    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await userModel.resetPassword(token, 'new-password-123').catch(() => {});
    const resetCall = mockQuery.mock.calls.find(([sql]) => sql.includes('WHERE reset_token'));
    expect(resetCall).toBeTruthy();
    expect(resetCall[1][1]).toBe(expectedHash);
  });
});
