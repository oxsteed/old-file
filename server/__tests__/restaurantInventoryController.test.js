'use strict';

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
const permissions = require('../services/permissionsService');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const RESTAURANT_ID = 9;

function access(overrides = {}) {
  return {
    id: RESTAURANT_ID,
    business_id: 42,
    effective_role: 'owner',
    ...overrides,
  };
}

function app() {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.user = { id: USER_ID, email: 'owner@example.com' };
    next();
  });
  server.get('/api/restaurants/:restaurantId/inventory/items', inventory.listItems);
  server.post('/api/restaurants/:restaurantId/inventory/items', inventory.createItem);
  server.post('/api/restaurants/:restaurantId/inventory/items/:itemId/adjust', inventory.adjustItem);
  server.use(errorHandler);
  return server;
}

beforeEach(() => {
  resetMocks();
  availability.syncMappedMenuAvailability.mockClear();
  permissions.getEffectivePermissions.mockResolvedValue({
    permissions: new Set(['inventory.view', 'inventory.update']),
    raw: {},
  });
});

describe('restaurant Inventory item backend', () => {
  test('lists items with tenant-scoped area, supplier, mapping, and menu joins', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({
        rows: [{
          id: 5,
          restaurant_id: RESTAURANT_ID,
          name: 'Chicken',
          area_name: 'Walk-in',
          supplier_display_name: 'Atlantic Foods',
          affected_menu_items: [{ id: 77, name: 'Jerk Chicken' }],
        }],
      });

    const response = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/inventory/items`);

    expect(response.status).toBe(200);
    expect(response.body.items[0].name).toBe('Chicken');
    const listSql = mockQuery.mock.calls[1][0];
    expect(listSql).toMatch(/a\.restaurant_id = i\.restaurant_id/);
    expect(listSql).toMatch(/s\.restaurant_id = i\.restaurant_id/);
    expect(listSql).toMatch(/m\.restaurant_id = i\.restaurant_id/);
    expect(listSql).toMatch(/fmi\.restaurant_id = i\.restaurant_id/);
  });

  test('rejects item creation when supplier or storage area belongs to another restaurant', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({ rows: [{ supplier_ok: false, area_ok: true }] });

    const response = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/items`)
      .send({
        name: 'Chicken',
        supplierId: 99,
        storageAreaId: 7,
      });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('inventory_reference_not_found');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO restaurant_inventory_items/.test(sql))).toBe(false);
  });

  test('replays an already-recorded adjustment without applying stock twice', async () => {
    const operationId = '9a1ef8e4-832f-4c34-8aa1-b5f7f65b7e09';
    mockQuery
      .mockResolvedValueOnce({ rows: [access({ effective_role: 'employee' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 5,
          restaurant_id: RESTAURANT_ID,
          item_id: 5,
          name: 'Chicken',
          quantity: '3',
          low_stock_threshold: '2',
        }],
      });

    const response = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/items/5/adjust`)
      .send({
        type: 'count',
        quantity: 3,
        clientOperationId: operationId,
      });

    expect(response.status).toBe(200);
    expect(response.body.replayed).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE restaurant_inventory_items/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO restaurant_inventory_adjustments/.test(sql))).toBe(false);
    expect(availability.syncMappedMenuAvailability).not.toHaveBeenCalled();
  });

  test('requires inventory update permission before recording stock changes', async () => {
    permissions.getEffectivePermissions.mockResolvedValueOnce({
      permissions: new Set(['inventory.view']),
      raw: {},
    });
    mockQuery.mockResolvedValueOnce({ rows: [access({ effective_role: 'employee', membership_id: 88 })] });

    const response = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/items/5/adjust`)
      .send({ type: 'count', quantity: 3 });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('forbidden');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE restaurant_inventory_items/.test(sql))).toBe(false);
  });

  test('writes an audit event when stock is adjusted', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({
        rows: [{
          id: 5,
          restaurant_id: RESTAURANT_ID,
          name: 'Chicken',
          quantity: '8',
          low_stock_threshold: '2',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 5,
          restaurant_id: RESTAURANT_ID,
          name: 'Chicken',
          quantity: '4',
          low_stock_threshold: '2',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 99, event_type: 'stock_adjusted' }] });

    const response = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/items/5/adjust`)
      .send({ type: 'count', quantity: 4, reason: 'closing_count' });

    expect(response.status).toBe(200);
    const auditCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO restaurant_inventory_audit_events/.test(sql));
    expect(auditCall).toBeTruthy();
    expect(auditCall[1][2]).toBe('stock_adjusted');
    expect(auditCall[1][3]).toBe('item');
    expect(auditCall[1][4]).toBe(5);
  });

  test('BACKEND-2K: listItems GROUP BY covers reserved.quantity referenced in the SELECT', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/inventory/items`);

    expect(response.status).toBe(200);
    const listSql = mockQuery.mock.calls[1][0];
    const groupBy = listSql.match(/GROUP BY([\s\S]*?)ORDER BY/)[1];
    expect(groupBy).toMatch(/reserved\.quantity/);
  });
});
