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

beforeEach(() => {
  resetMocks();
  process.env.ACCESS_PROJECTION_ENABLED = 'false';
  delete process.env.ACCESS_PILOT_USER_IDS;
});

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
    expect(res.body.data.profile.mode.intent).toBe('find_help');
    expect(res.body.data.profile.mode.defaultMode).toBeUndefined();
    expect(res.body.data.profile.verification.diditEnforcementRequired).toBe(true);
    expect(res.body.data.profile.verification.identityVerificationRequired).toBe(true);
    expect(res.body.data.languages.map((language) => language.code)).toEqual(
      expect.arrayContaining(['en', 'es', 'fr', 'ht', 'ar'])
    );
  });

  test('returns the signup intent for a helper-mode account instead of the mode', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [userRow({ role: 'helper', default_mode: 'helper' })],
    });

    const res = await request(buildApp())
      .get('/api/mobile/profile')
      .set('Authorization', authHeader({ role: 'helper' }));

    expect(res.status).toBe(200);
    expect(res.body.data.profile.mode.intent).toBe('offer_services');
    expect(res.body.data.profile.mode.defaultMode).toBeUndefined();
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

  test('returns the capability projection and retires mobile mode switching when enabled', async () => {
    process.env.ACCESS_PROJECTION_ENABLED = 'true';
    mockQuery
      // authenticate
      .mockResolvedValueOnce({ rows: [userRow({ default_mode: 'helper' })] })
      // access projection facts, open requests, and version
      .mockResolvedValueOnce({ rows: [{ id: USER_ID, role: 'customer', is_active: true, deleted_at: null, is_suspended: false, suspended_until: null, is_banned: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'grant-1', capability: 'helper.offer_services', subject_type: 'self', status: 'active', expires_at: null, provenance: 'application' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ n: 0 }] })
      .mockResolvedValueOnce({ rows: [{ version: 7 }] });

    const res = await request(buildApp())
      .get('/api/mobile/profile')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.flags.accessProjection).toBe(true);
    expect(res.body.data.access.version).toBe(7);
    expect(res.body.data.access.personal).toEqual(expect.arrayContaining(['customer', 'helper.offer_services']));
    expect(res.body.data.profile.mode).toMatchObject({
      accessControlled: true,
      selfSelectableModes: ['customer'],
      grantedModes: [],
    });
    expect(res.body.data.profile.mode.intent).toBe('offer_services');
  });

  // WP-104: mobile profile writes take an intent. A customer asking for the
  // helper intent is gated (no grant, no business ownership), so the switch
  // is ignored rather than granted; the same request with the legacy
  // defaultMode field behaves identically, so old clients keep working.
  test('ignores an intent the account has no access for instead of raising authority', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [userRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: USER_ID, role: 'customer', is_active: true, deleted_at: null, is_suspended: false, suspended_until: null, is_banned: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [userRow()] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .patch('/api/mobile/profile')
      .set('Authorization', authHeader())
      .send({ intent: 'offer_services' });

    expect(res.status).toBe(200);
    expect(res.body.data.modeSwitched).toBe(false);
    expect(res.body.data.modeChangeIgnored).toEqual({ code: 'access_required', capability: 'helper.offer_services' });
    expect(res.body.data.profile.mode.intent).toBe('find_help');
  });

  test('legacy defaultMode still works for old clients and is gated the same way', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [userRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: USER_ID, role: 'customer', is_active: true, deleted_at: null, is_suspended: false, suspended_until: null, is_banned: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [userRow()] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .patch('/api/mobile/profile')
      .set('Authorization', authHeader())
      .send({ defaultMode: 'helper' });

    expect(res.status).toBe(200);
    expect(res.body.data.modeSwitched).toBe(false);
    expect(res.body.data.modeChangeIgnored).toEqual({ code: 'access_required', capability: 'helper.offer_services' });
  });

  test('an intent switch to find_help moves a helper-mode account back to customer', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [userRow({ role: 'helper', default_mode: 'helper' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: USER_ID, role: 'helper', default_mode: 'helper' }] })
      .mockResolvedValueOnce({ rows: [{ id: USER_ID }] })
      .mockResolvedValueOnce({ rows: [userRow({ role: 'customer', default_mode: 'customer' })] })
      .mockResolvedValueOnce({ rows: [userRow({ role: 'customer', default_mode: 'customer' })] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .patch('/api/mobile/profile')
      .set('Authorization', authHeader({ role: 'helper' }))
      .send({ intent: 'find_help' });

    expect(res.status).toBe(200);
    expect(res.body.data.modeSwitched).toBe(true);
    expect(res.body.data.profile.role).toBe('customer');
    expect(res.body.data.profile.mode.intent).toBe('find_help');
  });

  test('rejects an unknown intent instead of collapsing it into a mode', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [userRow()] });

    const res = await request(buildApp())
      .patch('/api/mobile/profile')
      .set('Authorization', authHeader())
      .send({ intent: 'become_admin' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.fields.intent).toMatch(/Unsupported intent/);
  });
});
