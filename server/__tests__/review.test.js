'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(true),
}));

// db.connect() returns a client with query/release — mock it separately from pool.query
const { Pool } = require('pg');
const mockConnect = Pool.mockConnect;
const mockRelease = Pool.mockRelease;

const express = require('express');
const request = require('supertest');
const jwt     = require('jsonwebtoken');

const reviewRoutes = require('../routes/reviews');

const CLIENT_ID = 1;
const HELPER_ID = 2;
const TOKEN_CLIENT = jwt.sign({ id: CLIENT_ID, email: 'c@test.com', role: 'customer' }, process.env.JWT_SECRET);

const MOCK_CLIENT = {
  id: CLIENT_ID, first_name: 'Alice', last_name: 'Smith', email: 'c@test.com',
  phone: null, role: 'customer', email_verified: true, is_verified: false,
  onboarding_status: 'active', onboarding_completed: true,
  contact_completed: true, profile_completed: true,
  tier_selected: true, w9_completed: false, terms_accepted: true,
  membership_tier: 'free', id_verified: false, background_check_passed: false,
  city: null, state: null, zip_code: null,
  display_name_preference: 'first_name', business_name: null, is_active: true,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/reviews', reviewRoutes);
  return app;
}
const auth = r => r.set('Authorization', `Bearer ${TOKEN_CLIENT}`);

beforeEach(() => {
  resetMocks();
  // submitReview uses db.connect() / client.query() / client.release()
  // mockConnect resolves to { query: mockQuery, release: mockRelease }
  mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
});

// ── POST /api/reviews/jobs/:jobId ─────────────────────────────────────────────
describe('POST /api/reviews/jobs/:jobId', () => {
  test('returns 400 when rating is invalid', async () => {
    // authenticate → user row; then db.connect succeeds; then submitReview returns 400 before any query
    mockQuery
      .mockResolvedValueOnce({ rows: [MOCK_CLIENT] }); // authenticate

    const res = await auth(
      request(buildApp()).post('/api/reviews/jobs/10').send({ rating: 0, body: 'Great!' })
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rating/i);
  });

  test('returns 403 when user was not part of the job', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [MOCK_CLIENT] }) // authenticate
      .mockResolvedValueOnce({ rows: [] });            // BEGIN (via client.query)

    // The submitReview uses dbClient.query for all queries after connect
    // We need to mock the BEGIN and then the job SELECT
    mockQuery
      .mockResolvedValueOnce({ rows: [] }); // job SELECT → no rows = 403

    const res = await auth(
      request(buildApp()).post('/api/reviews/jobs/10').send({ rating: 5, body: 'Great!' })
    );
    expect(res.status).toBe(403);
  });

  test('submits review successfully', async () => {
    const job = {
      id: 10, client_id: CLIENT_ID, assigned_helper_id: HELPER_ID,
      status: 'closed', client_first: 'Alice', helper_first: 'Bob',
    };
    const review = { id: 55, job_id: 10, reviewer_id: CLIENT_ID, reviewee_id: HELPER_ID, rating: 5 };

    mockQuery
      .mockResolvedValueOnce({ rows: [MOCK_CLIENT] }) // authenticate
      .mockResolvedValueOnce({ rows: [] })            // BEGIN
      .mockResolvedValueOnce({ rows: [job] })         // SELECT job
      .mockResolvedValueOnce({ rows: [review] })      // INSERT review
      .mockResolvedValueOnce({ rows: [] })            // UPDATE helper_profiles avg_rating
      .mockResolvedValueOnce({ rows: [] })            // COMMIT
      .mockResolvedValueOnce({ rows: [] });           // sendNotification (if any extra query)

    const res = await auth(
      request(buildApp()).post('/api/reviews/jobs/10').send({ rating: 5, title: 'Excellent', body: 'Great job!' })
    );
    expect(res.status).toBe(201);
    expect(res.body.review).toHaveProperty('id', 55);
  });
});

// ── GET /api/reviews/users/:userId ────────────────────────────────────────────
describe('GET /api/reviews/users/:userId', () => {
  test('returns public reviews for a user', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { id: 55, rating: 5, comment: 'Great!', reviewer_id: CLIENT_ID },
      ] })
      .mockResolvedValueOnce({ rows: [
        { total_reviews: '1', average_rating: '5.00', five_star: '1', four_star: '0', three_star: '0', two_star: '0', one_star: '0' },
      ] });
    const res = await request(buildApp()).get('/api/reviews/users/2');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reviews');
    expect(res.body.reviews).toHaveLength(1);
  });
});

// ── GET /api/reviews/jobs/:jobId/eligibility ──────────────────────────────────
describe('GET /api/reviews/jobs/:jobId/eligibility', () => {
  test('returns 401 without token', async () => {
    const res = await request(buildApp()).get('/api/reviews/jobs/10/eligibility');
    expect(res.status).toBe(401);
  });

  test('returns eligibility for authenticated user', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [MOCK_CLIENT] })  // authenticate
      .mockResolvedValueOnce({ rows: [{ id: 10, client_id: CLIENT_ID, status: 'closed' }] }) // job
      .mockResolvedValueOnce({ rows: [] });             // existing review check
    const res = await auth(request(buildApp()).get('/api/reviews/jobs/10/eligibility'));
    expect(res.status).toBe(200);
  });
});
