'use strict';

// 2026-11-02 admin-ops audit item 1: affiliate payout processing moves
// money, so the process route and its step-up issue endpoint require
// manage_financials (with the super-admin bypass), not the read-only
// view_financials grant. A view_financials-only admin must be refused
// before any step-up challenge is issued or verified.

const fs = require('fs');
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { requireSuperAdminOrPermission, requirePermission } = require('../middleware/adminAuth');

const ROUTE_SRC = fs.readFileSync(require.resolve('../routes/affiliatePayouts.js'), 'utf8');

function routeBlock(src, path) {
  const at = src.indexOf(`'${path}'`);
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf(');', at));
}

function buildApp(middleware) {
  const app = express();
  app.get('/guarded', (req, _res, next) => {
    req.user = { id: 'admin-1' };
    req.isSuper = false;
    next();
  }, middleware, (_req, res) => res.json({ ok: true }));
  app.get('/super', (req, _res, next) => {
    req.user = { id: 'super-1' };
    req.isSuper = true;
    next();
  }, middleware, (_req, res) => res.json({ ok: true }));
  return app;
}

beforeEach(() => {
  resetMocks();
});

describe('affiliate payout grant tightening', () => {
  test('process route requires manage_financials, not view_financials', () => {
    const block = routeBlock(ROUTE_SRC, '/:payoutId/process');
    expect(block).toContain("requireSuperAdminOrPermission('manage_financials')");
    expect(block).not.toContain("requirePermission('view_financials')");
  });

  test('step-up issue route requires manage_financials, not view_financials', () => {
    const block = routeBlock(ROUTE_SRC, '/:payoutId/stepup-challenges');
    expect(block).toContain("requireSuperAdminOrPermission('manage_financials')");
    expect(block).not.toContain("requirePermission('view_financials')");
  });

  test('read-only list route keeps view_financials', () => {
    const block = routeBlock(ROUTE_SRC, '/payouts');
    expect(block).toContain("requirePermission('view_financials')");
    expect(block).not.toContain('manage_financials');
  });

  test('a view_financials-only admin is refused by the manage gate', async () => {
    // The grant lookup returns nothing for manage_financials: this admin
    // holds no manage grant (a view grant would only answer a
    // view_financials lookup, which this gate never performs).
    mockQuery.mockImplementation(async (_sql, params) => {
      expect(params[1]).toBe('manage_financials');
      return { rows: [] };
    });
    const res = await request(buildApp(requireSuperAdminOrPermission('manage_financials'))).get('/guarded');
    expect(res.status).toBe(403);
    // And the same admin passes the old read gate, proving the refusal
    // comes from the tightening, not from a broken admin record.
    mockQuery.mockResolvedValue({ rows: [{ id: 1, region_id: null, grant_source: 'direct' }] });
    const readRes = await request(buildApp(requirePermission('view_financials'))).get('/guarded');
    expect(readRes.status).toBe(200);
  });

  test('a manage_financials admin passes, and a super-admin bypasses', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, region_id: null, grant_source: 'direct' }] });
    const res = await request(buildApp(requireSuperAdminOrPermission('manage_financials'))).get('/guarded');
    expect(res.status).toBe(200);
    const superRes = await request(buildApp(requireSuperAdminOrPermission('manage_financials'))).get('/super');
    expect(superRes.status).toBe(200);
  });
});
