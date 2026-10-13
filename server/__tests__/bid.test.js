'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { currentConsentRows } = require('./helpers/currentConsents');
const { routeQueries } = require('./helpers/sqlRouter');

// helperOnboardingMiddleware requires DB + tier checks - mock it to pass
jest.mock('../middleware/helperOnboardingMiddleware', () => ({
  requireOnboardingStep: () => (req, res, next) => next(),
  requireTier:           () => (req, res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const jwt     = require('jsonwebtoken');

const bidRoutes = require('../routes/bids');

const HELPER_ID   = 2;
const TOKEN_HELPER = jwt.sign({ id: HELPER_ID, email: 'h@test.com', role: 'helper' }, process.env.JWT_SECRET);

const MOCK_HELPER = {
  id: HELPER_ID, first_name: 'Bob', last_name: 'Fix', email: 'h@test.com',
  phone: null, role: 'helper', email_verified: true, is_verified: true, is_active: true,
  onboarding_status: 'active', onboarding_completed: true,
  contact_completed: true, profile_completed: true,
  tier_selected: true, w9_completed: true, terms_accepted: true,
  membership_tier: 'pro', id_verified: true, background_check_passed: true,
  city: 'Austin', state: 'TX', zip_code: '78701',
  display_name_preference: 'first_name', business_name: null,
  didit_status: 'verified', didit_verified_at: new Date(), didit_enforcement_required: false,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/bids', bidRoutes);
  return app;
}
const auth = r => r.set('Authorization', `Bearer ${TOKEN_HELPER}`);

function mockAuth(...extras) {
  mockQuery.mockResolvedValueOnce({ rows: [MOCK_HELPER] });
  extras.forEach(e => mockQuery.mockResolvedValueOnce(e));
}

function mockBidAuth(...extras) {
  mockAuth({ rows: currentConsentRows() }, ...extras);
}

beforeEach(() => resetMocks());

// ── POST /api/bids ────────────────────────────────────────────────────────────
describe('POST /api/bids', () => {
  test('returns 404 when job does not exist', async () => {
    mockBidAuth({ rows: [] }); // job query → not found
    const res = await auth(
      request(buildApp()).post('/api/bids').send({ job_id: 999, amount: 150, message: 'I can do this' })
    );
    expect(res.status).toBe(404);
  });

  test('returns 400 when bidding on own job', async () => {
    // Job's client_id matches the helper's user id
    mockBidAuth({ rows: [{ id: 10, client_id: HELPER_ID, status: 'published' }] });
    const res = await auth(
      request(buildApp()).post('/api/bids').send({ job_id: 10, amount: 150, message: 'I own this' })
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own job/i);
  });

  test('returns 400 when job is not accepting bids', async () => {
    mockBidAuth({ rows: [{ id: 10, client_id: 1, status: 'completed' }] });
    const res = await auth(
      request(buildApp()).post('/api/bids').send({ job_id: 10, amount: 150, message: 'Too late' })
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not accepting/i);
  });

  const JOB = { id: '10', client_id: 1, status: 'published', version: 3, revision: 2, title: 'Fix the fence', description: 'x'.repeat(60) };
  const routesFor = (extra = []) => [
    [/FROM users u/, { rows: [MOCK_HELPER] }],
    [/FROM user_consents/, { rows: currentConsentRows() }],
    [/SELECT id, client_id, status, deleted_at FROM jobs/, { rows: [JOB] }],
    [/SELECT \* FROM jobs WHERE id = \$1 FOR SHARE/, { rows: [JOB] }],
    ...extra,
  ];

  test('returns 409 when bid already placed', async () => {
    routeQueries(mockQuery, routesFor([[/SELECT id FROM bids WHERE job_id = \$1 AND helper_id = \$2 FOR UPDATE/, { rows: [{ id: 5 }] }]]));
    const res = await auth(
      request(buildApp()).post('/api/bids').send({ job_id: 10, amount: 150, message: 'Already bid' })
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
  });

  test('creates bid with cents and a job revision snapshot', async () => {
    const calls = routeQueries(mockQuery, routesFor([
      [/INSERT INTO bids/, (sql, params) => ({ rows: [{ id: 20, job_id: 10, helper_id: HELPER_ID, amount: params[2], amount_cents: params[3], status: 'pending', job_revision: params[7] }] })],
    ]));
    const res = await auth(
      request(buildApp()).post('/api/bids').send({ job_id: 10, amount: 150.255, message: 'I can handle this' })
    );
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id', 20);
    expect(res.body.amount_cents).toBe(15026);
    expect(res.body.job_revision).toBe(2);
    const insert = calls.find((c) => /INSERT INTO bids/.test(c.sql));
    const snapshot = JSON.parse(insert.params[8]);
    expect(snapshot).toMatchObject({ revision: 2, version: 3, title: 'Fix the fence' });
    expect(snapshot.description_sha256).toHaveLength(64);
    // Lock order: the job row is locked before the bid duplicate check.
    const lockIdx = calls.findIndex((c) => /FOR SHARE/.test(c.sql));
    const dupIdx = calls.findIndex((c) => /FROM bids WHERE job_id = \$1 AND helper_id = \$2 FOR UPDATE/.test(c.sql));
    expect(lockIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(dupIdx);
  });

  test('rejects a bid written against an outdated job revision', async () => {
    routeQueries(mockQuery, routesFor());
    const res = await auth(
      request(buildApp()).post('/api/bids').send({ job_id: 10, amount: 150, message: 'Old terms', job_revision: 1 })
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('job_changed');
  });

  test('accepts bids while the customer is negotiating', async () => {
    const negotiating = { ...JOB, status: 'negotiating' };
    routeQueries(mockQuery, [
      [/FROM users u/, { rows: [MOCK_HELPER] }],
      [/FROM user_consents/, { rows: currentConsentRows() }],
      [/SELECT id, client_id, status, deleted_at FROM jobs/, { rows: [negotiating] }],
      [/FOR SHARE/, { rows: [negotiating] }],
      [/INSERT INTO bids/, { rows: [{ id: 21, status: 'pending' }] }],
    ]);
    const res = await auth(request(buildApp()).post('/api/bids').send({ job_id: 10, amount: 90, message: 'Happy to help' }));
    expect(res.status).toBe(201);
  });
});

// ── GET /api/bids/me ──────────────────────────────────────────────────────────
describe('GET /api/bids/me', () => {
  test('returns helper\'s bids', async () => {
    mockAuth(
      { rows: [{ id: 20, job_id: 10, status: 'pending' }] }, // list
      { rows: [{ count: '1' }] } // count for X-Total-Count
    );
    const res = await auth(request(buildApp()).get('/api/bids/me'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('returns 401 without token', async () => {
    const res = await request(buildApp()).get('/api/bids/me');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/bids/:id ─────────────────────────────────────────────────────────
describe('GET /api/bids/:id', () => {
  test('returns a single bid for the helper who placed it', async () => {
    mockAuth({
      rows: [{
        id: 20,
        job_id: 10,
        helper_id: HELPER_ID,
        client_id: 1,
        amount: '150',
        status: 'pending',
        job_title: 'Fix bathtub',
        helper_name: 'Bob Fix',
      }],
    });
    const res = await auth(request(buildApp()).get('/api/bids/20'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 20,
      job_id: 10,
      helper_id: HELPER_ID,
      job_title: 'Fix bathtub',
    });
    expect(res.body.client_id).toBeUndefined();
  });

  test('returns 403 when the user is not a party to the bid', async () => {
    mockAuth({
      rows: [{
        id: 20,
        job_id: 10,
        helper_id: 99,
        client_id: 1,
        amount: '150',
        status: 'pending',
      }],
    });
    const res = await auth(request(buildApp()).get('/api/bids/20'));
    expect(res.status).toBe(403);
  });
});

// ── PUT /api/bids/:id ─────────────────────────────────────────────────────────
describe('PUT /api/bids/:id', () => {
  test('returns 404 when bid not found', async () => {
    mockAuth({ rows: [] });
    const res = await auth(request(buildApp()).put('/api/bids/999').send({ amount: 200 }));
    expect(res.status).toBe(404);
  });

  const JOB = { id: '10', client_id: 1, status: 'published', version: 5, revision: 3, title: 'Fix the fence', description: 'y'.repeat(60) };
  const bidRoutesFor = (bid, extra = []) => [
    [/FROM users u/, { rows: [MOCK_HELPER] }],
    [/SELECT job_id FROM bids WHERE id = \$1/, { rows: [{ job_id: '10' }] }],
    [/SELECT \* FROM jobs WHERE id = \$1 FOR SHARE/, { rows: [JOB] }],
    [/FROM bids WHERE id = \$1 FOR UPDATE/, { rows: [bid] }],
    ...extra,
  ];

  test('returns 403 when bid belongs to another helper', async () => {
    routeQueries(mockQuery, bidRoutesFor({ id: 20, helper_id: 99, status: 'pending', job_revision: 3 }));
    const res = await auth(request(buildApp()).put('/api/bids/20').send({ amount: 200 }));
    expect(res.status).toBe(403);
  });

  test('returns 400 when bid is not pending', async () => {
    routeQueries(mockQuery, bidRoutesFor({ id: 20, helper_id: HELPER_ID, status: 'accepted', job_revision: 3 }));
    const res = await auth(request(buildApp()).put('/api/bids/20').send({ amount: 200 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pending/i);
  });

  test('updates and returns the bid in cents', async () => {
    const calls = routeQueries(mockQuery, bidRoutesFor({ id: 20, helper_id: HELPER_ID, status: 'pending', job_revision: 3 }, [
      [/UPDATE bids/, (sql, params) => ({ rows: [{ id: 20, amount: 200, amount_cents: params[0], status: 'pending', needs_reconfirm: false }] })],
    ]));
    const res = await auth(request(buildApp()).put('/api/bids/20').send({ amount: 200 }));
    expect(res.status).toBe(200);
    expect(res.body.amount_cents).toBe(20000);
    const update = calls.find((c) => /UPDATE bids/.test(c.sql));
    expect(update.params[4]).toBe(false); // not a reconfirmation
  });

  test('updating a stale bid reconfirms it against the latest revision', async () => {
    const calls = routeQueries(mockQuery, bidRoutesFor({ id: 20, helper_id: HELPER_ID, status: 'pending', job_revision: 2, needs_reconfirm: true }, [
      [/UPDATE bids/, { rows: [{ id: 20, status: 'pending', job_revision: 3, needs_reconfirm: false }] }],
    ]));
    const res = await auth(request(buildApp()).put('/api/bids/20').send({ message: 'Still works for me' }));
    expect(res.status).toBe(200);
    const update = calls.find((c) => /UPDATE bids/.test(c.sql));
    expect(update.params[4]).toBe(true);
    expect(update.params[6]).toBe(3);
  });
});

// ── POST /api/bids/:id/reconfirm ──────────────────────────────────────────────
describe('POST /api/bids/:id/reconfirm', () => {
  const JOB = { id: '10', client_id: 1, status: 'matched', version: 5, revision: 3, title: 'Fix the fence', description: 'z'.repeat(60) };
  const routesFor = (bid, job = JOB, extra = []) => [
    [/FROM users u/, { rows: [MOCK_HELPER] }],
    [/SELECT job_id FROM bids WHERE id = \$1/, { rows: [{ job_id: '10' }] }],
    [/SELECT \* FROM jobs WHERE id = \$1 FOR SHARE/, { rows: [job] }],
    [/FROM bids WHERE id = \$1 FOR UPDATE/, { rows: [bid] }],
    ...extra,
  ];

  test('rebinds a flagged bid to the current revision and clears the flag', async () => {
    const calls = routeQueries(mockQuery, routesFor({ id: 20, helper_id: HELPER_ID, status: 'pending', job_revision: 2, needs_reconfirm: true }, JOB, [
      [/UPDATE bids/, { rows: [{ id: 20, status: 'pending', job_revision: 3, needs_reconfirm: false }] }],
    ]));
    const res = await auth(request(buildApp()).post('/api/bids/20/reconfirm').send({ amount: 175 }));
    expect(res.status).toBe(200);
    expect(res.body.reconfirmed).toBe(true);
    expect(res.body.bid.needs_reconfirm).toBe(false);
    const update = calls.find((c) => /UPDATE bids/.test(c.sql));
    expect(update.params[0]).toBe(17500);
    expect(JSON.parse(update.params[7])).toMatchObject({ revision: 3 });
  });

  test('returns 409 when the bid already matches the latest job', async () => {
    routeQueries(mockQuery, routesFor({ id: 20, helper_id: HELPER_ID, status: 'pending', job_revision: 3, needs_reconfirm: false }));
    const res = await auth(request(buildApp()).post('/api/bids/20/reconfirm').send({}));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('bid_already_current');
  });

  test('returns 409 when the job stopped accepting bids', async () => {
    routeQueries(mockQuery, routesFor({ id: 20, helper_id: HELPER_ID, status: 'pending', job_revision: 2, needs_reconfirm: true }, { ...JOB, status: 'cancelled' }));
    const res = await auth(request(buildApp()).post('/api/bids/20/reconfirm').send({}));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('job_not_accepting_bids');
  });

  test('reconfirming against a revision the helper has not seen returns 409 job_changed', async () => {
    const calls = routeQueries(mockQuery, routesFor({ id: 20, helper_id: HELPER_ID, status: 'pending', job_revision: 2, needs_reconfirm: true }));
    const res = await auth(request(buildApp()).post('/api/bids/20/reconfirm').send({ job_revision: 2 }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('job_changed');
    expect(calls.some((c) => /UPDATE bids/.test(c.sql))).toBe(false);
  });

  test('an expired bid cannot be reconfirmed', async () => {
    routeQueries(mockQuery, routesFor({ id: 20, helper_id: HELPER_ID, status: 'pending', job_revision: 2, needs_reconfirm: true,
      expires_at: new Date(Date.now() - 60e3) }));
    const res = await auth(request(buildApp()).post('/api/bids/20/reconfirm').send({ job_revision: 3 }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('bid_expired');
  });

  test('other helpers cannot reconfirm someone else\'s bid', async () => {
    routeQueries(mockQuery, routesFor({ id: 20, helper_id: 77, status: 'pending', job_revision: 2, needs_reconfirm: true }));
    const res = await auth(request(buildApp()).post('/api/bids/20/reconfirm').send({}));
    expect(res.status).toBe(403);
  });
});

// ── POST /api/bids/:id/withdraw ───────────────────────────────────────────────
describe('POST /api/bids/:id/withdraw', () => {
  test('returns 400 when bid is not pending', async () => {
    mockAuth({ rows: [{ id: 20, helper_id: HELPER_ID, status: 'accepted' }] });
    const res = await auth(request(buildApp()).post('/api/bids/20/withdraw'));
    expect(res.status).toBe(400);
  });

  test('withdraws bid successfully', async () => {
    mockAuth(
      { rows: [{ id: 20, helper_id: HELPER_ID, status: 'pending' }] },
      { rows: [{ id: 20, status: 'withdrawn' }] }
    );
    const res = await auth(request(buildApp()).post('/api/bids/20/withdraw'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('withdrawn');
  });
});
