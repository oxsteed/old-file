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

beforeEach(() => resetMocks());

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
    const insertArgs = mockQuery.mock.calls[1][1];
    expect(insertArgs[1]).toBe('customer@example.com');
    expect(insertArgs[3]).toBe('Customer');
    expect(insertArgs[4]).toBe('User');
    expect(insertArgs[7]).toBe('123 Main St');
    expect(insertArgs[8]).toBe('Springfield');
    expect(insertArgs[9]).toBe('OH');
  });

  test('accepts exact-cased predefined region names', async () => {
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
    const insertArgs = mockQuery.mock.calls[1][1];
    expect(insertArgs[9]).toBe('Île-de-France');
    expect(insertArgs[14]).toBe('restaurant_staff');
  });

  test('allows empty postal code when the selected country does not require one', async () => {
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
    const insertArgs = mockQuery.mock.calls[1][1];
    expect(insertArgs[6]).toBeNull();
    expect(insertArgs[9]).toBeNull();
    expect(insertArgs[10]).toBe('HT');
  });

  test('returns 400 for DB field length overflow instead of 500', async () => {
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
