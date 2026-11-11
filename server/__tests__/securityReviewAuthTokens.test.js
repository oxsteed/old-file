'use strict';

/**
 * Security review 2026-11-10, regression tests.
 *
 * F-16 (Critical): POST /api/passkeys/authentication/options returned a JWT
 * signed with the access-token secret BEFORE any WebAuthn assertion, and the
 * API, admin and socket verifiers only rejected MFA and refresh tokens. The
 * "options" token therefore worked as a full bearer login for any email with
 * a passkey. Every verifier now admits only allow-listed access tokens.
 *
 * F-02 (High): parseAuthIdentity set a bare `req.user = { id }` from any
 * signature-valid token, and optionalAuth never cleared it, so revoked,
 * suspended, restricted, deleted and ended-impersonation tokens still acted
 * as their user on guest-capable (money-moving) routes.
 */

const { mockQuery, resetMocks } = require('./setup');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const tokenRevocationService = require('../services/tokenRevocationService');
const {
  generateTokens,
  authenticate,
  optionalAuth,
  parseAuthIdentity,
  authenticateIfPresent,
} = require('../middleware/auth');
const { requireAdmin, requireSuperAdmin } = require('../middleware/adminAuth');
const { getVerifiedAuthUserId } = require('../middleware/rateLimiter');
const { createChatAuthenticator } = require('../realtime/chatNamespace');
const { isAccessTokenPayload } = require('../utils/accessToken');
const userPasskeys = require('../controllers/userPasskeyController');

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn().mockResolvedValue({ challenge: 'challenge-1' }),
  verifyAuthenticationResponse: jest.fn(),
}));

const SECRET = process.env.JWT_SECRET;
const VICTIM = '00000000-0000-4000-8000-0000000000a1';

function resStub() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function activeUserRow(overrides = {}) {
  return {
    id: VICTIM, first_name: 'Vic', last_name: 'Tim', email: 'victim@example.invalid',
    role: 'super_admin', is_active: true, totp_enabled: true, email_verified: true,
    is_suspended: false, suspended_until: null, is_restricted: false,
    didit_status: 'approved', ...overrides,
  };
}

async function issuePasskeyOptionsToken() {
  // authenticationOptions: user lookup, passkey list, then challenge writes.
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: VICTIM, is_active: true }] })
    .mockResolvedValueOnce({ rows: [{ credential_id: 'cred-1', transports: [] }] })
    .mockResolvedValue({ rows: [], rowCount: 1 });
  const res = resStub();
  const next = jest.fn();
  await userPasskeys.authenticationOptions({ body: { email: 'victim@example.invalid' } }, res, next);
  expect(next).not.toHaveBeenCalled();
  const { token } = res.json.mock.calls[0][0];
  expect(typeof token).toBe('string');
  mockQuery.mockReset();
  return token;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  tokenRevocationService.isRevoked.mockResolvedValue(false);
  tokenRevocationService.isImpersonationSessionRevoked.mockResolvedValue(false);
});

