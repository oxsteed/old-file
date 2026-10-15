'use strict';

/**
 * Buyer-scoped warehouse reads.
 *
 * Individual buyers get read-only visibility into their OWN allocations and
 * deliveries. The route gate is the `warehouse.view` capability (any signed-in
 * user); ownership is enforced again in the service SQL so a buyer can never
 * read another buyer's records (404, no existence leakage). Writes stay
 * behind `warehouse.manage`.
 *
 * Covers:
 *  - buyer list endpoints are scoped to the caller's own user id
 *  - buyer A cannot read buyer B's allocation or delivery (404)
 *  - buyer cannot reach write routes (403 preserved)
 *  - staff with warehouse.manage still sees everything (unscoped)
 *  - unauthenticated callers get 401
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/logisticsAuditService', () => ({ logLogisticsAction: jest.fn() }));

const express = require('express');
const request = require('supertest');

const pool = require('../db');
const whCtrl = require('../controllers/logisticsWarehouseController');
const { requireLogisticsCapability } = require('../middleware/requireLogisticsAccess');

const BUYER_A = { id: 'buyer-a', role: 'user', logistics_role: 'individual_buyer' };
const BUYER_B = { id: 'buyer-b', role: 'user', logistics_role: 'business_buyer' };
const STAFF = { id: 'staff-1', role: 'user', logistics_role: 'warehouse_operator' };

function buildApp(user) {
  const app = express();
  app.use(express.json());
  // Stub auth: mirrors requireAuth's req.user / req.isAdmin contract.
  app.use((req, res, next) => {
    if (!user) return res.status(401).json({ error: 'unauthenticated' });
    req.user = user;
    req.isAdmin = ['admin', 'super_admin'].includes(user.role);
    return next();
  });
  const r = express.Router();
  const requireWarehouseRead = requireLogisticsCapability('warehouse.view');
  const requireWarehouseOps = requireLogisticsCapability('warehouse.manage');
  r.get('/allocations', requireWarehouseRead, whCtrl.listAllocations);
  r.get('/allocations/:id', requireWarehouseRead, whCtrl.getAllocation);
  r.post('/allocations', requireWarehouseOps, whCtrl.createAllocation);
  r.get('/deliveries', requireWarehouseRead, whCtrl.listDeliveryOrders);
  r.get('/deliveries/:id', requireWarehouseRead, whCtrl.getDeliveryOrder);
  r.patch('/deliveries/:id/status', requireWarehouseOps, whCtrl.updateDeliveryStatus);
  app.use(r);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: err.message, code: err.code });
  });
  return app;
}

const allocationRow = (overrides = {}) => ({
  id: 'alloc-1',
  buyer_user_id: 'buyer-a',
  status: 'allocated',
  ...overrides,
});
const deliveryRow = (overrides = {}) => ({
  id: 'del-1',
  recipient_user_id: 'buyer-a',
  status: 'pending',
  ...overrides,
});

beforeEach(() => { jest.clearAllMocks(); });

function mockListCalls({ allocation = allocationRow(), delivery = deliveryRow() } = {}) {
  pool.query.mockImplementation(async (text) => {
    if (text.includes('COUNT(*)')) return { rows: [{ count: '1' }] };
    if (text.includes('FROM inventory_allocations')) return { rows: [allocation] };
    if (text.includes('FROM delivery_orders')) return { rows: [delivery] };
    return { rows: [] };
  });
}

describe('buyer allocation reads', () => {
  test('buyer list is scoped to their own buyer_user_id', async () => {
    mockListCalls();
    const res = await request(buildApp(BUYER_A)).get('/allocations');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // The list query must constrain to the caller's id (ownership in SQL).
    const listCall = pool.query.mock.calls.find(([text]) => text.includes('FROM inventory_allocations') && !text.includes('COUNT(*)'));
    expect(listCall).toBeDefined();
    expect(listCall[0]).toMatch(/ia\.buyer_user_id = \$\d+/);
    expect(listCall[1]).toContain('buyer-a');
  });

  test('buyer reads their own allocation', async () => {
    pool.query.mockResolvedValue({ rows: [allocationRow()] });
    const res = await request(buildApp(BUYER_A)).get('/allocations/alloc-1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('alloc-1');
    const [text, params] = pool.query.mock.calls[0];
    expect(text).toMatch(/ia\.buyer_user_id = \$\d+/);
    expect(params).toEqual(['alloc-1', 'buyer-a']);
  });

  test("buyer A cannot read buyer B's allocation (404, no leakage)", async () => {
    // The ownership predicate is in the SQL, so a foreign record matches
    // zero rows and the controller maps it to 404 (not 403).
    pool.query.mockImplementation(async (text, params) => {
      expect(text).toMatch(/ia\.buyer_user_id = \$\d+/);
      expect(params).toContain('buyer-a');
      return { rows: [] };
    });
    const res = await request(buildApp(BUYER_A)).get('/allocations/alloc-foreign');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  test('buyer cannot create allocations (403 preserved)', async () => {
    const res = await request(buildApp(BUYER_A))
      .post('/allocations')
      .send({ inventory_receipt_id: 'r1', allocated_qty: 10 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('logistics_capability_required');
  });
});

describe('buyer delivery reads', () => {
  test('buyer list is scoped to their own recipient_user_id', async () => {
    mockListCalls();
    const res = await request(buildApp(BUYER_A)).get('/deliveries');
    expect(res.status).toBe(200);
    const listCall = pool.query.mock.calls.find(([text]) => text.includes('FROM delivery_orders') && !text.includes('COUNT(*)'));
    expect(listCall).toBeDefined();
    expect(listCall[0]).toMatch(/d\.recipient_user_id = \$\d+/);
    expect(listCall[1]).toContain('buyer-a');
  });

  test('buyer reads their own delivery', async () => {
    pool.query.mockResolvedValue({ rows: [deliveryRow()] });
    const res = await request(buildApp(BUYER_A)).get('/deliveries/del-1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('del-1');
    const [text, params] = pool.query.mock.calls[0];
    expect(text).toMatch(/d\.recipient_user_id = \$\d+/);
    expect(params).toEqual(['del-1', 'buyer-a']);
  });

  test("buyer A cannot read buyer B's delivery (404, no leakage)", async () => {
    pool.query.mockImplementation(async (text, params) => {
      expect(text).toMatch(/d\.recipient_user_id = \$\d+/);
      expect(params).toContain('buyer-a');
      return { rows: [] };
    });
    const res = await request(buildApp(BUYER_A)).get('/deliveries/del-foreign');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  test('buyer cannot transition delivery status (403 preserved)', async () => {
    const res = await request(buildApp(BUYER_A))
      .patch('/deliveries/del-1/status')
      .send({ status: 'delivered' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('logistics_capability_required');
  });
});

describe('staff with warehouse.manage', () => {
  test('staff list is unscoped (sees everything)', async () => {
    mockListCalls();
    const res = await request(buildApp(STAFF)).get('/allocations');
    expect(res.status).toBe(200);
    const listCall = pool.query.mock.calls.find(([text]) => text.includes('FROM inventory_allocations') && !text.includes('COUNT(*)'));
    expect(listCall[0]).not.toMatch(/ia\.buyer_user_id = \$\d+/);
    expect(listCall[1]).not.toContain('staff-1');
  });

  test('staff can read any allocation by id', async () => {
    pool.query.mockResolvedValue({ rows: [allocationRow({ buyer_user_id: 'buyer-b' })] });
    const res = await request(buildApp(STAFF)).get('/allocations/alloc-9');
    expect(res.status).toBe(200);
    const [text, params] = pool.query.mock.calls[0];
    expect(text).not.toMatch(/ia\.buyer_user_id = \$\d+/);
    expect(params).toEqual(['alloc-9']);
  });

  test('staff deliveries list is unscoped', async () => {
    mockListCalls();
    const res = await request(buildApp(STAFF)).get('/deliveries');
    expect(res.status).toBe(200);
    const listCall = pool.query.mock.calls.find(([text]) => text.includes('FROM delivery_orders') && !text.includes('COUNT(*)'));
    expect(listCall[0]).not.toMatch(/d\.recipient_user_id = \$\d+/);
  });
});

describe('unauthenticated', () => {
  test('allocation reads require auth (401)', async () => {
    const res = await request(buildApp(null)).get('/allocations');
    expect(res.status).toBe(401);
  });

  test('delivery reads require auth (401)', async () => {
    const res = await request(buildApp(null)).get('/deliveries/del-1');
    expect(res.status).toBe(401);
  });
});

describe('capability model', () => {
  test('buyers get warehouse.view but not warehouse.manage', async () => {
    const res = await request(buildApp(BUYER_B)).get('/allocations');
    // 200 proves warehouse.view passed; manage is asserted via the 403s above.
    expect(res.status).toBe(200);
    const sm = require('../services/logisticsStateMachine');
    const caps = sm.resolveCapabilities({ user: BUYER_B, logisticsRole: 'business_buyer' });
    expect(sm.getCapability(caps, 'warehouse.view')).toBe(true);
    expect(sm.getCapability(caps, 'warehouse.manage')).toBe(false);
  });
});
