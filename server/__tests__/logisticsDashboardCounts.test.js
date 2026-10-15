'use strict';

// Phase 2 (logistics refactor): dashboard count endpoints.
//  - GET /logistics/dashboard/counts?scope=... returns authoritative
//    workspace metrics instead of `limit: N` list derivations.
//  - GET /logistics/dashboard/warehouse-counts serves the admin/ops
//    warehouse dashboard.
// The database is mocked; assertions verify both the response shape and
// that non-admin callers are scoped to their own records.

jest.mock('../db', () => ({ query: jest.fn() }));

const express = require('express');
const request = require('supertest');
const db = require('../db');
const countsCtrl = require('../controllers/logisticsDashboardCountsController');

function buildApp({ userId = 'u1', isAdmin = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId };
    req.isAdmin = isAdmin;
    next();
  });
  app.get('/dashboard/counts', countsCtrl.getDashboardCounts);
  app.get('/dashboard/warehouse-counts', countsCtrl.getWarehouseDashboardCounts);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

// Route query text to canned aggregate rows. node-pg returns COUNT(*) as
// text, so the fixtures use strings like the real driver.
function mockCounts() {
  db.query.mockImplementation(async (sql) => {
    if (sql.includes('FROM shipment_records')) return { rows: [{ count: '9' }] };
    if (sql.includes('FROM sourcing_requests')) return { rows: [{ total: '5', active: '3' }] };
    if (sql.includes('FROM purchase_orders')) return { rows: [{ total: '4', warehoused: '1' }] };
    if (sql.includes('FROM inventory_allocations')) {
      return { rows: [{ total: '6', released: '2', pending: '4' }] };
    }
    if (sql.includes('FROM delivery_orders')) {
      if (sql.includes('failed')) return { rows: [{ total: '7', scheduled: '1', in_transit: '2', failed: '1' }] };
      return { rows: [{ count: '7' }] };
    }
    if (sql.includes('FROM logistics_claims')) return { rows: [{ count: '2' }] };
    if (sql.includes('FROM logistics_refund_cases')) return { rows: [{ count: '1' }] };
    if (sql.includes('FROM pooled_orders')) {
      return { rows: [{ total: '3', active: '2', needing_momentum: '1', committed_units: '100' }] };
    }
    if (sql.includes('FROM pooled_order_participants')) return { rows: [{ count: '2' }] };
    if (sql.includes('FROM warehouses')) return { rows: [{ count: '3' }] };
    if (sql.includes('FROM inventory_receipts')) return { rows: [{ total: '8', open: '5' }] };
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  });
}

function callsFor(table) {
  return db.query.mock.calls.filter(([sql]) => sql.includes(`FROM ${table}`));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCounts();
});

describe('GET /dashboard/counts', () => {
  test('rejects a missing scope with 400', async () => {
    const res = await request(buildApp()).get('/dashboard/counts');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  test('rejects an unknown scope with 400', async () => {
    const res = await request(buildApp()).get('/dashboard/counts?scope=bogus');
    expect(res.status).toBe(400);
  });

  test('buyer scope returns authoritative counts scoped to the caller', async () => {
    const res = await request(buildApp({ userId: 'buyer-1' })).get('/dashboard/counts?scope=buyer');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      scope: 'buyer',
      counts: {
        totalRequests: 5,
        activeRequests: 3,
        totalOrders: 4,
        warehousedOrders: 1,
        totalAllocations: 6,
        releasedAllocations: 2,
        pendingAllocations: 4,
        totalDeliveries: 7,
        scheduledDeliveries: 1,
        inTransitDeliveries: 2,
        failedDeliveries: 1,
        totalShipments: 9,
        atRiskShipments: 9,
        activeClaims: 2,
        refundCases: 1,
      },
    });
    // Ownership scoping: the caller's id is bound into each owned-entity query.
    for (const table of ['sourcing_requests', 'purchase_orders', 'inventory_allocations', 'delivery_orders']) {
      const calls = callsFor(table);
      expect(calls.length).toBeGreaterThan(0);
      for (const [, params] of calls) {
        expect(params).toContain('buyer-1');
      }
    }
    // Shipment visibility embeds the caller id in the OR-exists clause.
    const shipCalls = callsFor('shipment_records');
    expect(shipCalls.length).toBeGreaterThan(0);
    for (const [, params] of shipCalls) {
      expect(params).toEqual(['buyer-1']);
    }
  });

  test('distributor scope omits buyer-only claim counts', async () => {
    const res = await request(buildApp()).get('/dashboard/counts?scope=distributor');
    expect(res.status).toBe(200);
    expect(res.body.counts.pendingAllocations).toBe(4);
    expect(res.body.counts.failedDeliveries).toBe(1);
    expect(res.body.counts.activeClaims).toBeUndefined();
    expect(res.body.counts.refundCases).toBeUndefined();
    expect(callsFor('logistics_claims')).toHaveLength(0);
  });

  test('organizer scope returns campaign, commitment and handoff counts', async () => {
    const res = await request(buildApp({ userId: 'org-1' })).get('/dashboard/counts?scope=organizer');
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({
      totalCampaigns: 3,
      activeCampaigns: 2,
      needingMomentum: 1,
      committedUnits: 100,
      openCommitments: 2,
      totalShipments: 9,
    });
    expect(res.body.counts.handoffDeliveries).toBe(7);
    const campaignCalls = callsFor('pooled_orders');
    expect(campaignCalls.length).toBeGreaterThan(0);
    for (const [, params] of campaignCalls) {
      expect(params).toContain('org-1');
    }
  });

  test('compliance scope returns only the review queue count', async () => {
    const res = await request(buildApp()).get('/dashboard/counts?scope=compliance');
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ reviewQueue: 9 });
  });

  test('admin callers see the global picture unless they pass a user filter', async () => {
    const app = buildApp({ userId: 'admin-1', isAdmin: true });
    const res = await request(app).get('/dashboard/counts?scope=buyer');
    expect(res.status).toBe(200);
    // No ownership predicate: admins mirror the unfiltered list endpoints.
    for (const table of ['sourcing_requests', 'purchase_orders', 'inventory_allocations', 'delivery_orders']) {
      for (const [, params] of callsFor(table)) {
        expect(params).toHaveLength(0);
      }
    }
    // Shipment visibility is wide open for admins (mirrors listShipments).
    for (const [sql, params] of callsFor('shipment_records')) {
      expect(sql).toContain('1=1');
      expect(params).toHaveLength(0);
    }
  });

  test('admin user_id filter scopes the request counts', async () => {
    const app = buildApp({ userId: 'admin-1', isAdmin: true });
    const res = await request(app).get('/dashboard/counts?scope=buyer&user_id=buyer-9');
    expect(res.status).toBe(200);
    const reqCalls = callsFor('sourcing_requests');
    expect(reqCalls.length).toBeGreaterThan(0);
    for (const [, params] of reqCalls) {
      expect(params).toEqual(['buyer-9']);
    }
  });
});

describe('GET /dashboard/warehouse-counts', () => {
  test('returns global warehouse aggregates', async () => {
    const res = await request(buildApp({ isAdmin: true })).get('/dashboard/warehouse-counts');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      counts: {
        totalWarehouses: 3,
        totalReceipts: 8,
        openReceipts: 5,
        totalAllocations: 6,
        pendingAllocations: 4,
        totalDeliveries: 7,
      },
    });
  });
});
