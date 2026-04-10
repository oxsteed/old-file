'use strict';

const { mockQuery, resetMocks } = require('./setup');

// helperOnboardingMiddleware requires DB + tier checks — mock it to pass
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
  phone: null, role: 'helper', email_verified: true, is_verified: true,
  onboarding_status: 'active', onboarding_completed: true,
  contact_completed: true, profile_completed: true,
  tier_selected: true, w9_completed: true, terms_accepted: true,
  membership_tier: 'pro', id_verified: true, background_check_passed: true,
  city: 'Austin', state: 'TX', zip_code: '78701',
  display_name_preference: 'first_name', business_name: null, is_active: true,
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

beforeEach(() => resetMocks());

// ── POST /api/bids ────────────────────────────────────────────────────────────
describe('POST /api/bids', () => {
  test('returns 404 when job does not exist', async () => {
    mockAuth({ rows: [] }); // job query → not found
    const res = await auth(
      request(buildApp()).post('/api/bids').send({ job_id: 999, amount: 150, message: 'I can do this' })
    );
    expect(res.status).toBe(404);
  });

  test('returns 400 when bidding on own job', async () => {
    // Job's client_id matches the helper's user id
    mockAuth({ rows: [{ id: 10, client_id: HELPER_ID, status: 'published' }] });
    const res = await auth(
      request(buildApp()).post('/api/bids').send({ job_id: 10, amount: 150, message: 'I own this' })
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own job/i);
  });

  test('returns 400 when job is not accepting bids', async () => {
    mockAuth({ rows: [{ id: 10, client_id: 1, status: 'completed' }] });
    const res = await auth(
      request(buildApp()).post('/api/bids').send({ job_id: 10, amount: 150, message: 'Too late' })
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not accepting/i);
  });

  test('returns 400 when bid already placed', async () => {
    mockAuth(
      { rows: [{ id: 10, client_id: 1, status: 'published' }] }, // job
      { rows: [{ id: 5, helper_id: HELPER_ID }] }                  // existing bid
    );
    const res = await auth(
      request(buildApp()).post('/api/bids').send({ job_id: 10, amount: 150, message: 'Already bid' })
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already/i);
  });

  test('creates bid and returns 201', async () => {
    mockAuth(
      { rows: [{ id: 10, client_id: 1, status: 'published' }] },      // job
      { rows: [] },                                                       // no existing bid
      { rows: [{ id: 20, job_id: 10, helper_id: HELPER_ID, amount: 150, status: 'pending' }] }, // INSERT bid
      { rows: [], rowCount: 0 }                                          // UPDATE job status
    );
    const res = await auth(
      request(buildApp()).post('/api/bids').send({ job_id: 10, amount: 150, message: 'I can handle this' })
    );
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id', 20);
    expect(res.body.amount).toBe(150);
  });
});

// ── GET /api/bids/me ──────────────────────────────────────────────────────────
describe('GET /api/bids/me', () => {
  test('returns helper\'s bids', async () => {
    mockAuth({ rows: [{ id: 20, job_id: 10, status: 'pending' }] });
    const res = await auth(request(buildApp()).get('/api/bids/me'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('returns 401 without token', async () => {
    const res = await request(buildApp()).get('/api/bids/me');
    expect(res.status).toBe(401);
  });
});

// ── PUT /api/bids/:id ─────────────────────────────────────────────────────────
describe('PUT /api/bids/:id', () => {
  test('returns 404 when bid not found', async () => {
    mockAuth({ rows: [] });
    const res = await auth(request(buildApp()).put('/api/bids/999').send({ amount: 200 }));
    expect(res.status).toBe(404);
  });

  test('returns 403 when bid belongs to another helper', async () => {
    mockAuth({ rows: [{ id: 20, helper_id: 99, status: 'pending' }] });
    const res = await auth(request(buildApp()).put('/api/bids/20').send({ amount: 200 }));
    expect(res.status).toBe(403);
  });

  test('returns 400 when bid is not pending', async () => {
    mockAuth({ rows: [{ id: 20, helper_id: HELPER_ID, status: 'accepted' }] });
    const res = await auth(request(buildApp()).put('/api/bids/20').send({ amount: 200 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pending/i);
  });

  test('updates and returns the bid', async () => {
    mockAuth(
      { rows: [{ id: 20, helper_id: HELPER_ID, status: 'pending' }] },
      { rows: [{ id: 20, amount: 200, status: 'pending' }] }
    );
    const res = await auth(request(buildApp()).put('/api/bids/20').send({ amount: 200 }));
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(200);
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
