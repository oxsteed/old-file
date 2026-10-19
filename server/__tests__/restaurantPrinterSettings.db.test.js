'use strict';

/**
 * DB tests: restaurant network receipt printer settings + print endpoints
 * (Track C: POS hardware support).
 *
 * Covers:
 *   - migration 912: restaurant_printer_settings table, defaults, unique
 *     restaurant_id, FK to food_restaurants.
 *   - GET /:restaurantId/printer-settings: defaults when no row exists.
 *   - PUT /:restaurantId/printer-settings: owner/manager upsert; 403 for
 *     non-managers; 400 when enabling without a host; 400 on bad port.
 *   - POST /:restaurantId/printer-test: 409 when printing disabled; on
 *     success the transport is stubbed and the exact bytes asserted.
 *   - POST /:restaurantId/print-receipt: 400 without order_id; 404 for an
 *     order at another restaurant; builds the receipt from a read-only
 *     order snapshot and sends it without touching order/payment tables.
 *
 * The scope-model ownership gate is stubbed (its own suite covers the real
 * gate); the transport layer is stubbed so no real printer is touched.
 * Printing is verified fire-and-forget: the order row is byte-identical
 * before and after a print.
 *
 * Run with e.g.
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test \
 *     npx jest __tests__/restaurantPrinterSettings.db.test.js
 * Without it, the DB describes skip (fail closed) instead of touching a DB.
 */
jest.unmock('pg');

const crypto = require('crypto');

const { disposableDatabaseOptIn, isDisposableDatabase } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('RESTAURANT_PRINTER_TEST_DATABASE_URL');

const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = 'test-secret-for-db-suite';
}

const sentBuffers = [];
jest.mock('../services/escposPrinter', () => {
  const actual = jest.requireActual('../services/escposPrinter');
  return {
    ...actual,
    sendToPrinter: jest.fn(async (host, port, buffer) => {
      sentBuffers.push({ host, port, buffer });
      return { ok: true };
    }),
  };
});

const { resolveRestaurantAccess } = require('../services/scopeModel');
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(),
}));

const pool = require('../db');
const controller = require('../controllers/restaurantPrinterController');

function mockReq({ params = {}, body = {}, user = { id: 'user-1' } } = {}) {
  return { params, body, user };
}
function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

