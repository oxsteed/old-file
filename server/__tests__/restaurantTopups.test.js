'use strict';

/**
 * Tests for restaurant customer top-ups with OxSteed approval (migration 663).
 *
 * Covers the founder-rule flow end to end at the service + route level:
 * eligibility gating at intent AND at webhook time, idempotent webhooks,
 * fail-closed paths, the approval flow, clawback (including negative
 * balances), limits, step-up mirroring, and rate limiting.
 *
 * Stripe and the database are fully mocked (see __tests__/setup.js); the
 * Stripe PaymentIntent is never really created.
 */

const { mockQuery, resetMocks } = require('./setup');

// Pass the intent rate limiter through; limiter behavior has its own suite.
jest.mock('../middleware/rateLimiter', () => ({
  ...jest.requireActual('../middleware/rateLimiter'),
  restaurantTopupIntentLimiter: (_req, _res, next) => next(),
}));

// Fake the admin gate: every admin route test runs as a super-admin.
const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
jest.mock('../middleware/adminAuth', () => ({
  requireAdmin: (req, _res, next) => {
    req.user = { id: ADMIN_ID, role: 'super_admin' };
    req.isSuper = true;
    req.isSuperAdmin = true;
    next();
  },
  requirePermission: () => (_req, _res, next) => next(),
  requireSuperAdminOrPermission: () => (_req, _res, next) => next(),
  requireSuperAdmin: (_req, _res, next) => next(),
}));

// Step-up: real threshold logic lives in the top-up service; only the
// challenge verify/issue calls are mocked here.
jest.mock('../services/stepupChallengeService', () => ({
  ...jest.requireActual('../services/stepupChallengeService'),
  verifyStepupChallenge: jest.fn(),
  issueStepupChallenge: jest.fn(),
}));

// Dual-posting to the central journal is out of scope for these tests; the
// wallet ledger write itself is asserted through the mocked query stream.
jest.mock('../services/oxsteedCreditSubBankService', () => ({
  postFoodWalletDualEntry: jest.fn().mockResolvedValue({ posted: true }),
}));

jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ id: 'incident-1' }),
}));

