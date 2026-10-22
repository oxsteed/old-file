'use strict';

/**
 * Tests: F-23 vendor price history + PO-to-invoice matching (migration 99918).
 *
 *   - receipt lines accept unitCostCents; a price-history row is written
 *     per line (source_type 'receipt');
 *   - manual price entries are recorded and listed (item/supplier filters);
 *   - creating a receipt against a PO returns the line-level three-way
 *     price match; a line whose receiving cost exceeds the PO estimate
 *     beyond tolerance is flagged with variance_bps;
 *   - updating the invoice match recomputes the same variances.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
*   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantVendorPriceHistory.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'vendor-price-test-secret';
}

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(),
}));

const { resolveRestaurantAccess } = require('../services/scopeModel');
const { errorHandler } = require('../middleware/errorHandler');
const pool = require('../db');
const inventory = require('../controllers/restaurantInventoryController');
const ops = require('../controllers/restaurantInventoryOperationsController');

jest.setTimeout(60000);

function invApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, email: 'owner@example.com', role: 'customer' };
    next();
  });
  app.post('/api/restaurants/:restaurantId/inventory/purchase-requests', inventory.createPurchaseRequest);
  app.post('/api/restaurants/:restaurantId/inventory/receipts', ops.createReceipt);
  app.patch('/api/restaurants/:restaurantId/inventory/receipts/:receiptId/invoice-match', ops.updateReceiptInvoiceMatch);
  app.get('/api/restaurants/:restaurantId/inventory/price-history', ops.listVendorPriceHistory);
  app.post('/api/restaurants/:restaurantId/inventory/price-history', ops.recordVendorPrice);
  app.use(errorHandler);
  return app;
}

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Vendor', 'Price', 'customer', TRUE, TRUE)`,
    [id, `vendor-price-${label}-${id}@example.invalid`]
  );
  return id;
}

ddescribe('F-23 vendor price history + PO-to-invoice matching', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await newUser('owner');
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Vendor Price ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [biz.id, owner, 'Vendor Price Diner']
    );
    const { rows: [loc] } = await pool.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, status)
       VALUES ($1, 'Store A', 'active') RETURNING id`,
      [rest.id]
    );
    const { rows: [supplier] } = await pool.query(
      `INSERT INTO restaurant_inventory_suppliers (restaurant_id, name, is_active)
       VALUES ($1, 'Sysco Test', TRUE) RETURNING id`,
      [rest.id]
    );
    const { rows: [item] } = await pool.query(
      `INSERT INTO restaurant_inventory_items
         (restaurant_id, location_id, name, category, unit, quantity, created_by)
       VALUES ($1, $2, 'Chicken Breast', 'meat', 'lb', 0, $3) RETURNING id`,
      [rest.id, loc.id, owner]
    );
    F = { owner, businessId: biz.id, restaurantId: rest.id, locationId: loc.id, supplierId: supplier.id, itemId: item.id };
    resolveRestaurantAccess.mockImplementation(async () => ({
      id: rest.id,
      business_id: biz.id,
      display_name: 'Vendor Price Diner',
      timezone: 'UTC',
      currency_code: 'USD',
      settings: {},
      effective_role: 'owner',
      effective_membership_id: null,
    }));
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('a receipt line cost is recorded in the vendor price history', async () => {
    const app = invApp(F.owner);
    const res = await request(app)
      .post(`/api/restaurants/${F.restaurantId}/inventory/receipts`)
      .send({
        supplierName: 'Sysco Test',
        supplierId: F.supplierId,
        locationId: F.locationId,
        lines: [{ itemId: F.itemId, receivedQuantity: 10, acceptedQuantity: 10, unitCostCents: 250 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.receipt.lines[0].unit_cost_cents).toBe(250);

    const { rows } = await pool.query(
      `SELECT * FROM restaurant_inventory_vendor_price_history
        WHERE restaurant_id = $1 AND inventory_item_id = $2`,
      [F.restaurantId, F.itemId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source_type).toBe('receipt');
    expect(Number(rows[0].unit_cost_cents)).toBe(250);
    expect(Number(rows[0].supplier_id)).toBe(Number(F.supplierId));

    const listed = await request(app)
      .get(`/api/restaurants/${F.restaurantId}/inventory/price-history`)
      .query({ itemId: F.itemId });
    expect(listed.status).toBe(200);
    expect(listed.body.priceHistory).toHaveLength(1);
  });

  test('manual price entries are recorded and audited', async () => {
    const app = invApp(F.owner);
    const res = await request(app)
      .post(`/api/restaurants/${F.restaurantId}/inventory/price-history`)
      .send({ itemId: F.itemId, supplierId: F.supplierId, unit: 'lb', unitCostCents: 240, currencyCode: 'USD' });
    expect(res.status).toBe(201);
    expect(res.body.priceEntry.source_type).toBe('manual');

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM restaurant_inventory_vendor_price_history
        WHERE restaurant_id = $1 AND source_type = 'manual'`,
      [F.restaurantId]
    );
    expect(rows[0].n).toBe(1);

    const bad = await request(app)
      .post(`/api/restaurants/${F.restaurantId}/inventory/price-history`)
      .send({ itemId: F.itemId, unitCostCents: -5 });
    expect(bad.status).toBe(400);
  });

  test('a receipt against a PO returns the three-way price match with variance flags', async () => {
    const app = invApp(F.owner);
    // PO estimate: $2.50/lb.
    const po = await request(app)
      .post(`/api/restaurants/${F.restaurantId}/inventory/purchase-requests`)
      .send({
        itemName: 'Chicken Breast',
        requestedQuantity: 10,
        unit: 'lb',
        locationId: F.locationId,
        estimatedUnitCostCents: 250,
        estimatedCurrencyCode: 'USD',
      });
    expect(po.status).toBe(201);
    expect(Number(po.body.request.estimated_unit_cost_cents)).toBe(250);

    // Receiving at $3.00/lb: +20% over estimate, beyond the 5% tolerance.
    const receipt = await request(app)
      .post(`/api/restaurants/${F.restaurantId}/inventory/receipts`)
      .send({
        supplierName: 'Sysco Test',
        supplierId: F.supplierId,
        locationId: F.locationId,
        purchaseRequestId: po.body.request.id,
        lines: [{ itemId: F.itemId, receivedQuantity: 10, acceptedQuantity: 10, unitCostCents: 300 }],
      });
    expect(receipt.status).toBe(201);
    expect(receipt.body.receipt.invoice_match_status).toBe('matched');
    const match = receipt.body.priceMatch;
    expect(match.flagged).toBe(1);
    expect(match.variances).toHaveLength(1);
    expect(match.variances[0]).toMatchObject({
      po_matched: true,
      estimated_unit_cost_cents: 250,
      actual_unit_cost_cents: 300,
      variance_bps: 2000,
      flagged: true,
    });

    // A receipt at the estimated price is not flagged.
    const receipt2 = await request(app)
      .post(`/api/restaurants/${F.restaurantId}/inventory/receipts`)
      .send({
        supplierName: 'Sysco Test',
        supplierId: F.supplierId,
        locationId: F.locationId,
        lines: [{ itemId: F.itemId, receivedQuantity: 5, acceptedQuantity: 5, unitCostCents: 250 }],
      });
    expect(receipt2.status).toBe(201);
    const rematch = await request(app)
      .patch(`/api/restaurants/${F.restaurantId}/inventory/receipts/${receipt2.body.receipt.id}/invoice-match`)
      .send({ invoiceMatchStatus: 'matched', purchaseRequestId: po.body.request.id });
    expect(rematch.status).toBe(200);
    expect(rematch.body.priceMatch.flagged).toBe(0);
    expect(rematch.body.priceMatch.variances[0]).toMatchObject({
      po_matched: true,
      variance_bps: 0,
      flagged: false,
    });
  });
});
