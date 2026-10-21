'use strict';

/**
 * DB tests: restaurant network receipt printer settings + print endpoints
 * (Track C: POS hardware support).
 *
 * Covers:
 *   - migrations 912/976: restaurant_printer_settings table, defaults,
 *     legacy compatibility, and unique per-store settings.
 *   - GET /:restaurantId/printer-settings: defaults when no row exists.
 *   - PUT /:restaurantId/printer-settings: owner/manager upsert; 403 for
 *     non-managers; 400 when enabling without a host; 400 on bad port.
 *   - POST /:restaurantId/printer-test: 409 when printing disabled.
 *   - F-05: with RESTAURANT_SERVER_PRINTING_ENABLED unset (the default),
 *     printer-test and print-receipt ENQUEUE a restaurant_printer_jobs
 *     row for paired in-store devices and the API server opens no socket
 *     (net connect is spied on); the queued payload carries the exact
 *     ESC/POS bytes. Print endpoints are manager-only (403 for staff).
 *     Only with the flag explicitly 'true' does the controller dial, via
 *     the stubbed transport.
 *   - POST /:restaurantId/print-receipt: 400 without order_id; 404 for an
 *     order at another restaurant; builds the receipt from a read-only
 *     order snapshot without touching order/payment tables.
 *
 * The scope-model ownership gate is stubbed (its own suite covers the real
 * gate); the transport layer is stubbed so no real printer is touched.
 * Printing never mutates the order: the order row is byte-identical
 * before and after a print.
 *
 * Run with e.g.
 *   RESTAURANT_PRINTER_TEST_DATABASE_URL=<loopback disposable db url> \
 *     npx jest __tests__/restaurantPrinterSettings.db.test.js
 * Without it, the DB describes skip (fail closed) instead of touching a DB.
 */
jest.unmock('pg');

const crypto = require('crypto');

// Disposable-database opt-in for this suite: a loopback Postgres whose
// database is one of the allowlisted throwaway names (the shared
// statement helper only allows credit_statement_test; this suite also
// runs against the franchise-track fr_t3 database). Anything else fails
// closed: the suite skips instead of touching a real database.
function isDisposablePrinterDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && ['/credit_statement_test', '/fr_t3'].includes(url.pathname);
  } catch { return false; }
}
const RAW_URL = process.env.RESTAURANT_PRINTER_TEST_DATABASE_URL || '';
if (RAW_URL && !isDisposablePrinterDb(RAW_URL)) {
  throw new Error('Printer DB tests require an explicit loopback disposable database');
}

