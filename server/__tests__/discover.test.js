'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/rateLimiter', () => ({
  discoverLimiter: (_req, _res, next) => next(),
  discoverAuthLimiter: (_req, _res, next) => next(),
}));

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-1' };
    next();
  },
}));

const discoverRoutes = require('../routes/discover');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/discover', discoverRoutes);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

beforeEach(() => resetMocks());

describe('discover search routes', () => {
  test('GET /api/discover returns typed results and pagination metadata', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 12,
          first_name: 'Sam',
          last_name: 'Rivera',
          display_name_preference: 'first_name',
          primary_business_name: null,
          subtitle: 'Licensed plumber for urgent repairs',
          image_url: null,
          service_city: 'Austin',
          service_state: 'TX',
          lat: null,
          lng: null,
          avg_rating: '4.8',
          total_reviews: '17',
          is_identity_verified: true,
          is_background_checked: true,
          is_available_now: true,
          freshness_ts: new Date().toISOString(),
          matched_name: true,
          matched_skill: true,
          matched_profile: false,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .get('/api/discover')
      .query({ q: 'plumber', limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.query).toBe('plumber');
    expect(res.body.total).toBe(1);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      type: 'helper',
      id: '12',
      title: 'Sam',
      url: '/helpers/public/12',
      meta: 'Austin, TX',
      primaryAction: 'view',
      verified: true,
      backgroundChecked: true,
      availableToday: true,
    });
    expect(res.body.results[0].rating).toBe(4.8);
    expect(res.body.results[0].reviewCount).toBe(17);
    expect(res.body.results[0].matchReasons).toContain('skill');
  });
});
