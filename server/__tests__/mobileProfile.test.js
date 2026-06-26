'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { generateTokens } = require('../middleware/auth');
const mobileRoutes = require('../routes/mobile');

const USER_ID = '00000000-0000-4000-8000-000000000777';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mobile', mobileRoutes);
  app.use(errorHandler);
  return app;
}

function authHeader(user = {}) {
  const { accessToken } = generateTokens({
    id: USER_ID,
    email: 'mobile@example.com',
    role: 'customer',
    ...user,
  });
  return `Bearer ${accessToken}`;
}

function userRow(overrides = {}) {
  return {
    id: USER_ID,
    first_name: 'Mobile',
    last_name: 'User',
    email: 'mobile@example.com',
    phone: '+19375550100',
    role: 'customer',
    email_verified: true,
    is_verified: false,
    onboarding_status: 'onboarding_complete',
    onboarding_completed: true,
    contact_completed: true,
    profile_completed: true,
    tier_selected: false,
    w9_completed: false,
    terms_accepted: true,
    membership_tier: 'free',
    id_verified: false,
    background_check_passed: false,
    address_line1: '10 Main St',
    city: 'Columbus',
    state: 'OH',
    zip_code: '43215',
    country: 'US',
    preferred_language: 'en',
    display_name_preference: 'first_name',
    is_active: true,
    didit_status: 'pending',
    didit_verified_at: null,
    didit_enforcement_required: false,
    trial_started_at: null,
    trial_ends_at: null,
    default_mode: 'customer',
    logistics_role: null,
    business_name: null,
    is_listed: false,
    allow_guest_contact: true,
    allow_booking: true,
    allow_scheduling: true,
    allow_live_chat: true,
    ...overrides,
  };
}

beforeEach(() => resetMocks());

describe('mobile authenticated profile API', () => {
  test('returns app-shaped profile with mode, country, language, and verification status', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [userRow({ didit_enforcement_required: true, didit_status: 'pending', preferred_language: 'fr', country: 'HT' })],
    });

    const res = await request(buildApp())
      .get('/api/mobile/profile')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profile.fullName).toBe('Mobile User');
    expect(res.body.data.profile.preferences.language).toBe('fr');
    expect(res.body.data.profile.preferences.country).toBe('HT');
    expect(res.body.data.profile.preferences.currencyCode).toBe('HTG');
    expect(res.body.data.profile.mode.defaultMode).toBe('customer');
    expect(res.body.data.profile.verification.diditEnforcementRequired).toBe(true);
    expect(res.body.data.profile.verification.identityVerificationRequired).toBe(true);
    expect(res.body.data.languages.map((language) => language.code)).toEqual(
      expect.arrayContaining(['en', 'es', 'fr', 'ht', 'ar'])
    );
  });

  test('updates mobile profile preferences and address fields', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [userRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [userRow({
          phone: '+50937000000',
          preferred_language: 'ht',
          country: 'HT',
          address_line1: '22 Rue Test',
          city: 'Port-au-Prince',
          state: 'Ouest',
          zip_code: 'HT6110',
        })],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .patch('/api/mobile/profile')
      .set('Authorization', authHeader())
      .send({
        phone: '+50937000000',
        preferredLanguage: 'ht',
        country: 'HT',
        addressLine1: '22 Rue Test',
        city: 'Port-au-Prince',
        state: 'Ouest',
        zip: 'HT6110',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.profile.preferences.language).toBe('ht');
    expect(res.body.data.profile.address.country).toBe('HT');
    expect(res.body.data.profile.address.city).toBe('Port-au-Prince');
    expect(res.body.data.modeSwitched).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE users/.test(sql))).toBe(true);
  });

  test('rejects unsupported mobile profile language', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [userRow()] });

    const res = await request(buildApp())
      .patch('/api/mobile/profile')
      .set('Authorization', authHeader())
      .send({ preferredLanguage: 'pt' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.fields.preferredLanguage).toMatch(/Supported languages/);
  });
});
