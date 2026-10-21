'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/restaurantInventoryAvailabilityService', () => ({
  syncMappedMenuAvailability: jest.fn().mockResolvedValue({ changes: [], applied: true }),
}));
jest.mock('../services/permissionsService', () => ({
  getEffectivePermissions: jest.fn().mockResolvedValue({ permissions: new Set(['inventory.view', 'inventory.update']), raw: {} }),
  hasAny: (permissionSet, requested) => requested.some((permission) => permissionSet.has(permission)),
}));
jest.mock('../services/restaurantLocationAccessService', () => ({
  getLocationScope: jest.fn().mockResolvedValue({ mode: 'all', location_ids: null, assignments: [] }),
  assertLocationAccess: jest.fn().mockResolvedValue({ mode: 'all', location_ids: null, assignments: [] }),
}));
jest.mock('../services/restaurantInventoryAuditService', () => ({
  logInventoryAudit: jest.fn().mockResolvedValue(undefined),
}));

const operations = require('../controllers/restaurantInventoryOperationsController');
const permissions = require('../services/permissionsService');
const locationAccess = require('../services/restaurantLocationAccessService');

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
  server.get('/api/restaurants/:restaurantId/inventory/reports/food-cost', operations.foodCostSummary);
  server.get('/api/restaurants/:restaurantId/inventory/audit-events', operations.listAuditEvents);
  server.get('/api/restaurants/:restaurantId/inventory/areas', operations.listAreas);
  server.post('/api/restaurants/:restaurantId/inventory/suppliers', operations.createSupplier);
  server.get('/api/restaurants/:restaurantId/inventory/supplier-catalog', operations.listSupplierCatalog);
  server.put('/api/restaurants/:restaurantId/inventory/supplier-catalog', operations.upsertSupplierCatalog);
  server.post('/api/restaurants/:restaurantId/inventory/transfers', operations.createTransfer);
  server.get('/api/restaurants/:restaurantId/inventory/transfers', operations.listTransfers);
  server.patch('/api/restaurants/:restaurantId/inventory/transfers/:transferId', operations.updateTransfer);
  server.post('/api/restaurants/:restaurantId/inventory/receipts', operations.createReceipt);
  server.patch('/api/restaurants/:restaurantId/inventory/receipts/:receiptId/invoice-match', operations.updateReceiptInvoiceMatch);
  server.use(errorHandler);
  return server;
}

