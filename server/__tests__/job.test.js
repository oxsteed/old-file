'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { currentConsentRows } = require('./helpers/currentConsents');
const { routeQueries } = require('./helpers/sqlRouter');

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
// Route-based mocks for createJob: auth lookup + INSERT (inside a transaction).
function mockCreate(newJob) {
  return routeQueries(mockQuery, [
    [/FROM users u/, { rows: [MOCK_USER_CUSTOMER] }],
    [/FROM user_consents/, { rows: currentConsentRows() }],
    [/INSERT INTO jobs/, { rows: [newJob] }],
  ]);
}
const insertParams = (calls) => calls.find((c) => /INSERT INTO jobs/.test(c.sql)).params;

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

  test('returns 422 with a localizable code when title is too short', async () => {
    mockAuth(MOCK_USER_CUSTOMER, { rows: currentConsentRows() });
    const res = await auth(
      request(buildApp()).post('/api/jobs').send({ ...validBody, title: 'Short' })
    );
    expect(res.status).toBe(422);
    expect(res.body.fields.title).toBe('too_short');
  });

  test('returns 422 when description is too short', async () => {
    mockAuth(MOCK_USER_CUSTOMER, { rows: currentConsentRows() });
    const res = await auth(
      request(buildApp()).post('/api/jobs').send({ ...validBody, description: 'Too short' })
    );
    expect(res.status).toBe(422);
    expect(res.body.fields.description).toBe('too_short');
  });

  test('returns 422 when location_city is missing (legacy `location` key mirrored)', async () => {
    mockAuth(MOCK_USER_CUSTOMER, { rows: currentConsentRows() });
    const res = await auth(
      request(buildApp()).post('/api/jobs').send({ ...validBody, location_city: '' })
    );
    expect(res.status).toBe(422);
    expect(res.body.fields.location_city).toBe('required');
    expect(res.body.fields.location).toBe('required');
  });

  test('returns 422 when the budget range is inverted', async () => {
    mockAuth(MOCK_USER_CUSTOMER, { rows: currentConsentRows() });
    const res = await auth(
      request(buildApp()).post('/api/jobs').send({ ...validBody, budget_type: 'range', budget_min: 300, budget_max: 100 })
    );
    expect(res.status).toBe(422);
    expect(res.body.fields.budget_max_cents).toBe('budget_order');
  });

  test('creates job and returns 201', async () => {
    const newJob = { id: 42, title: validBody.title, status: 'published', client_id: 1 };
    const calls = mockCreate(newJob);
    const res = await auth(
      request(buildApp()).post('/api/jobs').send(validBody)
    );
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    // The publish event commits with the insert (transactional outbox).
    expect(calls.some((c) => /INSERT INTO job_event_outbox/.test(c.sql) && c.params[1] === 'job.published')).toBe(true);
  });

  test('never returns exact coordinates', async () => {
    const newJob = { id: 46, title: validBody.title, status: 'published', client_id: 1, location_lat: 30.1, location_lng: -97.7, location_point: 'POINT', location_approx_lat: 30.12 };
    mockCreate(newJob);
    const res = await auth(request(buildApp()).post('/api/jobs').send({ ...validBody, location_lat: 30.1, location_lng: -97.7 }));
    expect(res.status).toBe(201);
    expect(res.body.location_lat).toBeUndefined();
    expect(res.body.location_lng).toBeUndefined();
    expect(res.body.location_point).toBeUndefined();
    expect(res.body.location_approx_lat).toBe(30.12);
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
    const calls = mockCreate(newJob);

    const res = await auth(
      request(buildApp()).post('/api/jobs').send({
        ...validBody,
        budget: 85,
        currency_code: 'ghs',
      }),
    );

    expect(res.status).toBe(201);
    expect(insertParams(calls)[32]).toBe('GHS');
    expect(insertParams(calls)[33]).toBe(8500);
    expect(insertParams(calls)[34]).toBe(8500);
  });

  test('creates job with uploaded media urls from the iOS payload', async () => {
    const mediaUrls = [
      'https://oxsteed.com/api/storage/public/jobs/fence-before.jpg',
      'https://oxsteed.com/api/storage/public/jobs/fence-closeup.jpg',
    ];
    const newJob = {
      id: 43,
      title: validBody.title,
      status: 'published',
      client_id: 1,
      media_urls: mediaUrls,
    };
    const calls = mockCreate(newJob);

    const res = await auth(
      request(buildApp()).post('/api/jobs').send({
        ...validBody,
        media_urls: mediaUrls,
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body.media_urls).toEqual(mediaUrls);
    expect(insertParams(calls)[23]).toEqual(mediaUrls);
  });

  test('creates recurring job using recurrence from the mobile payload', async () => {
    const newJob = {
      id: 44,
      title: validBody.title,
      status: 'published',
      client_id: 1,
      recurrence: 'monthly',
    };
    const calls = mockCreate(newJob);

    const res = await auth(
      request(buildApp()).post('/api/jobs').send({
        ...validBody,
        recurrence: 'monthly',
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body.recurrence).toBe('monthly');
    expect(insertParams(calls)[28]).toBe('monthly');
  });
});

// ── POST /api/jobs/assign ─────────────────────────────────────────────────────
describe('POST /api/jobs/assign', () => {
  const JOB = {
    id: '10', client_id: 1, status: 'published', version: 4, revision: 2, title: 'Fix my fence',
    location_city: 'Austin', location_state: 'TX', scheduled_start_at: null, deleted_at: null,
  };
  const PENDING_BID = { id: 20, job_id: '10', helper_id: 2, status: 'pending', eta_hours: 2, amount: '250.00', amount_cents: 25000, job_revision: 2, needs_reconfirm: false, expires_at: new Date(Date.now() + 3600e3) };
  const assignRoutes = ({ job = JOB, bid = PENDING_BID } = {}) => [
    [/FROM users u/, { rows: [MOCK_USER_CUSTOMER] }],
    [/FROM user_consents/, { rows: currentConsentRows() }],
    [/SELECT job_id FROM bids WHERE id = \$1/, { rows: [{ job_id: '10' }] }],
    [/SELECT \* FROM jobs WHERE id = \$1 FOR UPDATE/, { rows: [job] }],
    [/FROM bids WHERE id = \$1 AND job_id = \$2 FOR UPDATE/, { rows: [bid] }],
    [/UPDATE bids SET status = 'accepted'/, { rows: [{ ...bid, status: 'accepted' }] }],
    [/FROM helper_cancellation_policies/, { rows: [{ helper_id: 2, oxsteed_enabled: false, custom_enabled: true, custom_policy: { payment_mode: 'direct' } }] }],
    [/UPDATE jobs SET\s+assigned_helper_id/, { rows: [{ ...job, assigned_helper_id: 2, status: 'accepted', version: job.version + 1, location_lat: 30.1, location_lng: -97.7 }] }],
  ];

  test('customer accepts a pending bid with direct payment and assigns the job', async () => {
    const calls = routeQueries(mockQuery, assignRoutes());

    const res = await auth(
      request(buildApp()).post('/api/jobs/assign').send({ bid_id: 20, payment_method: 'off_platform' })
    );

    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe('accepted');
    expect(res.body.job.assigned_helper_id).toBe(2);
    expect(res.body.job.location_lat).toBeUndefined();
    expect(res.body.bid.status).toBe('accepted');
    expect(res.headers.etag).toBe('W/"job-10-v5"');
    const acceptBidCall = calls.find(({ sql }) => String(sql).includes('payment_method = $1'));
    expect(acceptBidCall.params[0]).toBe('off_platform');
    expect(JSON.parse(acceptBidCall.params[1]).type).toBe('custom');
    // Lock order jobs → bids.
    const jobLock = calls.findIndex((c) => /FROM jobs WHERE id = \$1 FOR UPDATE/.test(c.sql));
    const bidLock = calls.findIndex((c) => /FROM bids WHERE id = \$1 AND job_id = \$2 FOR UPDATE/.test(c.sql));
    expect(jobLock).toBeGreaterThan(-1);
    expect(jobLock).toBeLessThan(bidLock);
  });

  test('accepts from negotiating status', async () => {
    routeQueries(mockQuery, assignRoutes({ job: { ...JOB, status: 'negotiating' } }));
    const res = await auth(request(buildApp()).post('/api/jobs/assign').send({ bid_id: 20, payment_method: 'off_platform' }));
    expect(res.status).toBe(200);
  });

  test('refuses a bid that must be reconfirmed after a material edit', async () => {
    routeQueries(mockQuery, assignRoutes({ job: { ...JOB, revision: 3 }, bid: { ...PENDING_BID, job_revision: 2, needs_reconfirm: true } }));
    const res = await auth(request(buildApp()).post('/api/jobs/assign').send({ bid_id: 20, payment_method: 'off_platform' }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('bid_needs_reconfirm');
  });

  test('refuses an expired bid', async () => {
    routeQueries(mockQuery, assignRoutes({ bid: { ...PENDING_BID, expires_at: new Date(Date.now() - 1000) } }));
    const res = await auth(request(buildApp()).post('/api/jobs/assign').send({ bid_id: 20, payment_method: 'off_platform' }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('bid_expired');
  });

  test('race guard: the customer\'s stale job version fails with 412 under If-Match', async () => {
    routeQueries(mockQuery, assignRoutes());
    const res = await auth(request(buildApp()).post('/api/jobs/assign')
      .set('If-Match', 'W/"job-10-v3"')
      .send({ bid_id: 20, payment_method: 'off_platform' }));
    expect(res.status).toBe(412);
    expect(res.body.code).toBe('precondition_failed');
    expect(res.headers.etag).toBe('W/"job-10-v4"');
  });

  test('race guard: expected_job_version mismatch is a 409', async () => {
    routeQueries(mockQuery, assignRoutes());
    const res = await auth(request(buildApp()).post('/api/jobs/assign').send({ bid_id: 20, payment_method: 'off_platform', expected_job_version: 2 }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('version_conflict');
  });

  test('non-owners cannot accept bids', async () => {
    routeQueries(mockQuery, assignRoutes({ job: { ...JOB, client_id: 99 } }));
    const res = await auth(request(buildApp()).post('/api/jobs/assign').send({ bid_id: 20, payment_method: 'off_platform' }));
    expect(res.status).toBe(403);
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
      { rows: [] }, // no proposed work-agreement change order
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
    const calls = routeQueries(mockQuery, [
      [/FROM users u/, { rows: [MOCK_USER_CUSTOMER] }],
      [/FROM jobs/, { rows: [{ id: 10, client_id: 1, assigned_helper_id: 2,
        status: 'in_progress', job_type: 'one_time', job_type_label: 'One-Time',
        transaction_mode: 'guided_protected' }] }],
      [/FROM payments WHERE job_id = \$1 AND status = 'authorized'/, { rows: [{
        id: 5, job_id: 10, amount: 100, stripe_payment_intent_id: 'pi_t3',
        stripe_account_id: 'acct_x', status: 'authorized',
      }] }],
      [/UPDATE jobs SET/, { rows: [{ id: 10, status: 'completed', client_id: 1, assigned_helper_id: 2 }] }],
    ]);
    const res = await auth(request(buildApp()).post('/api/jobs/10/complete').send({}));
    expect(res.status).toBe(200);
    expect(stripe.paymentIntents.capture).toHaveBeenCalled();
    expect(res.body.job.status).toBe('completed');
    expect(calls.some(c => /INSERT INTO admin_audit_log/.test(c.sql))).toBe(true);
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
      { rows: [] }, // no proposed work-agreement change order
      { rows: [{ id: 10, status: 'completed', client_id: 1, assigned_helper_id: 2 }] },
    );
    const res = await auth(request(buildApp()).post('/api/jobs/10/complete').send({}));
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe('completed');
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
  });
});
