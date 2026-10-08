'use strict';

/**
 * WS1 — auth & sessions audit-remediation tests.
 *
 * Covers: C1 (editUserFull privilege gates), H8a/H8c/H8d (token transport),
 * H9 (socket token-type rejection + revocation), H10 (per-account lockout and
 * OTP cooldowns), H11 (validate2FA MFA-session binding), H18 (in-memory
 * user-level revocation), M1 (hashed reset tokens), M22 (HS256 pinning),
 * L2 (reset-password limiter keyed on token, not email).
 */

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('hashed_pw'),
}));

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const mockQuery = Pool.mockQuery;
const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_key_1234567890';
const bcrypt = require('bcrypt');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [{}] });
  bcrypt.compare.mockReset();
  bcrypt.compare.mockResolvedValue(false);
});

// ─── H18: in-memory user-level revocation ────────────────────────────────────

describe('H18 tokenRevocationService (no Redis)', () => {
  // The shared setup mocks this service; H18 tests the real in-memory logic.
  const svc = jest.requireActual('../services/tokenRevocationService');

  test('revokeAllUserTokens invalidates tokens issued before revocation', async () => {
    const userId = 'ws1-h18-a';
    const iatBefore = Math.floor(Date.now() / 1000) - 120;
    await svc.revokeAllUserTokens(userId);
    expect(await svc.isRevoked('some-jti', userId, iatBefore)).toBe(true);
  });

  test('tokens issued after revocation still pass', async () => {
    const userId = 'ws1-h18-b';
    await svc.revokeAllUserTokens(userId);
    const iatAfter = Math.floor(Date.now() / 1000) + 30;
    expect(await svc.isRevoked('some-jti', userId, iatAfter)).toBe(false);
  });

  test('users without a revocation marker are unaffected', async () => {
    expect(await svc.isRevoked('jti', 'ws1-h18-nobody', Math.floor(Date.now() / 1000))).toBe(false);
  });
});

// ─── H8a / H9 / M22: chat socket authenticator ───────────────────────────────

describe('H8a/H9/M22 chatNamespace authenticator', () => {
  const { createChatAuthenticator } = require('../realtime/chatNamespace');
  const revocation = require('../services/tokenRevocationService');

  const userRow = { is_active: true, role: 'customer', logistics_role: null };
  const makeSocket = (auth, query, headers = {}) => ({
    handshake: { auth: auth || {}, query: query || {}, headers },
  });

  function authFor(poolOverrides) {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [userRow] }), ...poolOverrides };
    return { auth: createChatAuthenticator({ pool, jwtSecret: JWT_SECRET }), pool };
  }

  const sign = (payload, alg = 'HS256') =>
    jwt.sign(payload, JWT_SECRET, { algorithm: alg, expiresIn: '1h' });

  test('H8a: token in handshake.query is rejected (auth payload only)', async () => {
    const { auth } = authFor();
    const next = jest.fn();
    await auth(makeSocket({}, { token: sign({ id: 'u1' }) }), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].message).toMatch(/Authentication required/);
  });

  test('H9: refresh tokens are rejected', async () => {
    const { auth } = authFor();
    const next = jest.fn();
    await auth(makeSocket({ token: sign({ id: 'u1', type: 'refresh' }) }), next);
    expect(next.mock.calls[0][0].message).toMatch(/Invalid chat token/);
  });

  test('H9: MFA pre-auth tokens are rejected', async () => {
    const { auth } = authFor();
    const next = jest.fn();
    await auth(makeSocket({ token: sign({ id: 'u1', isMfaToken: true }) }), next);
    expect(next.mock.calls[0][0].message).toMatch(/Invalid chat token/);
  });

  test('H9: revoked access tokens are rejected', async () => {
    const spy = jest.spyOn(revocation, 'isRevoked').mockResolvedValue(true);
    const { auth } = authFor();
    const next = jest.fn();
    try {
      await auth(makeSocket({ token: sign({ id: 'u1' }) }), next);
      expect(next.mock.calls[0][0].message).toMatch(/revoked/);
    } finally {
      spy.mockRestore();
    }
  });

  test('M22: non-HS256 algorithm is rejected', async () => {
    const { auth } = authFor();
    const next = jest.fn();
    await auth(makeSocket({ token: sign({ id: 'u1' }, 'HS384') }), next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  test('valid HS256 access token passes and primes re-validation state', async () => {
    const { auth } = authFor();
    const token = sign({ id: 'u1' });
    const socket = makeSocket({ token });
    const next = jest.fn();
    await auth(socket, next);
    expect(next).toHaveBeenCalledWith();
    expect(socket.userId).toBe('u1');
    expect(socket.accessToken).toBe(token);
    expect(typeof socket.tokenIssuedAt).toBe('number');
  });

  test('malformed access cookie does not crash the authenticator', async () => {
    const { auth } = authFor();
    const next = jest.fn();
    await auth(makeSocket({}, {}, { cookie: 'oxsteed_access=%E0' }), next);
    expect(next.mock.calls[0][0].message).toMatch(/Authentication required/);
  });

  test('cookie auth is rejected from a disallowed Origin', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [userRow] }) };
    const auth = createChatAuthenticator({
      pool,
      jwtSecret: JWT_SECRET,
      allowedOrigins: ['https://oxsteed.com'],
    });
    const next = jest.fn();
    await auth(makeSocket({}, {}, {
      cookie: 'oxsteed_access=from-cookie',
      origin: 'https://evil.example',
    }), next);
    expect(next.mock.calls[0][0].message).toMatch(/Authentication required/);
  });
});

