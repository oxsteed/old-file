'use strict';

process.env.DIDIT_API_KEY = 'test-didit-key';

// The email-unverified hole: the API identity gate used to check
// `user.email_verified && !isDiditIdentitySatisfied(user)`, so an
// email-unverified account (admin-created via createUserFull, legacy rows)
// got full API access and skipped the Didit check entirely. The gate must
// now apply to unverified accounts too: they verify email through the
// exempt /api/auth paths, then satisfy Didit like everyone else.
const { mockQuery, resetMocks } = require('./setup');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const tokenRevocationService = require('../services/tokenRevocationService');
const { authenticate } = require('../middleware/auth');

function buildApp() {
  const app = express();
  app.get('/protected', authenticate, (req, res) => {
    res.json({ userId: req.user?.id || null });
  });
  // An exempt path (email verification lives under /api/auth).
  app.get('/api/auth/verify-email', authenticate, (req, res) => {
    res.json({ ok: true });
  });
  return app;
}

function userRow(overrides = {}) {
  return {
    id: 7,
    first_name: 'Test',
    last_name: 'Helper',
    email: 'test@example.com',
    phone: null,
    role: 'helper',
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
  return jwt.sign({ id: 7 }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

beforeEach(() => {
  resetMocks();
  tokenRevocationService.isRevoked.mockResolvedValue(false);
  delete process.env.DIDIT_ALLOW_USER_SKIP; // default: skip open
});

describe('didit API gate for email-unverified accounts', () => {
  test('unverified + skipped is still gated (cannot skip Didit)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [userRow({ email_verified: false, didit_status: 'skipped' })],
    });
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DIDIT_REQUIRED');
  });

  test('unverified + pending is gated', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [userRow({ email_verified: false, didit_status: 'pending' })],
    });
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DIDIT_REQUIRED');
  });

  test('verified + skipped still passes when skip is open (default)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [userRow({ email_verified: true, didit_status: 'skipped' })],
    });
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(7);
  });

  test('verified + pending is still gated', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [userRow({ email_verified: true, didit_status: 'pending' })],
    });
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DIDIT_REQUIRED');
  });

  test('unverified accounts can still reach exempt auth paths (email verification)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [userRow({ email_verified: false, didit_status: 'pending' })],
    });
    const res = await request(buildApp())
      .get('/api/auth/verify-email')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
  });

  test('gate stays disabled when the Didit provider is not configured', async () => {
    delete process.env.DIDIT_API_KEY;
    try {
      mockQuery.mockResolvedValueOnce({
        rows: [userRow({ email_verified: false, didit_status: 'pending' })],
      });
      const res = await request(buildApp())
        .get('/protected')
        .set('Authorization', `Bearer ${token()}`);
      expect(res.status).toBe(200);
    } finally {
      process.env.DIDIT_API_KEY = 'test-didit-key';
    }
  });
});