beforeEach(() => {
  resetMocks();
  permissions.getEffectivePermissions.mockResolvedValue({
    permissions: new Set(['inventory.view', 'inventory.update']),
    raw: {},
  });
});

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

  test('lists restaurant-scoped inventory audit events with actor details', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({
        rows: [{
          id: 99,
          restaurant_id: RESTAURANT_ID,
          event_type: 'stock_adjusted',
          entity_type: 'item',
          entity_id: 5,
          actor_name: 'Emile Jean Philippe',
          actor_email: 'owner@example.com',
        }],
      });

    const response = await request(app())
      .get(`/api/restaurants/${RESTAURANT_ID}/inventory/audit-events?entityType=item&entityId=5`);

    expect(response.status).toBe(200);
    expect(response.body.events[0].event_type).toBe('stock_adjusted');
    expect(response.body.events[0].actor_name).toBe('Emile Jean Philippe');
    const auditSql = mockQuery.mock.calls[1][0];
    expect(auditSql).toMatch(/restaurant_inventory_audit_events/);
    expect(mockQuery.mock.calls[1][1][0]).toBe(RESTAURANT_ID);
  });

  test('returns theoretical versus actual food cost for a period', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({ rows: [{
        inventory_item_id: 5,
        name: 'Rice',
        unit: 'kg',
        unit_cost: '3.00',
        theoretical_quantity: '4.000',
        actual_quantity: '5.000',
        variance_quantity: '1.000',
        theoretical_cost: '12.00',
        actual_cost: '15.00',
        variance_cost: '3.00',
      }] });

    const response = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/inventory/reports/food-cost?from=2026-10-01&to=2026-10-07`);

    expect(response.status).toBe(200);
    expect(response.body.rows[0].variance_quantity).toBe('1.000');
    expect(response.body.totals.variance_cost).toBe(3);
    expect(mockQuery.mock.calls[1][0]).toMatch(/conversion_factor/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/yield_percent/);
  });

  test('upserts a supplier catalog entry with pack and price metadata', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access()] })
      .mockResolvedValueOnce({ rows: [{ supplier_id: 7, inventory_item_id: 5, location_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 19, supplier_id: 7, inventory_item_id: 5, pack_quantity: ' case', unit_cost: '42.50', currency_code: 'USD' }] });

    const response = await request(app())
      .put(`/api/restaurants/${RESTAURANT_ID}/inventory/supplier-catalog`)
      .send({ supplierId: 7, inventoryItemId: 5, packQuantity: 6, packUnit: 'case', unitCost: 42.5, currencyCode: 'usd' });

    expect(response.status).toBe(201);
    expect(response.body.catalog.unit_cost).toBe('42.50');
    expect(mockQuery.mock.calls[2][0]).toMatch(/ON CONFLICT/);
  });

  test('requires owner or manager access to create suppliers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access({ effective_role: 'employee', membership_id: 88 })] });

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

  test('filters transfers to assigned stores and preserves the location predicate', async () => {
    locationAccess.getLocationScope.mockResolvedValueOnce({ mode: 'assigned', location_ids: [11], assignments: [] });
    mockQuery
      .mockResolvedValueOnce({ rows: [access({ effective_role: 'manager', effective_membership_id: 88 })] })
      .mockResolvedValueOnce({ rows: [{ id: 12, location_id: 11, item_name: 'Rice' }] });

    const response = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/inventory/transfers`);

    expect(response.status).toBe(200);
    expect(response.body.transfers[0].location_id).toBe(11);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/t\.location_id = ANY\(\$2::bigint\[\]\)/);
    expect(params).toEqual([RESTAURANT_ID, [11]]);
  });

  test('restricts transfer lifecycle changes to restaurant managers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access({ effective_role: 'employee', membership_id: 88 })] });

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

  test('reconciles a late invoice against a store-scoped purchase request', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access({ effective_role: 'manager', effective_membership_id: 88 })] })
      .mockResolvedValueOnce({ rows: [{
        id: 77,
        restaurant_id: RESTAURANT_ID,
        location_id: 11,
        invoice_match_status: 'unmatched',
        purchase_request_id: null,
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 21, location_id: 11, status: 'submitted' }] })
      .mockResolvedValueOnce({ rows: [{
        id: 77,
        location_id: 11,
        purchase_request_id: 21,
        invoice_match_status: 'matched',
        invoice_total_cents: 4250,
        invoice_currency_code: 'USD',
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: 77,
        location_id: 11,
        purchase_request_id: 21,
        invoice_match_status: 'matched',
        invoice_total_cents: 4250,
        invoice_currency_code: 'USD',
        lines: [],
      }] });

    const response = await request(app())
      .patch(`/api/restaurants/${RESTAURANT_ID}/inventory/receipts/77/invoice-match`)
      .send({ invoiceMatchStatus: 'matched', purchaseRequestId: 21, invoiceTotalCents: 4250, invoiceCurrencyCode: 'usd' });

    expect(response.status).toBe(200);
    expect(response.body.receipt.invoice_match_status).toBe('matched');
    expect(response.body.receipt.purchase_request_id).toBe(21);
    expect(mockQuery.mock.calls[3][0]).toMatch(/invoice_match_status = \$2/);
    expect(mockQuery.mock.calls[3][1]).toEqual([21, 'matched', true, 4250, true, 'USD', USER_ID, 77, RESTAURANT_ID]);
  });

  test('rejects unsupported invoice match states before changing a receipt', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access()] });

    const response = await request(app())
      .patch(`/api/restaurants/${RESTAURANT_ID}/inventory/receipts/77/invoice-match`)
      .send({ invoiceMatchStatus: 'approved' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('validation_failed');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