// The webhook route offers the event to local-delivery payments before the
// switch; keep that surface out of these tests.
jest.mock('../services/localDeliveryPaymentService', () => ({
  handleStripeEvent: jest.fn().mockResolvedValue({ handled: false }),
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')();
const { AppError, errorHandler } = require('../middleware/errorHandler');

const topupService = require('../services/restaurantTopupService');
const restaurantTopupRoutes = require('../routes/restaurantTopups');
const adminRestaurantTopupRoutes = require('../routes/adminRestaurantTopups');
const stepupService = require('../services/stepupChallengeService');
const subBankService = require('../services/oxsteedCreditSubBankService');
const incidentStore = require('../services/incidentStore');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';
const RESTAURANT_ID = 7;
const TOPUP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const USER_TOKEN = jwt.sign({ id: USER_ID }, process.env.JWT_SECRET, { expiresIn: '15m' });
const OTHER_USER_TOKEN = jwt.sign({ id: OTHER_USER_ID }, process.env.JWT_SECRET, { expiresIn: '15m' });

function baseUser(overrides) {
  return {
    id: USER_ID, first_name: 'Pat', last_name: 'Customer', email: 'pat@test.com',
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

const OWNER_ACCESS = { rows: [{ id: RESTAURANT_ID, business_id: 9, effective_role: 'owner' }] };
const STAFF_ACCESS = { rows: [{ id: RESTAURANT_ID, business_id: 9, effective_role: 'manager' }] };
const NO_ACCESS = { rows: [] };

const ACTIVE_RESTAURANT = {
  rows: [{ id: RESTAURANT_ID, business_id: 9, status: 'active', currency_code: 'USD', display_name: 'Test Kitchen' }],
};
const SUSPENDED_RESTAURANT = {
  rows: [{ id: RESTAURANT_ID, business_id: 9, status: 'suspended', currency_code: 'USD', display_name: 'Test Kitchen' }],
};

const CONNECTED_PAYOUTS = {
  rows: [{
    restaurant_id: RESTAURANT_ID, stripe_account_id: 'acct_rest_7',
    charges_enabled: true, payouts_enabled: true, onboarding_complete: true,
  }],
};
const NO_PAYOUTS = { rows: [] };
const PAYOUTS_NOT_READY = {
  rows: [{
    restaurant_id: RESTAURANT_ID, stripe_account_id: 'acct_rest_7',
    charges_enabled: false, payouts_enabled: false, onboarding_complete: false,
  }],
};

const ELIGIBILITY_APPROVED = {
  rows: [{
    restaurant_id: RESTAURANT_ID, status: 'approved', version: 1,
    applied_at: '2026-10-01T10:00:00.000Z', decided_at: '2026-10-01T11:00:00.000Z',
    decided_by: ADMIN_ID, decision_reason: null,
    created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T11:00:00.000Z',
  }],
};
const ELIGIBILITY_SUSPENDED = {
  rows: [{ ...ELIGIBILITY_APPROVED.rows[0], status: 'suspended', decision_reason: 'chargeback spike' }],
};
const ELIGIBILITY_REJECTED = {
  rows: [{ ...ELIGIBILITY_APPROVED.rows[0], status: 'rejected', decision_reason: 'missing documents' }],
};
const ELIGIBILITY_PENDING = {
  rows: [{ ...ELIGIBILITY_APPROVED.rows[0], status: 'pending', decided_at: null, decided_by: null }],
};
const NO_ELIGIBILITY = { rows: [] };

const DAILY_CAP_ZERO = { rows: [{ spent_cents: '0' }] };

function baseTopupRow(overrides = {}) {
  return {
    id: TOPUP_ID,
    restaurant_id: RESTAURANT_ID,
    user_id: USER_ID,
    amount_cents: 5000,
    currency: 'USD',
    stripe_payment_intent_id: null,
    status: 'pending',
    idempotency_key: 'idem-key-1',
    wallet_ledger_entry_id: null,
    expires_at: '2031-10-01T14:30:00.000Z',
    created_at: '2026-10-01T14:00:00.000Z',
    updated_at: '2026-10-01T14:00:00.000Z',
    ...overrides,
  };
}

const WALLET_ACCOUNT = {
  id: 501, restaurant_id: RESTAURANT_ID, customer_id: USER_ID,
  currency_code: 'USD', balance_cents: 0, reserved_cents: 0, status: 'active',
  ledger_version: 3, last_entry_hash: 'prevhash', last_posted_at: null,
};

function buildMerchantApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/restaurants', restaurantTopupRoutes);
  return app;
}

function buildAdminApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/restaurant-topups', adminRestaurantTopupRoutes);
  return app;
}

// Queue: authenticate user row, then the service queries in order.
function mockAuthed(overrides, ...serviceQueries) {
  mockQuery.mockResolvedValueOnce({ rows: [baseUser(overrides)] });
  serviceQueries.forEach((q) => mockQuery.mockResolvedValueOnce(q));
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  stepupService.verifyStepupChallenge.mockResolvedValue({ verified: true });
  stepupService.issueStepupChallenge.mockResolvedValue({
    challenge: { id: 'ch_1', actionType: 'restaurant_topup', amountCents: 30000, currencyCode: 'USD', expiresAt: '2031-01-01T00:00:00.000Z' },
    delivery: { delivered: true },
  });
  stripe.paymentIntents.create.mockResolvedValue({ id: 'pi_test_1', client_secret: 'cs_test_1' });
  if (!stripe.paymentIntents.retrieve) stripe.paymentIntents.retrieve = jest.fn();
  stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_test_1', client_secret: 'cs_test_1' });
  subBankService.postFoodWalletDualEntry.mockResolvedValue({ posted: true });
  incidentStore.recordIncident.mockResolvedValue({ id: 'incident-1' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Merchant application ────────────────────────────────────────────────────
describe('POST /api/restaurants/:restaurantId/topup-eligibility/apply', () => {
  test('returns 401 without a token', async () => {
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topup-eligibility/apply`)
      .send({});
    expect(res.status).toBe(401);
  });

  test('returns 404 when the restaurant does not exist', async () => {
    mockAuthed({}, NO_ACCESS);
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topup-eligibility/apply`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('restaurant_not_found');
  });

  test('returns 403 for staff who are not the owner', async () => {
    mockAuthed({ id: OTHER_USER_ID }, STAFF_ACCESS);
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topup-eligibility/apply`)
      .set('Authorization', `Bearer ${OTHER_USER_TOKEN}`)
      .send({});
    expect(res.status).toBe(403);
  });

  test('rejects the application when payouts are not connected (founder rule)', async () => {
    mockAuthed({}, OWNER_ACCESS, ACTIVE_RESTAURANT, NO_PAYOUTS);
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topup-eligibility/apply`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('restaurant_topup_payouts_not_connected');
    // No eligibility row is written when payouts are not connected.
    const writes = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO restaurant_topup_eligibility'));
    expect(writes).toHaveLength(0);
  });

  test('rejects when the payout account onboarding is incomplete', async () => {
    mockAuthed({}, OWNER_ACCESS, ACTIVE_RESTAURANT, PAYOUTS_NOT_READY);
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topup-eligibility/apply`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('restaurant_topup_payouts_not_ready');
  });

  test('sets status pending when payouts are connected', async () => {
    const pendingRow = { ...ELIGIBILITY_PENDING.rows[0] };
    mockAuthed(
      {}, OWNER_ACCESS, ACTIVE_RESTAURANT, CONNECTED_PAYOUTS,
      { rows: [pendingRow] }, // eligibility upsert
      { rows: [{ id: 1 }] } // admin audit log
    );
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topup-eligibility/apply`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.eligibility.status).toBe('pending');
    expect(res.body.eligibility.restaurantId).toBe(String(RESTAURANT_ID));
  });

  test('keeps an approved restaurant approved on re-apply (idempotent)', async () => {
    const approvedRow = { ...ELIGIBILITY_APPROVED.rows[0] };
    mockAuthed(
      {}, OWNER_ACCESS, ACTIVE_RESTAURANT, CONNECTED_PAYOUTS,
      { rows: [approvedRow] },
      { rows: [{ id: 1 }] }
    );
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topup-eligibility/apply`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.eligibility.status).toBe('approved');
  });
});

// ── Eligibility status read (additive GET) ──────────────────────────────────
describe('GET /api/restaurants/:restaurantId/topup-eligibility', () => {
  const RESTAURANT_EXISTS = { rows: [{ id: RESTAURANT_ID }] };
  const OWNER_ROW = { rows: [{ owner: 1 }] };
  const NOT_OWNER = { rows: [] };

  test('returns 401 without a token', async () => {
    const res = await request(buildMerchantApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/topup-eligibility`);
    expect(res.status).toBe(401);
  });

  test('returns 404 for an invalid restaurant id', async () => {
    mockAuthed({});
    const res = await request(buildMerchantApp())
      .get('/api/restaurants/abc/topup-eligibility')
      .set('Authorization', `Bearer ${USER_TOKEN}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('restaurant_not_found');
  });

  test('returns 404 when the restaurant does not exist', async () => {
    mockAuthed({}, NO_ACCESS);
    const res = await request(buildMerchantApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/topup-eligibility`)
      .set('Authorization', `Bearer ${USER_TOKEN}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('restaurant_not_found');
  });

  test('returns not_applied when no eligibility row exists', async () => {
    mockAuthed({}, RESTAURANT_EXISTS, NO_ELIGIBILITY);
    const res = await request(buildMerchantApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/topup-eligibility`)
      .set('Authorization', `Bearer ${USER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.eligibility.status).toBe('not_applied');
    expect(res.body.eligibility.restaurantId).toBe(String(RESTAURANT_ID));
    expect(res.body.eligibility.decisionReason).toBeUndefined();
  });

  test('returns the status without the decision reason for a non-owner customer', async () => {
    mockAuthed({}, RESTAURANT_EXISTS, ELIGIBILITY_REJECTED, NOT_OWNER);
    const res = await request(buildMerchantApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/topup-eligibility`)
      .set('Authorization', `Bearer ${USER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.eligibility.status).toBe('rejected');
    expect(res.body.eligibility.decisionReason).toBeUndefined();
  });

  test('exposes the decision reason to the restaurant owner', async () => {
    mockAuthed({}, RESTAURANT_EXISTS, ELIGIBILITY_REJECTED, OWNER_ROW);
    const res = await request(buildMerchantApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/topup-eligibility`)
      .set('Authorization', `Bearer ${USER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.eligibility.status).toBe('rejected');
    expect(res.body.eligibility.decisionReason).toBe('missing documents');
  });

  test('exposes the decision reason to an admin without an owner lookup', async () => {
    mockAuthed({ role: 'admin' }, RESTAURANT_EXISTS, ELIGIBILITY_SUSPENDED);
    const res = await request(buildMerchantApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/topup-eligibility`)
      .set('Authorization', `Bearer ${USER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.eligibility.status).toBe('suspended');
    expect(res.body.eligibility.decisionReason).toBe('chargeback spike');
    // auth user + restaurant exists + eligibility: no owner-access query.
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });
});

// ── Top-up intent creation ──────────────────────────────────────────────────
describe('POST /api/restaurants/:restaurantId/topups', () => {
  function intentQueries({ restaurant = ACTIVE_RESTAURANT, eligibility = ELIGIBILITY_APPROVED, dailyCap = DAILY_CAP_ZERO, inserted = true, existingRow = null } = {}) {
    const queries = [restaurant, eligibility, dailyCap];
    if (inserted) {
      queries.push({ rows: [baseTopupRow()] }); // INSERT ... RETURNING *
    } else {
      queries.push({ rows: [] }); // INSERT conflicted
      queries.push({ rows: [existingRow] }); // SELECT by idempotency key
    }
    return queries;
  }

  test('requires an idempotency key', async () => {
    mockAuthed({});
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topups`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .send({ amountCents: 5000 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('restaurant_topup_idempotency_key_required');
  });

  test('rejects amounts below the minimum without touching the database', async () => {
    mockAuthed({});
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topups`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .set('Idempotency-Key', 'k-min')
      .send({ amountCents: 499 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('restaurant_topup_amount_too_small');
    // Only the auth user lookup ran; no top-up queries.
    expect(mockQuery.mock.calls.length).toBe(1);
  });

  test('rejects amounts above the maximum', async () => {
    mockAuthed({});
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topups`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .set('Idempotency-Key', 'k-max')
      .send({ amountCents: 50001 });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('restaurant_topup_amount_too_large');
  });

  test('rejects when the restaurant is not eligible (S2 at intent)', async () => {
    mockAuthed({}, ...intentQueries({ eligibility: NO_ELIGIBILITY }));
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topups`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .set('Idempotency-Key', 'k-ineligible')
      .send({ amountCents: 5000 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('restaurant_topup_not_eligible');
    expect(res.body.fields.eligibilityStatus).toBe('not_applied');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  test('rejects when the restaurant is deactivated (S6)', async () => {
    mockAuthed({}, SUSPENDED_RESTAURANT);
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topups`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .set('Idempotency-Key', 'k-inactive')
      .send({ amountCents: 5000 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('restaurant_topup_restaurant_inactive');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  test('enforces the daily cap per user per restaurant', async () => {
    mockAuthed({}, ...intentQueries({ dailyCap: { rows: [{ spent_cents: '95000' }] } }));
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topups`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .set('Idempotency-Key', 'k-cap')
      .send({ amountCents: 10000 });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('restaurant_topup_daily_cap_exceeded');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  test('creates the intent on the happy path (S1)', async () => {
    const inserted = baseTopupRow();
    const withIntent = { ...inserted, stripe_payment_intent_id: 'pi_test_1' };
    mockAuthed(
      {}, ...intentQueries({}),
      { rows: [{ ...withIntent }] }, // UPDATE stripe_payment_intent_id (no RETURNING; default empty is fine)
      { rows: [withIntent] } // getTopupById
    );
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topups`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .set('Idempotency-Key', 'idem-key-1')
      .send({ amountCents: 5000 });
    expect(res.status).toBe(201);
    expect(res.body.topup.id).toBe(TOPUP_ID);
    expect(res.body.topup.amountCents).toBe(5000);
    expect(res.body.topup.currency).toBe('USD');
    expect(res.body.topup.status).toBe('pending');
    expect(res.body.clientSecret).toBe('cs_test_1');
    expect(res.body.replayed).toBe(false);
    // The Stripe intent carries the restaurant top-up metadata and a
    // deterministic idempotency key.
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5000,
        currency: 'usd',
        metadata: { restaurant_topup_id: TOPUP_ID },
      }),
      expect.objectContaining({ idempotencyKey: `restaurant-topup-intent:${TOPUP_ID}` })
    );
  });

  test('replays an identical idempotency key without a second Stripe intent', async () => {
    const existing = { ...baseTopupRow(), stripe_payment_intent_id: 'pi_test_1' };
    mockAuthed(
      {}, ...intentQueries({ inserted: false, existingRow: existing }),
      { rows: [existing] } // getTopupById
    );
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topups`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .set('Idempotency-Key', 'idem-key-1')
      .send({ amountCents: 5000 });
    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(true);
    expect(res.body.clientSecret).toBe('cs_test_1');
    // retrieve (existing intent) converges; create is never called again.
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_test_1');
  });

  test('conflicts when the idempotency key was used with different parameters', async () => {
    const existing = { ...baseTopupRow(), amount_cents: 7000 };
    mockAuthed({}, ...intentQueries({ inserted: false, existingRow: existing }));
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topups`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .set('Idempotency-Key', 'idem-key-1')
      .send({ amountCents: 5000 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('restaurant_topup_idempotency_conflict');
  });

  test('requires a verified step-up challenge for large amounts', async () => {
    stepupService.verifyStepupChallenge.mockRejectedValueOnce(
      new AppError('Invalid or expired verification code', 401, 'credit_stepup_code_invalid')
    );
    mockAuthed({});
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topups`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .set('Idempotency-Key', 'k-stepup')
      .send({ amountCents: 30000, stepupChallengeId: 'ch_1', stepupCode: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('credit_stepup_code_invalid');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  test('creates a large top-up once the step-up challenge verifies', async () => {
    const withIntent = { ...baseTopupRow({ amount_cents: 30000 }), stripe_payment_intent_id: 'pi_test_1' };
    mockAuthed(
      {}, ACTIVE_RESTAURANT, ELIGIBILITY_APPROVED, DAILY_CAP_ZERO,
      { rows: [baseTopupRow({ amount_cents: 30000 })] },
      { rows: [] },
      { rows: [withIntent] }
    );
    const res = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topups`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .set('Idempotency-Key', 'k-stepup-ok')
      .send({ amountCents: 30000, stepupChallengeId: 'ch_1', stepupCode: '123456' });
    expect(res.status).toBe(201);
    expect(stepupService.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: 'ch_1',
      actorUserId: USER_ID,
      actionType: 'restaurant_topup',
      code: '123456',
    }));
    expect(res.body.topup.amountCents).toBe(30000);
  });

  test('issues a step-up challenge only above the threshold', async () => {
    mockAuthed({});
    const below = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topups/stepup-challenges`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .send({ amountCents: 5000 });
    expect(below.status).toBe(400);
    expect(below.body.code).toBe('restaurant_topup_stepup_not_required');

    mockAuthed({}, ACTIVE_RESTAURANT);
    const above = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topups/stepup-challenges`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .send({ amountCents: 30000 });
    expect(above.status).toBe(201);
    expect(stepupService.issueStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'restaurant_topup',
      amountCents: 30000,
    }));
  });
});

// ── Top-up status (owner only) ──────────────────────────────────────────────
describe('GET /api/restaurants/:restaurantId/topups/:topupId', () => {
  test('returns the top-up to the topping-up user', async () => {
    mockAuthed({}, { rows: [baseTopupRow({ status: 'succeeded' })] });
    const res = await request(buildMerchantApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/topups/${TOPUP_ID}`)
      .set('Authorization', `Bearer ${USER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.topup.id).toBe(TOPUP_ID);
    expect(res.body.topup.status).toBe('succeeded');
  });

  test('returns 404 for anyone else (owner-only)', async () => {
    mockAuthed({ id: OTHER_USER_ID }, { rows: [] });
    const res = await request(buildMerchantApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/topups/${TOPUP_ID}`)
      .set('Authorization', `Bearer ${OTHER_USER_TOKEN}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('restaurant_topup_not_found');
  });

  test('S3: without a webhook the top-up stays pending and nothing is credited', async () => {
    const withIntent = { ...baseTopupRow(), stripe_payment_intent_id: 'pi_test_1' };
    mockAuthed(
      {}, ACTIVE_RESTAURANT, ELIGIBILITY_APPROVED, DAILY_CAP_ZERO,
      { rows: [baseTopupRow()] },
      { rows: [] },
      { rows: [withIntent] } // intent created; Stripe holds the money, no webhook yet
    );
    const created = await request(buildMerchantApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/topups`)
      .set('Authorization', `Bearer ${USER_TOKEN}`)
      .set('Idempotency-Key', 'idem-s3')
      .send({ amountCents: 5000 });
    expect(created.status).toBe(201);

    mockAuthed({}, { rows: [withIntent] });
    const status = await request(buildMerchantApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/topups/${TOPUP_ID}`)
      .set('Authorization', `Bearer ${USER_TOKEN}`);
    expect(status.status).toBe(200);
    expect(status.body.topup.status).toBe('pending');
    // No wallet credit happened without the verified webhook.
    const walletWrites = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('food_customer_wallet_ledger'));
    expect(walletWrites).toHaveLength(0);
  });
});

// ── Admin approval queue ────────────────────────────────────────────────────
describe('admin restaurant top-up endpoints', () => {
  test('GET /applications lists pending applications', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...ELIGIBILITY_PENDING.rows[0], restaurant_name: 'Test Kitchen', restaurant_status: 'active', restaurant_currency: 'USD' }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });
    const res = await request(buildAdminApp()).get('/api/admin/restaurant-topups/applications?status=pending');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.applications[0].status).toBe('pending');
    expect(res.body.applications[0].restaurantId).toBe(String(RESTAURANT_ID));
  });

  test('GET /applications rejects an unknown status filter', async () => {
    const res = await request(buildAdminApp()).get('/api/admin/restaurant-topups/applications?status=bogus');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('restaurant_topup_status_invalid');
  });

  test('POST approve records the decision and audit trail', async () => {
    const decided = { ...ELIGIBILITY_APPROVED.rows[0], decided_by: ADMIN_ID, version: 2 };
    mockQuery
      .mockResolvedValueOnce(ACTIVE_RESTAURANT) // restaurant row
      .mockResolvedValueOnce(CONNECTED_PAYOUTS) // payouts re-check on approve
      .mockResolvedValueOnce({ rows: [{ ...ELIGIBILITY_PENDING.rows[0], version: 1 }] }) // before state (locked)
      .mockResolvedValueOnce({ rows: [decided] }) // upsert
      .mockResolvedValueOnce({ rows: [{ id: 9 }] }); // admin audit log
    const res = await request(buildAdminApp())
      .post(`/api/admin/restaurant-topups/applications/${RESTAURANT_ID}/approve`)
      .send({ expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe('approved');
    expect(res.body.application.decidedBy).toBe(ADMIN_ID);
    expect(res.body.application.version).toBe(2);
    expect(res.body.previousStatus).toBe('pending');
    const auditCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO admin_audit_log'));
    expect(auditCall).toBeDefined();
    expect(JSON.stringify(auditCall[1])).toContain('restaurant_topup.eligibility.approve');
    // The decision upsert bumps the optimistic-lock version.
    const upsertCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO restaurant_topup_eligibility'));
    expect(String(upsertCall[0])).toContain('version + 1');
  });

  test('POST approve fails closed when payouts were disconnected after applying', async () => {
    mockQuery
      .mockResolvedValueOnce(ACTIVE_RESTAURANT)
      .mockResolvedValueOnce(NO_PAYOUTS);
    const res = await request(buildAdminApp())
      .post(`/api/admin/restaurant-topups/applications/${RESTAURANT_ID}/approve`)
      .send({ expectedVersion: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('restaurant_topup_payouts_not_connected');
  });

  test('POST reject requires a reason', async () => {
    const res = await request(buildAdminApp())
      .post(`/api/admin/restaurant-topups/applications/${RESTAURANT_ID}/reject`)
      .send({ expectedVersion: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('restaurant_topup_decision_reason_required');
  });

  test('POST reject requires an expected version', async () => {
    const res = await request(buildAdminApp())
      .post(`/api/admin/restaurant-topups/applications/${RESTAURANT_ID}/reject`)
      .send({ reason: 'Missing business documents' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('restaurant_topup_expected_version_required');
  });

  test('POST reject records status rejected with the reason', async () => {
    const decided = { ...ELIGIBILITY_REJECTED.rows[0], decided_by: ADMIN_ID, version: 2 };
    mockQuery
      .mockResolvedValueOnce(ACTIVE_RESTAURANT)
      .mockResolvedValueOnce({ rows: [{ ...ELIGIBILITY_PENDING.rows[0], version: 1 }] })
      .mockResolvedValueOnce({ rows: [decided] })
      .mockResolvedValueOnce({ rows: [{ id: 9 }] });
    const res = await request(buildAdminApp())
      .post(`/api/admin/restaurant-topups/applications/${RESTAURANT_ID}/reject`)
      .send({ reason: 'Missing business documents', expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe('rejected');
    expect(res.body.application.decisionReason).toBe('missing documents');
    expect(res.body.application.version).toBe(2);
  });

  test('POST suspend requires a reason and records it', async () => {
    const decided = { ...ELIGIBILITY_SUSPENDED.rows[0], decided_by: ADMIN_ID, version: 2 };
    mockQuery
      .mockResolvedValueOnce(ACTIVE_RESTAURANT)
      .mockResolvedValueOnce({ rows: [{ ...ELIGIBILITY_APPROVED.rows[0], version: 1 }] })
      .mockResolvedValueOnce({ rows: [decided] })
      .mockResolvedValueOnce({ rows: [{ id: 9 }] });
    const res = await request(buildAdminApp())
      .post(`/api/admin/restaurant-topups/applications/${RESTAURANT_ID}/suspend`)
      .send({ reason: 'Chargeback spike under review', expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe('suspended');
    expect(res.body.application.decisionReason).toBe('chargeback spike');
  });

  // TV1: a stale admin approval (rendered before a newer suspension) must be
  // rejected with 409 and must not write anything.
  test('POST approve rejects a stale decision with 409 and issues no upsert', async () => {
    mockQuery
      .mockResolvedValueOnce(ACTIVE_RESTAURANT)
      .mockResolvedValueOnce(CONNECTED_PAYOUTS)
      // The row has since been suspended (version 2); the admin rendered version 1.
      .mockResolvedValueOnce({ rows: [{ ...ELIGIBILITY_SUSPENDED.rows[0], version: 2 }] });
    const res = await request(buildAdminApp())
      .post(`/api/admin/restaurant-topups/applications/${RESTAURANT_ID}/approve`)
      .send({ expectedVersion: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('restaurant_topup_version_conflict');
    const upsertCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO restaurant_topup_eligibility'));
    expect(upsertCall).toBeUndefined();
    const auditCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO admin_audit_log'));
    expect(auditCall).toBeUndefined();
  });

  test('POST approve with a matching expected version succeeds and bumps the version', async () => {
    const decided = { ...ELIGIBILITY_APPROVED.rows[0], decided_by: ADMIN_ID, version: 2 };
    mockQuery
      .mockResolvedValueOnce(ACTIVE_RESTAURANT)
      .mockResolvedValueOnce(CONNECTED_PAYOUTS)
      .mockResolvedValueOnce({ rows: [{ ...ELIGIBILITY_PENDING.rows[0], version: 1 }] })
      .mockResolvedValueOnce({ rows: [decided] })
      .mockResolvedValueOnce({ rows: [{ id: 9 }] });
    const res = await request(buildAdminApp())
      .post(`/api/admin/restaurant-topups/applications/${RESTAURANT_ID}/approve`)
      .send({ expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe('approved');
    expect(res.body.application.version).toBe(2);
  });

  test('a rejected merchant can re-apply and goes back to pending (S7)', async () => {
    const backToPending = { ...ELIGIBILITY_PENDING.rows[0] };
    mockQuery
      .mockResolvedValueOnce(ACTIVE_RESTAURANT)
      .mockResolvedValueOnce(CONNECTED_PAYOUTS)
      .mockResolvedValueOnce({ rows: [backToPending] })
      .mockResolvedValueOnce({ rows: [{ id: 10 }] });
    const { eligibility } = await topupService.applyForEligibility({
      restaurantId: RESTAURANT_ID,
      actorUserId: USER_ID,
    });
    expect(eligibility.status).toBe('pending');
  });
});

// ── Webhook completion ──────────────────────────────────────────────────────
describe('restaurant top-up webhook handling', () => {
  const succeededEvent = (intentId = 'pi_test_1') => ({
    type: 'payment_intent.succeeded',
    object: { id: intentId, metadata: { restaurant_topup_id: TOPUP_ID } },
  });

  function happyPathQueries({ topupStatus = 'pending', balanceCents = 0 } = {}) {
    const topup = baseTopupRow({ status: topupStatus, stripe_payment_intent_id: 'pi_test_1' });
    const account = { ...WALLET_ACCOUNT, balance_cents: balanceCents };
    const ledgerEntry = { id: 9001, account_id: account.id, balance_after_cents: balanceCents + 5000, amount_cents: 5000 };
    return {
      topup,
      account,
      ledgerEntry,
      queries: [
        { rows: [topup] }, // SELECT topup FOR UPDATE
        ACTIVE_RESTAURANT, // restaurant re-check
        ELIGIBILITY_APPROVED, // eligibility re-check
        { rows: [] }, // getOrCreateWalletAccount INSERT (conflict no-op)
        { rows: [account] }, // SELECT account FOR UPDATE
        { rows: [] }, // findExistingLedgerEntry by idempotency key (no replay)
        { rows: [] }, // findExistingLedgerEntry by reference (no replay)
        { rows: [{ ...account, balance_cents: balanceCents + 5000, ledger_version: 4, last_entry_hash: 'newhash' }] }, // UPDATE account
        { rows: [ledgerEntry] }, // INSERT ledger
        { rows: [{ ...topup, status: 'succeeded' }] }, // UPDATE topup succeeded
      ],
    };
  }

  test('returns false for events that are not ours', async () => {
    const handled = await topupService.applyRestaurantTopupWebhookEvent({
      type: 'payment_intent.succeeded',
      object: { id: 'pi_other', metadata: {} },
    });
    expect(handled).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('S1 happy path: credits the food wallet exactly once', async () => {
    const { queries } = happyPathQueries();
    queries.forEach((q) => mockQuery.mockResolvedValueOnce(q));
    const handled = await topupService.applyRestaurantTopupWebhookEvent(succeededEvent());
    expect(handled).toBe(true);

    const ledgerInsert = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO food_customer_wallet_ledger'));
    expect(ledgerInsert).toBeDefined();
    // Columns: (account_id, restaurant_id, customer_id, entry_type,
    //  amount_cents, balance_after_cents, currency_code, description,
    //  reference_type, reference_id, idempotency_key, ...)
    const params = ledgerInsert[1];
    expect(params[3]).toBe('credit');
    expect(params[4]).toBe(5000); // amount_cents
    expect(params[5]).toBe(5000); // balance_after_cents
    expect(params[8]).toBe('restaurant_topup'); // reference_type
    expect(params[9]).toBe(TOPUP_ID); // reference_id
    expect(params[10]).toBe(`restaurant-topup:${TOPUP_ID}`); // idempotency key

    const topupUpdate = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE restaurant_topups') && String(sql).includes("'succeeded'"));
    expect(topupUpdate).toBeDefined();
  });

  test('S4 duplicate webhook: a succeeded top-up is never credited twice', async () => {
    const topup = baseTopupRow({ status: 'succeeded', stripe_payment_intent_id: 'pi_test_1' });
    mockQuery.mockResolvedValueOnce({ rows: [topup] });
    const result = await topupService.completeRestaurantTopupFromWebhook({ paymentIntentId: 'pi_test_1' });
    expect(result.outcome).toBe('duplicate');
    const walletWrites = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('food_customer_wallet_ledger') || String(sql).includes('UPDATE food_customer_wallet_accounts'));
    expect(walletWrites).toHaveLength(0);
  });

  test('S2 webhook blocked when eligibility was suspended mid-flight: no credit, incident raised', async () => {
    const topup = baseTopupRow({ status: 'pending', stripe_payment_intent_id: 'pi_test_1' });
    mockQuery
      .mockResolvedValueOnce({ rows: [topup] }) // SELECT topup FOR UPDATE
      .mockResolvedValueOnce(ACTIVE_RESTAURANT) // restaurant still active
      .mockResolvedValueOnce(ELIGIBILITY_SUSPENDED) // ...but eligibility suspended
      .mockResolvedValueOnce({ rows: [{ ...topup, status: 'failed' }] }) // park as failed
      .mockResolvedValueOnce({ rows: [{ id: 11 }] }); // admin audit log
    const result = await topupService.completeRestaurantTopupFromWebhook({ paymentIntentId: 'pi_test_1' });
    expect(result.outcome).toBe('blocked_ineligible');
    // The wallet is never touched.
    const walletWrites = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('food_customer_wallet_ledger') || String(sql).includes('UPDATE food_customer_wallet_accounts'));
    expect(walletWrites).toHaveLength(0);
    expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      type: 'restaurant_topup_blocked_ineligible',
      severity: 'critical',
    }));
  });

  test('failed payment intents never credit (S3-adjacent: only pending rows fail)', async () => {
    const topup = baseTopupRow({ status: 'pending', stripe_payment_intent_id: 'pi_test_1' });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: topup.id, status: 'pending' }] });
    const result = await topupService.failRestaurantTopupFromWebhook({ paymentIntentId: 'pi_test_1' });
    expect(result.outcome).toBe('failed');
    const walletWrites = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('food_customer_wallet_ledger'));
    expect(walletWrites).toHaveLength(0);
  });

  test('a canceled event for an already-succeeded top-up is ignored', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TOPUP_ID, status: 'succeeded' }] });
    const handled = await topupService.applyRestaurantTopupWebhookEvent({
      type: 'payment_intent.canceled',
      object: { id: 'pi_test_1', metadata: { restaurant_topup_id: TOPUP_ID } },
    });
    expect(handled).toBe(true);
    const walletWrites = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('food_customer_wallet_ledger'));
    expect(walletWrites).toHaveLength(0);
  });

  test('the Stripe webhook route wires the restaurant top-up branch', async () => {
    // Drives the real webhook envelope: receipt dedupe, signature, then the
    // payment_intent.succeeded branch must route to the restaurant top-up
    // service when metadata.restaurant_topup_id is present.
    const webhookRoutes = require('../routes/webhook');
    const app = express();
    app.use('/api/webhooks', webhookRoutes);
    // Receipt bookkeeping runs before the branch.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 77 }] }) // webhook_event_receipts
      .mockResolvedValueOnce({ rows: [{ event_id: 'evt_rt_1' }] }); // watermarks
    const { queries } = happyPathQueries();
    queries.forEach((q) => mockQuery.mockResolvedValueOnce(q));
    mockQuery.mockResolvedValue({ rows: [] }); // any trailing bookkeeping
    const envelope = {
      id: 'evt_rt_1',
      type: 'payment_intent.succeeded',
      created: 1780000000,
      data: { object: succeededEvent().object },
    };
    stripe.webhooks.constructEvent.mockReturnValueOnce(envelope);
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'test-sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(envelope));
    expect(res.status).toBe(200);
    const ledgerInsert = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO food_customer_wallet_ledger'));
    expect(ledgerInsert).toBeDefined();
  });
});

// ── Clawback ────────────────────────────────────────────────────────────────
describe('POST /api/admin/restaurant-topups/topups/:topupId/clawback', () => {
  const succeededTopup = baseTopupRow({ status: 'succeeded', stripe_payment_intent_id: 'pi_test_1' });

  function clawbackQueries({ balanceCents = 8000, existingEntry = null } = {}) {
    const account = { ...WALLET_ACCOUNT, balance_cents: balanceCents };
    const nextBalance = balanceCents - 5000;
    const entry = existingEntry || {
      id: 9101, account_id: account.id, amount_cents: 5000,
      balance_after_cents: nextBalance, entry_type: 'debit',
    };
    const queries = [
      { rows: [{ ...succeededTopup, business_id: 9, restaurant_name: 'Test Kitchen' }] }, // topup FOR UPDATE
      { rows: [account] }, // wallet account FOR UPDATE
      { rows: existingEntry ? [existingEntry] : [] }, // clawback idempotency lookup
    ];
    if (!existingEntry) {
      queries.push(
        { rows: [{ ...account, balance_cents: nextBalance, ledger_version: 4, last_entry_hash: 'clawhash' }] }, // UPDATE account
        { rows: [entry] }, // INSERT ledger
        { rows: [{ id: 21 }] }, // admin audit log
        { rows: [{ id: 31 }] } // operator audit event
      );
    }
    return { queries, account, entry, nextBalance };
  }

  test('requires a reason', async () => {
    const res = await request(buildAdminApp())
      .post(`/api/admin/restaurant-topups/topups/${TOPUP_ID}/clawback`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('restaurant_topup_clawback_reason_required');
  });

  test('refuses a top-up that is not succeeded', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...baseTopupRow({ status: 'pending' }), business_id: 9 }],
    });
    const res = await request(buildAdminApp())
      .post(`/api/admin/restaurant-topups/topups/${TOPUP_ID}/clawback`)
      .send({ reason: 'chargeback cb_123' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('restaurant_topup_clawback_invalid_status');
  });

  test('debits the wallet with audit when funds cover it', async () => {
    const { queries } = clawbackQueries({ balanceCents: 8000 });
    queries.forEach((q) => mockQuery.mockResolvedValueOnce(q));
    const res = await request(buildAdminApp())
      .post(`/api/admin/restaurant-topups/topups/${TOPUP_ID}/clawback`)
      .send({ reason: 'chargeback cb_123' });
    expect(res.status).toBe(200);
    const { clawback } = res.body;
    expect(clawback.amountCents).toBe(5000);
    expect(clawback.balanceBeforeCents).toBe(8000);
    expect(clawback.balanceAfterCents).toBe(3000);
    expect(clawback.wentNegative).toBe(false);
    expect(clawback.replayed).toBe(false);
    expect(clawback.reason).toBe('chargeback cb_123');

    // The debit is a flagged clawback entry, not a silent adjustment.
    const ledgerInsert = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO food_customer_wallet_ledger'));
    expect(ledgerInsert).toBeDefined();
    // Columns: (account_id, restaurant_id, customer_id, 'debit' literal,
    //  $4 amount_cents, $5 balance_after_cents, ..., $8 reference_type,
    //  $9 reference_id, $10 idempotency_key, ...)
    const params = ledgerInsert[1];
    expect(params[3]).toBe(5000); // amount_cents
    expect(params[4]).toBe(3000); // balance_after_cents
    expect(params[7]).toBe('restaurant_topup_clawback'); // reference_type
    expect(params[8]).toBe(TOPUP_ID); // reference_id
    expect(params[9]).toBe(`restaurant-topup-clawback:${TOPUP_ID}`); // idempotency key

    // Both audits are written inside the transaction, flagging the outcome.
    const adminAudit = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO admin_audit_log'));
    expect(adminAudit).toBeDefined();
    expect(JSON.stringify(adminAudit[1])).toContain('restaurant_topup.clawback');
    // after_state carries wentNegative:false for the covered case.
    expect(JSON.parse(adminAudit[1][9]).wentNegative).toBe(false);
    const operatorAudit = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO food_customer_wallet_operator_audit_events'));
    expect(operatorAudit).toBeDefined();
  });

  test('S5 allows the wallet to go negative and flags it explicitly', async () => {
    const { queries } = clawbackQueries({ balanceCents: 2000 });
    queries.forEach((q) => mockQuery.mockResolvedValueOnce(q));
    const res = await request(buildAdminApp())
      .post(`/api/admin/restaurant-topups/topups/${TOPUP_ID}/clawback`)
      .send({ reason: 'chargeback cb_456, credit already spent' });
    expect(res.status).toBe(200);
    const { clawback } = res.body;
    expect(clawback.balanceBeforeCents).toBe(2000);
    expect(clawback.balanceAfterCents).toBe(-3000);
    expect(clawback.wentNegative).toBe(true);

    const ledgerInsert = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO food_customer_wallet_ledger'));
    expect(ledgerInsert[1][4]).toBe(-3000);

    // The negative outcome is flagged in the response and both audits.
    const adminAudit = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO admin_audit_log'));
    expect(JSON.stringify(adminAudit[1])).toContain('WENT NEGATIVE');
    expect(JSON.parse(adminAudit[1][9]).wentNegative).toBe(true); // after_state
    const operatorAudit = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO food_customer_wallet_operator_audit_events'));
    expect(JSON.parse(operatorAudit[1][10]).wentNegative).toBe(true); // metadata
  });

  test('a repeated clawback replays instead of double-debiting', async () => {
    const existingEntry = {
      id: 9101, account_id: WALLET_ACCOUNT.id, amount_cents: 5000,
      balance_after_cents: 3000, entry_type: 'debit',
    };
    const { queries } = clawbackQueries({ balanceCents: 8000, existingEntry });
    queries.forEach((q) => mockQuery.mockResolvedValueOnce(q));
    const res = await request(buildAdminApp())
      .post(`/api/admin/restaurant-topups/topups/${TOPUP_ID}/clawback`)
      .send({ reason: 'chargeback cb_123 again' });
    expect(res.status).toBe(200);
    expect(res.body.clawback.replayed).toBe(true);
    expect(res.body.clawback.balanceAfterCents).toBe(3000);
    const accountUpdates = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('UPDATE food_customer_wallet_accounts'));
    expect(accountUpdates).toHaveLength(0);
  });

  test('the top-up row itself is left untouched by the clawback', async () => {
    const { queries } = clawbackQueries({ balanceCents: 8000 });
    queries.forEach((q) => mockQuery.mockResolvedValueOnce(q));
    await request(buildAdminApp())
      .post(`/api/admin/restaurant-topups/topups/${TOPUP_ID}/clawback`)
      .send({ reason: 'chargeback cb_123' });
    const topupUpdates = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('UPDATE restaurant_topups'));
    expect(topupUpdates).toHaveLength(0);
  });
});

