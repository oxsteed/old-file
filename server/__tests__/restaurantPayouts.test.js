'use strict';

// Restaurant merchant payout routes (Stripe Connect per restaurant).
// Covers: owner/admin authorization gating, the connect / status /
// disconnect flow, and the response shapes the client panel consumes.
// Stripe and the database are fully mocked (see __tests__/setup.js).

const { mockQuery, resetMocks } = require('./setup');

// Skip the shared connect rate limiter in tests; limiter behavior has its own
// dedicated suite and the daily quota is not part of these assertions.
jest.mock('../middleware/rateLimiter', () => ({
  ...jest.requireActual('../middleware/rateLimiter'),
  connectAccountLimiter: (_req, _res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const restaurantPayoutRoutes = require('../routes/restaurantPayouts');

const OWNER_TOKEN = jwt.sign({ id: 1, email: 'owner@test.com', role: 'customer' }, process.env.JWT_SECRET);
const STAFF_TOKEN = jwt.sign({ id: 2, email: 'staff@test.com', role: 'customer' }, process.env.JWT_SECRET);
const SUPER_TOKEN = jwt.sign({ id: 3, email: 'super@test.com', role: 'super_admin' }, process.env.JWT_SECRET);
const ADMIN_TOKEN = jwt.sign({ id: 4, email: 'admin@test.com', role: 'admin' }, process.env.JWT_SECRET);

function baseUser(overrides) {
  return {
    id: 1, first_name: 'Rita', last_name: 'Owner', email: 'owner@test.com',
    phone: null, role: 'customer', email_verified: true, is_verified: false, is_active: true,
    onboarding_status: 'active', onboarding_completed: true,
    contact_completed: true, profile_completed: true,
    tier_selected: true, w9_completed: false, terms_accepted: true,
    membership_tier: 'free', id_verified: false, background_check_passed: false,
    city: null, state: null, zip_code: null,
    display_name_preference: 'first_name', business_name: null,
    didit_status: 'verified', didit_verified_at: new Date(), didit_enforcement_required: false,
    ...overrides,
  };
}

const RESTAURANT_ID = 7;
const OWNER_ACCESS = { rows: [{ id: RESTAURANT_ID, business_id: 9, effective_role: 'owner' }] };
const STAFF_ACCESS = { rows: [{ id: RESTAURANT_ID, business_id: 9, effective_role: 'manager' }] };
const NO_ACCESS = { rows: [] };

const CONNECT_ROW = {
  restaurant_id: RESTAURANT_ID,
  stripe_account_id: 'acct_rest_7',
  charges_enabled: false,
  payouts_enabled: false,
  onboarding_complete: false,
};

const stripeMock = require('stripe')();
// The shared Stripe mock covers create/retrieve; disconnect also calls
// accounts.del, so add it locally without touching the shared fixture.
if (!stripeMock.accounts.del) stripeMock.accounts.del = jest.fn();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/restaurants', restaurantPayoutRoutes);
  return app;
}

function mockAuth(user, ...extras) {
  mockQuery.mockResolvedValueOnce({ rows: [user] });
  extras.forEach((e) => mockQuery.mockResolvedValueOnce(e));
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  stripeMock.accounts.create.mockReset();
  stripeMock.accounts.retrieve.mockReset();
  stripeMock.accounts.del.mockReset();
});

// ── POST /api/restaurants/:id/payouts/connect ────────────────────────────────
describe('POST /api/restaurants/:id/payouts/connect', () => {
  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).post(`/api/restaurants/${RESTAURANT_ID}/payouts/connect`).send({});
    expect(res.status).toBe(401);
  });

  test('returns 404 when the restaurant does not exist', async () => {
    mockAuth(baseUser(), NO_ACCESS);
    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/payouts/connect`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({});
    expect(res.status).toBe(404);
  });

  test('returns 403 for staff who are not the owner and not admins', async () => {
    mockAuth(baseUser({ id: 2, email: 'staff@test.com' }), STAFF_ACCESS);
    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/payouts/connect`)
      .set('Authorization', `Bearer ${STAFF_TOKEN}`)
      .send({});
    expect(res.status).toBe(403);
  });

  test('returns 503 when Stripe is not configured', async () => {
    const saved = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      mockAuth(baseUser(), OWNER_ACCESS);
      const res = await request(buildApp())
        .post(`/api/restaurants/${RESTAURANT_ID}/payouts/connect`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({});
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('stripe_not_configured');
    } finally {
      process.env.STRIPE_SECRET_KEY = saved;
    }
  });

  test('owner with no account creates an Express account and gets an onboarding link', async () => {
    stripeMock.accounts.create.mockResolvedValue({ id: 'acct_rest_7' });
    mockAuth(baseUser(), OWNER_ACCESS, { rows: [] }, { rows: [{ stripe_account_id: 'acct_rest_7' }] });
    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/payouts/connect`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({ return_path: '/food/merchant' });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://stripe.com/onboard');
    expect(res.body.account_id).toBe('acct_rest_7');
    expect(stripeMock.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'express', country: 'US' }),
      expect.objectContaining({ idempotencyKey: `oxsteed-restaurant-connect-account:${RESTAURANT_ID}` })
    );
  });

  test('owner with an incomplete account gets a fresh onboarding link', async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: { currently_due: ['business_profile.url'], past_due: [] },
      country: 'US',
      default_currency: 'usd',
    });
    mockAuth(baseUser(), OWNER_ACCESS, { rows: [CONNECT_ROW] });
    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/payouts/connect`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.onboarding_url).toBe('https://stripe.com/onboard');
    expect(res.body.account_id).toBe('acct_rest_7');
  });

  test('owner with a complete account gets "already set up"', async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [], past_due: [] },
      country: 'US',
      default_currency: 'usd',
    });
    mockAuth(
      baseUser(),
      OWNER_ACCESS,
      { rows: [{ ...CONNECT_ROW, charges_enabled: true, payouts_enabled: true, onboarding_complete: true }] }
    );
    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/payouts/connect`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Account already set up');
  });

  test('super_admin can connect for a restaurant they do not own', async () => {
    stripeMock.accounts.create.mockResolvedValue({ id: 'acct_rest_7' });
    mockAuth(
      baseUser({ id: 3, email: 'super@test.com', role: 'super_admin' }),
      { rows: [{ id: RESTAURANT_ID }] },
      { rows: [] },
      { rows: [{ stripe_account_id: 'acct_rest_7' }] }
    );
    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/payouts/connect`)
      .set('Authorization', `Bearer ${SUPER_TOKEN}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://stripe.com/onboard');
  });

  test('regular admin without the grant is rejected', async () => {
    mockAuth(
      baseUser({ id: 4, email: 'admin@test.com', role: 'admin' }),
      { rows: [{ id: RESTAURANT_ID }] },
      { rows: [] } // no grant row
    );
    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/payouts/connect`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({});
    expect(res.status).toBe(403);
  });
});

