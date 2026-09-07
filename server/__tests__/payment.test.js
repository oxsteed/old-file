'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../utils/feeCalculator', () => ({
  calculateTier3Fees: jest.fn().mockReturnValue({
    application_fee_cents: 710,
    platform_fee_cents:    710,
  }),
}));

const express = require('express');
const request = require('supertest');
const jwt     = require('jsonwebtoken');

const paymentRoutes = require('../routes/payments');

const TOKEN = jwt.sign({ id: 1, email: 'c@test.com', role: 'customer' }, process.env.JWT_SECRET);

const MOCK_AUTH_USER = {
  id: 1, first_name: 'Alice', last_name: 'Smith', email: 'c@test.com',
  phone: null, role: 'customer', email_verified: true, is_verified: false, is_active: true,
  onboarding_status: 'active', onboarding_completed: true,
  contact_completed: true, profile_completed: true,
  tier_selected: true, w9_completed: false, terms_accepted: true,
  membership_tier: 'free', id_verified: false, background_check_passed: false,
  city: null, state: null, zip_code: null,
  display_name_preference: 'first_name', business_name: null,
  didit_status: 'verified', didit_verified_at: new Date(), didit_enforcement_required: false,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/payments', paymentRoutes);
  return app;
}
const auth = r => r.set('Authorization', `Bearer ${TOKEN}`);

function mockAuth(...extras) {
  mockQuery.mockResolvedValueOnce({ rows: [MOCK_AUTH_USER] });
  extras.forEach(e => mockQuery.mockResolvedValueOnce(e));
}

// Pull the stripe mock instance for asserting calls
const stripe = require('stripe')();

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

// ── POST /api/payments/intent ─────────────────────────────────────────────────
describe('POST /api/payments/intent', () => {
  test('returns 400 when job_id is missing', async () => {
    mockAuth();
    const res = await auth(request(buildApp()).post('/api/payments/intent').send({}));
    expect(res.status).toBe(400);
    expect(res.body.fields).toHaveProperty('job_id');
  });

  test('returns 404 when job does not exist', async () => {
    mockAuth({ rows: [] });
    const res = await auth(
      request(buildApp()).post('/api/payments/intent').send({ job_id: 999 })
    );
    expect(res.status).toBe(404);
  });

  test('returns 403 when user is not the job owner', async () => {
    mockAuth({ rows: [{ id: 10, client_id: 99, job_value: 100, assigned_helper_id: 2 }] });
    const res = await auth(
      request(buildApp()).post('/api/payments/intent').send({ job_id: 10 })
    );
    expect(res.status).toBe(403);
  });

  test('returns 400 when no agreed price set', async () => {
    mockAuth({ rows: [{ id: 10, client_id: 1, job_value: null, assigned_helper_id: 2 }] });
    const res = await auth(
      request(buildApp()).post('/api/payments/intent').send({ job_id: 10 })
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/price/i);
  });

  test('returns 400 when helper payment account not ready', async () => {
    mockAuth(
      { rows: [{ id: 10, client_id: 1, job_value: 100, assigned_helper_id: 2 }] }, // job
      { rows: [{ stripe_account_id: 'acct_x', charges_enabled: false }] }           // connect
    );
    const res = await auth(
      request(buildApp()).post('/api/payments/intent').send({ job_id: 10 })
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not ready/i);
  });

  test('creates payment intent and returns client_secret', async () => {
    stripe.paymentIntents.create.mockResolvedValueOnce({
      id: 'pi_test123',
      client_secret: 'pi_test123_secret_abc',
    });
    mockAuth(
      { rows: [{ id: 10, client_id: 1, job_value: 100, assigned_helper_id: 2, title: 'Job' }] }, // job
      { rows: [{ stripe_account_id: 'acct_x', charges_enabled: true }] },                         // connect
      { rows: [{ balance_cents: 0 }] },                                                           // customer credit balance
      { rows: [] },                                                                                // existing payment check
      { rows: [{ attempt_count: 0 }] },                                                           // payment attempt count
      { rows: [{ id: 1 }] }                                                                          // INSERT payment RETURNING id
    );
    const res = await auth(
      request(buildApp()).post('/api/payments/intent').send({ job_id: 10 })
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('client_secret');
    expect(res.body).toHaveProperty('payment_intent_id', 'pi_test123');
  });
});

// ── POST /api/payments/capture ────────────────────────────────────────────────
describe('POST /api/payments/capture', () => {
  test('returns 400 when job is not completed', async () => {
    mockAuth({ rows: [{ id: 10, status: 'published' }] });
    const res = await auth(
      request(buildApp()).post('/api/payments/capture').send({ job_id: 10 })
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/completed/i);
  });

  test('returns 404 when no authorized payment found', async () => {
    mockAuth(
      { rows: [{ id: 10, status: 'completed', assigned_helper_id: 2, title: 'Job', client_id: 1 }] },
      { rows: [] } // no payment
    );
    const res = await auth(
      request(buildApp()).post('/api/payments/capture').send({ job_id: 10 })
    );
    expect(res.status).toBe(404);
  });

  test('captures payment synchronously and returns 200 by default', async () => {
    stripe.paymentIntents.capture.mockResolvedValueOnce({
      charges: { data: [{ id: 'ch_test1' }] },
      amount_received: 10000,
    });
    mockAuth(
      { rows: [{ id: 10, status: 'completed', assigned_helper_id: 2, title: 'Fence repair', client_id: 1 }] }, // job
      { rows: [] }, // BEGIN (tx)
      { rows: [{ id: 5, stripe_payment_intent_id: 'pi_test123', stripe_account_id: 'acct_x', amount: 100, status: 'authorized' }] }, // payment (controller)
      { rows: [] }, // dispute check
      { rows: [] }, // COMMIT (tx)
      { rows: [{ id: 5, stripe_payment_intent_id: 'pi_test123', stripe_account_id: 'acct_x', amount: 100, status: 'authorized' }] }, // payment (capture service)
      { rows: [] }, // UPDATE inside withTransaction mock
    );
    const res = await auth(
      request(buildApp()).post('/api/payments/capture').send({ job_id: 10 })
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('captured');
    expect(res.body.payment_id).toBe(5);
    expect(res.body.job_id).toBe(10);
    expect(stripe.paymentIntents.capture).toHaveBeenCalled();
  });

  test('queues capture and returns 202 when PAYMENT_CAPTURE_ASYNC=true', async () => {
    process.env.PAYMENT_CAPTURE_ASYNC = 'true';
    mockAuth(
      { rows: [{ id: 10, status: 'completed', assigned_helper_id: 2, title: 'Fence repair', client_id: 1 }] },
      { rows: [] }, // BEGIN (tx)
      { rows: [{ id: 5, stripe_payment_intent_id: 'pi_test123', stripe_account_id: 'acct_x', amount: 100, status: 'authorized' }] },
      { rows: [] },
      { rows: [] }, // COMMIT (tx)
    );
    const res = await auth(
      request(buildApp()).post('/api/payments/capture').send({ job_id: 10 })
    );
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('processing');
    delete process.env.PAYMENT_CAPTURE_ASYNC;
  });
});

// ── GET /api/payments/me ──────────────────────────────────────────────────────
describe('GET /api/payments/me', () => {
  test('returns user payment history', async () => {
    mockAuth({ rows: [{ id: 5, amount: 100, status: 'captured' }] });
    const res = await auth(request(buildApp()).get('/api/payments/me'));
    expect(res.status).toBe(200);
  });
});

// ── GET /api/payments/connect/status ─────────────────────────────────────────
describe('GET /api/payments/connect/status', () => {
  test('returns connected:false when no account', async () => {
    mockAuth({ rows: [] });
    const res = await auth(request(buildApp()).get('/api/payments/connect/status'));
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
  });

  test('returns connected:true when account exists', async () => {
    mockAuth({ rows: [{ stripe_account_id: 'acct_x', onboarding_complete: true }] });
    const res = await auth(request(buildApp()).get('/api/payments/connect/status'));
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.stripe_account_id).toBe('acct_x');
  });

  test('refreshes connect status from Stripe before responding', async () => {
    stripe.accounts.retrieve.mockResolvedValueOnce({
      id: 'acct_x',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [] },
      country: 'US',
      default_currency: 'usd',
    });

    mockAuth(
      { rows: [{ user_id: 1, stripe_account_id: 'acct_x', charges_enabled: false, payouts_enabled: false, onboarding_complete: false }] },
      { rows: [] },
    );

    const res = await auth(request(buildApp()).get('/api/payments/connect/status'));

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.charges_enabled).toBe(true);
    expect(res.body.onboarding_complete).toBe(true);
    expect(mockQuery.mock.calls[2][0]).toContain('UPDATE connect_accounts');
  });
});

