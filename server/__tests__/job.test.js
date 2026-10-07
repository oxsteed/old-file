'use strict';

const { mockQuery, resetMocks } = require('./setup');

// Extra mocks needed for job controller
jest.mock('../services/matchService', () => ({
  scoreAndMatch: jest.fn().mockResolvedValue({ total: 0, notified: 0 }),
}));
jest.mock('../utils/storage', () => ({
  uploadFile:   jest.fn().mockResolvedValue('jobs/test-key.jpg'),
  getPublicUrl: jest.fn(key => `https://bucket.s3.amazonaws.com/${key}`),
}));
jest.mock('../middleware/upload', () => ({
  array: () => (req, res, next) => { req.files = []; next(); },
}));

const express = require('express');
const request = require('supertest');
const jwt     = require('jsonwebtoken');

const jobRoutes = require('../routes/jobs');

const TOKEN_CUSTOMER = jwt.sign({ id: 1, email: 'c@test.com', role: 'customer' }, process.env.JWT_SECRET);
const TOKEN_HELPER   = jwt.sign({ id: 2, email: 'h@test.com', role: 'helper'   }, process.env.JWT_SECRET);

const stripe = require('stripe')();

const MOCK_USER_CUSTOMER = {
  id: 1, first_name: 'Alice', last_name: 'Smith', email: 'c@test.com',
  phone: null, role: 'customer', email_verified: true, is_verified: false, is_active: true,
  onboarding_status: 'active', onboarding_completed: true,
  contact_completed: true, profile_completed: true,
  tier_selected: true, w9_completed: false, terms_accepted: true,
  membership_tier: 'free', id_verified: false, background_check_passed: false,
  city: 'Austin', state: 'TX', zip_code: '78701',
  display_name_preference: 'first_name', business_name: null,
  didit_status: 'verified', didit_verified_at: new Date(), didit_enforcement_required: false,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', jobRoutes);
  return app;
}
const auth = (r, token = TOKEN_CUSTOMER) => r.set('Authorization', `Bearer ${token}`);

// Each authenticated request fires the middleware DB lookup first
function mockAuth(user = MOCK_USER_CUSTOMER, ...extras) {
  mockQuery.mockResolvedValueOnce({ rows: [user] });
  extras.forEach(e => mockQuery.mockResolvedValueOnce(e));
}

beforeEach(() => resetMocks());

// ── GET /api/jobs ─────────────────────────────────────────────────────────────
describe('GET /api/jobs', () => {
  test('returns job list (public - no auth required)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { id: 10, title: 'Fix my fence', status: 'published', location_city: 'Austin' },
      ] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] }); // COUNT query

    const res = await request(buildApp()).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('jobs');
  });
});

// ── GET /api/jobs/:id ─────────────────────────────────────────────────────────
describe('GET /api/jobs/:id', () => {
  test('returns 404 for unknown job', async () => {
    mockAuth();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await auth(request(buildApp()).get('/api/jobs/999'));
    expect(res.status).toBe(404);
  });

  test('returns job details', async () => {
    mockAuth();
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 10, title: 'Fix my fence', status: 'published', client_id: 1 },
    ] });
    const res = await auth(request(buildApp()).get('/api/jobs/10'));
    expect(res.status).toBe(200);
  });
});