// ─── C1: editUserFull privilege gates ────────────────────────────────────────

describe('C1 superAdminUserController.editUserFull', () => {
  const controller = require('../controllers/superAdminUserController');

  const target = (role) => ({
    id: 't1', email: 't@x.com', first_name: 'T', last_name: 'U', role,
    is_active: true,
  });

  function runEdit({ callerRole, isSuper, targetRole, body }) {
    const req = {
      params: { userId: 't1' },
      user: { id: 'a1', role: callerRole },
      isSuper: !!isSuper,
      body: body || {},
    };
    const res = mockRes();
    mockQuery.mockImplementation((sql) => {
      if (/SELECT[\s\S]*FROM users/i.test(sql)) return Promise.resolve({ rows: [target(targetRole)] });
      if (/admin_permission_grants/i.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [{}] });
    });
    return controller.editUserFull(req, res).then(() => res);
  }

  test('non-super admin cannot edit an admin target', async () => {
    const res = await runEdit({ callerRole: 'admin', targetRole: 'admin', body: { first_name: 'X' } });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/super-admin/) })
    );
  });

  test('non-super admin cannot set a password without the grant', async () => {
    const res = await runEdit({
      callerRole: 'admin', targetRole: 'customer', body: { password: 'NewPass123!' },
    });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'privilege_required' })
    );
  });

  test('non-super admin cannot change a role without the grant', async () => {
    const res = await runEdit({
      callerRole: 'admin', targetRole: 'customer', body: { role: 'helper' },
    });
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('grant holder can change a password on a non-admin target', async () => {
    const req = {
      params: { userId: 't1' },
      user: { id: 'a1', role: 'admin' },
      body: { password: 'NewPass123!' },
    };
    const res = mockRes();
    mockQuery.mockImplementation((sql) => {
      if (/admin_permission_grants/i.test(sql)) return Promise.resolve({ rows: [{ '1': 1 }] });
      if (/SELECT[\s\S]*FROM users/i.test(sql)) return Promise.resolve({ rows: [target('customer')] });
      return Promise.resolve({ rows: [{ id: 't1' }] });
    });
    await controller.editUserFull(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('super-admin can edit an admin target and set passwords', async () => {
    const req = {
      params: { userId: 't1' },
      user: { id: 'a1', role: 'super_admin' },
      isSuper: true,
      body: { password: 'NewPass123!' },
    };
    const res = mockRes();
    mockQuery.mockImplementation((sql) => {
      if (/SELECT[\s\S]*FROM users/i.test(sql)) return Promise.resolve({ rows: [target('admin')] });
      return Promise.resolve({ rows: [{ id: 't1' }] });
    });
    await controller.editUserFull(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

// ─── H10: login lockout + OTP cooldowns ──────────────────────────────────────

describe('H10 authController lockout and cooldowns', () => {
  const auth = require('../controllers/authController');

  const baseUser = {
    id: 'u1', first_name: 'A', last_name: 'B', email: 'admin@oxsteed.com',
    password_hash: 'hash', role: 'admin', is_active: true,
    failed_login_attempts: 0, login_locked_until: null,
  };

  test('login: active lockout returns 429 before password check', async () => {
    mockQuery.mockImplementation((sql) =>
      /SELECT role FROM users/i.test(sql)
        ? Promise.resolve({ rows: [{ role: 'admin' }] })
        : Promise.resolve({ rows: [{ ...baseUser, login_locked_until: new Date(Date.now() + 60000) }] })
    );
    const next = jest.fn();
    await auth.login({ body: { email: 'admin@oxsteed.com', password: 'x' } }, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].status).toBe(429);
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  test('login: wrong password increments the counter with escalating lockout', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT role FROM users/i.test(sql)) return Promise.resolve({ rows: [{ role: 'admin' }] });
      if (/^SELECT u\.id/i.test(sql)) {
        return Promise.resolve({ rows: [{ ...baseUser, failed_login_attempts: 4 }] });
      }
      return Promise.resolve({ rows: [{}] });
    });
    const next = jest.fn();
    await auth.login({ body: { email: 'admin@oxsteed.com', password: 'wrong' } }, mockRes(), next);
    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      /UPDATE users SET failed_login_attempts/i.test(sql));
    expect(updateCall).toBeTruthy();
    // 5th failure -> 5 minute lockout
    expect(updateCall[1][0]).toBe(5);
    expect(next.mock.calls[0][0].status).toBe(429);
  });

  test('requestOTP: active OTP lockout is not cleared by re-request', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'u1', preferred_language: 'en', otp_locked_until: new Date(Date.now() + 60000), otp_last_sent_at: null }],
    });
    const res = mockRes();
    await auth.requestOTP({ body: { email: 'u@x.com' } }, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockQuery).toHaveBeenCalledTimes(1); // no UPDATE issued
  });

  test('requestOTP: 60s send cooldown enforced', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'u1', preferred_language: 'en', otp_locked_until: null, otp_last_sent_at: new Date(Date.now() - 30000) }],
    });
    const res = mockRes();
    await auth.requestOTP({ body: { email: 'u@x.com' } }, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryAfterMs: expect.any(Number) }));
  });
});

