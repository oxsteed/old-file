'use strict';

process.env.DIDIT_API_KEY = 'synthetic-didit-provider';

// Review P2-7-F13: the API gate 403 for didit_status='duplicate' must return
// the actionable in-app recovery message (with locale keys), not the generic
// identity_verification_required body.
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
    didit_status: 'duplicate',
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

beforeEach(() => {
  resetMocks();
  tokenRevocationService.isRevoked.mockResolvedValue(false);
});

describe('didit duplicate API gate', () => {
  test("duplicate status returns DIDIT_DUPLICATE_IDENTITY with locale keys and recovery steps", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [userRow()] });
    const token = jwt.sign({ id: 7 }, process.env.JWT_SECRET, { algorithm: 'HS256' });

    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DIDIT_DUPLICATE_IDENTITY');
    expect(res.body.didit_status).toBe('duplicate');
    expect(res.body.message_key).toBe('didit.duplicateGateMessage');
    expect(res.body.error).toMatch(/already linked to an existing/i);
    expect(res.body.recovery_steps).toEqual([
      { key: 'didit.duplicateRecoverySignIn' },
      { key: 'didit.duplicateRecoveryReset' },
      { key: 'didit.duplicateRecoverySupport' },
    ]);
    expect(res.body.sign_in_url).toBe('/login');
    expect(res.body.support_url).toBe('/support');
  });

  test('non-duplicate unverified status keeps the generic DIDIT_REQUIRED body', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [userRow({ didit_status: 'pending' })] });
    const token = jwt.sign({ id: 7 }, process.env.JWT_SECRET, { algorithm: 'HS256' });

    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DIDIT_REQUIRED');
    expect(res.body.message_key).toBeUndefined();
  });
});
