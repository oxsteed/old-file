/**
 * __tests__/auth.test.js
 *
 * Unit tests for authentication endpoints:
 *   POST /api/auth/register
 *   POST /api/auth/login
 *   POST /api/auth/refresh
 *   POST /api/auth/logout
 *
 * All DB and external service calls are mocked via __tests__/setup.js.
 */

'use strict';

const { mockQuery, resetMocks } = require('./setup');
const settingsCache = require('../services/platformSettingsCache');

jest.mock('@otplib/v12-adapter', () => ({
  authenticator: {
    options: {},
    verify: jest.fn().mockReturnValue(true),
    generateSecret: jest.fn().mockReturnValue('TESTSECRET'),
    keyuri: jest.fn().mockReturnValue('otpauth://totp/OxSteed:test@example.com?secret=TESTSECRET'),
  },
}));

// Load after mocks are set up
const express = require('express');
const request = require('supertest');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcrypt');
const { encrypt } = require('../utils/encryption');
const authRoutes = require('../routes/auth');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

// Valid JWT used by logout when only access token is provided.
const TEST_TOKEN = jwt.sign(
  { id: 1, email: 'test@example.com', role: 'customer' },
  process.env.JWT_SECRET
);

beforeEach(() => {
  resetMocks();
  // Review P3-7-F07: the registration gate reads platform_settings first;
  // clear the TTL cache so each test's mock sequence starts fresh.
  settingsCache._clearCacheForTests();
});

// The registration gate (assertRegistrationsOpen) issues the first query:
// SELECT value FROM platform_settings WHERE key = 'new_user_registrations'.
const registrationsOpenMock = () =>
  mockQuery.mockResolvedValueOnce({ rows: [{ value: 'true' }] });

// ── Helpers ──────────────────────────────────────────────────────────────────

// ── POST /api/auth/register/accept-terms ─────────────────────────────────────
describe('POST /api/auth/register/accept-terms', () => {
  test('stores a DB-safe hashed IP length and sends OTP', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ email: 'test@example.com' }], // SELECT pending registration
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE pending registration

    const res = await request(buildApp())
      .post('/api/auth/register/accept-terms')
      .send({ token: 'pending-token' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/terms accepted/i);

    const updateArgs = mockQuery.mock.calls[1][1];
    expect(typeof updateArgs[2]).toBe('string');
    expect(updateArgs[2].length).toBeLessThanOrEqual(45);
  });
});

// ── POST /api/auth/check-zip ──────────────────────────────────────────────────
describe('POST /api/auth/check-zip', () => {
  test('is non-blocking for international signup compatibility', async () => {
    const res = await request(buildApp())
      .post('/api/auth/check-zip')
      .send({ zip: '' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      inMarket: true,
      supported: true,
      available: true,
      zip: null,
    }));
  });
});