describe('F-16: the passkey options token is never a login', () => {
  function appWith(...middleware) {
    const app = express();
    app.get('/probe', ...middleware, (req, res) => res.json({ userId: req.user?.id || null }));
    return app;
  }

  test('the token has its own type and audience', async () => {
    const token = await issuePasskeyOptionsToken();
    const decoded = jwt.decode(token);
    expect(decoded).toMatchObject({ id: VICTIM, isPasskeyToken: true, typ: 'passkey_login', aud: 'oxsteed:passkey-login' });
    expect(isAccessTokenPayload(decoded)).toBe(false);
  });

  test('authenticate refuses it as a Bearer and as the access cookie, before any DB read', async () => {
    const token = await issuePasskeyOptionsToken();
    mockQuery.mockResolvedValue({ rows: [activeUserRow()] });
    const bearer = await request(appWith(authenticate)).get('/probe').set('Authorization', `Bearer ${token}`);
    expect(bearer.status).toBe(401);
    const cookie = await request(appWith(authenticate)).get('/probe').set('Cookie', `oxsteed_access=${token}`);
    expect(cookie.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('requireAdmin and requireSuperAdmin refuse it even for a TOTP-enabled super admin', async () => {
    const token = await issuePasskeyOptionsToken();
    mockQuery.mockResolvedValue({ rows: [activeUserRow()] });
    const admin = await request(appWith(requireAdmin)).get('/probe').set('Authorization', `Bearer ${token}`);
    expect(admin.status).toBe(401);
    const superAdmin = await request(appWith(requireSuperAdmin)).get('/probe').set('Authorization', `Bearer ${token}`);
    expect(superAdmin.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('optionalAuth and parseAuthIdentity give it no identity at all', async () => {
    const token = await issuePasskeyOptionsToken();
    mockQuery.mockResolvedValue({ rows: [activeUserRow()] });
    const app = express();
    app.use(parseAuthIdentity);
    app.get('/probe', optionalAuth, (req, res) => res.json({
      userId: req.user?.id || null, csrf: req.csrfIdentity?.id || null,
    }));
    const res = await request(app).get('/probe').set('Authorization', `Bearer ${token}`);
    expect(res.body).toEqual({ userId: null, csrf: null });
  });

  test('the chat socket refuses it', async () => {
    const token = await issuePasskeyOptionsToken();
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ is_active: true, role: 'customer' }] }) };
    const auth = createChatAuthenticator({ pool, jwtSecret: SECRET });
    const next = jest.fn();
    await auth({ handshake: { auth: { token }, headers: {} } }, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('the per-user rate-limit identity ignores it', async () => {
    const token = await issuePasskeyOptionsToken();
    expect(getVerifiedAuthUserId({ headers: { authorization: `Bearer ${token}` } })).toBeNull();
  });
});

describe('F-16: access tokens are an allow-list, not a deny-list', () => {
  const sign = (payload) => jwt.sign(payload, SECRET, { algorithm: 'HS256', expiresIn: '5m' });

  test('real session and impersonation access tokens are accepted', () => {
    const { accessToken, refreshToken } = generateTokens({ id: 5, email: 'a@b.c', role: 'customer' });
    expect(isAccessTokenPayload(jwt.decode(accessToken))).toBe(true);
    expect(isAccessTokenPayload(jwt.decode(refreshToken))).toBe(false);
    expect(isAccessTokenPayload(jwt.decode(sign({
      id: 5, typ: 'access', impersonation: true, impersonated_by: 1, jti: 'j',
    })))).toBe(true);
  });

  test('a caller-supplied typ claim cannot downgrade a minted access token', () => {
    const { accessToken } = generateTokens({ id: 5 }, { typ: 'passkey_login' });
    expect(jwt.decode(accessToken).typ).toBe('access');
  });

  test.each([
    ['untyped legacy token', { id: 5, sid: 's' }],
    ['typed token without a session id', { id: 5, typ: 'access' }],
    ['impersonation token without a jti', { id: 5, typ: 'access', impersonation: true, impersonated_by: 1 }],
    ['typed token without a user id', { typ: 'access', sid: 's' }],
    ['MFA token', { id: 5, isMfaToken: true }],
    ['MFA token stamped access', { id: 5, typ: 'access', sid: 's', isMfaToken: true }],
    ['refresh token', { id: 5, type: 'refresh' }],
    ['internal-access token', { userId: 5, internalAccessId: 1, isInternalAccessToken: true }],
    ['guest chat token', { guestEmail: 'g@x.y', inquiryId: 3 }],
    ['token with an audience', { id: 5, typ: 'access', sid: 's', aud: 'oxsteed:passkey-login' }],
  ])('%s is refused by authenticate', async (_label, payload) => {
    const app = express();
    app.get('/probe', authenticate, (req, res) => res.json({ ok: true }));
    const res = await request(app).get('/probe').set('Authorization', `Bearer ${sign(payload)}`);
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('F-02: optional identity runs the full checks and never leaves a bare user', () => {
  function app(...middleware) {
    const a = express();
    a.use(parseAuthIdentity);
    a.post('/spend', ...middleware, (req, res) => res.json({
      userId: req.user?.id || null,
      impersonated: req.isImpersonated === true,
      csrf: req.csrfIdentity?.id || null,
    }));
    return a;
  }
  const token = () => generateTokens({ id: VICTIM, email: 'v@x.y', role: 'customer' }).accessToken;

  test('an expired timed suspension reactivates an account that was deactivated by suspendUser', async () => {
    const a = express();
    a.get('/probe', authenticate, (req, res) => res.json({ userId: req.user?.id || null }));
    mockQuery
      .mockResolvedValueOnce({ rows: [activeUserRow({
        role: 'customer',
        is_active: false,
        is_suspended: true,
        suspended_until: new Date(Date.now() - 60_000).toISOString(),
      })] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(a).get('/probe').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(VICTIM);
    expect(mockQuery.mock.calls[1][0]).toMatch(/is_suspended = FALSE/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/is_active = TRUE/);
  });

  test('a live session is still recognised on optional routes', async () => {
    mockQuery.mockResolvedValue({ rows: [activeUserRow({ role: 'customer' })] });
    const res = await request(app(optionalAuth)).post('/spend').set('Authorization', `Bearer ${token()}`);
    expect(res.body).toMatchObject({ userId: VICTIM, csrf: VICTIM });
  });

  test('a revoked (logged-out) token is a guest everywhere, but still CSRF-bound', async () => {
    tokenRevocationService.isRevoked.mockResolvedValue(true);
    mockQuery.mockResolvedValue({ rows: [activeUserRow({ role: 'customer' })] });
    const noMiddleware = await request(app()).post('/spend').set('Authorization', `Bearer ${token()}`);
    expect(noMiddleware.body).toEqual({ userId: null, impersonated: false, csrf: VICTIM });
    const optional = await request(app(optionalAuth)).post('/spend').set('Authorization', `Bearer ${token()}`);
    expect(optional.body.userId).toBeNull();
  });

  test.each([
    ['suspended', { is_suspended: true }],
    ['restricted', { is_restricted: true }],
    ['deactivated', { is_active: false }],
  ])('a %s account gets no identity on routes without authenticate', async (_label, overrides) => {
    mockQuery.mockResolvedValue({ rows: [activeUserRow({ role: 'customer', ...overrides })] });
    const res = await request(app()).post('/spend').set('Authorization', `Bearer ${token()}`);
    expect(res.body.userId).toBeNull();
  });

  test('a deleted account gets no identity (the lookup excludes deleted rows)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app(optionalAuth)).post('/spend').set('Authorization', `Bearer ${token()}`);
    expect(res.body.userId).toBeNull();
    expect(mockQuery.mock.calls.some(([sql]) => /deleted_at IS NULL/.test(sql))).toBe(true);
  });

  test('an ended impersonation session is neither the target nor flagged', async () => {
    const imp = jwt.sign({
      id: VICTIM, typ: 'access', impersonation: true, impersonated_by: 'admin-1', jti: 'jti-ended',
    }, SECRET, { algorithm: 'HS256', expiresIn: '30m' });
    mockQuery.mockImplementation(async (sql) => (/user_impersonation_log/.test(sql)
      ? { rows: [{ ended_at: new Date().toISOString() }] }
      : { rows: [activeUserRow({ role: 'customer' })] }));
    const res = await request(app(optionalAuth)).post('/spend').set('Authorization', `Bearer ${imp}`);
    expect(res.body).toMatchObject({ userId: null, impersonated: false });
  });

  test('a live impersonation session is flagged so impersonation guards fire', async () => {
    const imp = jwt.sign({
      id: VICTIM, typ: 'access', impersonation: true, impersonated_by: 'admin-1', jti: 'jti-live',
    }, SECRET, { algorithm: 'HS256', expiresIn: '30m' });
    mockQuery.mockImplementation(async (sql) => (/user_impersonation_log/.test(sql)
      ? { rows: [{ ended_at: null }] }
      : { rows: [activeUserRow({ role: 'customer' })] }));
    const res = await request(app()).post('/spend').set('Authorization', `Bearer ${imp}`);
    expect(res.body).toMatchObject({ userId: VICTIM, impersonated: true });
  });

  test('authenticateIfPresent refuses a revoked session instead of downgrading it to a guest', async () => {
    tokenRevocationService.isRevoked.mockResolvedValue(true);
    const res = await request(app(authenticateIfPresent)).post('/spend').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(401);
  });

  test('authenticateIfPresent refuses suspended sessions and non-access tokens', async () => {
    mockQuery.mockResolvedValue({ rows: [activeUserRow({ role: 'customer', is_suspended: true })] });
    const res = await request(app(authenticateIfPresent)).post('/spend').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('session_invalid');
    const passkey = await issuePasskeyOptionsToken();
    const res2 = await request(app(authenticateIfPresent)).post('/spend').set('Authorization', `Bearer ${passkey}`);
    expect(res2.status).toBe(401);
  });

  test('authenticateIfPresent keeps a live session (and its impersonation flag)', async () => {
    mockQuery.mockResolvedValue({ rows: [activeUserRow({ role: 'customer', didit_status: 'pending' })] });
    const res = await request(app(authenticateIfPresent)).post('/spend').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(VICTIM);
  });

  test('authenticateIfPresent lets a real guest (no token, or an expired cookie) through', async () => {
    const guest = await request(app(authenticateIfPresent)).post('/spend');
    expect(guest.status).toBe(200);
    expect(guest.body.userId).toBeNull();
    const expired = jwt.sign({ id: VICTIM, typ: 'access', sid: 's', exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
    const stale = await request(app(authenticateIfPresent)).post('/spend').set('Cookie', `oxsteed_access=${expired}`);
    expect(stale.status).toBe(200);
    expect(stale.body.userId).toBeNull();
  });
});
