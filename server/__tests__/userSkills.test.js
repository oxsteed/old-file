/**
 * __tests__/userSkills.test.js
 *
 * Tests for user-skills endpoints:
 *   GET    /api/user-skills/lookup
 *   GET    /api/user-skills/me
 *   POST   /api/user-skills
 *   PUT    /api/user-skills/:id
 *   DELETE /api/user-skills/:id
 */

'use strict';

const { mockQuery, resetMocks } = require('./setup');

const express = require('express');
const request = require('supertest');
const jwt     = require('jsonwebtoken');
const userSkillsRoutes = require('../routes/userSkills');

const TEST_USER_ID = 99;
const TEST_TOKEN = jwt.sign(
  { id: TEST_USER_ID, email: 'test@example.com', role: 'customer' },
  process.env.JWT_SECRET
);

// The authenticate middleware does a DB lookup for the user.
// This row is returned as the first mock call in any authenticated request.
const MOCK_AUTH_USER = {
  id: TEST_USER_ID, first_name: 'Test', last_name: 'User',
  email: 'test@example.com', phone: null, role: 'customer',
  email_verified: true, is_verified: false,
  onboarding_status: 'active', onboarding_completed: true,
  contact_completed: true, profile_completed: true,
  tier_selected: true, w9_completed: false, terms_accepted: true,
  membership_tier: 'free', id_verified: false, background_check_passed: false,
  city: 'Austin', state: 'TX', zip_code: '78701',
  display_name_preference: 'first_name', business_name: null,
};

/** Mock the authenticate DB query, then any further query results */
function mockAuth(...extraResults) {
  mockQuery.mockResolvedValueOnce({ rows: [MOCK_AUTH_USER] });
  extraResults.forEach(r => mockQuery.mockResolvedValueOnce(r));
}

// Build a minimal app; real authenticate middleware reads the JWT we send
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/user-skills', userSkillsRoutes);
  return app;
}

// Helper to make authenticated requests
function auth(r) { return r.set('Authorization', `Bearer ${TEST_TOKEN}`); }

beforeEach(() => resetMocks());

// ── GET /lookup ───────────────────────────────────────────────────────────────
describe('GET /api/user-skills/lookup', () => {
  test('returns matching skills', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, name: 'Plumbing', category: 'Trades' }],
    });

    const res = await request(buildApp())
      .get('/api/user-skills/lookup?q=plumb&limit=5');

    expect(res.status).toBe(200);
    expect(res.body.skills).toHaveLength(1);
    expect(res.body.skills[0].name).toBe('Plumbing');
    expect(res.body.limit).toBe(5);
    expect(res.body.offset).toBe(0);
  });

  test('caps limit at 100', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .get('/api/user-skills/lookup?limit=999');
    expect(res.status).toBe(200);
    // The query should have been called with limit=100
    const callArgs = mockQuery.mock.calls[0][1];
    expect(callArgs[2]).toBe(100);
  });
});

// ── GET /me ───────────────────────────────────────────────────────────────────
describe('GET /api/user-skills/me', () => {
  test('returns authenticated user\'s skills', async () => {
    mockAuth({ rows: [{ id: 10, skill_name: 'Tiling', user_id: TEST_USER_ID }] });

    const res = await auth(request(buildApp()).get('/api/user-skills/me'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.skills)).toBe(true);
    expect(res.body.skills[0].skill_name).toBe('Tiling');
  });

  test('returns 401 when unauthenticated', async () => {
    const res = await request(buildApp()).get('/api/user-skills/me');
    expect(res.status).toBe(401);
  });
});

// ── POST / ────────────────────────────────────────────────────────────────────
describe('POST /api/user-skills', () => {
  test('returns 400 when skill_name is empty', async () => {
    mockAuth();
    const res = await auth(
      request(buildApp()).post('/api/user-skills').send({ skill_name: '' })
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/skill_name/i);
  });

  test('creates a skill and returns 201', async () => {
    mockAuth({ rows: [{ id: 11, skill_name: 'Roofing', category: 'Trades', user_id: TEST_USER_ID }] });

    const res = await auth(
      request(buildApp())
        .post('/api/user-skills')
        .send({ skill_name: 'Roofing', category: 'Trades', hourly_rate: '75' })
    );
    expect(res.status).toBe(201);
    expect(res.body.skill.skill_name).toBe('Roofing');
  });
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
describe('PUT /api/user-skills/:id', () => {
  test('returns 404 when skill belongs to another user', async () => {
    mockAuth({ rows: [] }); // ownership check fails

    const res = await auth(
      request(buildApp()).put('/api/user-skills/999').send({ skill_name: 'X' })
    );
    expect(res.status).toBe(404);
  });

  test('updates and returns the skill', async () => {
    mockAuth({ rows: [{ id: 11, skill_name: 'Updated Skill', user_id: TEST_USER_ID }] });

    const res = await auth(
      request(buildApp()).put('/api/user-skills/11').send({ skill_name: 'Updated Skill' })
    );
    expect(res.status).toBe(200);
    expect(res.body.skill.skill_name).toBe('Updated Skill');
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
describe('DELETE /api/user-skills/:id', () => {
  test('returns 404 when skill not found', async () => {
    mockAuth({ rows: [] });
    const res = await auth(request(buildApp()).delete('/api/user-skills/999'));
    expect(res.status).toBe(404);
  });

  test('deletes and returns { deleted: true }', async () => {
    mockAuth({ rows: [{ id: 11 }] });
    const res = await auth(request(buildApp()).delete('/api/user-skills/11'));
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});
