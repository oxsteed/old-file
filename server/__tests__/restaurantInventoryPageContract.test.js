'use strict';

// Finding 10 reproduction: the standalone Inventory page used to post payloads
// the server never accepted, and rendered fields the server never returned.
//   adjust:   page sent { type: 'restock'|'adjustment', quantity } — the
//             server only accepts count/receive/waste/usage/correction and
//             requires `delta` (not `quantity`) for every non-count type.
//   purchase: page sent snake_case { item_name, supplier, quantity } — the
//             server requires itemName + requestedQuantity (+ supplierName).
//   issue:    page sent { supplier, description } — the server requires
//             supplierName + issue.
//   lists:    page rendered current_stock / r.quantity / iss.supplier /
//             iss.description while the server returns quantity /
//             requested_quantity / supplier_name / issue, and the list
//             endpoints had no total for paging.
// These tests pin the server side of that contract: the old page payloads
// must 400 (and write nothing), the current field names must succeed, and
// the list endpoints must return a real total.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const availability = require('../services/restaurantInventoryAvailabilityService');

jest.mock('../services/restaurantInventoryAvailabilityService', () => ({
  syncMappedMenuAvailability: jest.fn().mockResolvedValue({ changes: [], applied: true }),
}));
jest.mock('../services/permissionsService', () => ({
  getEffectivePermissions: jest.fn().mockResolvedValue({ permissions: new Set(['inventory.view', 'inventory.update']), raw: {} }),
  hasAny: (permissionSet, requested) => requested.some((permission) => permissionSet.has(permission)),
}));

const inventory = require('../controllers/restaurantInventoryController');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const RESTAURANT_ID = 9;

function access() {
  return { id: RESTAURANT_ID, business_id: 42, effective_role: 'owner' };
}

function app() {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.user = { id: USER_ID, email: 'owner@example.com' };
    next();
  });
  server.get('/api/restaurants/:restaurantId/inventory/purchase-requests', inventory.listPurchaseRequests);
  server.post('/api/restaurants/:restaurantId/inventory/purchase-requests', inventory.createPurchaseRequest);
  server.get('/api/restaurants/:restaurantId/inventory/supplier-issues', inventory.listSupplierIssues);
  server.post('/api/restaurants/:restaurantId/inventory/supplier-issues', inventory.createSupplierIssue);
  server.post('/api/restaurants/:restaurantId/inventory/items/:itemId/adjust', inventory.adjustItem);
  server.use(errorHandler);
  return server;
}

beforeEach(() => {
  resetMocks();
  availability.syncMappedMenuAvailability.mockClear();
});

function noInsert(tableSql) {
  return !mockQuery.mock.calls.some(([sql]) => new RegExp(tableSql).test(sql));
}

describe('standalone Inventory page contract (finding 10)', () => {
  test('old adjust payload (restock + quantity) is rejected and writes nothing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access()] });

    const response = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/items/5/adjust`)
      .send({ type: 'restock', quantity: 2, note: 'delivery' });

    expect(response.status).toBe(400);
    expect(noInsert('INSERT INTO restaurant_inventory_adjustments')).toBe(true);
  });

  test('old adjust payload (waste + quantity, no delta) is rejected and writes nothing', async () => {
    // The delta check runs after the item lookup, so the item row is
    // mocked first; the failure must still happen before any write.
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({ rows: [{ id: 5, restaurant_id: RESTAURANT_ID, name: 'Chicken', quantity: '8', location_id: null }] });

    const response = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/items/5/adjust`)
      .send({ type: 'waste', quantity: 2 });

    expect(response.status).toBe(400);
    expect(noInsert('INSERT INTO restaurant_inventory_adjustments')).toBe(true);
  });

  test('current adjust payload (waste + delta) succeeds', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({ rows: [{ id: 5, restaurant_id: RESTAURANT_ID, name: 'Chicken', quantity: '8', location_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 5, restaurant_id: RESTAURANT_ID, name: 'Chicken', quantity: '6', location_id: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 99, event_type: 'stock_adjusted' }] });

    const response = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/items/5/adjust`)
      .send({ type: 'waste', delta: 2, note: 'spoiled' });

    expect(response.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO restaurant_inventory_adjustments/.test(sql))).toBe(true);
  });

  test('old purchase-request payload (snake_case) is rejected and writes nothing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access()] });

    const response = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/purchase-requests`)
      .send({ item_name: 'Chicken', supplier: 'Atlantic Foods', quantity: 10, notes: 'urgent' });

    expect(response.status).toBe(400);
    expect(noInsert('INSERT INTO restaurant_inventory_purchase_requests')).toBe(true);
  });

  test('current purchase-request payload succeeds and returns server field names', async () => {
    // No clientOperationId is sent, so the advisory-lock / replay
    // queries are skipped: access, primary-location lookup, insert.
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 7, restaurant_id: RESTAURANT_ID, item_name: 'Chicken',
          requested_quantity: '10', unit: 'units', supplier_name: 'Atlantic Foods', status: 'pending',
        }],
      });

    const response = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/purchase-requests`)
      .send({ itemName: 'Chicken', requestedQuantity: 10, supplierName: 'Atlantic Foods' });

    expect(response.status).toBe(201);
    expect(response.body.request.item_name).toBe('Chicken');
    expect(response.body.request.requested_quantity).toBe('10');
  });

  test('old supplier-issue payload is rejected and writes nothing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access()] });

    const response = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/supplier-issues`)
      .send({ supplier: 'Atlantic Foods', description: 'Late delivery' });

    expect(response.status).toBe(400);
    expect(noInsert('INSERT INTO restaurant_inventory_supplier_issues')).toBe(true);
  });

  test('current supplier-issue payload succeeds and returns server field names', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 3, restaurant_id: RESTAURANT_ID, supplier_name: 'Atlantic Foods',
          issue: 'Late delivery', status: 'open',
        }],
      });

    const response = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/supplier-issues`)
      .send({ supplierName: 'Atlantic Foods', issue: 'Late delivery' });

    expect(response.status).toBe(201);
    expect(response.body.issue.supplier_name).toBe('Atlantic Foods');
    expect(response.body.issue.issue).toBe('Late delivery');
  });

  test('purchase-request list returns a total for paging', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({ rows: [{ id: 7, item_name: 'Chicken', requested_quantity: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total: 7 }] });

    const response = await request(app())
      .get(`/api/restaurants/${RESTAURANT_ID}/inventory/purchase-requests?limit=25&offset=0`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(7);
    expect(response.body.requests[0].requested_quantity).toBe('10');
  });

  test('supplier-issue list returns a total for paging', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({ rows: [{ id: 3, supplier_name: 'Atlantic Foods', issue: 'Late delivery' }] })
      .mockResolvedValueOnce({ rows: [{ total: 4 }] });

    const response = await request(app())
      .get(`/api/restaurants/${RESTAURANT_ID}/inventory/supplier-issues?limit=25&offset=0`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(4);
    expect(response.body.issues[0].supplier_name).toBe('Atlantic Foods');
  });
});