async function newFixtures() {
  const tag = crypto.randomUUID().slice(0, 8);
  const userId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Printer', 'Fixture', 'customer', TRUE, TRUE)`,
    [userId, `printer-${tag}@example.invalid`]
  );
  const { rows: [b] } = await pool.query(
    'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
    [userId, `Printer Biz ${tag}`]
  );
  const { rows: [r] } = await pool.query(
    `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, phone)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [b.id, userId, `Printer Diner ${tag}`, '555-0100']
  );
  return { userId, businessId: b.id, restaurantId: r.id };
}

async function newOrder(restaurantId, businessId) {
  const { rows: [o] } = await pool.query(
    `INSERT INTO food_orders
       (restaurant_id, business_id, guest_name, table_label, fulfillment_type,
        order_source, status, payment_status, subtotal_cents, tax_cents,
        total_cents, currency_code, queue_number)
     VALUES ($1, $2, 'Test Guest', 'T1', 'dine_in', 'counter',
             'completed', 'paid', 900, 72, 972, 'USD', 7)
     RETURNING id`,
    [restaurantId, businessId]
  );
  await pool.query(
    `INSERT INTO food_order_items
       (order_id, item_name, quantity, unit_price_cents, line_total_cents, special_instructions)
     VALUES ($1, 'Burger', 2, 450, 900, 'No onions')`,
    [o.id]
  );
  return o.id;
}

async function orderRowJson(orderId) {
  const { rows: [row] } = await pool.query('SELECT * FROM food_orders WHERE id = $1', [orderId]);
  return JSON.stringify(row);
}

ddescribe('restaurant_printer_settings (migration 912)', () => {
  let fx;

  beforeAll(async () => {
    const { rows } = await pool.query(
      `SELECT column_name, data_type, column_default
         FROM information_schema.columns
        WHERE table_name = 'restaurant_printer_settings'
        ORDER BY ordinal_position`
    );
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(byName.host).toBeDefined();
    expect(byName.port.data_type).toBe('integer');
    expect(byName.port.column_default).toBe('9100');
    expect(byName.enabled.column_default).toBe('false');
    expect(byName.drawer_kick_on_cash.column_default).toBe('true');
    const { rows: uniq } = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = 'restaurant_printer_settings'
        AND indexname = 'restaurant_printer_settings_restaurant_id_uniq'`
    );
    expect(uniq.length).toBe(1);
    fx = await newFixtures();
  });

  afterAll(async () => {
    // Fixtures are left in the disposable database (same pattern as
    // restaurantLoyaltyAnalytics.db.test.js): deleting food_restaurants rows
    // trips the oxsteed_credit_restaurant_status_guard trigger's integrity
    // check, which is unrelated to printer settings.
    await pool.end().catch(() => {});
  });

  beforeEach(() => {
    sentBuffers.length = 0;
    resolveRestaurantAccess.mockReset();
  });

  function ownerAccess() {
    resolveRestaurantAccess.mockResolvedValue({ id: fx.restaurantId, effective_role: 'owner', display_name: 'Printer Diner', phone: '555-0100' });
  }
  function staffAccess() {
    resolveRestaurantAccess.mockResolvedValue({ id: fx.restaurantId, effective_role: 'staff', display_name: 'Printer Diner' });
  }

  async function enablePrinting(overrides = {}) {
    ownerAccess();
    const res = mockRes();
    await controller.updatePrinterSettings(
      mockReq({
        params: { restaurantId: String(fx.restaurantId) },
        body: { enabled: true, host: '192.168.1.50', port: 9100, drawerKickOnCash: true, ...overrides },
      }),
      res,
      jest.fn()
    );
    return res.payload.settings;
  }

  test('GET returns defaults when no settings row exists', async () => {
    ownerAccess();
    const req = mockReq({ params: { restaurantId: String(fx.restaurantId) } });
    const res = mockRes();
    const next = jest.fn();
    await controller.getPrinterSettings(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.settings).toEqual({ enabled: false, host: '', port: 9100, drawerKickOnCash: true });
  });

  test('PUT upserts settings for owner; GET reads them back', async () => {
    ownerAccess();
    const putRes = mockRes();
    await controller.updatePrinterSettings(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { enabled: true, host: '192.168.1.50', port: 9100, drawerKickOnCash: false } }),
      putRes,
      jest.fn()
    );
    expect(putRes.payload.settings).toEqual({ enabled: true, host: '192.168.1.50', port: 9100, drawerKickOnCash: false });

    const getRes = mockRes();
    await controller.getPrinterSettings(mockReq({ params: { restaurantId: String(fx.restaurantId) } }), getRes, jest.fn());
    expect(getRes.payload.settings).toEqual({ enabled: true, host: '192.168.1.50', port: 9100, drawerKickOnCash: false });

    // Second PUT updates the same single row (unique on restaurant_id).
    const putRes2 = mockRes();
    await controller.updatePrinterSettings(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { enabled: false, host: '', port: 9100 } }),
      putRes2,
      jest.fn()
    );
    expect(putRes2.payload.settings.enabled).toBe(false);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM restaurant_printer_settings WHERE restaurant_id = $1', [fx.restaurantId]);
    expect(rows[0].n).toBe(1);
  });

  test('PUT is forbidden for non-managers', async () => {
    staffAccess();
    const next = jest.fn();
    await controller.updatePrinterSettings(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { enabled: true, host: 'x' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  test('PUT rejects enabling without a host and rejects bad ports', async () => {
    ownerAccess();
    const next1 = jest.fn();
    await controller.updatePrinterSettings(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { enabled: true, host: '' } }),
      mockRes(),
      next1
    );
    expect(next1.mock.calls[0][0].statusCode).toBe(400);

    const next2 = jest.fn();
    await controller.updatePrinterSettings(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { enabled: false, port: 99999 } }),
      mockRes(),
      next2
    );
    expect(next2.mock.calls[0][0].statusCode).toBe(400);
  });

  test('print-test returns 409 while printing is disabled', async () => {
    ownerAccess();
    await controller.updatePrinterSettings(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { enabled: false, host: '', port: 9100 } }),
      mockRes(),
      jest.fn()
    );
    const next = jest.fn();
    await controller.printTestPage(mockReq({ params: { restaurantId: String(fx.restaurantId) } }), mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].code).toBe('printer_disabled');
    expect(sentBuffers.length).toBe(0);
  });

  test('print-test sends a test page when enabled', async () => {
    await enablePrinting();
    const res = mockRes();
    await controller.printTestPage(mockReq({ params: { restaurantId: String(fx.restaurantId) } }), res, jest.fn());
    expect(res.payload).toEqual({ ok: true, error: null });
    expect(sentBuffers.length).toBe(1);
    expect(sentBuffers[0].host).toBe('192.168.1.50');
    expect(sentBuffers[0].port).toBe(9100);
    const text = sentBuffers[0].buffer.toString('latin1');
    expect(text).toContain('Printer Diner');
    // Test page never kicks the drawer.
    expect(sentBuffers[0].buffer.includes(Buffer.from([0x1b, 0x70]))).toBe(false);
  });

  test('print-receipt requires order_id and is scoped to the restaurant', async () => {
    await enablePrinting();
    const next1 = jest.fn();
    await controller.printReceipt(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: {} }),
      mockRes(),
      next1
    );
    expect(next1.mock.calls[0][0].statusCode).toBe(400);

    const other = await newFixtures();
    const otherOrder = await newOrder(other.restaurantId, other.businessId);
    const next2 = jest.fn();
    await controller.printReceipt(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { order_id: otherOrder } }),
      mockRes(),
      next2
    );
    expect(next2.mock.calls[0][0].code).toBe('order_not_found');
    // Fixtures stay in the disposable DB (see afterAll note).
  });

  test('print-receipt prints from a read-only snapshot and never mutates the order', async () => {
    await enablePrinting();
    const orderId = await newOrder(fx.restaurantId, fx.businessId);
    const before = await orderRowJson(orderId);

    const res = mockRes();
    await controller.printReceipt(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { order_id: orderId } }),
      res,
      jest.fn()
    );
    expect(res.payload.ok).toBe(true);
    expect(res.payload.orderId).toBe(Number(orderId));
    expect(sentBuffers.length).toBe(1);

    const text = sentBuffers[0].buffer.toString('latin1');
    expect(text).toContain('Printer Diner');
    expect(text).toContain('2 x Burger');
    expect(text).toContain('No onions');
    expect(text).toContain('TOTAL');

    // The order row is byte-identical: printing mutated nothing.
    const after = await orderRowJson(orderId);
    expect(after).toBe(before);
    const { rows: items } = await pool.query('SELECT count(*)::int AS n FROM food_order_items WHERE order_id = $1', [orderId]);
    expect(items[0].n).toBe(1);
  });

  test('drawer kicks only for cash payments when the setting is on', async () => {
    await enablePrinting({ drawerKickOnCash: true });
    const orderId = await newOrder(fx.restaurantId, fx.businessId);
    await pool.query(
      `INSERT INTO restaurant_pos_payments (restaurant_id, food_order_id, payment_type, amount_cents, status)
       VALUES ($1, $2, 'cash', 972, 'recorded')`,
      [fx.restaurantId, orderId]
    );
    await controller.printReceipt(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { order_id: orderId } }),
      mockRes(),
      jest.fn()
    );
    const buf = sentBuffers[sentBuffers.length - 1].buffer;
    expect(buf.includes(Buffer.from([0x1b, 0x70]))).toBe(true); // ESC p drawer kick present

    // Card-only payment: no kick even with the setting on.
    const cardOrder = await newOrder(fx.restaurantId, fx.businessId);
    await pool.query(
      `INSERT INTO restaurant_pos_payments (restaurant_id, food_order_id, payment_type, amount_cents, status)
       VALUES ($1, $2, 'card', 972, 'captured')`,
      [fx.restaurantId, cardOrder]
    );
    await controller.printReceipt(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { order_id: cardOrder } }),
      mockRes(),
      jest.fn()
    );
    const cardBuf = sentBuffers[sentBuffers.length - 1].buffer;
    expect(cardBuf.includes(Buffer.from([0x1b, 0x70]))).toBe(false);
  });
});
