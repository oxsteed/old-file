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

// Domain 6 enforce contract (ACCESS_HELPER_ENFORCEMENT=enforce): the
// helper-profile routes run requireHelperCapability, which calls
// accessService.can() -> loadFacts (users, access_grants, businesses)
// before the handler. The fixture helper holds an active
// helper.offer_services grant with the provenance the legacy backfill
// writes (services/access/legacyMapping.js), so the gate passes and these
// tests keep proving booking-buffer behaviour, not access.
const HELPER_USER = { id: 'helper-1', role: 'helper', is_active: true };
const ACCESS_GRANT = {
  id: 1, capability: 'helper.offer_services', subject_type: 'self', subject_id: null,
  status: 'active', expires_at: null, provenance: 'legacy_backfill', version: 1,
};

// Queue the three loadFacts answers (users, access_grants, businesses) for
// one gate evaluation, in the order accessService.loadFacts issues them.
function mockGrantFacts() {
  mockQuery.mockResolvedValueOnce({ rows: [HELPER_USER] });
  mockQuery.mockResolvedValueOnce({ rows: [ACCESS_GRANT] });
  mockQuery.mockResolvedValueOnce({ rows: [] });
}

// Route pool queries to the gate answers, falling back to `fallback` for
// the handler's own queries.
function mockGateThen(fallback) {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM users WHERE id/.test(sql)) return { rows: [HELPER_USER] };
    if (/FROM access_grants/.test(sql)) return { rows: [ACCESS_GRANT] };
    if (/FROM businesses b/.test(sql)) return { rows: [] };
    return fallback;
  });
}

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
    mockGrantFacts();
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
    mockGateThen({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .put('/api/helper-profile/core')
      .send({ booking_buffer_minutes: 45 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The gate's three SELECTs run first; the update is no longer call 0.
    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE/i.test(sql));
    expect(updateCall[0]).toMatch(/booking_buffer_minutes/);
    // availability_json was retired from the write; the buffer is now $17.
    expect(updateCall[1][16]).toBe(45);
  });

  test('PUT /core rejects invalid booking buffer values', async () => {
    mockGateThen({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .put('/api/helper-profile/core')
      .send({ booking_buffer_minutes: 999 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/booking_buffer_minutes/);
    // The gate's three read-only SELECTs now run before the handler by
    // design (the grant is re-read from the DB on every request), so the
    // old "no query at all" assertion cannot hold. What this test still
    // proves is unchanged: an invalid value never reaches a write.
    expect(mockQuery.mock.calls.some(([sql]) => /^\s*(UPDATE|INSERT|DELETE)/i.test(sql))).toBe(false);
  });
});
