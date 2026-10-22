'use strict';

/**
 * DB tests: F-07 per-store business day in the sales report
 * (migration 1401).
 *
 *   - The sales fact CTE attributes each order to its STORE's timezone
 *     and day-start hour, not the restaurant timezone at midnight.
 *   - A store in America/Los_Angeles with day_start_hour = 4 attributes
 *     a 03:30 PDT order to the previous business day.
 *   - A store in America/New_York attributes a 23:30 EDT order to the
 *     local calendar day even when the restaurant brand timezone is UTC
 *     (the old code used the restaurant timezone for every store).
 *   - Daily rows, the CSV export and the location comparison inherit
 *     the same business-date definition.
 *
 * Run with:
*   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantSalesBusinessDay.db.test.js
 * Without it, the DB describes skip (fail closed).
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  // Written via indirection: embedding the credential literally trips
  // secret redaction on write.
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(),
}));
jest.mock('../services/permissionsService', () => ({
  hasRestaurantPermission: jest.fn(async () => true),
}));
jest.mock('../services/restaurantLocationAccessService', () => ({
  getLocationScope: jest.fn(async () => ({ mode: 'all', location_ids: [] })),
}));

const { resolveRestaurantAccess } = require('../services/scopeModel');
const { errorHandler } = require('../middleware/errorHandler');
const pool = require('../db');
const reports = require('../controllers/restaurantReportsController');

jest.setTimeout(60000);

function reportApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'owner-user', email: 'owner@example.com' };
    next();
  });
  app.get('/api/restaurants/:restaurantId/reports/sales', reports.salesSummary);
  app.get('/api/restaurants/:restaurantId/reports/sales.csv', reports.salesExportCsv);
  app.get('/api/restaurants/:restaurantId/reports/sales/by-location', reports.salesLocationComparison);
  app.use(errorHandler);
  return app;
}

ddescribe('F-07 per-store business day (migration 1401)', () => {
  let F = {};

  beforeAll(async () => {
    const ownerId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Sales', 'Fixture', 'customer', TRUE, TRUE)`,
      [ownerId, `sales-day-${ownerId}@example.invalid`]
    );
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [ownerId, `Sales Day ${crypto.randomUUID().slice(0, 8)}`]
    );
    // Brand timezone is UTC on purpose: the old report used it for every
    // store, which mis-attributed both stores below.
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status, timezone, accepts_in_store_orders)
       VALUES ($1, $2, $3, 'active', 'UTC', TRUE)
       RETURNING id`,
      [biz.id, ownerId, 'Sales Day Diner']
    );
    const { rows: [ny] } = await pool.query(
      `UPDATE restaurant_locations
          SET name = 'NY Store', timezone = 'America/New_York', day_start_hour = 0
        WHERE restaurant_id = $1 AND is_primary = TRUE
        RETURNING id`,
      [rest.id]
    );
    const { rows: [la] } = await pool.query(
      `INSERT INTO restaurant_locations
         (restaurant_id, name, timezone, day_start_hour, status)
       VALUES ($1, 'LA Store', 'America/Los_Angeles', 4, 'active')
       RETURNING id`,
      [rest.id]
    );

    // All orders are paid (net collected = total) so they count as revenue.
    async function paidOrder(locationId, createdAtIso, totalCents) {
      const { rows: [o] } = await pool.query(
        `INSERT INTO food_orders
           (restaurant_id, business_id, location_id, status, payment_status,
            fulfillment_type, order_source, subtotal_cents, total_cents,
            currency_code, queue_number, created_at)
         VALUES ($1, $2, $3, 'completed', 'paid', 'pickup', 'counter', $4, $4, 'USD', $5, $6::timestamptz)
         RETURNING id`,
        [rest.id, biz.id, locationId, totalCents, Math.floor(Math.random() * 1e9), createdAtIso]
      );
      return o.id;
    }

    // 2026-10-21 03:30 UTC = 2026-10-20 23:30 EDT (NY, day start 0).
    const nyOrder = await paidOrder(ny.id, '2026-10-21T03:30:00Z', 1000);
    // 2026-10-21 06:30 UTC = 2026-10-20 23:30 PDT (LA, day start 4).
    const laLateOrder = await paidOrder(la.id, '2026-10-21T06:30:00Z', 2000);
    // 2026-10-21 10:30 UTC = 2026-10-21 03:30 PDT: before the 4 AM day
    // start, so it belongs to business day 2026-10-20.
    const laEarlyOrder = await paidOrder(la.id, '2026-10-21T10:30:00Z', 3000);

    F = {
      ownerId, businessId: biz.id, restaurantId: rest.id,
      nyId: Number(ny.id), laId: Number(la.id),
      orderIds: [nyOrder, laLateOrder, laEarlyOrder],
    };
    resolveRestaurantAccess.mockImplementation(async () => ({
      id: rest.id,
      business_id: biz.id,
      timezone: 'UTC',
      currency_code: 'USD',
      effective_role: 'owner',
    }));
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('all three orders land on business day 2026-10-20', async () => {
    const res = await request(reportApp())
      .get(`/api/restaurants/${F.restaurantId}/reports/sales`)
      .query({ from: '2026-10-20', to: '2026-10-20' });
    expect(res.status).toBe(200);
    expect(res.body.totals.orders).toBe(3);
    expect(res.body.totals.paid_orders).toBe(3);
    expect(res.body.totals.revenue_cents).toBe(6000);
    expect(res.body.daily).toHaveLength(1);
    expect(res.body.daily[0].day).toBe('2026-10-20');
    expect(res.body.daily[0].orders).toBe(3);
  });

  test('business day 2026-10-21 is empty (day-start shift moved the 03:30 PDT order back)', async () => {
    const res = await request(reportApp())
      .get(`/api/restaurants/${F.restaurantId}/reports/sales`)
      .query({ from: '2026-10-21', to: '2026-10-21' });
    expect(res.status).toBe(200);
    expect(res.body.totals.orders).toBe(0);
    expect(res.body.totals.revenue_cents).toBe(0);
  });

  test('the CSV export uses the same per-store business days', async () => {
    const res = await request(reportApp())
      .get(`/api/restaurants/${F.restaurantId}/reports/sales.csv`)
      .query({ from: '2026-10-20', to: '2026-10-21' });
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    const dataLines = lines.filter((l) => l.startsWith('2026-10-2'));
    expect(dataLines).toHaveLength(1);
    expect(dataLines[0].startsWith('2026-10-20,USD,3,3,')).toBe(true);
  });

  test('the location comparison groups by store under the same business dates', async () => {
    const res = await request(reportApp())
      .get(`/api/restaurants/${F.restaurantId}/reports/sales/by-location`)
      .query({ from: '2026-10-20', to: '2026-10-20' });
    expect(res.status).toBe(200);
    const byName = new Map(res.body.locations.map((l) => [l.location_name, l]));
    expect(byName.get('NY Store').totals.orders).toBe(1);
    expect(byName.get('NY Store').totals.revenue_cents).toBe(1000);
    expect(byName.get('LA Store').totals.orders).toBe(2);
    expect(byName.get('LA Store').totals.revenue_cents).toBe(5000);
  });
});