// ─── H11 / M22: twoFactorController.validate2FA ──────────────────────────────

describe('H11/M22 twoFactorController.validate2FA', () => {
  const twoFactor = require('../controllers/twoFactorController');

  const mfaToken = (payload, alg = 'HS256', secret = JWT_SECRET) =>
    jwt.sign(payload, secret, { algorithm: alg, expiresIn: '10m' });

  test('H11: missing mfaToken is rejected', async () => {
    const next = jest.fn();
    await twoFactor.validate2FA({ body: { token: '123456' } }, mockRes(), next);
    expect(next.mock.calls[0][0].status).toBe(401);
    expect(next.mock.calls[0][0].code).toBe('mfa_token_required');
  });

  test('H11: userId in body cannot differ from the MFA session', async () => {
    const next = jest.fn();
    await twoFactor.validate2FA(
      { body: { mfaToken: mfaToken({ id: 'u1', isMfaToken: true }), userId: 'u2', token: '123456' } },
      mockRes(), next
    );
    expect(next.mock.calls[0][0].status).toBe(400);
  });

  test('M22: MFA token with "none" algorithm is rejected', async () => {
    const noneToken = jwt.sign({ id: 'u1', isMfaToken: true }, '', { algorithm: 'none' });
    const next = jest.fn();
    await twoFactor.validate2FA({ body: { mfaToken: noneToken, token: '123456' } }, mockRes(), next);
    expect(next.mock.calls[0][0].status).toBe(401);
    expect(next.mock.calls[0][0].code).toBe('invalid_mfa_token');
  });

  test('H11: lockout after 5 failures in 15 minutes', async () => {
    mockQuery.mockImplementation((sql) =>
      /two_factor_audit_log/i.test(sql)
        ? Promise.resolve({ rows: [{ count: '5' }] })
        : Promise.resolve({ rows: [] })
    );
    const next = jest.fn();
    await twoFactor.validate2FA(
      { body: { mfaToken: mfaToken({ id: 'u1', isMfaToken: true }), token: '123456' } },
      mockRes(), next
    );
    expect(next.mock.calls[0][0].status).toBe(429);
  });

  test('valid backup code succeeds', async () => {
    bcrypt.compare.mockResolvedValue(true);
    mockQuery.mockImplementation((sql) => {
      if (/two_factor_audit_log/i.test(sql)) return Promise.resolve({ rows: [{ count: '0' }] });
      if (/FROM users WHERE id/i.test(sql)) {
        return Promise.resolve({ rows: [{ totp_secret: 'enc', totp_enabled: true, backup_codes: ['h1'] }] });
      }
      return Promise.resolve({ rows: [{}] });
    });
    const res = mockRes();
    const next = jest.fn();
    await twoFactor.validate2FA(
      { body: { mfaToken: mfaToken({ id: 'u1', isMfaToken: true }), token: 'abcdef12', isBackupCode: true } },
      res, next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ valid: true, remainingBackupCodes: 0 })
    );
  });
});

// ─── M1: hashed password-reset tokens ────────────────────────────────────────

