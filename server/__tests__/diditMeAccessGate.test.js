'use strict';

process.env.DIDIT_API_KEY = 'test-didit-key';

// Domain 6 B2 (2026-11-17): the server Didit gate 403'd every non-exempt
// API path for Didit-pending users, including GET /api/me/access, so a
// Didit-pending customer rendered a dead dashboard (ProtectedRoute does
// not redirect plain customers to /verify-identity). GET /api/me/* is now
// exempt from the Didit gate for email-verified, non-enforcement users:
// every route under /api/me is a self-scoped read. Writes under /api/me
// and every other path stay gated, and enforcement, email-unverified and
// duplicate accounts stay gated everywhere.
const { mockQuery, resetMocks } = require('./setup');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const tokenRevocationService = require('../services/tokenRevocationService');
const { authenticate } = require('../middleware/auth');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/api/me/access', authenticate, (req, res) => {
    res.json({ userId: req.user?.id || null });
  });
  app.get('/api/me/access-policies', authenticate, (req, res) => {
    res.json({ userId: req.user?.id || null });
  });
  app.post('/api/me/access-requests', authenticate, (req, res) => {
    res.json({ userId: req.user?.id || null });
  });
  app.get('/api/protected', authenticate, (req, res) => {
    res.json({ userId: req.user?.id || null });
  });
  return app;
}

function userRow(overrides = {}) {
  return {
    id: 7,
    first_name: 'Test',
    last_name: 'Customer',
    email: 'test@example.com',
    phone: null,
    role: 'customer',
    email_verified: true,
    is_verified: false,
    onboarding_status: 'onboarding_complete',
    onboarding_completed: true,
    contact_completed: true,
    profile_completed: true,
    tier_selected: true,
    w9_completed: false,
    terms_accepted: true,
    membership_tier: 'tier1',
    id_verified: false,
    background_check_passed: false,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    zip_code: null,
    country: 'US',
    bio: null,
    profile_photo_url: null,
    preferred_language: 'en',
    display_name_preference: 'first_name',
    is_active: true,
    didit_status: 'pending',
    didit_verified_at: null,
    is_suspended: false,
    suspended_until: null,
    suspended_reason: null,
    didit_enforcement_required: false,
    trial_started_at: null,
    trial_ends_at: null,
    connect_stripe_account_id: null,
    connect_charges_enabled: false,
    connect_payouts_enabled: false,
    connect_onboarding_complete: false,
    ...overrides,
  };
}

function token() {
  return jwt.sign({ typ: 'access', sid: 'test-session', id: 7 }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

beforeEach(() => {
  resetMocks();
  tokenRevocationService.isRevoked.mockResolvedValue(false);
  delete process.env.DIDIT_ALLOW_USER_SKIP; // default: skip open
});

describe('didit gate read-only self-service exemption (B2)', () => {
  test('Didit-pending customer can GET /api/me/access', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [userRow()] });
    const res = await request(buildApp())
      .get('/api/me/access')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(7);
  });

  test('Didit-pending customer can GET other read-only /api/me routes', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [userRow()] });
    const res = await request(buildApp())
      .get('/api/me/access-policies')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
  });

  test('helper-activation write under /api/me still 403s for a Didit-pending customer', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [userRow()] });
    const res = await request(buildApp())
      .post('/api/me/access-requests')
      .set('Authorization', `Bearer ${token()}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DIDIT_REQUIRED');
  });

  test('Didit-pending customer is still gated off /api/me', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [userRow()] });
    const res = await request(buildApp())
      .get('/api/protected')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DIDIT_REQUIRED');
  });

  test('didit_enforcement_required user stays gated on GET /api/me/access', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [userRow({ didit_enforcement_required: true })],
    });
    const res = await request(buildApp())
      .get('/api/me/access')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DIDIT_REQUIRED');
  });

  test('email-unverified user stays gated on GET /api/me/access', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [userRow({ email_verified: false })],
    });
    const res = await request(buildApp())
      .get('/api/me/access')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DIDIT_REQUIRED');
  });

  test('duplicate identity stays gated on GET /api/me/access', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [userRow({ didit_status: 'duplicate' })],
    });
    const res = await request(buildApp())
      .get('/api/me/access')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DIDIT_DUPLICATE_IDENTITY');
  });

  test('stale-verified user can read /api/me/access but is still gated elsewhere', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [userRow({ didit_status: 'verified', didit_verified_at: '2020-01-01T00:00:00.000Z' })],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [userRow({ didit_status: 'verified', didit_verified_at: '2020-01-01T00:00:00.000Z' })],
    });
    const app = buildApp();
    const me = await request(app)
      .get('/api/me/access')
      .set('Authorization', `Bearer ${token()}`);
    expect(me.status).toBe(200);
    const other = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${token()}`);
    expect(other.status).toBe(403);
    expect(other.body.code).toBe('DIDIT_REQUIRED');
  });

  test('skipped and fresh-verified users can GET /api/me/access', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [userRow({ didit_status: 'skipped' })] });
    mockQuery.mockResolvedValueOnce({
      rows: [userRow({ didit_status: 'verified', didit_verified_at: new Date().toISOString() })],
    });
    const app = buildApp();
    const skipped = await request(app)
      .get('/api/me/access')
      .set('Authorization', `Bearer ${token()}`);
    expect(skipped.status).toBe(200);
    const verified = await request(app)
      .get('/api/me/access')
      .set('Authorization', `Bearer ${token()}`);
    expect(verified.status).toBe(200);
  });
});
