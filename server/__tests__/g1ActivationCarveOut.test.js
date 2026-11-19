'use strict';

/**
 * G-1 carve-out: the routes a helper must use to complete payout setup stay
 * reachable while activation is incomplete. Without this, restoring
 * payout_setup to helper.offer_services would be a circular gate: the
 * helper could never finish the very setup the gate demands.
 *
 * Carved out via requireHelperSetupCapability (allowActivationIncomplete):
 *   POST /helper-registration/w9            (authenticate-only, no gate)
 *   POST /helper-registration/accept-terms
 *   GET  /helper-registration/onboarding/status
 * (POST /payments/connect is covered in payment.test.js; the Didit
 * /api/didit/session + webhook routes are authenticate-only / unauthenticated
 * webhook and carry no capability gate.)
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'helper-1', role: 'helper' };
    next();
  },
}));
jest.mock('../middleware/rateLimiter', () => ({
  authLimiter: (_req, _res, next) => next(),
  generalLimiter: (_req, _res, next) => next(),
}));

const helperRegistrationRoutes = require('../routes/helperRegistration');

// Identity + terms satisfied, payout_setup missing: no W-9, no Connect
// account. Holds the grant but is not activated.
const INCOMPLETE_HELPER = {
  id: 'helper-1', first_name: 'Ava', last_name: 'Agent', email: 'a@test.com',
  phone: null, role: 'helper', email_verified: true, is_verified: true, is_active: true,
  onboarding_status: 'pending', onboarding_completed: false,
  contact_completed: true, profile_completed: false,
  tier_selected: false, w9_completed: false, terms_accepted: true,
  terms_accepted_at: new Date(), terms_version: 'test-v1',
  membership_tier: 'free', id_verified: true, background_check_passed: false,
  city: 'Austin', state: 'TX', zip_code: '78701',
  display_name_preference: 'first_name', business_name: null,
  didit_status: 'verified', didit_verified_at: new Date(), didit_enforcement_required: false,
  identity_verified: true, connect_charges_enabled: false, connect_payouts_enabled: false,
};

const ACCESS_GRANT = {
  id: 1, capability: 'helper.offer_services', subject_type: 'self', subject_id: null,
  status: 'active', expires_at: null, provenance: 'legacy_backfill', version: 1,
};

function routeGateQueries() {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM users u[\s\S]*LEFT JOIN connect_accounts ca/.test(sql)) return { rows: [INCOMPLETE_HELPER] };
    if (/FROM users WHERE id/.test(sql)) return { rows: [INCOMPLETE_HELPER] };
    if (/FROM access_grants/.test(sql)) return { rows: [ACCESS_GRANT] };
    if (/FROM businesses b/.test(sql)) return { rows: [] };
    if (/FROM restaurant_locations rl/.test(sql)) return { rows: [] };
    if (/FROM food_restaurants|FROM franchise_applications/.test(sql)) return { rows: [] };
    if (/INSERT INTO w9_records/.test(sql)) return { rows: [], rowCount: 1 };
    if (/UPDATE users\s+SET w9_completed/.test(sql)) return { rows: [], rowCount: 1 };
    if (/UPDATE users\s+SET terms_accepted/.test(sql)) return { rows: [{ id: 'helper-1' }] };
    return { rows: [], rowCount: 0 };
  });
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/helper-registration', helperRegistrationRoutes);
  return app;
}

beforeEach(() => resetMocks());

describe('G-1 payout-setup carve-out', () => {
  test('POST /w9 succeeds while activation is incomplete', async () => {
    routeGateQueries();
    const res = await request(buildApp())
      .post('/api/helper-registration/w9')
      .send({
        legalName: 'Ava Agent',
        businessName: 'Ava Services',
        taxClassification: 'individual',
        tin: '123456789',
        address: '1 Main St',
        signatureData: 'signed',
        certify: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('W9 saved successfully');
  });

  test('POST /accept-terms succeeds while activation is incomplete', async () => {
    routeGateQueries();
    const res = await request(buildApp()).post('/api/helper-registration/accept-terms').send({});
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Terms accepted');
  });

  test('GET /onboarding/status succeeds while activation is incomplete', async () => {
    routeGateQueries();
    const res = await request(buildApp()).get('/api/helper-registration/onboarding/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('onboarding_step');
    expect(res.body.w9_completed).toBe(false);
  });
});
