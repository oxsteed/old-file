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
  test('business discovery filters before pagination and reports the filtered total', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, first_name: 'Local', last_name: 'Helper', freshness_ts: new Date().toISOString() }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 2, title: 'Local business', subtitle: 'Local services', service_city: 'Springfield', service_state: 'OH' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const result = await request(buildApp()).get('/api/discover').query({ q: 'Local', type: 'business', city: 'Springfield', state: 'OH', limit: 5 });
    expect(result.status).toBe(200);
    expect(result.body.results).toHaveLength(1);
    expect(result.body.results[0].type).toBe('business');
    expect(result.body.total).toBe(1);
    expect(result.body.hasMore).toBe(false);
  });

  test('popular business discovery never includes helper cards', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, first_name: 'Local', last_name: 'Helper' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 2, title: 'Local business' }] });
    const result = await request(buildApp()).get('/api/discover/popular?type=business&city=Springfield&state=OH');
    expect(result.status).toBe(200);
    expect(result.body.results.map(item => item.type)).toEqual(['business']);
    const businessCall = mockQuery.mock.calls.find(([sql]) => sql.includes('SELECT b.id, b.business_name AS title'));
    expect(businessCall[0]).toContain("LOWER(TRIM(COALESCE(NULLIF(b.service_city, ''), NULLIF(b.address_city, ''), hp.service_city))) = $1");
    expect(businessCall[1]).toEqual(['springfield', 'oh']);
  });
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
      url: '/helpers/12',
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