const CAN_RUN_DB = isDisposablePrinterDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only a disposable loopback database', () => {
  expect(isDisposablePrinterDb(RAW_URL)).toBe(CAN_RUN_DB);
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
    const { rows: locationUniq } = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = 'restaurant_printer_settings'
        AND indexname = 'restaurant_printer_settings_restaurant_location_uniq'`
    );
    const { rows: legacyUniq } = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = 'restaurant_printer_settings'
        AND indexname = 'restaurant_printer_settings_legacy_restaurant_uniq'`
    );
    expect(locationUniq.length).toBe(1);
    expect(legacyUniq.length).toBe(1);
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
    // S-08: the mocked access row mirrors the real gate's shape — the
    // permission resolver needs business_id + effective_membership_id.
    resolveRestaurantAccess.mockResolvedValue({ id: fx.restaurantId, business_id: fx.businessId, effective_membership_id: null, effective_role: 'owner', display_name: 'Printer Diner', phone: '555-0100' });
  }
  function staffAccess() {
    resolveRestaurantAccess.mockResolvedValue({ id: fx.restaurantId, business_id: fx.businessId, effective_membership_id: null, effective_role: 'staff', display_name: 'Printer Diner' });
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
    const { rows: audits } = await pool.query(
      `SELECT action, target_type, before_state, after_state
         FROM business_audit_log
        WHERE business_id = $1 AND action = 'restaurant.printer_settings.updated'
        ORDER BY id ASC`,
      [fx.businessId]
    );
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits.at(-1).target_type).toBe('restaurant_printer_settings');
    expect(audits.at(-1).before_state.enabled).toBe(true);
    expect(audits.at(-1).after_state.enabled).toBe(false);
  });

  test('keeps printer settings isolated between stores', async () => {
    const { rows: stores } = await pool.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, is_primary, status)
       VALUES ($1, 'Main store', TRUE, 'active'), ($1, 'Second store', FALSE, 'active')
       RETURNING id, name`,
      [fx.restaurantId]
    );
    stores.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    ownerAccess();
    const first = mockRes();
    await controller.updatePrinterSettings(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { locationId: stores[0].id, enabled: true, host: '192.168.1.51', port: 9100 } }),
      first,
      jest.fn()
    );
    const second = mockRes();
    await controller.updatePrinterSettings(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { locationId: stores[1].id, enabled: true, host: '192.168.1.52', port: 9100 } }),
      second,
      jest.fn()
    );
    expect(first.payload.settings.locationId).toBe(Number(stores[0].id));
    expect(second.payload.settings.locationId).toBe(Number(stores[1].id));

    const readFirst = mockRes();
    await controller.getPrinterSettings(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { locationId: stores[0].id } }),
      readFirst,
      jest.fn()
    );
    const readSecond = mockRes();
    await controller.getPrinterSettings(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { locationId: stores[1].id } }),
      readSecond,
      jest.fn()
    );
    expect(readFirst.payload.settings.host).toBe('192.168.1.51');
    expect(readSecond.payload.settings.host).toBe('192.168.1.52');
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

  async function jobsFor(restaurantId) {
    const { rows } = await pool.query(
      'SELECT * FROM restaurant_printer_jobs WHERE restaurant_id = $1 ORDER BY id ASC',
      [restaurantId]
    );
    return rows;
  }
  function jobBytes(job) {
    return Buffer.from(job.payload.escpos_base64, 'base64');
  }

  test('print-test queues a test page job when enabled and opens no socket', async () => {
    await enablePrinting();
    const before = await jobsFor(fx.restaurantId);
    const net = require('net');
    const connectSpy = jest.spyOn(net.Socket.prototype, 'connect');
    const res = mockRes();
    try {
      await controller.printTestPage(mockReq({ params: { restaurantId: String(fx.restaurantId) }, user: { id: fx.userId } }), res, jest.fn());
    } finally {
      expect(connectSpy).not.toHaveBeenCalled();
      connectSpy.mockRestore();
    }
    // F-05: the API server never dials the printer on the default path.
    expect(sentBuffers.length).toBe(0);
    expect(res.statusCode).toBe(202);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.queued).toBe(true);
    expect(res.payload.jobStatus).toBe('queued');

    const jobs = await jobsFor(fx.restaurantId);
    expect(jobs.length).toBe(before.length + 1);
    const job = jobs[jobs.length - 1];
    expect(Number(job.id)).toBe(Number(res.payload.jobId));
    expect(job.job_type).toBe('receipt');
    expect(job.food_order_id).toBeNull();
    expect(job.payload.kind).toBe('test_page');
    expect(job.payload.printer).toEqual({ host: '192.168.1.50', port: 9100 });
    const text = jobBytes(job).toString('latin1');
    expect(text).toContain('Printer Diner');
    // Test page never kicks the drawer.
    expect(jobBytes(job).includes(Buffer.from([0x1b, 0x70]))).toBe(false);
  });

  test('print endpoints refuse non-managers', async () => {
    await enablePrinting();
    const orderId = await newOrder(fx.restaurantId, fx.businessId);
    staffAccess();
    const before = await jobsFor(fx.restaurantId);

    const next1 = jest.fn();
    await controller.printTestPage(mockReq({ params: { restaurantId: String(fx.restaurantId) }, user: { id: fx.userId } }), mockRes(), next1);
    expect(next1).toHaveBeenCalled();
    expect(next1.mock.calls[0][0].statusCode).toBe(403);

    const next2 = jest.fn();
    await controller.printReceipt(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { order_id: orderId }, user: { id: fx.userId } }),
      mockRes(),
      next2
    );
    expect(next2).toHaveBeenCalled();
    expect(next2.mock.calls[0][0].statusCode).toBe(403);

    expect(sentBuffers.length).toBe(0);
    const after = await jobsFor(fx.restaurantId);
    expect(after.length).toBe(before.length);
  });

  test('with RESTAURANT_SERVER_PRINTING_ENABLED=true the controller dials and queues nothing', async () => {
    await enablePrinting();
    const before = await jobsFor(fx.restaurantId);
    process.env.RESTAURANT_SERVER_PRINTING_ENABLED = 'true';
    try {
      const res = mockRes();
      await controller.printTestPage(mockReq({ params: { restaurantId: String(fx.restaurantId) }, user: { id: fx.userId } }), res, jest.fn());
      expect(res.payload).toEqual({ ok: true, error: null });
    } finally {
      delete process.env.RESTAURANT_SERVER_PRINTING_ENABLED;
    }
    expect(sentBuffers.length).toBe(1);
    expect(sentBuffers[0].host).toBe('192.168.1.50');
    expect(sentBuffers[0].port).toBe(9100);
    const after = await jobsFor(fx.restaurantId);
    expect(after.length).toBe(before.length);
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

  test('print-receipt queues a receipt job from a read-only snapshot and never mutates the order', async () => {
    await enablePrinting();
    const orderId = await newOrder(fx.restaurantId, fx.businessId);
    const before = await orderRowJson(orderId);

    const res = mockRes();
    await controller.printReceipt(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { order_id: orderId }, user: { id: fx.userId } }),
      res,
      jest.fn()
    );
    expect(res.statusCode).toBe(202);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.queued).toBe(true);
    expect(res.payload.jobStatus).toBe('queued');
    expect(res.payload.orderId).toBe(Number(orderId));
    // Nothing was dialed: the job waits for a paired in-store device.
    expect(sentBuffers.length).toBe(0);

    const jobs = await jobsFor(fx.restaurantId);
    const job = jobs[jobs.length - 1];
    expect(Number(job.id)).toBe(Number(res.payload.jobId));
    expect(job.job_type).toBe('receipt');
    expect(Number(job.food_order_id)).toBe(Number(orderId));
    expect(job.payload.kind).toBe('receipt');

    const text = jobBytes(job).toString('latin1');
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

  test('queued receipt kicks the drawer only for cash payments when the setting is on', async () => {
    await enablePrinting({ drawerKickOnCash: true });
    const orderId = await newOrder(fx.restaurantId, fx.businessId);
    await pool.query(
      `INSERT INTO restaurant_pos_payments (restaurant_id, food_order_id, payment_type, amount_cents, status)
       VALUES ($1, $2, 'cash', 972, 'recorded')`,
      [fx.restaurantId, orderId]
    );
    await controller.printReceipt(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { order_id: orderId }, user: { id: fx.userId } }),
      mockRes(),
      jest.fn()
    );
    let jobs = await jobsFor(fx.restaurantId);
    expect(jobBytes(jobs[jobs.length - 1]).includes(Buffer.from([0x1b, 0x70]))).toBe(true); // ESC p drawer kick present
    expect(jobs[jobs.length - 1].payload.kick_drawer).toBe(true);

    // Card-only payment: no kick even with the setting on.
    const cardOrder = await newOrder(fx.restaurantId, fx.businessId);
    await pool.query(
      `INSERT INTO restaurant_pos_payments (restaurant_id, food_order_id, payment_type, amount_cents, status)
       VALUES ($1, $2, 'card', 972, 'captured')`,
      [fx.restaurantId, cardOrder]
    );
    await controller.printReceipt(
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, body: { order_id: cardOrder }, user: { id: fx.userId } }),
      mockRes(),
      jest.fn()
    );
    jobs = await jobsFor(fx.restaurantId);
    expect(jobBytes(jobs[jobs.length - 1]).includes(Buffer.from([0x1b, 0x70]))).toBe(false);
    expect(jobs[jobs.length - 1].payload.kick_drawer).toBe(false);
  });
});
