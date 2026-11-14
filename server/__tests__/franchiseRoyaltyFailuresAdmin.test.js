'use strict';

/**
 * franchiseRoyaltyFailuresAdmin.test.js
 *
 * Route test for Domain 8 #13: the admin list endpoint for the
 * franchise royalty failure outbox.
 *
 * Mounts the real admin router with the super-admin gate stubbed to
 * pass through (the gate itself is covered by adminAuthSecurity
 * tests); the database is the shared mocked pool from ./setup, so
 * the count + list queries are canned per call.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/adminAuth', () => {
  const actual = jest.requireActual('../middleware/adminAuth');
  return {
    ...actual,
    requireAdmin: (req, res, next) => {
      req.user = { id: 'super-1', role: 'super_admin' };
      req.isSuper = true;
      next();
    },
    requireSuperAdmin: (req, res, next) => {
      req.user = { id: 'super-1', role: 'super_admin' };
      req.isSuper = true;
      next();
    },
    requirePermission: () => (req, res, next) => next(),
  };
});
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return { ...actual, authenticate: (req, res, next) => next() };
});

const adminRoutes = require('../routes/admin');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  return app;
}

const PARKED_ROW = {
  id: 12,
  source_type: 'job',
  source_id: 'job-parked',
  agreement_id: null,
  amount_cents: 10000,
  location_id: null,
  city: 'Denver',
  region: 'Colorado',
  description: 'test park',
  error: 'simulated fee store outage',
  attempts: 10,
  next_retry_at: '2026-11-13T00:00:00.000Z',
  resolved_at: null,
  parked_at: '2026-11-13T01:00:00.000Z',
  created_at: '2026-11-12T00:00:00.000Z',
  updated_at: '2026-11-13T01:00:00.000Z',
};

beforeEach(() => {
  resetMocks();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('Domain 8 #13: GET /api/admin/super/franchise-royalty-failures', () => {
  test('lists parked failures with the total', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [PARKED_ROW] });
    const res = await request(buildApp())
      .get('/api/admin/super/franchise-royalty-failures?status=parked');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.status).toBe('parked');
    expect(res.body.failures).toHaveLength(1);
    expect(res.body.failures[0]).toMatchObject({
      source_type: 'job',
      source_id: 'job-parked',
      attempts: 10,
      parked_at: '2026-11-13T01:00:00.000Z',
    });
    // The list query filters on parked rows only.
    const listCall = mockQuery.mock.calls[1];
    expect(String(listCall[0])).toContain('parked_at IS NOT NULL');
  });

  test('defaults to open failures', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/admin/super/franchise-royalty-failures');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
    expect(res.body.failures).toEqual([]);
    expect(String(mockQuery.mock.calls[1][0])).toContain('resolved_at IS NULL AND parked_at IS NULL');
  });

  test('rejects an unknown status', async () => {
    const res = await request(buildApp())
      .get('/api/admin/super/franchise-royalty-failures?status=bogus');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_status');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
