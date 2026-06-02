'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'helper-1', role: 'helper' };
    next();
  },
}));

jest.mock('../middleware/requireRole', () => () => (_req, _res, next) => next());
jest.mock('../middleware/rateLimiter', () => ({ generalLimiter: (_req, _res, next) => next() }));
jest.mock('../services/helperContext', () => ({ invalidateHelperContext: jest.fn() }));

const helperProfileRoutes = require('../routes/helperProfile');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/helper-profile', helperProfileRoutes);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, fields: err.fields }));
  return app;
}

beforeEach(() => resetMocks());

describe('helper profile booking buffer setting', () => {
  test('GET /me returns persisted booking_buffer_minutes', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          profile_headline: 'Local helper',
          booking_buffer_minutes: 30,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/helper-profile/me');

    expect(res.status).toBe(200);
    expect(res.body.booking_buffer_minutes).toBe(30);
  });

  test('PUT /core persists booking_buffer_minutes', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .put('/api/helper-profile/core')
      .send({ booking_buffer_minutes: 45 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const updateCall = mockQuery.mock.calls[0];
    expect(updateCall[0]).toMatch(/booking_buffer_minutes/);
    expect(updateCall[1][17]).toBe(45);
  });

  test('PUT /core rejects invalid booking buffer values', async () => {
    const res = await request(buildApp())
      .put('/api/helper-profile/core')
      .send({ booking_buffer_minutes: 999 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/booking_buffer_minutes/);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
