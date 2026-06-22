'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/restaurantInventoryAvailabilityService', () => ({
  syncMappedMenuAvailability: jest.fn().mockResolvedValue({ changes: [], applied: true }),
}));

const operations = require('../controllers/restaurantInventoryOperationsController');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const RESTAURANT_ID = 9;

function access(overrides = {}) {
  return {
    id: RESTAURANT_ID,
    business_id: 42,
    display_name: 'Bon Pate',
    address_city: 'Columbus',
    address_state: 'Ohio',
    timezone: 'America/New_York',
    currency_code: 'USD',
    effective_role: 'owner',
    ...overrides,
  };
}

function app() {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.user = { id: USER_ID, email: 'owner@example.com', first_name: 'Emile', last_name: 'Jean Philippe' };
    next();
  });
  server.get('/api/restaurants/:restaurantId/inventory/dashboard', operations.getDashboard);
  server.get('/api/restaurants/:restaurantId/inventory/reports', operations.getReports);
  server.get('/api/restaurants/:restaurantId/inventory/areas', operations.listAreas);
  server.post('/api/restaurants/:restaurantId/inventory/suppliers', operations.createSupplier);
  server.post('/api/restaurants/:restaurantId/inventory/transfers', operations.createTransfer);
  server.patch('/api/restaurants/:restaurantId/inventory/transfers/:transferId', operations.updateTransfer);
  server.post('/api/restaurants/:restaurantId/inventory/receipts', operations.createReceipt);
  server.use(errorHandler);
  return server;
}

beforeEach(() => resetMocks());

describe('restaurant Inventory operations backend', () => {
  test('returns the live dashboard contract scoped to the authenticated restaurant', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({ rows: [{ name: 'Main Stockroom', address_city: 'Columbus', address_state: 'Ohio' }] })
      .mockResolvedValueOnce({ rows: [{ low_stock: 2, out_of_stock: 1, needs_count: 4, supplier_issues: 1, pending_requests: 3 }] })
      .mockResolvedValueOnce({ rows: [{ counts_done: 12, deliveries: 1, waste_reports: 3, requests: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, name: 'Chicken', quantity: '1', unit: 'case', affected_menu_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ menu_item_id: 8, menu_item_name: 'Chicken Plate', inventory_item_name: 'Chicken' }] });

    const response = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/inventory/dashboard`);

    expect(response.status).toBe(200);
    expect(response.body.restaurant.name).toBe('Bon Pate');
    expect(response.body.restaurant.area).toBe('Main Stockroom');
    expect(response.body.user.role).toBe('owner');
    expect(response.body.risk.low_stock).toBe(2);
    expect(response.body.priorities[0].name).toBe('Chicken');
    expect(response.body.menu_impacts[0].menu_item_name).toBe('Chicken Plate');
  });

  test('does not reveal inventory for an inaccessible restaurant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const response = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/inventory/areas`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('restaurant_not_found');
  });

  test('builds reports only from the authenticated restaurant ledger', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({ rows: [{ day: '2026-06-22', reports: 2, quantity: '3' }] })
      .mockResolvedValueOnce({ rows: [{ reports: 2, quantity: '3', estimated_cost: '12.50' }] })
      .mockResolvedValueOnce({ rows: [{ exact: 1, minor: 2, major: 0 }] })
      .mockResolvedValueOnce({ rows: [{ day: '2026-06-22', variance: '2' }] })
      .mockResolvedValueOnce({ rows: [{ item_name: 'Chicken', quantity: '3', unit: 'kg', estimated_cost: '12.50' }] })
      .mockResolvedValueOnce({ rows: [{ total: 4, with_issues: 1, fill_rate: '96' }] })
      .mockResolvedValueOnce({ rows: [{ supplier_name: 'Atlantic Foods', lines: 6, issue_lines: 1 }] });

    const response = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/inventory/reports`);

    expect(response.status).toBe(200);
    expect(response.body.waste.top_items[0].item_name).toBe('Chicken');
    expect(response.body.counts.minor).toBe(2);
    expect(response.body.deliveries.fill_rate).toBe('96');
    expect(mockQuery.mock.calls.slice(1).every(([, params]) => params[0] === RESTAURANT_ID)).toBe(true);
  });

  test('requires owner or manager access to create suppliers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access({ effective_role: 'employee' })] });

    const response = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/suppliers`)
      .send({ name: 'Atlantic Foods' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('forbidden');
  });

  test('creates a restaurant-scoped transfer without changing total on-hand stock', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({ rows: [{ id: 5, name: 'Rice', unit: 'bag' }] })
      .mockResolvedValueOnce({ rows: [{ id: 2, name: 'Dry Storage' }, { id: 3, name: 'Prep Kitchen' }] })
      .mockResolvedValueOnce({ rows: [{ id: 12, item_name: 'Rice', status: 'completed' }] });

    const response = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/transfers`)
      .send({ itemId: 5, quantity: 1, fromAreaId: 2, toAreaId: 3 });

    expect(response.status).toBe(201);
    expect(response.body.transfer.item_name).toBe('Rice');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE restaurant_inventory_items/.test(sql))).toBe(false);
  });

  test('restricts transfer lifecycle changes to restaurant managers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access({ effective_role: 'employee' })] });

    const response = await request(app())
      .patch(`/api/restaurants/${RESTAURANT_ID}/inventory/transfers/12`)
      .send({ status: 'completed' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('forbidden');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE restaurant_inventory_transfers/.test(sql))).toBe(false);
  });

  test('replays an already-recorded receipt without applying stock twice', async () => {
    const operationId = '9a1ef8e4-832f-4c34-8aa1-b5f7f65b7e09';
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 77 }] })
      .mockResolvedValueOnce({ rows: [{ id: 77, supplier_name: 'Atlantic Foods', lines: [{ id: 1, accepted_quantity: '4' }] }] });

    const response = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/receipts`)
      .send({
        supplierName: 'Atlantic Foods',
        clientOperationId: operationId,
        lines: [{ itemId: 5, receivedQuantity: 4, acceptedQuantity: 4 }],
      });

    expect(response.status).toBe(200);
    expect(response.body.replayed).toBe(true);
    expect(response.body.receipt.id).toBe(77);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE restaurant_inventory_items/.test(sql))).toBe(false);
  });
});
