'use strict';

/**
 * DB tests: F-07 web sales report (restaurantReportsController.salesSummary
 * + salesExportCsv) against a real migrated database.
 *
 * Proves, with orders placed around local midnight in America/New_York:
 *   - day boundaries and grouping follow the RESTAURANT timezone, not UTC
 *     (an order at 01:30 UTC is 21:30 local the previous day);
 *   - revenue is net collected (POS payments minus refunds, mirroring
 *     getManagerReports), never the gross total of 'completed' orders;
 *   - an unpaid 'completed' order contributes no revenue;
 *   - currencies are never summed together: USD and EUR get separate
 *     totals, daily rows, breakdowns and payment-method mixes;
 *   - avg ticket = net collected / paid orders per currency;
 *   - the CSV export carries the same facts.
 *
 * The scope-model gate is stubbed (its own suite covers the real gate);
 * every report query runs against the real schema.
 *
 * Run with:
 *   RESTAURANT_REPORTS_TEST_DATABASE_URL=<loopback disposable db url>
 *     npx jest __tests__/restaurantReportsSales.db.test.js
 * Without it, the DB describes skip (fail closed).
 */
jest.unmock('pg');

const crypto = require('crypto');

function isDisposableReportsDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && ['/credit_statement_test', '/fr_t3'].includes(url.pathname);
  } catch { return false; }
}
const RAW_URL = process.env.RESTAURANT_REPORTS_TEST_DATABASE_URL || '';
if (RAW_URL && !isDisposableReportsDb(RAW_URL)) {
  throw new Error('Reports DB tests require an explicit loopback disposable database');
}
const CAN_RUN_DB = isDisposableReportsDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only a disposable loopback database', () => {
  expect(isDisposableReportsDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(),
}));

const { resolveRestaurantAccess } = require('../services/scopeModel');
const pool = require('../db');
const controller = require('../controllers/restaurantReportsController');

function mockReq({ params = {}, query = {}, user = { id: 'user-1' } } = {}) {
  return { params, query, user };
}
function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; return res; });
  res.send = jest.fn((body) => { res.body = body; return res; });
  return res;
}