// ── POST /api/auth/register/start ─────────────────────────────────────────────
describe('POST /api/auth/register/start', () => {
  test('requires postal code when the selected country uses postal codes', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register/start')
      .send({
        email: 'no-zip@example.com',
        password: 'SecurePass123!',
        firstName: 'No',
        lastName: 'Zip',
        phone: '+15551112222',
        addressLine1: '123 Main St',
        city: 'Springfield',
        state: 'OH',
        country: 'US',
        zip: '',
        ageConfirmed: true,
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(expect.objectContaining({
      error: 'validation_failed',
      fields: expect.objectContaining({ zip: expect.anything() }),
    }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('normalizes and stores trimmed registration fields', async () => {
    registrationsOpenMock();
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // check existing email
      .mockResolvedValueOnce({ rows: [{ id: 123 }] }); // insert/update pending registration

    const res = await request(buildApp())
      .post('/api/auth/register/start')
      .send({
        email: '  CUSTOMER@Example.com ',
        password: 'SecurePass123!',
        firstName: '  Customer ',
        lastName: ' User  ',
        phone: ' +1 (555) 111-2222 ',
        addressLine1: '  123 Main St  ',
        city: ' Springfield ',
        state: 'oh',
        zip: '12345',
        ageConfirmed: true,
      });

    expect(res.status).toBe(200);
    const insertArgs = mockQuery.mock.calls[2][1];
    expect(insertArgs[1]).toBe('customer@example.com');
    expect(insertArgs[3]).toBe('Customer');
    expect(insertArgs[4]).toBe('User');
    expect(insertArgs[7]).toBe('123 Main St');
    expect(insertArgs[8]).toBe('Springfield');
    expect(insertArgs[9]).toBe('OH');
  });

  test('rejects an unknown referral code instead of failing silently (P2-6-F08)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // referral code lookup: no match

    const res = await request(buildApp())
      .post('/api/auth/register/start')
      .send({
        email: 'ref-bad@example.com',
        password: 'Str0ng!Pass',
        firstName: 'Ref',
        lastName: 'Bad',
        phone: '+15551112222',
        addressLine1: '123 Main St',
        city: 'Springfield',
        state: 'OH',
        country: 'US',
        zip: '12345',
        ageConfirmed: true,
        ref: 'typo-code',
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(expect.objectContaining({ code: 'invalid_referral_code' }));
  });

  test('accepts a known referral code and stores it', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'referrer-1' }] }) // referral code lookup
      .mockResolvedValueOnce({ rows: [] }) // check existing email
      .mockResolvedValueOnce({ rows: [{ id: 125 }] }); // insert/update pending registration

    const res = await request(buildApp())
      .post('/api/auth/register/start')
      .send({
        email: 'ref-good@example.com',
        password: 'Str0ng!Pass',
        firstName: 'Ref',
        lastName: 'Good',
        phone: '+15551112222',
        addressLine1: '123 Main St',
        city: 'Springfield',
        state: 'OH',
        country: 'US',
        zip: '12345',
        ageConfirmed: true,
        ref: 'good-code',
      });

    expect(res.status).toBe(200);
    const insertArgs = mockQuery.mock.calls[2][1];
    expect(insertArgs[13]).toBe('good-code');
  });

  test('accepts exact-cased predefined region names', async () => {
    registrationsOpenMock();
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 124 }] });

    const res = await request(buildApp())
      .post('/api/auth/register/start')
      .send({
        email: 'fr-customer@example.com',
        password: 'SecurePass123!',
        firstName: 'French',
        lastName: 'Customer',
        phone: '+33123456789',
        addressLine1: '10 Rue Example',
        city: 'Paris',
        country: 'FR',
        state: 'Île-de-France',
        zip: '75001',
        ageConfirmed: true,
        defaultMode: 'restaurant_staff',
      });

    expect(res.status).toBe(200);
    const insertArgs = mockQuery.mock.calls[2][1];
    expect(insertArgs[9]).toBe('Île-de-France');
    expect(insertArgs[14]).toBe('restaurant_staff');
  });

  test('allows empty postal code when the selected country does not require one', async () => {
    registrationsOpenMock();
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 125 }] });

    const res = await request(buildApp())
      .post('/api/auth/register/start')
      .send({
        email: 'haiti-customer@example.com',
        password: 'SecurePass123!',
        firstName: 'Haiti',
        lastName: 'Customer',
        phone: '+50937000000',
        addressLine1: '1 Rue Example',
        city: 'Port-au-Prince',
        country: 'HT',
        state: '',
        zip: '',
        ageConfirmed: true,
      });

    expect(res.status).toBe(200);
    const insertArgs = mockQuery.mock.calls[2][1];
    expect(insertArgs[6]).toBeNull();
    expect(insertArgs[9]).toBeNull();
    expect(insertArgs[10]).toBe('HT');
  });

  test('returns 400 for DB field length overflow instead of 500', async () => {
    registrationsOpenMock();
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // check existing email
      .mockRejectedValueOnce({ code: '22001' }); // insert pending registration

    const res = await request(buildApp())
      .post('/api/auth/register/start')
      .send({
        email: 'customer@example.com',
        password: 'SecurePass123!',
        firstName: 'Customer',
        lastName: 'User',
        phone: '+15551112222',
        addressLine1: '1 Main',
        city: 'Dayton',
        state: 'OH',
        zip: '12345',
        ageConfirmed: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
  });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  test('returns 400 when termsAgreed is missing for non-admin users', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'customer' }] });

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'SecurePass123!' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.fields?.termsAgreed).toBeTruthy();
  });

  test('returns 400 when fields are missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: '', password: '' });
    expect(res.status).toBe(400);
  });

  test('returns 401 when user not found', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // pre-check role
      .mockResolvedValueOnce({ rows: [] }); // user lookup
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({
        email: 'nobody@example.com',
        password: 'SomePass123',
        termsAgreed: true,
        agreementName: 'Jane Doe',
      });
    expect(res.status).toBe(401);
    const userLookupSql = mockQuery.mock.calls[1][0];
    expect(userLookupSql).toMatch(/SELECT\s+u\.id/i);
    expect(userLookupSql).toMatch(/FROM users u/i);
    expect(userLookupSql).toMatch(/LEFT JOIN connect_accounts ca ON ca\.user_id = u\.id/i);
  });

  test('returns 401 when password is wrong', async () => {
    // bcrypt.compare will fail because the stored hash won't match
    mockQuery
      .mockResolvedValueOnce({ rows: [{ role: 'customer' }] }) // pre-check role
      .mockResolvedValueOnce({ rows: [{
        id: 1, email: 'test@example.com',
        password_hash: '$2b$12$invalid_hash_that_never_matches',
        is_active: true, totp_enabled: false, role: 'customer',
      }] });

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'WrongPassword!',
        termsAgreed: true,
        agreementName: 'Jane Doe',
      });
    expect(res.status).toBe(401);
  });

  test('normalizes email and preserves remember-me in an MFA challenge', async () => {
    const passwordHash = await bcrypt.hash('SecurePass123!', 4);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ role: 'customer' }] })
      .mockResolvedValueOnce({ rows: [{
        id: 7,
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
        password_hash: passwordHash,
        is_active: true,
        totp_enabled: true,
        role: 'customer',
      }] });

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({
        email: '  Jane@Example.COM ',
        password: 'SecurePass123!',
        termsAgreed: true,
        agreementName: 'Jane Doe',
        rememberMe: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFactor).toBe(true);
    expect(mockQuery.mock.calls[0][1]).toEqual(['jane@example.com']);
    expect(mockQuery.mock.calls[1][1]).toEqual(['jane@example.com']);
    expect(jwt.verify(res.body.mfaToken, process.env.JWT_SECRET)).toMatchObject({
      id: 7,
      isMfaToken: true,
      rememberMe: true,
    });
  });
});

