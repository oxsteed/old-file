'use strict';

// Pentest remainder: helper OTP codes must be stored as HMAC under the
// server secret (matching authController.hashOtp), not unsalted SHA-256.
// In this suite the HMAC key is the test JWT_SECRET because setup does not
// set OTP_HMAC_SECRET, mirroring the production fallback chain.

const crypto = require('crypto');
const { mockQuery, resetMocks } = require('./setup');

const express = require('express');
const request = require('supertest');

jest.mock('@otplib/v12-adapter', () => ({
  authenticator: {
    options: {},
    verify: jest.fn().mockReturnValue(true),
    generateSecret: jest.fn().mockReturnValue('TESTSECRET'),
    keyuri: jest.fn().mockReturnValue('otpauth://totp/OxSteed:test@example.com?secret=TESTSECRET'),
  },
}));

jest.mock('../middleware/validateFileUpload', () => (req, res, next) => next());
jest.mock('../middleware/upload', () => ({
  single: () => (req, res, next) => next(),
}));

const helperRegistrationRoutes = require('../routes/helperRegistration');
const settingsCache = require('../services/platformSettingsCache');
const { sendOTPEmail } = require('../utils/email');

// Mirror the controller's fallback chain; setup leaves OTP_HMAC_SECRET
// unset, so the key is the test JWT_SECRET.
const HMAC_KEY = process.env.OTP_HMAC_SECRET || process.env.JWT_SECRET;
const hmacOtp = (otp) => crypto.createHmac('sha256', HMAC_KEY).update(String(otp)).digest('hex');
const unsaltedOtp = (otp) => crypto.createHash('sha256').update(otp).digest('hex');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/helper-registration', helperRegistrationRoutes);
  return app;
}

beforeEach(() => {
  resetMocks();
  settingsCache._clearCacheForTests();
  sendOTPEmail.mockClear();
});

// The registration gate (requireRegistrationsOpen) issues the first query:
// SELECT value FROM platform_settings WHERE key = 'new_user_registrations'.
const registrationsOpenMock = () =>
  mockQuery.mockResolvedValueOnce({ rows: [{ value: 'true' }] });

const startPayload = {
  email: 'helper@example.com',
  password: 'SecurePass123!',
  firstName: 'Helper',
  lastName: 'User',
  phone: '+12345678901',
  addressLine1: '1 Elm',
  city: 'Toledo',
  state: 'OH',
  zip: '12345',
  ageConfirmed: true,
};

describe('helper OTP hashing', () => {
  test('start stores the OTP as HMAC, not unsalted SHA-256', async () => {
    registrationsOpenMock();
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // duplicate email check
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // pendingRegistrationsHasRoleColumn
      .mockResolvedValueOnce({ rows: [] }) // delete existing pending row
      .mockResolvedValueOnce({ rows: [{ token: 'generated-token' }] }); // insert pending row

    const res = await request(buildApp())
      .post('/api/helper-registration/start')
      .send(startPayload);
    expect(res.status).toBe(201);

    // The OTP is random; recover it from the mocked email send.
    const sentOtp = sendOTPEmail.mock.calls[0][1];
    expect(sentOtp).toMatch(/^\d{6}$/);
    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      /INSERT INTO pending_registrations/.test(sql));
    expect(insertCall).toBeDefined();
    const storedHash = insertCall[1][11];
    expect(storedHash).toBe(hmacOtp(sentOtp));
    expect(storedHash).not.toBe(unsaltedOtp(sentOtp));
  });

  test('resend stores the OTP as HMAC, not unsalted SHA-256', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ email: 'helper@example.com' }] }); // UPDATE ... RETURNING email

    const res = await request(buildApp())
      .post('/api/helper-registration/resend-otp')
      .send({ token: 'pending-token' });
    expect(res.status).toBe(200);

    const sentOtp = sendOTPEmail.mock.calls[0][1];
    expect(sentOtp).toMatch(/^\d{6}$/);
    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      /UPDATE pending_registrations/.test(sql));
    expect(updateCall).toBeDefined();
    expect(updateCall[1][0]).toBe(hmacOtp(sentOtp));
    expect(updateCall[1][0]).not.toBe(unsaltedOtp(sentOtp));
  });

  test('verify-otp rejects a code stored with the old unsalted hash', async () => {
    const pendingRow = {
      id: 'pending-1',
      email: 'helper@example.com',
      password_hash: 'hashed',
      first_name: 'Helper',
      last_name: 'User',
      phone: null,
      zip_code: null,
      address_line1: null,
      city: null,
      state: null,
      otp_code: unsaltedOtp('123456'),
      otp_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      otp_attempts: 0,
      otp_locked_until: null,
      user_id: null,
      account_created: false,
      terms_accepted_at: new Date().toISOString(),
      terms_version: '2026-03-20',
      terms_acceptance_ip: null,
      terms_acceptance_ua: null,
      signup_device_fingerprint: null,
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [pendingRow] }) // SELECT pending row
      .mockResolvedValueOnce({ rows: [] }) // UPDATE attempts
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = await request(buildApp())
      .post('/api/helper-registration/verify-otp')
      .send({ token: 'pending-token', otp: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid or expired OTP');
  });

  test('verify-otp accepts a code stored with the new HMAC hash', async () => {
    const pendingRow = {
      id: 'pending-1',
      email: 'helper@example.com',
      password_hash: 'hashed',
      first_name: 'Helper',
      last_name: 'User',
      phone: null,
      zip_code: null,
      address_line1: null,
      city: null,
      state: null,
      otp_code: hmacOtp('123456'),
      otp_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      otp_attempts: 0,
      otp_locked_until: null,
      user_id: 'user-1',
      account_created: true,
      terms_accepted_at: new Date().toISOString(),
      terms_version: '2026-03-20',
      terms_acceptance_ip: null,
      terms_acceptance_ua: null,
      signup_device_fingerprint: null,
    };
    const userRow = {
      id: 'user-1',
      first_name: 'Helper',
      last_name: 'User',
      email: 'helper@example.com',
      phone: null,
      role: 'helper',
      email_verified: true,
      is_verified: false,
      onboarding_status: 'verified_pending_onboarding',
      onboarding_completed: false,
      contact_completed: false,
      profile_completed: false,
      tier_selected: true,
      w9_completed: false,
      terms_accepted: true,
      membership_tier: 'tier1',
      id_verified: false,
      background_check_passed: false,
      city: null,
      state: null,
      zip_code: null,
      trial_started_at: null,
      trial_ends_at: null,
      didit_status: null,
      didit_verified_at: null,
      didit_enforcement_required: false,
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [pendingRow] }) // SELECT pending row
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
      .mockResolvedValueOnce({ rows: [userRow] }) // SELECT user row
      .mockResolvedValueOnce({ rows: [] }); // INSERT session

    const res = await request(buildApp())
      .post('/api/helper-registration/verify-otp')
      .send({ token: 'pending-token', otp: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Email verified');
    expect(res.body.user.email).toBe('helper@example.com');
  });
});