// ── Constants contract ─────────────────────────────────────────────────────
describe('top-up policy constants', () => {
  test('limits and the no-fee default are the documented values', () => {
    expect(topupService.RESTAURANT_TOPUP_MIN_CENTS).toBe(500);
    expect(topupService.RESTAURANT_TOPUP_MAX_CENTS).toBe(50000);
    expect(topupService.RESTAURANT_TOPUP_DAILY_CAP_CENTS).toBe(100000);
    expect(topupService.TOPUP_FEE_BPS).toBe(0);
    expect(topupService.RESTAURANT_TOPUP_STEPUP_THRESHOLD_CENTS).toBe(25000);
  });

  test('the step-up threshold sits inside the per-top-up max', () => {
    // The mirrored step-up pattern must be reachable: threshold <= max.
    expect(topupService.RESTAURANT_TOPUP_STEPUP_THRESHOLD_CENTS)
      .toBeLessThanOrEqual(topupService.RESTAURANT_TOPUP_MAX_CENTS);
  });

  test('S8: the intent limiter is wired into the rate-limiter module', () => {
    // The route file mocks the limiter as pass-through; this asserts the
    // real limiter exists so intent creation is actually rate-limited.
    const realLimiter = jest.requireActual('../middleware/rateLimiter');
    expect(typeof realLimiter.restaurantTopupIntentLimiter).toBe('function');
  });
});