// ── POST /api/auth/login/2fa ─────────────────────────────────────────────────
describe('POST /api/auth/login/2fa', () => {
  test.each([
    [{ mfaToken: 'invalid-token', token: '123456', isBackupCode: false }],
    [{ mfa_token: 'invalid-token', token: '123456', is_backup_code: false }],
  ])('accepts camelCase and snake_case request field names', async (body) => {
    const res = await request(buildApp())
      .post('/api/auth/login/2fa')
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or expired MFA token/i);
  });

  test('uses a 30-day session and returns the full user contract after remembered MFA', async () => {
    const mfaToken = jwt.sign(
      { id: 8, isMfaToken: true, rememberMe: true },
      process.env.JWT_SECRET,
      { expiresIn: '15m' },
    );
    const fullUser = {
      id: 8,
      first_name: 'Maya',
      last_name: 'Chen',
      email: 'maya@example.com',
      role: 'helper',
      email_verified: true,
      is_verified: true,
      default_mode: 'helper',
      connect_onboarding_complete: false,
    };

    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('COUNT(*) FROM two_factor_audit_log')) return { rows: [{ count: '0' }] };
      if (text.includes('SELECT id, email, role, is_active, totp_secret')) {
        return { rows: [{
          id: 8,
          email: 'maya@example.com',
          role: 'helper',
          is_active: true,
          totp_secret: encrypt('TESTSECRET'),
          totp_enabled: true,
          backup_codes: [],
        }] };
      }
      if (text.includes('SELECT u.id, u.first_name')) return { rows: [fullUser] };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildApp())
      .post('/api/auth/login/2fa')
      .send({ mfaToken, token: '123456', isBackupCode: false });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 8, email: 'maya@example.com', default_mode: 'helper' });
    const sessionSql = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO sessions'))?.[0];
    expect(sessionSql).toMatch(/interval '30 days'/i);
    const fullUserSql = mockQuery.mock.calls.find(([sql]) => String(sql).includes('SELECT u.id, u.first_name'))?.[0];
    expect(fullUserSql).toMatch(/u\.default_mode/i);
    expect(fullUserSql).toMatch(/LEFT JOIN connect_accounts ca/i);
  });
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
describe('POST /api/auth/refresh', () => {
  test('returns 401 when refresh token is invalid', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no valid session

    const res = await request(buildApp())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'invalid-token' });
    expect(res.status).toBe(401);
  });

  test('rejects a session whose server-side expires_at has passed', async () => {
    mockQuery.mockReset();
    const token = jwt.sign({ id: 3, type: 'refresh' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 3, is_valid: true, is_revoked: false, expires_at: new Date(Date.now() - 1000).toISOString() }] });
    const res = await request(buildApp()).post('/api/auth/refresh').send({ refreshToken: token });
    expect(res.status).toBe(401);
    const consumed = mockQuery.mock.calls.some(([sql]) => /UPDATE sessions SET is_valid = false/.test(String(sql)));
    expect(consumed).toBe(false);
  });

  test('atomic consume also requires an unexpired session', async () => {
    mockQuery.mockReset();
    const token = jwt.sign({ id: 3, type: 'refresh' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 3, is_valid: true, is_revoked: false, expires_at: new Date(Date.now() + 86400000).toISOString() }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).post('/api/auth/refresh').send({ refreshToken: token });
    expect(res.status).toBe(401);
    const consumeSql = mockQuery.mock.calls.find(([sql]) => /UPDATE sessions SET is_valid = false/.test(String(sql)))?.[0];
    expect(consumeSql).toMatch(/expires_at > NOW\(\)/);
  });

  test('rejects a session family past its absolute deadline', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 3, is_valid: true, is_revoked: false,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      absolute_expires_at: new Date(Date.now() - 1000).toISOString() }] });
    const res = await request(buildApp()).post('/api/auth/refresh').send({ refreshToken: 'fam-token' });
    expect(res.status).toBe(401);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE sessions SET is_valid = false/.test(String(sql)))).toBe(false);
  });

  test('rotation carries the absolute deadline forward', async () => {
    mockQuery.mockReset();
    const deadline = new Date(Date.now() + 3 * 86400000).toISOString();
    mockQuery.mockImplementation(async (sql) => {
      const t = String(sql);
      if (t.includes('FROM sessions s WHERE')) return { rows: [{ id: 17, user_id: 3, is_valid: true, is_revoked: false, remember_me: false, expires_at: new Date(Date.now() + 86400000).toISOString(), absolute_expires_at: deadline }] };
      if (t.includes('UPDATE sessions SET is_valid = false')) return { rows: [{ id: 1 }] };
      if (t.includes('FROM users WHERE id')) return { rows: [{ id: 3, email: 'a@b.c', role: 'customer' }] };
      return { rows: [] };
    });
    const res = await request(buildApp()).post('/api/auth/refresh').send({ refreshToken: 'fam-token' });
    expect(res.status).toBe(200);
    const insert = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO sessions'));
    // Review P1-1-F04: the rotation window is parameterized by remember_me
    // (7d default, 30d when the original login had remember-me).
    expect(insert[0]).toMatch(/LEAST\(NOW\(\) \+ make_interval\(days => \$4\)/);
    expect(insert[1][2]).toBe(new Date(deadline).toISOString());
    expect(insert[1][3]).toBe(7);
    expect(insert[0]).toMatch(/parent_session_id/);
    expect(insert[1][5]).toBe(17);
    expect(insert[1][6]).toBe(false);
  });

  test('rotation honors remember-me with a 30-day window', async () => {
    mockQuery.mockReset();
    const deadline = new Date(Date.now() + 40 * 86400000).toISOString();
    mockQuery.mockImplementation(async (sql) => {
      const t = String(sql);
      if (t.includes('FROM sessions s WHERE')) return { rows: [{ id: 17, user_id: 3, is_valid: true, is_revoked: false, remember_me: true, expires_at: new Date(Date.now() + 86400000).toISOString(), absolute_expires_at: deadline }] };
      if (t.includes('UPDATE sessions SET is_valid = false')) return { rows: [{ id: 1 }] };
      if (t.includes('FROM users WHERE id')) return { rows: [{ id: 3, email: 'a@b.c', role: 'customer' }] };
      return { rows: [] };
    });
    const res = await request(buildApp()).post('/api/auth/refresh').send({ refreshToken: 'fam-token' });
    expect(res.status).toBe(200);
    const insert = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO sessions'));
    expect(insert[1][3]).toBe(30);
    expect(insert[1][6]).toBe(true);
  });

  test('does not mint a session for an inactive account', async () => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async (sql) => {
      const t = String(sql);
      if (t.includes('FROM sessions s WHERE')) {
        return { rows: [{ user_id: 3, is_valid: true, is_revoked: false,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          absolute_expires_at: new Date(Date.now() + 3 * 86400000).toISOString() }] };
      }
      if (t.includes('UPDATE sessions SET is_valid = false')) return { rows: [{ id: 1 }] };
      if (t.includes('FROM users WHERE id')) {
        return { rows: [{ id: 3, email: 'inactive@example.com', role: 'customer', is_active: false }] };
      }
      return { rows: [] };
    });

    const res = await request(buildApp()).post('/api/auth/refresh').send({ refreshToken: 'inactive-token' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_inactive');
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO sessions'))).toBe(false);
  });

  test('does not mint a session while an account suspension is active', async () => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async (sql) => {
      const t = String(sql);
      if (t.includes('FROM sessions s WHERE')) {
        return { rows: [{ user_id: 3, is_valid: true, is_revoked: false,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          absolute_expires_at: new Date(Date.now() + 3 * 86400000).toISOString() }] };
      }
      if (t.includes('UPDATE sessions SET is_valid = false')) return { rows: [{ id: 1 }] };
      if (t.includes('FROM users WHERE id')) {
        return { rows: [{ id: 3, email: 'suspended@example.com', role: 'customer', is_active: true,
          is_suspended: true, suspended_until: new Date(Date.now() + 3600000).toISOString() }] };
      }
      return { rows: [] };
    });

    const res = await request(buildApp()).post('/api/auth/refresh').send({ refreshToken: 'suspended-token' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO sessions'))).toBe(false);
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {
  test('returns 200 and clears session by refresh token without auth header', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE sessions by hashed refresh token

    const res = await request(buildApp())
      .post('/api/auth/logout')
      .send({ refreshToken: 'some-refresh-token' });

    expect(res.status).toBe(200);
  });

  test('returns 200 and clears all user sessions with valid access token only', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE sessions by user_id

    const res = await request(buildApp())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
  });

  test('returns 400 when no refresh token or valid access token is provided', async () => {
    const res = await request(buildApp())
      .post('/api/auth/logout')
      .send({});

    expect(res.status).toBe(400);
  });
});
