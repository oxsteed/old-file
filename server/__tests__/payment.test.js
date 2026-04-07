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
  phone: null, role: 'customer', email_verified: true, is_verified: false,
  onboarding_status: 'active', onboarding_completed: true,
  contact_completed: true, profile_completed: true,
  tier_selected: true, w9_completed: false, terms_accepted: true,
  membership_tier: 'free', id_verified: false, background_check_passed: false,
  city: null, state: null, zip_code: null,
  display_name_preference: 'first_name', business_name: null,
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
      { rows: [] }                                                                                  // INSERT payment
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
      { rows: [{ id: 10, status: 'completed', assigned_helper_id: 2, title: 'Job' }] },
      { rows: [] } // no payment
    );
    const res = await auth(
      request(buildApp()).post('/api/payments/capture').send({ job_id: 10 })
    );
    expect(res.status).toBe(404);
  });

  test('captures payment successfully', async () => {
    stripe.paymentIntents.capture.mockResolvedValueOnce({ id: 'pi_test123', status: 'succeeded' });
    mockAuth(
      { rows: [{ id: 10, status: 'completed', assigned_helper_id: 2, title: 'Fence repair', client_id: 1 }] }, // job
      { rows: [{ id: 5, stripe_payment_intent_id: 'pi_test123', stripe_account_id: 'acct_x', amount: 100 }] }, // payment
      { rows: [] }, // UPDATE payment
      { rows: [] }, // INSERT income expense
      { rows: [] }  // INSERT expense
    );
    const res = await auth(
      request(buildApp()).post('/api/payments/capture').send({ job_id: 10 })
    );
    expect(res.status).toBe(200);
    expect(stripe.paymentIntents.capture).toHaveBeenCalledWith(
      'pi_test123', {}, { stripeAccount: 'acct_x' }
    );
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
  });
});