ddescribe('F-07 sales report (restaurant timezone, net collected, per currency)', () => {
  let fx;

  async function newFixtures() {
    const tag = crypto.randomUUID().slice(0, 8);
    const userId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Reports', 'Fixture', 'customer', TRUE, TRUE)`,
      [userId, `reports-${tag}@example.invalid`]
    );
    const { rows: [b] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [userId, `Reports Biz ${tag}`]
    );
    const { rows: [r] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id`,
      [b.id, userId, `Reports Diner ${tag}`]
    );
    return { userId, businessId: b.id, restaurantId: r.id };
  }

  async function newOrder({
    createdAt, currency = 'USD', status = 'completed', paymentStatus = 'paid',
    subtotal = 0, discount = 0, tax = 0, tip = 0, total = 0, queue,
  }) {
    const { rows: [o] } = await pool.query(
      `INSERT INTO food_orders
         (restaurant_id, business_id, guest_name, fulfillment_type, order_source,
          status, payment_status, subtotal_cents, discount_cents, tax_cents,
          tip_cents, total_cents, currency_code, queue_number, created_at)
       VALUES ($1, $2, 'Reports Guest', 'pickup', 'counter', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [fx.restaurantId, fx.businessId, status, paymentStatus, subtotal, discount, tax, tip, total, currency, queue, createdAt]
    );
    return o.id;
  }

  async function newPayment(orderId, { type = 'cash', amount, status = 'recorded' }) {
    await pool.query(
      `INSERT INTO restaurant_pos_payments (restaurant_id, food_order_id, payment_type, amount_cents, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [fx.restaurantId, orderId, type, amount, status]
    );
  }

  beforeAll(async () => {
    fx = await newFixtures();
    resolveRestaurantAccess.mockResolvedValue({
      id: fx.restaurantId,
      business_id: fx.businessId,
      effective_role: 'owner',
      timezone: 'America/New_York',
      currency_code: 'USD',
    });

    // Local day 2026-10-19 in America/New_York (EDT, UTC-4).
    // A: 23:30 UTC Oct 19 = 19:30 local Oct 19. Cash paid 1000.
    const a = await newOrder({ createdAt: '2026-10-19T23:30:00Z', subtotal: 900, tax: 100, total: 1000, queue: 101 });
    await newPayment(a, { type: 'cash', amount: 1000 });
    // B: 01:30 UTC Oct 20 = 21:30 local Oct 19 (previous UTC day boundary
    // trap). Card paid 2000, with a 100 discount in the breakdown.
    const b = await newOrder({ createdAt: '2026-10-20T01:30:00Z', subtotal: 1900, discount: 100, tax: 200, total: 2000, queue: 102 });
    await newPayment(b, { type: 'card', amount: 2000, status: 'captured' });
    // E: 15:00 UTC Oct 19 = 11:00 local Oct 19. Cash 4000, refunded 500.
    const e = await newOrder({ createdAt: '2026-10-19T15:00:00Z', subtotal: 3600, tax: 400, total: 4000, queue: 103 });
    await newPayment(e, { type: 'cash', amount: 4000 });
    await newPayment(e, { type: 'refund', amount: 500 });
    // D: EUR order, local Oct 19, paid via payment_status only (no POS rows).
    await newOrder({ createdAt: '2026-10-19T18:00:00Z', currency: 'EUR', subtotal: 3000, total: 3000, queue: 104 });
    // C: 05:30 UTC Oct 20 = 01:30 local Oct 20. Completed but UNPAID.
    await newOrder({ createdAt: '2026-10-20T05:30:00Z', paymentStatus: 'unpaid', subtotal: 5000, total: 5000, queue: 105 });
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  const RANGE = { from: '2026-10-19', to: '2026-10-20' };

  async function fetchReport() {
    const res = mockRes();
    const next = jest.fn();
    await controller.salesSummary(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, query: { ...RANGE } }),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    return res.payload;
  }

  test('groups by local business date and reports net collected per currency', async () => {
    const report = await fetchReport();
    expect(report.timezone).toBe('America/New_York');
    expect(report.from_date).toBe('2026-10-19');
    expect(report.to_date).toBe('2026-10-20');
    // Local-midnight bounds in UTC: Oct 19 00:00 EDT = 04:00 UTC.
    expect(report.from).toBe('2026-10-19T04:00:00.000Z');
    expect(report.to).toBe('2026-10-21T04:00:00.000Z');

    expect(report.currencies.map((c) => c.currency)).toEqual(['USD', 'EUR']);
    expect(report.currency).toBe('USD');

    const usd = report.currencies[0];
    // A 1000 + B 2000 + E (4000 - 500 refund) = 6500 net collected.
    expect(usd.totals.revenue_cents).toBe(6500);
    expect(usd.totals.collected_cents).toBe(7000);
    expect(usd.totals.refunds_cents).toBe(500);
    expect(usd.totals.paid_orders).toBe(3);
    expect(usd.totals.orders).toBe(4); // includes the unpaid completed order
    expect(usd.totals.avg_ticket_cents).toBe(2167); // 6500 / 3 paid orders
    // Breakdown over paid orders only.
    expect(usd.totals.gross_cents).toBe(6400);
    expect(usd.totals.discount_cents).toBe(100);
    expect(usd.totals.net_sales_cents).toBe(6300);
    expect(usd.totals.tax_cents).toBe(700);

    // B (01:30 UTC Oct 20) belongs to local Oct 19: all USD revenue lands
    // on the 19th; the 20th has only the unpaid order's volume.
    expect(usd.daily).toHaveLength(2);
    const [d19, d20] = usd.daily;
    expect(d19.day).toBe('2026-10-19');
    expect(d19.revenue_cents).toBe(6500);
    expect(d19.orders).toBe(3);
    expect(d20.day).toBe('2026-10-20');
    expect(d20.orders).toBe(1);
    expect(d20.paid_orders).toBe(0);
    expect(d20.revenue_cents).toBe(0);

    // Payment-method mix: refunds are not a tender.
    expect(usd.payment_methods).toEqual([
      { payment_type: 'cash', payments: 2, amount_cents: 5000 },
      { payment_type: 'card', payments: 1, amount_cents: 2000 },
    ]);

    // Top-level fields mirror the primary currency.
    expect(report.totals.revenue_cents).toBe(6500);
    expect(report.daily).toHaveLength(2);
  });

  test('EUR is reported separately and never summed into USD', async () => {
    const report = await fetchReport();
    const eur = report.currencies.find((c) => c.currency === 'EUR');
    expect(eur.totals.revenue_cents).toBe(3000);
    expect(eur.totals.paid_orders).toBe(1);
    expect(eur.totals.avg_ticket_cents).toBe(3000);
    expect(eur.daily).toHaveLength(1);
    expect(eur.daily[0].day).toBe('2026-10-19');
    // No figure anywhere adds 6500 + 3000.
    expect(report.totals.revenue_cents).toBe(6500);
  });

  test('CSV export carries the same facts per currency', async () => {
    const res = mockRes();
    const next = jest.fn();
    await controller.salesExportCsv(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, query: { ...RANGE } }),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.headers['Content-Type']).toContain('text/csv');
    expect(res.headers['Content-Disposition']).toContain('sales-report-2026-10-19-to-2026-10-20.csv');
    const lines = res.body.trim().split('\n');
    expect(lines[0]).toBe(
      'date,currency,orders,paid_orders,gross_cents,discounts_cents,net_sales_cents,tax_cents,tips_cents,service_fees_cents,delivery_fees_cents,refunds_cents,net_collected_cents,avg_ticket_cents'
    );
    const usdDay = lines.find((l) => l.startsWith('2026-10-19,USD,'));
    expect(usdDay).toBe('2026-10-19,USD,3,3,6400,100,6300,700,0,0,0,500,6500,2167');
    const usdTotal = lines.find((l) => l.startsWith('TOTAL,USD,'));
    expect(usdTotal).toBe('TOTAL,USD,4,3,6400,100,6300,700,0,0,0,500,6500,2167');
    const eurTotal = lines.find((l) => l.startsWith('TOTAL,EUR,'));
    expect(eurTotal).toBe('TOTAL,EUR,1,1,3000,0,3000,0,0,0,0,0,3000,3000');
  });

  test('rejects an inverted range with 400', async () => {
    const next = jest.fn();
    await controller.salesSummary(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, query: { from: '2026-10-20', to: '2026-10-19' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });
});