describe('M1 authController.resetPassword', () => {
  const auth = require('../controllers/authController');
  const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

  test('lookup and consume use the SHA-256 of the presented token', async () => {
    const rawToken = 'plaintext-reset-token';
    mockQuery.mockImplementation((sql) => {
      if (/SELECT id FROM users/i.test(sql)) return Promise.resolve({ rows: [{ id: 'u1' }] });
      if (/^UPDATE users/i.test(sql)) return Promise.resolve({ rows: [{ id: 'u1' }] });
      return Promise.resolve({ rows: [{}] });
    });
    const res = mockRes();
    await auth.resetPassword(
      { body: { token: rawToken, password: 'NewPass123!' }, headers: {}, ip: '127.0.0.1' },
      res
    );
    const selectCall = mockQuery.mock.calls.find(([sql]) => /SELECT id FROM users/i.test(sql));
    expect(selectCall[1]).toEqual([sha256(rawToken)]);
    const updateCall = mockQuery.mock.calls.find(([sql]) => /^UPDATE users/i.test(sql));
    expect(updateCall[1][1]).toBe(sha256(rawToken));
    // the plaintext token never reaches the database
    for (const [, params] of mockQuery.mock.calls) {
      for (const p of params || []) {
        expect(String(p)).not.toBe(rawToken);
      }
    }
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Password reset successful.' })
    );
  });

  test('unknown token is rejected', async () => {
    mockQuery.mockImplementation((sql) =>
      /SELECT id FROM users/i.test(sql)
        ? Promise.resolve({ rows: [] })
        : Promise.resolve({ rows: [{}] })
    );
    const res = mockRes();
    await auth.resetPassword(
      { body: { token: 'nope', password: 'NewPass123!' }, headers: {}, ip: '127.0.0.1' },
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── H8d: refresh-token cookie transport ─────────────────────────────────────

describe('H8d refresh token via httpOnly cookie', () => {
  const auth = require('../controllers/authController');
  const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

  const userRow = {
    id: 'u1', first_name: 'A', last_name: 'B', email: 'u@x.com', role: 'customer',
    email_verified: true, is_verified: true, preferred_language: 'en',
  };

  function mockRefreshChain(rawToken) {
    const hashed = sha256(rawToken);
    mockQuery.mockImplementation((sql) => {
      if (/FROM sessions s WHERE/i.test(sql)) return Promise.resolve({ rows: [{ user_id: 'u1', is_valid: true, is_revoked: false }] });
      if (/UPDATE sessions SET is_valid/i.test(sql)) return Promise.resolve({ rows: [{ id: 7 }] });
      if (/FROM users WHERE id/i.test(sql)) return Promise.resolve({ rows: [userRow] });
      return Promise.resolve({ rows: [{}] });
    });
    return hashed;
  }

  test('refresh works with the cookie and no body token', async () => {
    const raw = 'cookie-refresh-token';
    const hashed = mockRefreshChain(raw);
    const res = mockRes();
    const next = jest.fn();
    await auth.refreshToken(
      { body: {}, headers: { cookie: `oxsteed_rt=${raw}; other=1` } }, res, next
    );
    expect(next).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls[0][1]).toEqual([hashed]);
    expect(res.cookie).toHaveBeenCalledWith(
      'oxsteed_rt', expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('legacy body token still works (native/mobile compat)', async () => {
    const raw = 'legacy-body-token';
    mockRefreshChain(raw);
    const res = mockRes();
    const next = jest.fn();
    await auth.refreshToken({ body: { refreshToken: raw }, headers: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('no token anywhere returns 401', async () => {
    const res = mockRes();
    const next = jest.fn();
    await auth.refreshToken({ body: {}, headers: {} }, res, next);
    expect(next.mock.calls[0][0].status).toBe(401);
  });
});

// ─── L2 / H8c / M22: source-level regression guards ──────────────────────────

describe('source-level regression guards', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  test('L2: /reset-password is limited by token hash, not email', () => {
    const limiterSrc = read('middleware/rateLimiter.js');
    expect(limiterSrc).toMatch(/passwordResetVerifyLimiter/);
    expect(limiterSrc).toMatch(/keyGenerator:\s*\(req\)\s*=>\s*\{[\s\S]*?req\.body\?\.token[\s\S]*?createHash\(['"]sha256['"]\)/);
    const routesSrc = read('routes/auth.js');
    expect(routesSrc).toMatch(/passwordResetVerifyLimiter/);
    expect(routesSrc).toMatch(/post\(['"]\/reset-password['"],\s*passwordResetVerifyLimiter/);
  });

  test('H8c: Sentry scrubs tokens from captured URLs', () => {
    const src = read('../client/src/instrument.jsx');
    expect(src).toMatch(/beforeSend/);
    for (const param of ['token', 'refresh_token', 'code', 'otp', 'reset_token', 'mfa_token']) {
      expect(src).toContain(`'${param}'`);
    }
  });

  test('M22: jwt.verify is HS256-pinned in auth, 2FA, and chat code', () => {
    const pinned = (read('controllers/authController.js').match(/algorithms:\s*\['HS256'\]/g) || []).length
      + (read('controllers/twoFactorController.js').match(/algorithms:\s*\['HS256'\]/g) || []).length
      + (read('realtime/chatNamespace.js').match(/algorithms:\s*\['HS256'\]/g) || []).length;
    expect(pinned).toBeGreaterThanOrEqual(4);
  });
});