// ── GET /api/restaurants/:id/payouts/status ──────────────────────────────────
describe('GET /api/restaurants/:id/payouts/status', () => {
  test('returns 403 for staff who are not the owner', async () => {
    mockAuth(baseUser({ id: 2, email: 'staff@test.com' }), STAFF_ACCESS);
    const res = await request(buildApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/payouts/status`)
      .set('Authorization', `Bearer ${STAFF_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('returns connected:false when no account exists', async () => {
    mockAuth(baseUser(), OWNER_ACCESS, { rows: [] });
    const res = await request(buildApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/payouts/status`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });

  test('returns the full status shape for a connected account', async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
      requirements: { currently_due: [], past_due: [] },
      country: 'US',
      default_currency: 'usd',
    });
    mockAuth(baseUser(), OWNER_ACCESS, { rows: [CONNECT_ROW] });
    const res = await request(buildApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/payouts/status`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.stripe_account_id).toBe('acct_rest_7');
    expect(res.body.status_verified).toBe(true);
    expect(res.body.stripe_connect_ready).toBe(true);
    expect(res.body.stripe_connect_payouts_ready).toBe(false);
    expect(res.body.stripe_connect_onboarded).toBe(true);
    expect(res.body.next_payout).toBeNull();
  });
});

// ── POST /api/restaurants/:id/payouts/disconnect ─────────────────────────────
describe('POST /api/restaurants/:id/payouts/disconnect', () => {
  test('returns 403 for staff who are not the owner', async () => {
    mockAuth(baseUser({ id: 2, email: 'staff@test.com' }), STAFF_ACCESS);
    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/payouts/disconnect`)
      .set('Authorization', `Bearer ${STAFF_TOKEN}`)
      .send({});
    expect(res.status).toBe(403);
  });

  test('owner disconnect removes the local link and returns success', async () => {
    stripeMock.accounts.del.mockResolvedValue({});
    mockAuth(baseUser(), OWNER_ACCESS, { rows: [CONNECT_ROW] }, { rows: [] });
    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/payouts/disconnect`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(stripeMock.accounts.del).toHaveBeenCalledWith('acct_rest_7');
  });

  test('disconnect with no account is a no-op success', async () => {
    mockAuth(baseUser(), OWNER_ACCESS, { rows: [] });
    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/payouts/disconnect`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(stripeMock.accounts.del).not.toHaveBeenCalled();
  });
});