describe('POST /api/payments/connect', () => {
  test('creates an onboarding link using APP_URL fallback when CLIENT_URL is absent', async () => {
    const prevAppUrl = process.env.APP_URL;
    const prevClientUrl = process.env.CLIENT_URL;
    try {
      process.env.APP_URL = 'https://oxsteed.com';
      delete process.env.CLIENT_URL;

      stripe.accounts.create.mockResolvedValueOnce({ id: 'acct_new' });
      stripe.accountLinks.create.mockResolvedValueOnce({ url: 'https://stripe.test/onboard' });

      mockAuth(
        { rows: [] }, // existing connect account lookup
        { rows: [] }, // INSERT connect account
      );

      const res = await auth(request(buildApp()).post('/api/payments/connect'));

      expect(res.status).toBe(200);
      expect(res.body.url).toBe('https://stripe.test/onboard');
      expect(stripe.accountLinks.create).toHaveBeenCalledWith(expect.objectContaining({
        refresh_url: expect.stringMatching(/\/helper-dashboard\?refresh=true$/),
        return_url: expect.stringMatching(/\/helper-dashboard\?onboarding=complete$/),
      }));
    } finally {
      process.env.APP_URL = prevAppUrl;
      process.env.CLIENT_URL = prevClientUrl;
    }
  });
});

describe('GET /api/payments/me role filtering', () => {
  test('uses payee_id when role=payee so earners see payout history', async () => {
    mockAuth(
      { rows: [{ id: 6, amount: 125, status: 'captured', payee_id: 1 }] },
      { rows: [{ count: '1' }] },
    );

    const res = await auth(request(buildApp()).get('/api/payments/me?role=payee'));

    expect(res.status).toBe(200);
    expect(res.body.payments[0].id).toBe(6);
    expect(mockQuery.mock.calls[1][0]).toContain('WHERE p.payee_id = $1');
    expect(mockQuery.mock.calls[2][0]).toContain('WHERE payee_id = $1');
  });
});
