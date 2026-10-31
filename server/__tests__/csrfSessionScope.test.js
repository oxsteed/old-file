'use strict';

/**
 * Session-scoped CSRF (recommendation track 8): CSRF tokens are bound to
 * the login session (sid), not just the user.
 *   - a token issued under session A never validates for session B,
 *     even for the same user;
 *   - logout invalidates only the presented session's token;
 *   - force-logout invalidates every token for the user;
 *   - refresh preserves the sid, so rotation never invalidates the
 *     client's token (the full login-refresh-logout cycle works);
 *   - pre-scoping tokens without a sid keep validating against the
 *     legacy per-user key until their first refresh mints a sid.
 * Follows the ws1 harness style: real handlers/middleware with
 * SQL-pattern mocks, plus supertest for the middleware boundary (with a
 * live env, since validateCsrfToken skips entirely under NODE_ENV=test).
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/supportChatThreads', () => ({
  clearSupportThread: jest.fn().mockResolvedValue(undefined),
}));

const { generateTokens, parseAuthIdentity } = require('../middleware/auth');
const {
  attachCsrfToken,
  validateCsrfToken,
  getOrGenerateToken,
  validateToken,
  invalidateSessionToken,
  invalidateAllTokens,
} = require('../middleware/csrf');
const auth = require('../controllers/authController');

const JWT_SECRET = process.env.JWT_SECRET;

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.cookie = jest.fn(() => res);
  res.clearCookie = jest.fn(() => res);
  res.setHeader = jest.fn();
  res.set = jest.fn();
  res.getHeader = jest.fn(() => undefined);
  return res;
}

function accessCookie(userId, sid) {
  const token = jwt.sign(
    sid ? { id: userId, sid } : { id: userId },
    JWT_SECRET,
    { algorithm: 'HS256' }
  );
  return `oxsteed_access=${token}`;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(parseAuthIdentity);
  app.use(attachCsrfToken);
  app.use(validateCsrfToken);
  app.get('/ping', (req, res) => res.json({ ok: true, csrfSid: req.csrfSid || null }));
  app.post('/mutate', (req, res) => res.json({ ok: true }));
  return app;
}

async function withLiveEnv(fn) {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    return await fn();
  } finally {
    process.env.NODE_ENV = prev;
  }
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('generateTokens mints a session id', () => {
  test('fresh tokens carry a random sid; a caller sid is preserved', () => {
    const a = generateTokens({ id: 1, email: 'a@b.c', role: 'user' });
    const b = generateTokens({ id: 1, email: 'a@b.c', role: 'user' });
    expect(typeof a.sid).toBe('string');
    expect(a.sid).not.toBe(b.sid);
    expect(jwt.verify(a.accessToken, JWT_SECRET).sid).toBe(a.sid);
    const kept = generateTokens({ id: 1 }, { sid: 'kept-sid' });
    expect(kept.sid).toBe('kept-sid');
    expect(jwt.verify(kept.accessToken, JWT_SECRET).sid).toBe('kept-sid');
    expect(jwt.verify(kept.refreshToken, JWT_SECRET)).not.toHaveProperty('sid');
  });
});

describe('parseAuthIdentity exposes the session id', () => {
  test('sid from a verified token lands on req.csrfSid; sid-less tokens give null', async () => {
    const app = express();
    app.use(express.json());
    app.use(parseAuthIdentity);
    app.get('/who', (req, res) => res.json({ id: req.user?.id || null, csrfSid: req.csrfSid || null }));
    const withSid = await request(app).get('/who').set('Cookie', accessCookie(9, 'sid-probe'));
    expect(withSid.body).toEqual({ id: 9, csrfSid: 'sid-probe' });
    const withoutSid = await request(app).get('/who').set('Cookie', accessCookie(9));
    expect(withoutSid.body).toEqual({ id: 9, csrfSid: null });
  });
});

describe('session binding at the middleware boundary', () => {
  test('a token from session A is rejected under session B, accepted under A', async () => {
    await withLiveEnv(async () => {
      const app = buildApp();
      const getA = await request(app).get('/ping').set('Cookie', accessCookie(11, 'sid-A'));
      expect(getA.status).toBe(200);
      expect(getA.body.csrfSid).toBe('sid-A');
      const tokenA = getA.headers['x-csrf-token'];
      expect(tokenA).toBeTruthy();

      const cross = await request(app).post('/mutate')
        .set('Cookie', accessCookie(11, 'sid-B'))
        .set('X-CSRF-Token', tokenA)
        .send({});
      expect(cross.status).toBe(403);

      const getB = await request(app).get('/ping').set('Cookie', accessCookie(11, 'sid-B'));
      const tokenB = getB.headers['x-csrf-token'];
      expect(tokenB).toBeTruthy();
      expect(tokenB).not.toBe(tokenA);
      const same = await request(app).post('/mutate')
        .set('Cookie', accessCookie(11, 'sid-B'))
        .set('X-CSRF-Token', tokenB)
        .send({});
      expect(same.status).toBe(200);
    });
  });

  test('legacy sid-less tokens still validate against the per-user key only', async () => {
    await withLiveEnv(async () => {
      const app = buildApp();
      const legacy = await request(app).get('/ping').set('Cookie', accessCookie(12));
      const legacyToken = legacy.headers['x-csrf-token'];
      expect(legacyToken).toBeTruthy();
      const ok = await request(app).post('/mutate')
        .set('Cookie', accessCookie(12))
        .set('X-CSRF-Token', legacyToken)
        .send({});
      expect(ok.status).toBe(200);
      // The legacy token must NOT validate once the request carries a sid.
      const scoped = await request(app).post('/mutate')
        .set('Cookie', accessCookie(12, 'sid-C'))
        .set('X-CSRF-Token', legacyToken)
        .send({});
      expect(scoped.status).toBe(403);
    });
  });

  test('full cycle: rotation preserves the binding, session logout kills only its own token', async () => {
    await withLiveEnv(async () => {
      const app = buildApp();
      const sid = generateTokens({ id: 13 }).sid;
      const first = await request(app).get('/ping').set('Cookie', accessCookie(13, sid));
      const token = first.headers['x-csrf-token'];
      expect(token).toBeTruthy();
      // Simulate a refresh rotation: a new access token, same sid.
      const rotated = await request(app).post('/mutate')
        .set('Cookie', accessCookie(13, sid))
        .set('X-CSRF-Token', token)
        .send({});
      expect(rotated.status).toBe(200);
      // Another session for the same user is unaffected by this session's logout.
      const other = await request(app).get('/ping').set('Cookie', accessCookie(13, 'sid-other'));
      const otherToken = other.headers['x-csrf-token'];
      await invalidateSessionToken(13, sid);
      expect(await validateToken(13, token, sid)).toBe(false);
      expect(await validateToken(13, otherToken, 'sid-other')).toBe(true);
      await invalidateAllTokens(13);
      expect(await validateToken(13, otherToken, 'sid-other')).toBe(false);
    });
  });
});

describe('session-scoped invalidation primitives', () => {
  test('invalidateSessionToken kills only its own session key', async () => {
    const user = 'scope-user-primitives';
    const tokenA = await getOrGenerateToken(user, 'sid-A');
    const tokenB = await getOrGenerateToken(user, 'sid-B');
    expect(tokenA).not.toBe(tokenB);
    await invalidateSessionToken(user, 'sid-A');
    expect(await validateToken(user, tokenA, 'sid-A')).toBe(false);
    expect(await validateToken(user, tokenB, 'sid-B')).toBe(true);
    expect(await getOrGenerateToken(user, 'sid-B')).toBe(tokenB);
  });

  test('invalidateAllTokens clears session keys and the legacy key', async () => {
    const user = 'scope-user-all';
    const tokenA = await getOrGenerateToken(user, 'sid-A');
    const legacy = await getOrGenerateToken(user, null);
    await invalidateAllTokens(user);
    expect(await validateToken(user, tokenA, 'sid-A')).toBe(false);
    expect(await validateToken(user, legacy, null)).toBe(false);
  });
});

function userRow() {
  const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  return {
    id: 'u-scope',
    first_name: 'Scope',
    last_name: 'User',
    email: 'scope@example.com',
    phone: null,
    role: 'user',
    email_verified: true,
    is_verified: true,
    onboarding_status: 'onboarding_complete',
    onboarding_completed: true,
    contact_completed: true,
    profile_completed: true,
    tier_selected: true,
    w9_completed: true,
    terms_accepted: true,
    membership_tier: 'basic',
    id_verified: true,
    background_check_passed: true,
    city: null,
    state: null,
    zip_code: null,
    preferred_language: 'en',
    trial_started_at: null,
    trial_ends_at: null,
    didit_status: 'verified',
    didit_verified_at: future,
    default_mode: null,
    is_active: true,
    is_suspended: false,
    suspended_until: null,
    didit_enforcement_required: false,
  };
}

function installRefreshMocks({ csrfSid }) {
  const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const past = new Date(Date.now() - 3600 * 1000).toISOString();
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (/FROM sessions s WHERE/i.test(sql)) {
      return {
        rows: [{
          id: 'sess-old',
          user_id: 'u-scope',
          is_valid: true,
          is_revoked: false,
          expires_at: future,
          absolute_expires_at: future,
          created_at: past,
          refresh_replay_noted_at: null,
          csrf_sid: csrfSid,
          remember_me: false,
        }],
      };
    }
    if (/UPDATE sessions SET is_valid = false/i.test(sql)) {
      return { rows: [{ id: 'sess-old' }] };
    }
    if (/FROM users WHERE/i.test(sql)) {
      return { rows: [userRow()] };
    }
    if (/INSERT INTO sessions/i.test(sql)) {
      return { rows: [{ expires_at: future }] };
    }
    return { rows: [] };
  });
}

describe('refresh preserves the session id', () => {
  test('a consumed row sid is copied to the rotated row and the new token', async () => {
    installRefreshMocks({ csrfSid: 'sid-kept' });
    const res = mockRes();
    await auth.refreshToken(
      { body: { refreshToken: 'rt-scope' }, headers: {}, get: () => undefined },
      res,
      jest.fn()
    );
    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(jwt.verify(body.accessToken, JWT_SECRET).sid).toBe('sid-kept');
    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO sessions/i.test(sql));
    expect(insert).toBeTruthy();
    expect(insert[1]).toContain('sid-kept');
    const header = res.set.mock.calls.find(([name]) => name === 'X-CSRF-Token');
    expect(header).toBeTruthy();
  });

  test('a pre-scoping row without a sid mints one on refresh', async () => {
    installRefreshMocks({ csrfSid: null });
    const res = mockRes();
    await auth.refreshToken(
      { body: { refreshToken: 'rt-scope' }, headers: {}, get: () => undefined },
      res,
      jest.fn()
    );
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    const minted = jwt.verify(body.accessToken, JWT_SECRET).sid;
    expect(typeof minted).toBe('string');
    expect(minted.length).toBeGreaterThan(0);
    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO sessions/i.test(sql));
    expect(insert[1]).toContain(minted);
  });
});

describe('logout invalidates only the presented session', () => {
  test('refresh-row sid logout kills that session key, leaves the sibling key', async () => {
    const userId = 'scope-user-logout';
    const tokenA = await getOrGenerateToken(userId, 'sid-A');
    const tokenB = await getOrGenerateToken(userId, 'sid-B');
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('WHERE refresh_token')) {
        return { rows: [{ id: 'sess-1', user_id: userId, csrf_sid: 'sid-A' }] };
      }
      return { rows: [] };
    });
    const res = mockRes();
    await auth.logout(
      { body: { refreshToken: 'rt-1' }, headers: {}, get: () => undefined },
      res
    );
    expect(res.json).toHaveBeenCalledWith({ message: 'Logged out' });
    expect(await validateToken(userId, tokenA, 'sid-A')).toBe(false);
    expect(await validateToken(userId, tokenB, 'sid-B')).toBe(true);
  });

  test('legacy logout without any sid still clears the per-user key', async () => {
    const userId = 'scope-user-logout-legacy';
    const before = await getOrGenerateToken(userId, null);
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('WHERE refresh_token')) {
        return { rows: [{ id: 'sess-1', user_id: userId }] };
      }
      return { rows: [] };
    });
    const res = mockRes();
    await auth.logout(
      { body: { refreshToken: 'rt-1' }, headers: {}, get: () => undefined },
      res
    );
    expect(res.json).toHaveBeenCalledWith({ message: 'Logged out' });
    expect(await getOrGenerateToken(userId, null)).not.toBe(before);
  });
});