// ── POST /api/jobs ────────────────────────────────────────────────────────────
describe('POST /api/jobs', () => {
  const validBody = {
    title:        'Replace broken fence panel on north side of property',
    description:  'The fence panel on the north side fell over in the storm. Need it replaced with same cedar wood. About 8 feet wide.',
    location_city: 'Austin',
    location_country: 'US',
  };

  test('returns 400 when title is too short', async () => {
    mockAuth();
    const res = await auth(
      request(buildApp()).post('/api/jobs').send({ ...validBody, title: 'Short' })
    );
    expect(res.status).toBe(400);
    expect(res.body.fields).toHaveProperty('title');
  });

  test('returns 400 when description is too short', async () => {
    mockAuth();
    const res = await auth(
      request(buildApp()).post('/api/jobs').send({ ...validBody, description: 'Too short' })
    );
    expect(res.status).toBe(400);
    expect(res.body.fields).toHaveProperty('description');
  });

  test('returns 400 when location_city is missing', async () => {
    mockAuth();
    const res = await auth(
      request(buildApp()).post('/api/jobs').send({ ...validBody, location_city: '' })
    );
    expect(res.status).toBe(400);
    expect(res.body.fields).toHaveProperty('location');
  });

  test('creates job and returns 201', async () => {
    const newJob = { id: 42, title: validBody.title, status: 'published', client_id: 1 };
    mockAuth(MOCK_USER_CUSTOMER, { rows: [newJob] }); // auth + INSERT RETURNING
    const res = await auth(
      request(buildApp()).post('/api/jobs').send(validBody)
    );
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  test('stores app budget payload with currency and canonical cents', async () => {
    const newJob = {
      id: 45,
      title: validBody.title,
      status: 'published',
      client_id: 1,
      currency_code: 'GHS',
      budget_min_cents: 8500,
      budget_max_cents: 8500,
    };
    mockAuth(MOCK_USER_CUSTOMER, { rows: [newJob] });

    const res = await auth(
      request(buildApp()).post('/api/jobs').send({
        ...validBody,
        budget: 85,
        currency_code: 'ghs',
      }),
    );

    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls[1][1][32]).toBe('GHS');
    expect(mockQuery.mock.calls[1][1][33]).toBe(8500);
    expect(mockQuery.mock.calls[1][1][34]).toBe(8500);
  });

  test('creates job with uploaded media urls from the iOS payload', async () => {
    const mediaUrls = [
      'https://cdn.oxsteed.com/jobs/fence-before.jpg',
      'https://cdn.oxsteed.com/jobs/fence-closeup.jpg',
    ];
    const newJob = {
      id: 43,
      title: validBody.title,
      status: 'published',
      client_id: 1,
      media_urls: mediaUrls,
    };
    mockAuth(MOCK_USER_CUSTOMER, { rows: [newJob] });

    const res = await auth(
      request(buildApp()).post('/api/jobs').send({
        ...validBody,
        media_urls: mediaUrls,
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body.media_urls).toEqual(mediaUrls);
    expect(mockQuery.mock.calls[1][1][23]).toEqual(mediaUrls);
  });

  test('creates recurring job using recurrence from the mobile payload', async () => {
    const newJob = {
      id: 44,
      title: validBody.title,
      status: 'published',
      client_id: 1,
      recurrence: 'monthly',
    };
    mockAuth(MOCK_USER_CUSTOMER, { rows: [newJob] });

    const res = await auth(
      request(buildApp()).post('/api/jobs').send({
        ...validBody,
        recurrence: 'monthly',
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body.recurrence).toBe('monthly');
    expect(mockQuery.mock.calls[1][1][28]).toBe('monthly');
  });
});

// ── POST /api/jobs/assign ─────────────────────────────────────────────────────
describe('POST /api/jobs/assign', () => {
  test('customer accepts a pending bid with direct payment and assigns the job', async () => {
    mockAuth(
      MOCK_USER_CUSTOMER,
      {
        rows: [{
          id: 20,
          job_id: 10,
          helper_id: 2,
          status: 'pending',
          eta_hours: 2,
          client_id: 1,
          job_status: 'published',
          title: 'Fix my fence',
          scheduled_date: null,
          scheduled_time: null,
          location_city: 'Austin',
          location_state: 'TX',
        }],
      },
      {
        rows: [{
          id: 20,
          job_id: 10,
          helper_id: 2,
          amount: 25000,
          status: 'accepted',
          eta_hours: 2,
        }],
      },
      { rows: [] },
      {
        rows: [{
          helper_id: 2,
          oxsteed_enabled: false,
          custom_enabled: true,
          custom_policy: {
            terms: 'Customer and helper arrange payment directly. OxSteed does not collect or hold job payment yet.',
            payment_mode: 'direct',
          },
        }],
      },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
      {
        rows: [{
          id: 10,
          title: 'Fix my fence',
          client_id: 1,
          assigned_helper_id: 2,
          status: 'accepted',
        }],
      },
      { rows: [], rowCount: 1 },
    );

    const res = await auth(
      request(buildApp()).post('/api/jobs/assign').send({ bid_id: 20, payment_method: 'off_platform' })
    );

    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe('accepted');
    expect(res.body.job.assigned_helper_id).toBe(2);
    expect(res.body.bid.status).toBe('accepted');
    const acceptBidCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('payment_method = $1'));
    expect(acceptBidCall[1][0]).toBe('off_platform');
    expect(JSON.parse(acceptBidCall[1][1]).type).toBe('custom');
  });

  test('rejects protected OxSteed job payment while platform job payments are coming soon', async () => {
    mockAuth(MOCK_USER_CUSTOMER);
    // This test exercises the coming-soon gate, so the feature flag must be
    // off even though the shared setup enables it for other suites.
    const previous = process.env.FEATURE_PAYMENTS_ENABLED;
    process.env.FEATURE_PAYMENTS_ENABLED = 'false';
    try {
      const res = await auth(
        request(buildApp()).post('/api/jobs/assign').send({ bid_id: 20, payment_method: 'oxsteed' })
      );

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('platform_job_payments_coming_soon');
    } finally {
      if (previous === undefined) delete process.env.FEATURE_PAYMENTS_ENABLED;
      else process.env.FEATURE_PAYMENTS_ENABLED = previous;
    }
  });
});

// ── POST /api/jobs/:id/cancel ─────────────────────────────────────────────────
describe('POST /api/jobs/:id/cancel', () => {
  test('returns 404 when job not found', async () => {
    mockAuth(MOCK_USER_CUSTOMER, { rows: [] });
    const res = await auth(request(buildApp()).post('/api/jobs/999/cancel'));
    expect(res.status).toBe(404);
  });

  test('returns 404 when user does not own the job', async () => {
    // cancelJob does a single UPDATE WHERE client_id = $2; returns empty when not owner
    mockAuth(MOCK_USER_CUSTOMER, { rows: [] });
    const res = await auth(request(buildApp()).post('/api/jobs/10/cancel'));
    expect(res.status).toBe(404);
  });
});

// ── GET /api/jobs/me/list ─────────────────────────────────────────────────────
describe('GET /api/jobs/me/list', () => {
  test('returns authenticated user\'s jobs', async () => {
    mockAuth(MOCK_USER_CUSTOMER, { rows: [{ id: 10, title: 'My Job', client_id: 1 }] });
    const res = await auth(request(buildApp()).get('/api/jobs/me/list'));
    expect(res.status).toBe(200);
  });

  test('returns 401 without auth', async () => {
    const res = await request(buildApp()).get('/api/jobs/me/list');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/jobs/:id/complete ───────────────────────────────────────────────
describe('POST /api/jobs/:id/complete', () => {
  test('helper completes in_progress job (no escrow capture)', async () => {
    const helperUser = {
      ...MOCK_USER_CUSTOMER,
      id: 2,
      email: 'h@test.com',
      role: 'helper',
    };
    mockAuth(
      helperUser,
      {
        rows: [{
          id: 10,
          client_id: 1,
          assigned_helper_id: 2,
          status: 'in_progress',
          job_type: 'one_time',
          job_type_label: 'One-Time',
        }],
      },
      { rows: [{ id: 10, status: 'completed', client_id: 1, assigned_helper_id: 2 }] },
    );
    const res = await auth(
      request(buildApp()).post('/api/jobs/10/complete').send({}),
      TOKEN_HELPER,
    );
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe('completed');
  });

  test('customer completes tier-3 escrow job and captures authorized payment', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_t3',
      status: 'requires_capture',
    });
    stripe.paymentIntents.capture.mockResolvedValueOnce({
      charges: { data: [{ id: 'ch_job_complete' }] },
      amount_received: 10000,
    });
    mockAuth(
      MOCK_USER_CUSTOMER,
      {
        rows: [{
          id: 10,
          client_id: 1,
          assigned_helper_id: 2,
          status: 'in_progress',
          job_type: 'one_time',
          job_type_label: 'One-Time',
          // Deterministic tier enum (replaces label substring matching).
          transaction_mode: 'guided_protected',
        }],
      },
      {
        rows: [{
          id: 5,
          amount: 100,
          stripe_payment_intent_id: 'pi_t3',
          stripe_account_id: 'acct_x',
          status: 'authorized',
        }],
      },
      { rows: [] },
      { rowCount: 1, rows: [] },
      { rows: [{ id: 10, status: 'completed', client_id: 1, assigned_helper_id: 2 }] },
    );
    const res = await auth(request(buildApp()).post('/api/jobs/10/complete').send({}));
    expect(res.status).toBe(200);
    expect(stripe.paymentIntents.capture).toHaveBeenCalled();
    expect(res.body.job.status).toBe('completed');
  });

  test('tier-looking labels alone do not trigger escrow capture (fail closed)', async () => {
    stripe.paymentIntents.capture.mockClear();
    mockAuth(
      MOCK_USER_CUSTOMER,
      {
        rows: [{
          id: 10,
          client_id: 1,
          assigned_helper_id: 2,
          status: 'in_progress',
          // Legacy substring bait: must NOT count as tier-3 without the enum.
          job_type: 'tier3_escrow',
          job_type_label: 'Escrow Protected',
          transaction_mode: 'direct',
        }],
      },
      { rows: [{ id: 10, status: 'completed', client_id: 1, assigned_helper_id: 2 }] },
    );
    const res = await auth(request(buildApp()).post('/api/jobs/10/complete').send({}));
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe('completed');
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
  });
});
