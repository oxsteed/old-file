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
jest.mock('../middleware/upload', () => {
  const noop = (req, res, next) => { req.files = []; next(); };
  return {
    upload: { array: () => noop, single: () => noop },
    validateMagicBytes: (req, res, next) => next(),
  };
});

const express = require('express');
const request = require('supertest');
const jwt     = require('jsonwebtoken');

const jobRoutes = require('../routes/jobs');

const TOKEN_CUSTOMER = jwt.sign({ id: 1, email: 'c@test.com', role: 'customer' }, process.env.JWT_SECRET);
const TOKEN_HELPER   = jwt.sign({ id: 2, email: 'h@test.com', role: 'helper'   }, process.env.JWT_SECRET);

const MOCK_USER_CUSTOMER = {
  id: 1, first_name: 'Alice', last_name: 'Smith', email: 'c@test.com',
  phone: null, role: 'customer', email_verified: true, is_verified: false,
  onboarding_status: 'active', onboarding_completed: true,
  contact_completed: true, profile_completed: true,
  tier_selected: true, w9_completed: false, terms_accepted: true,
  membership_tier: 'free', id_verified: false, background_check_passed: false,
  city: 'Austin', state: 'TX', zip_code: '78701',
  display_name_preference: 'first_name', business_name: null, is_active: true,
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
  test('returns job list (public — no auth required)', async () => {
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
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/jobs/999');
    expect(res.status).toBe(404);
  });

  test('returns job details', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 10, title: 'Fix my fence', status: 'published', client_id: 1 },
    ] });
    const res = await request(buildApp()).get('/api/jobs/10');
    expect(res.status).toBe(200);
  });
});

// ── POST /api/jobs ────────────────────────────────────────────────────────────
describe('POST /api/jobs', () => {
  const validBody = {
    title:        'Replace broken fence panel on north side of property',
    description:  'The fence panel on the north side fell over in the storm. Need it replaced with same cedar wood. About 8 feet wide.',
    location_city: 'Austin',
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
