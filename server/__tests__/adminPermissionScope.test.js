'use strict';

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');
const { requirePermission } = require('../middleware/adminAuth');

function buildApp() {
  const app = express();
  app.get('/global', (req, _res, next) => {
    req.user = { id: 'admin-1' };
    req.isSuper = false;
    next();
  }, requirePermission('view_financials'), (_req, res) => res.json({ ok: true }));
  return app;
}

beforeEach(() => {
  resetMocks();
});

describe('delegated admin permission scope', () => {
  test('does not treat a regional grant as platform-wide access', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 10, region_id: 4 }] });

    const response = await request(buildApp()).get('/global');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('global_permission_required');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('region_id'), ['admin-1', 'view_financials']);
  });

  test('allows an unscoped grant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 11, region_id: null }] });

    const response = await request(buildApp()).get('/global');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  test('does not let a regional row hide a valid unscoped grant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 12, region_id: 4 },
      { id: 13, region_id: null },
    ] });

    const response = await request(buildApp()).get('/global');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  test('keeps super-admin bypass independent of grant storage', async () => {
    const app = express();
    app.get('/global', (req, _res, next) => {
      req.user = { id: 'super-1' };
      req.isSuper = true;
      next();
    }, requirePermission('view_financials'), (_req, res) => res.json({ ok: true }));

    const response = await request(app).get('/global');

    expect(response.status).toBe(200);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
