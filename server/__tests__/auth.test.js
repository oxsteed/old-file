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

// Load after mocks are set up
const express = require('express');
const request = require('supertest');
const jwt     = require('jsonwebtoken');
const authRoutes = require('../routes/auth');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

// Valid JWT for routes that require authentication (e.g. logout)
const TEST_TOKEN = jwt.sign(
  { id: 1, email: 'test@example.com', role: 'customer' },
  process.env.JWT_SECRET
);

const MOCK_AUTH_USER = {
  id: 1, first_name: 'Test', last_name: 'User',
  email: 'test@example.com', phone: null, role: 'customer',
  email_verified: true, is_verified: false,
  onboarding_status: 'active', onboarding_completed: true,
  contact_completed: true, profile_completed: true,
  tier_selected: true, w9_completed: false, terms_accepted: true,
  membership_tier: 'free', id_verified: false, background_check_passed: false,
  city: null, state: null, zip_code: null,
  display_name_preference: 'first_name', business_name: null, is_active: true,
};

beforeEach(() => resetMocks());

// ── Helpers ──────────────────────────────────────────────────────────────────
const validRegisterBody = {
  email:      'test@example.com',
  password:   'SecurePass123!',
  first_name: 'Jane',
  last_name:  'Doe',
  role:       'customer',
};

// ── POST /api/auth/register ───────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  test('returns 400 when email is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ ...validRegisterBody, email: '' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when password is too short', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ ...validRegisterBody, password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('fields');
    expect(res.body.fields).toHaveProperty('password');
  });

  test('returns 409 when email already registered', async () => {
    // First query: check existing email → return a row (conflict)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const res = await request(buildApp())
      .post('/api/auth/register')
      .send(validRegisterBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
  });

  test('registers successfully and returns tokens', async () => {
    const insertedUser = { id: 42, email: 'test@example.com', role: 'customer' };
    const fullUser = {
      id: 42, first_name: 'Jane', last_name: 'Doe',
      email: 'test@example.com', phone: null, role: 'customer',
      email_verified: false, is_verified: false,
      onboarding_status: 'registered', onboarding_completed: false,
      contact_completed: false, profile_completed: false, tier_selected: false,
      w9_completed: false, terms_accepted: false, membership_tier: 'free',
      city: null, state: null, zip_code: null,
      trial_started_at: null, trial_ends_at: null,
      didit_status: 'pending', didit_verified_at: null,
      id_verified: false, background_check_passed: false,
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [] })               // 1. check existing email
      .mockResolvedValueOnce({ rows: [insertedUser] })   // 2. INSERT user
      .mockResolvedValueOnce({ rows: [] })               // 3. INSERT session
      .mockResolvedValueOnce({ rows: [fullUser] });      // 4. SELECT full user

    const res = await request(buildApp())
      .post('/api/auth/register')
      .send(validRegisterBody);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user).toMatchObject({ email: 'test@example.com' });
  });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  test('returns 400 when fields are missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: '', password: '' });
    expect(res.status).toBe(400);
  });

  test('returns 401 when user not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'SomePass123' });
    expect(res.status).toBe(401);
  });

  test('returns 401 when password is wrong', async () => {
    // bcrypt.compare will fail because the stored hash won't match
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, email: 'test@example.com',
      password_hash: '$2b$12$invalid_hash_that_never_matches',
      is_active: true, totp_enabled: false, role: 'customer',
    }] });

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'WrongPassword!' });
    expect(res.status).toBe(401);
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
// logout requires authenticate middleware, so we must send a valid JWT
describe('POST /api/auth/logout', () => {
  test('returns 200 and clears session', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [MOCK_AUTH_USER] })  // authenticate lookup
      .mockResolvedValueOnce({ rows: [] });               // UPDATE sessions

    const res = await request(buildApp())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ refreshToken: 'some-refresh-token' });
    expect(res.status).toBe(200);
  });

  test('returns 401 when no token provided', async () => {
    const res = await request(buildApp())
      .post('/api/auth/logout')
      .send({});
    expect(res.status).toBe(401);
  });
});
