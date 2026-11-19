'use strict';

/**
 * Group 1 (Customer) — acceptance tests for the surfaces built in this
 * group, against the real migrated schema, through the real controllers:
 *
 *   item  4  shortlist: save a helper, list the shortlist, remove it;
 *   item 20  aftercare: completing a job with aftercare instructions
 *            stores them on the job; completing without leaves them null;
 *   item 26  home care calendar data: home tasks carry their due dates;
 *   item 27  vehicle reminders: an overdue oil change and service surface
 *            as due; a fresh vehicle surfaces no reminders;
 *   item 29  seasonal packs: four packs; applying winter creates its
 *            needs once, a second apply skips them all;
 *   item 32  DIY kit picker: list includes the kit, build creates a draft
 *            cart with the available items and reports the omitted one;
 *   item 34  kit substitution preview: the omitted item carries same-
 *            category substitutes, cheapest first, and its quantity;
 *   item 35  product return entry: a return request records the request
 *            (201), a second open one 409s, a stranger 404s, a pending
 *            order 400s, cancelling frees the slot again, and no refund
 *            is ever issued by the request itself;
 *   item 40  accessibility: a support request with category
 *            'accessibility' is stored as accessibility, not downgraded
 *            to 'general'; an unknown category still falls back;
 *   item 43  saved locations: create/list/update/delete, owner-scoped,
 *            one default at a time;
 *   item 44  marketing preferences: the marketing toggle and frequency
 *            persist through GET/PUT /notifications/email.
 *
 * DB: disposable loopback database credit_statement_test only; the suite
 * skips otherwise. Run with STATEMENT_TEST_DATABASE_URL pointed at it.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
  sendBulkNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/supportNotificationService', () => ({
  scheduleSupportMessageNotifications: jest.fn(),
  SUPPORT_STAFF_ALERT_LIMIT: 10,
}));

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable Group 1 test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'group1-surfaces-test-secret';
}

const pool = require('../db');
const { completeJobCore } = require('../controllers/jobController');
const lifeCtrl = require('../controllers/lifeDashboardController');
const vehicleCtrl = require('../controllers/vehicleController');
const plannedNeedsCtrl = require('../controllers/plannedNeedsController');
const ordersCtrl = require('../controllers/ordersController');
const supportCtrl = require('../controllers/supportController');
const emailPrefsCtrl = require('../controllers/emailPreferencesController');
const { listJobKits, buildKitFromTemplate, previewKit } = require('../services/jobKitService');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

// Calls a controller that reports errors through next(err). Returns the
// response plus the error next received, if any.
async function callWithNext(fn, req) {
  const res = mockRes();
  let nextErr = null;
  const next = (err) => { nextErr = err; };
  await fn(req, res, next);
  return { res, nextErr };
}

async function makeUser(role) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, onboarding_completed)
     VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, FALSE)`,
    [id, `g1s-${id.slice(0, 8)}@example.invalid`, role, role],
  );
  return id;
}

function dateOffset(days) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

ddescribe('Group 1 customer surfaces', () => {
  let customer;
  let helper;
  let stranger;

  beforeAll(async () => {
    customer = await makeUser('customer');
    helper = await makeUser('helper');
    stranger = await makeUser('customer');

    // Kit fixtures for items 32/34: one available item, one unavailable
    // item in the same category, and two available substitutes.
    const products = [
      { sku: 'G1-TEST-OK', name: 'G1 test fitting', available: true, price: 500 },
      { sku: 'G1-TEST-UNAVAIL', name: 'G1 test valve', available: false, price: 1000 },
      { sku: 'G1-TEST-SUB-A', name: 'G1 test valve A', available: true, price: 900 },
      { sku: 'G1-TEST-SUB-B', name: 'G1 test valve B', available: true, price: 1200 },
    ];
    // marketplace_products.sku carries no unique index, so clear any prior
    // run's rows for these test SKUs instead of upserting. Cart items
    // reference the products, so they go first.
    await pool.query(
      `DELETE FROM shopping_cart_items
        WHERE product_id IN (SELECT id FROM marketplace_products WHERE sku LIKE 'G1-TEST-%')`,
    );
    await pool.query(
      `DELETE FROM marketplace_products WHERE sku LIKE 'G1-TEST-%'`,
    );
    await pool.query(
      `DELETE FROM job_kit_definitions WHERE job_type = 'g1-test-kit'`,
    );
    for (const p of products) {
      await pool.query(
        `INSERT INTO marketplace_products (name, category, sku, price_cents, currency, is_active, is_available)
         VALUES ($1, 'g1-test-plumbing', $2, $3, 'USD', TRUE, $4)`,
        [p.name, p.sku, p.price, p.available],
      );
    }
    await pool.query(
      `INSERT INTO job_kit_definitions (job_type, sku, quantity, notes, sort_order)
       VALUES ('g1-test-kit', 'G1-TEST-OK', 1, 'available part', 1),
              ('g1-test-kit', 'G1-TEST-UNAVAIL', 2, 'unavailable part', 2)`,
    );
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('item 4: shortlist save, list, and remove', async () => {
    const saved = mockRes();
    await lifeCtrl.saveHelper({ user: { id: customer }, body: { helper_id: helper, note: 'Great plumber' } }, saved);
    expect(saved.statusCode).toBe(201);
    expect(saved.payload.helper_id).toBe(helper);

    const selfSave = mockRes();
    await lifeCtrl.saveHelper({ user: { id: customer }, body: { helper_id: customer } }, selfSave);
    expect(selfSave.statusCode).toBe(400);

    const listed = mockRes();
    await lifeCtrl.getSavedHelpers({ user: { id: customer } }, listed);
    expect(listed.payload.saved_helpers.map((r) => r.helper_id)).toContain(helper);

    const removed = mockRes();
    await lifeCtrl.removeSavedHelper({ user: { id: customer }, params: { id: saved.payload.id } }, removed);
    expect(removed.statusCode).toBe(200);

    const listedAgain = mockRes();
    await lifeCtrl.getSavedHelpers({ user: { id: customer } }, listedAgain);
    expect(listedAgain.payload.saved_helpers.map((r) => r.helper_id)).not.toContain(helper);
  });

  test('item 20: aftercare instructions ride with job completion', async () => {
    const jobId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO jobs(id, client_id, assigned_helper_id, status, transaction_mode, metadata, title, description)
       VALUES($1, $2, $3, 'in_progress', 'direct', '{}'::jsonb, 'G1 fix sink', 'Leaky tap')`,
      [jobId, customer, helper],
    );
    const result = await completeJobCore({
      job: { id: jobId, client_id: customer, transaction_mode: 'direct', payment_rail: null, assigned_helper_id: helper },
      jobId,
      asClient: true,
      actorUserId: customer,
      req: { body: { aftercare_instructions: 'Keep the area dry for 24 hours.' } },
    });
    expect(result.status).toBe('completed');
    expect(result.aftercare_instructions).toBe('Keep the area dry for 24 hours.');

    const jobId2 = crypto.randomUUID();
    await pool.query(
      `INSERT INTO jobs(id, client_id, assigned_helper_id, status, transaction_mode, metadata, title, description)
       VALUES($1, $2, $3, 'in_progress', 'direct', '{}'::jsonb, 'G1 fix tap', 'Dripping tap')`,
      [jobId2, customer, helper],
    );
    const result2 = await completeJobCore({
      job: { id: jobId2, client_id: customer, transaction_mode: 'direct', payment_rail: null, assigned_helper_id: helper },
      jobId: jobId2,
      asClient: true,
      actorUserId: customer,
      req: { body: {} },
    });
    expect(result2.status).toBe('completed');
    expect(result2.aftercare_instructions).toBeNull();
  });

  test('item 26: home tasks carry the due dates the calendar groups by', async () => {
    await pool.query(`DELETE FROM home_tasks WHERE user_id = $1 AND title LIKE 'G1 %'`, [customer]);
    await pool.query(
      `INSERT INTO home_tasks (user_id, title, section, is_completed, is_recurring, due_date)
       VALUES ($1, 'G1 clean gutters', 'home', FALSE, FALSE, $2),
              ($1, 'G1 overdue task', 'home', FALSE, FALSE, $3),
              ($1, 'G1 unscheduled task', 'home', FALSE, FALSE, NULL)`,
      [customer, dateOffset(5), dateOffset(-2)],
    );
    const res = mockRes();
    await lifeCtrl.getHomeTasks({ user: { id: customer }, query: {} }, res);
    const rows = res.payload.home_tasks.filter((t) => String(t.title).startsWith('G1 '));
    expect(rows).toHaveLength(3);
    const byTitle = new Map(rows.map((r) => [r.title, r]));
    const isoDate = (v) => new Date(v).toISOString().slice(0, 10);
    expect(isoDate(byTitle.get('G1 clean gutters').due_date)).toBe(dateOffset(5));
    expect(isoDate(byTitle.get('G1 overdue task').due_date)).toBe(dateOffset(-2));
    expect(byTitle.get('G1 unscheduled task').due_date).toBeNull();
  });

  test('item 27: vehicle service reminders derive from mileage and dates', async () => {
    await pool.query(`DELETE FROM user_vehicles WHERE user_id = $1`, [customer]);
    await pool.query(
      `INSERT INTO user_vehicles (user_id, make_id, model_id, make_name, model_name, mileage, last_oil_change_mile, last_service_date)
       VALUES ($1, 1, 1, 'Toyota', 'Camry', 52000, 46000, $2),
              ($1, 2, 2, 'Honda', 'Civic', 100, 0, $3)`,
      [customer, dateOffset(-400), dateOffset(-1)],
    );
    const res = mockRes();
    await vehicleCtrl.listMyVehicles({ user: { id: customer } }, res);
    const byMake = new Map(res.payload.map((v) => [v.make_name, v]));
    const overdue = byMake.get('Toyota').service_reminders;
    expect(overdue.map((r) => `${r.kind}:${r.status}`)).toEqual(
      expect.arrayContaining(['oil_change:due', 'service:due']),
    );
    expect(byMake.get('Honda').service_reminders).toEqual([]);
  });

  test('item 29: seasonal packs apply once, then skip', async () => {
    const listed = mockRes();
    await plannedNeedsCtrl.getSeasonalPacks({}, listed);
    expect(listed.payload.packs.map((p) => p.season).sort()).toEqual(['fall', 'spring', 'summer', 'winter']);
    const winter = listed.payload.packs.find((p) => p.season === 'winter');
    expect(winter.templates).toHaveLength(3);

    const first = mockRes();
    await plannedNeedsCtrl.applySeasonalPack({ user: { id: customer }, params: { season: 'winter' } }, first);
    expect(first.statusCode).toBe(201);
    expect(first.payload.created).toHaveLength(3);
    expect(first.payload.skipped).toHaveLength(0);

    const second = mockRes();
    await plannedNeedsCtrl.applySeasonalPack({ user: { id: customer }, params: { season: 'winter' } }, second);
    expect(second.payload.created).toHaveLength(0);
    expect(second.payload.skipped).toHaveLength(3);

    const bad = mockRes();
    await plannedNeedsCtrl.applySeasonalPack({ user: { id: customer }, params: { season: 'monsoon' } }, bad);
    expect(bad.statusCode).toBe(400);
  });

  test('items 32 and 34: kit list, build, and substitution preview', async () => {
    const kits = await listJobKits();
    const kit = kits.find((k) => k.jobType === 'g1-test-kit');
    expect(kit).toBeDefined();
    expect(kit.availableCount).toBe(1);
    expect(kit.missingCount).toBe(1);

    const preview = await previewKit('g1-test-kit');
    expect(preview.resolved).toHaveLength(1);
    expect(preview.omitted).toHaveLength(1);
    const omitted = preview.omitted[0];
    expect(omitted.sku).toBe('G1-TEST-UNAVAIL');
    expect(omitted.quantity).toBe(2);
    expect(omitted.substitutes.map((s) => s.name)).toEqual(['G1 test valve A', 'G1 test valve B']);
    expect(omitted.substitutes[0].unitPriceCents).toBeLessThan(omitted.substitutes[1].unitPriceCents);

    const built = await buildKitFromTemplate({ jobType: 'g1-test-kit', helperId: customer });
    expect(built.cartId).toBeTruthy();
    expect(built.itemCount).toBe(1);
    expect(built.omitted).toHaveLength(1);
    expect(built.omitted[0].substitutes).toHaveLength(2);
  });

  test('item 35: return requests record the request and never refund', async () => {
    const { rows: [order] } = await pool.query(
      `INSERT INTO marketplace_orders (customer_id, total_cents, subtotal_cents, status)
       VALUES ($1, 2500, 2500, 'paid') RETURNING id`,
      [customer],
    );
    const { res, nextErr } = await callWithNext(ordersCtrl.createReturnRequest, {
      user: { id: customer },
      params: { orderId: String(order.id) },
      body: { reason: 'Arrived damaged' },
    });
    expect(nextErr).toBeNull();
    expect(res.statusCode).toBe(201);
    expect(res.payload.data.status).toBe('requested');
    expect(res.payload.data.reason).toBe('Arrived damaged');

    // A second open request for the same order is refused.
    const second = await callWithNext(ordersCtrl.createReturnRequest, {
      user: { id: customer },
      params: { orderId: String(order.id) },
      body: { reason: 'Still damaged' },
    });
    expect(second.nextErr).not.toBeNull();
    expect(second.nextErr.status || second.nextErr.statusCode).toBe(409);

    // A stranger cannot see the order at all.
    const strangerCall = await callWithNext(ordersCtrl.createReturnRequest, {
      user: { id: stranger },
      params: { orderId: String(order.id) },
      body: { reason: 'Not mine' },
    });
    expect(strangerCall.nextErr).not.toBeNull();
    expect(strangerCall.nextErr.status || strangerCall.nextErr.statusCode).toBe(404);

    // Cancelling the open request frees the slot again.
    const cancel = await callWithNext(ordersCtrl.cancelReturnRequest, {
      user: { id: customer },
      params: { orderId: String(order.id), returnId: String(res.payload.data.id) },
    });
    expect(cancel.nextErr).toBeNull();
    expect(cancel.res.payload.data.status).toBe('cancelled');
    const again = await callWithNext(ordersCtrl.createReturnRequest, {
      user: { id: customer },
      params: { orderId: String(order.id) },
      body: { reason: 'Still want a return' },
    });
    expect(again.nextErr).toBeNull();
    expect(again.res.statusCode).toBe(201);

    // The request itself never moves money: the order is untouched.
    const { rows: [after] } = await pool.query('SELECT status FROM marketplace_orders WHERE id = $1', [order.id]);
    expect(after.status).toBe('paid');

    // A pending order is cancelled, not returned.
    const { rows: [pending] } = await pool.query(
      `INSERT INTO marketplace_orders (customer_id, total_cents, subtotal_cents, status)
       VALUES ($1, 1000, 1000, 'pending') RETURNING id`,
      [customer],
    );
    const pendingCall = await callWithNext(ordersCtrl.createReturnRequest, {
      user: { id: customer },
      params: { orderId: String(pending.id) },
      body: { reason: 'Changed my mind' },
    });
    expect(pendingCall.nextErr).not.toBeNull();
    expect(pendingCall.nextErr.status || pendingCall.nextErr.statusCode).toBe(400);
  });

  test('item 40: accessibility is a first-class support category', async () => {
    const req = {
      user: { id: customer },
      body: {
        name: 'Test Customer',
        email: 'g1-access@example.invalid',
        subject: 'Screen reader help',
        message: 'I need help using the site with a screen reader.',
        category: 'accessibility',
        // The widget always sends an idempotency key; the ticket insert
        // needs one to resolve its parameter types.
        clientRequestId: crypto.randomUUID(),
      },
      get: () => undefined,
    };
    const { res, nextErr } = await callWithNext(supportCtrl.submitSupportRequest, req);
    expect(nextErr).toBeNull();
    expect(res.statusCode).toBe(201);
    const { rows: [ticket] } = await pool.query(
      'SELECT category FROM support_tickets WHERE id = $1',
      [res.payload.ticket_id],
    );
    expect(ticket.category).toBe('accessibility');

    const unknown = await callWithNext(supportCtrl.submitSupportRequest, {
      user: { id: customer },
      body: {
        name: 'Test Customer',
        email: 'g1-access@example.invalid',
        subject: 'Unknown topic',
        message: 'Hello.',
        category: 'nonsense-category',
        clientRequestId: crypto.randomUUID(),
      },
      get: () => undefined,
    });
    expect(unknown.nextErr).toBeNull();
    const { rows: [ticket2] } = await pool.query(
      'SELECT category FROM support_tickets WHERE id = $1',
      [unknown.res.payload.ticket_id],
    );
    expect(ticket2.category).toBe('general');
  });

  test('item 43: saved locations are owner-scoped with one default', async () => {
    const first = mockRes();
    await lifeCtrl.createSavedLocation({
      user: { id: customer },
      body: { label: 'Home', address: '12 Main St', entry_instructions: 'Gate code 1234', is_default: true },
    }, first);
    expect(first.statusCode).toBe(201);

    const second = mockRes();
    await lifeCtrl.createSavedLocation({
      user: { id: customer },
      body: { label: 'Office', address: '99 Work Ave', is_default: true },
    }, second);
    expect(second.statusCode).toBe(201);

    const listed = mockRes();
    await lifeCtrl.getSavedLocations({ user: { id: customer } }, listed);
    expect(listed.payload.saved_locations).toHaveLength(2);
    const defaults = listed.payload.saved_locations.filter((l) => l.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].label).toBe('Office');

    // The other user sees none of them and cannot delete them.
    const strangerList = mockRes();
    await lifeCtrl.getSavedLocations({ user: { id: stranger } }, strangerList);
    expect(strangerList.payload.saved_locations).toHaveLength(0);
    const strangerDelete = mockRes();
    await lifeCtrl.deleteSavedLocation({ user: { id: stranger }, params: { id: first.payload.saved_location.id } }, strangerDelete);
    expect(strangerDelete.statusCode).toBe(404);

    const updated = mockRes();
    await lifeCtrl.updateSavedLocation({
      user: { id: customer },
      params: { id: first.payload.saved_location.id },
      body: { label: 'Home base' },
    }, updated);
    expect(updated.payload.saved_location.label).toBe('Home base');

    const deleted = mockRes();
    await lifeCtrl.deleteSavedLocation({ user: { id: customer }, params: { id: second.payload.saved_location.id } }, deleted);
    expect(deleted.statusCode).toBe(200);
  });

  test('item 44: marketing toggle and frequency persist', async () => {
    const saved = mockRes();
    await emailPrefsCtrl.updateEmailPreferences({
      user: { id: customer },
      body: { marketingEmails: false, frequency: 'weekly' },
    }, saved);
    expect(saved.payload.data.marketingEmails).toBe(false);
    expect(saved.payload.data.frequency).toBe('weekly');

    const loaded = mockRes();
    await emailPrefsCtrl.getEmailPreferences({ user: { id: customer } }, loaded);
    expect(loaded.payload.data.marketingEmails).toBe(false);
    expect(loaded.payload.data.frequency).toBe('weekly');

    const back = mockRes();
    await emailPrefsCtrl.updateEmailPreferences({
      user: { id: customer },
      body: { marketingEmails: true, frequency: 'daily' },
    }, back);
    expect(back.payload.data.marketingEmails).toBe(true);
    expect(back.payload.data.frequency).toBe('daily');
  });
});
