'use strict';

/**
 * DB tests: course-level hold/fire controls and seat-level ticket splits.
 *
 * Runs against the real migrated schema (credit_statement_test) so the
 * kitchen_status transitions, course chit printer jobs, seat-split ticket
 * accounting, and idempotency replay are proven on production SQL.
 *
 * Honors STATEMENT_TEST_DATABASE_URL (or RESTAURANT_COURSE_TEST_DATABASE_URL);
 * skipped when absent so the default unit suite never needs a database.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');

const { disposableDatabaseOptIn, isDisposableDatabase } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('RESTAURANT_COURSE_TEST_DATABASE_URL');

const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = 'test-secret-for-course-actions';
}

const pool = require('../db');
const appFlow = require('../controllers/restaurantAppFlowController');

function uid() {
  return crypto.randomUUID();
}

async function newUser() {
  const id = uid();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Course', 'Fixture', 'customer', TRUE, TRUE)`,
    [id, `course-${id}@example.invalid`]
  );
  return id;
}

async function newBusiness(ownerId) {
  const { rows: [b] } = await pool.query(
    'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
    [ownerId, `Course Biz ${uid().slice(0, 8)}`]
  );
  return b.id;
}

async function newRestaurant(businessId, ownerId) {
  const { rows: [r] } = await pool.query(
    `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone)
     VALUES ($1, $2, $3, 'America/New_York') RETURNING id`,
    [businessId, ownerId, `Course Diner ${uid().slice(0, 8)}`]
  );
  // A trigger auto-creates the restaurant's primary store on insert.
  const { rows: [loc] } = await pool.query(
    `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = TRUE LIMIT 1`,
    [r.id]
  );
  return { id: r.id, locationId: loc.id };
}

let queueCounter = 5000;
async function newOrder(restaurantId, businessId, locationId, { status = 'accepted', paymentStatus = 'unpaid' } = {}) {
  const { rows: [o] } = await pool.query(
    `INSERT INTO food_orders
       (restaurant_id, business_id, location_id, status, payment_status, queue_number, table_label)
     VALUES ($1, $2, $3, $4, $5, $6, 'T-7') RETURNING id`,
    [restaurantId, businessId, locationId, status, paymentStatus, queueCounter++]
  );
  return o.id;
}

async function addItem(orderId, { name = 'Item', qty = 1, unitCents = 1000, course = 1, seat = null, kitchenStatus = 'queued', station = null } = {}) {
  const { rows: [item] } = await pool.query(
    `INSERT INTO food_order_items
       (order_id, item_name, quantity, unit_price_cents, modifier_total_cents, line_total_cents,
        course_number, seat_number, kitchen_status, station_label)
     VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9) RETURNING *`,
    [orderId, name, qty, unitCents, unitCents * qty, course, seat, kitchenStatus, station]
  );
  return item;
}

function invoke(handler, { params = {}, body = {}, user, headers = {} } = {}) {
  const req = {
    params,
    body,
    user,
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    get(name) { return this.headers[String(name).toLowerCase()]; },
  };
  const res = { statusCode: 200 };
  return new Promise((resolve, reject) => {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (value) => resolve({ status: res.statusCode, body: value });
    Promise.resolve(handler(req, res, (err) => resolve({ error: err }))).catch(reject);
  });
}

async function itemStatuses(orderId) {
  const { rows } = await pool.query(
    `SELECT id, course_number, seat_number, kitchen_status FROM food_order_items WHERE order_id = $1 ORDER BY id`,
    [orderId]
  );
  return rows;
}

async function courseEvents(orderId) {
  const { rows } = await pool.query(
    `SELECT event_type, to_status, metadata FROM restaurant_kitchen_events
      WHERE food_order_id = $1 AND event_type LIKE 'course\\_%' ORDER BY id`,
    [orderId]
  );
  return rows;
}

async function printerJobs(orderId) {
  const { rows } = await pool.query(
    `SELECT job_type, payload FROM restaurant_printer_jobs WHERE food_order_id = $1 ORDER BY id`,
    [orderId]
  );
  return rows;
}

let ownerId;
let businessId;
let restaurantId;
let locationId;

ddescribe('course hold/fire controls', () => {
  beforeAll(async () => {
    ownerId = await newUser();
    businessId = await newBusiness(ownerId);
    ({ id: restaurantId, locationId } = await newRestaurant(businessId, ownerId));
  });

  test('hold parks a whole course and prints a HOLD chit; fire releases it with a FIRE chit', async () => {
    const orderId = await newOrder(restaurantId, businessId, locationId);
    await addItem(orderId, { name: 'Salad', course: 1, seat: 1 });
    await addItem(orderId, { name: 'Steak', course: 2, seat: 1, station: 'GRILL' });
    await addItem(orderId, { name: 'Fish', course: 2, seat: 2, station: 'GRILL' });

    const hold = await invoke(appFlow.performKitchenCourseAction, {
      params: { restaurantId: String(restaurantId), orderId: String(orderId), courseNumber: '2' },
      body: { action: 'hold', reason: 'waiting on mains' },
      user: { id: ownerId },
    });
    expect(hold.error).toBeUndefined();
    expect(hold.status).toBe(201);
    expect(hold.body.action).toBe('hold');
    expect(hold.body.courseNumber).toBe(2);
    expect(hold.body.items).toHaveLength(2);
    expect(hold.body.event.event_type).toBe('course_hold');
    expect(hold.body.printerJobs).toHaveLength(1);

    const held = await itemStatuses(orderId);
    expect(held.find((i) => i.course_number === 1).kitchen_status).toBe('queued');
    expect(held.filter((i) => i.course_number === 2).map((i) => i.kitchen_status)).toEqual(['held', 'held']);

    const chits = await printerJobs(orderId);
    expect(chits).toHaveLength(1);
    expect(chits[0].job_type).toBe('kitchen_ticket');
    const payload = typeof chits[0].payload === 'string' ? JSON.parse(chits[0].payload) : chits[0].payload;
    expect(payload.stationName).toContain('COURSE 2');
    expect(payload.stationName).toContain('HOLD');
    expect(payload.items.map((i) => i.name).sort()).toEqual(['Fish', 'Steak']);

    const fire = await invoke(appFlow.performKitchenCourseAction, {
      params: { restaurantId: String(restaurantId), orderId: String(orderId), courseNumber: '2' },
      body: { action: 'fire' },
      user: { id: ownerId },
    });
    expect(fire.error).toBeUndefined();
    expect(fire.status).toBe(201);
    expect(fire.body.event.event_type).toBe('course_fire');

    const fired = await itemStatuses(orderId);
    expect(fired.filter((i) => i.course_number === 2).map((i) => i.kitchen_status)).toEqual(['queued', 'queued']);
    const allChits = await printerJobs(orderId);
    expect(allChits).toHaveLength(2);
    const firePayload = typeof allChits[1].payload === 'string' ? JSON.parse(allChits[1].payload) : allChits[1].payload;
    expect(firePayload.stationName).toContain('FIRE');

    const events = await courseEvents(orderId);
    expect(events.map((e) => e.event_type)).toEqual(['course_hold', 'course_fire']);
    expect(events[0].metadata.itemIds).toHaveLength(2);
  });

  test('fire fails closed when nothing in the course is held', async () => {
    const orderId = await newOrder(restaurantId, businessId, locationId);
    await addItem(orderId, { name: 'Soup', course: 1 });
    const result = await invoke(appFlow.performKitchenCourseAction, {
      params: { restaurantId: String(restaurantId), orderId: String(orderId), courseNumber: '1' },
      body: { action: 'fire' },
      user: { id: ownerId },
    });
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe('course_action_not_allowed');
    expect(result.error.statusCode).toBe(409);
    expect((await courseEvents(orderId))).toHaveLength(0);
    expect((await printerJobs(orderId))).toHaveLength(0);
  });

  test('unknown course is a 404 and terminal orders are rejected', async () => {
    const orderId = await newOrder(restaurantId, businessId, locationId);
    await addItem(orderId, { name: 'Soup', course: 1 });
    const missing = await invoke(appFlow.performKitchenCourseAction, {
      params: { restaurantId: String(restaurantId), orderId: String(orderId), courseNumber: '9' },
      body: { action: 'hold' },
      user: { id: ownerId },
    });
    expect(missing.error?.code).toBe('kitchen_course_not_found');

    const doneId = await newOrder(restaurantId, businessId, locationId, { status: 'completed', paymentStatus: 'paid' });
    await addItem(doneId, { name: 'Soup', course: 1 });
    const terminal = await invoke(appFlow.performKitchenCourseAction, {
      params: { restaurantId: String(restaurantId), orderId: String(doneId), courseNumber: '1' },
      body: { action: 'hold' },
      user: { id: ownerId },
    });
    expect(terminal.error?.code).toBe('kitchen_order_terminal');
  });

  test('idempotency key replays without duplicating the event or chit', async () => {
    const orderId = await newOrder(restaurantId, businessId, locationId);
    await addItem(orderId, { name: 'Pasta', course: 2 });
    const key = `course-hold-${uid()}`;
    const first = await invoke(appFlow.performKitchenCourseAction, {
      params: { restaurantId: String(restaurantId), orderId: String(orderId), courseNumber: '2' },
      body: { action: 'hold' },
      user: { id: ownerId },
      headers: { 'idempotency-key': key },
    });
    expect(first.error).toBeUndefined();
    expect(first.body.replayed).toBe(false);
    const second = await invoke(appFlow.performKitchenCourseAction, {
      params: { restaurantId: String(restaurantId), orderId: String(orderId), courseNumber: '2' },
      body: { action: 'hold' },
      user: { id: ownerId },
      headers: { 'idempotency-key': key },
    });
    expect(second.error).toBeUndefined();
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect((await courseEvents(orderId))).toHaveLength(1);
    expect((await printerJobs(orderId))).toHaveLength(1);
  });

  test('hold rejects an unsupported action', async () => {
    const orderId = await newOrder(restaurantId, businessId, locationId);
    await addItem(orderId, { name: 'Pasta', course: 1 });
    const result = await invoke(appFlow.performKitchenCourseAction, {
      params: { restaurantId: String(restaurantId), orderId: String(orderId), courseNumber: '1' },
      body: { action: 'flambe' },
      user: { id: ownerId },
    });
    expect(result.error?.statusCode).toBe(400);
  });
});

ddescribe('seat-level ticket splits', () => {
  test('split by seat moves whole seat lines to a new ticket and reconciles totals', async () => {
    const orderId = await newOrder(restaurantId, businessId, locationId);
    await addItem(orderId, { name: 'Burger', qty: 1, unitCents: 1200, course: 1, seat: 1 });
    await addItem(orderId, { name: 'Fries', qty: 2, unitCents: 400, course: 1, seat: 1 });
    await addItem(orderId, { name: 'Salad', qty: 1, unitCents: 900, course: 1, seat: 2 });
    await addItem(orderId, { name: 'Soda', qty: 1, unitCents: 300, course: 1, seat: 3 });

    const result = await invoke(appFlow.splitPosOrder, {
      params: { restaurantId: String(restaurantId), orderId: String(orderId) },
      body: { seatNumbers: [2, 3] },
      user: { id: ownerId },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(201);
    const childId = result.body.splitOrder.id;
    expect(childId).not.toBe(orderId);
    expect(result.body.splitOrder.metadata.splitSeats).toEqual([2, 3]);

    const sourceItems = await itemStatuses(orderId);
    const childItems = await itemStatuses(childId);
    expect(sourceItems.map((i) => i.seat_number)).toEqual([1, 1]);
    expect(childItems.map((i) => i.seat_number).sort()).toEqual([2, 3]);
    // Course numbers travel with the lines.
    expect(childItems.every((i) => i.course_number === 1)).toBe(true);

    const { rows: [source] } = await pool.query('SELECT subtotal_cents, total_cents FROM food_orders WHERE id = $1', [orderId]);
    const { rows: [child] } = await pool.query('SELECT subtotal_cents, total_cents FROM food_orders WHERE id = $1', [childId]);
    expect(Number(source.subtotal_cents)).toBe(2000);
    expect(Number(child.subtotal_cents)).toBe(1200);
    expect(Number(source.total_cents) + Number(child.total_cents)).toBe(3200);
    // The child stays in the source ticket's store.
    const { rows: [childLoc] } = await pool.query('SELECT location_id FROM food_orders WHERE id = $1', [childId]);
    expect(Number(childLoc.location_id)).toBe(Number(locationId));
  });

  test('seat split fails closed when the ticket has no seat assignments', async () => {
    const orderId = await newOrder(restaurantId, businessId, locationId);
    await addItem(orderId, { name: 'Burger', qty: 1, unitCents: 1200, seat: null });
    const result = await invoke(appFlow.splitPosOrder, {
      params: { restaurantId: String(restaurantId), orderId: String(orderId) },
      body: { seatNumber: 1 },
      user: { id: ownerId },
    });
    expect(result.error?.code).toBe('seat_split_unavailable');
    expect(result.error?.statusCode).toBe(409);
  });

  test('seat split rejects unknown seats and mixed modes', async () => {
    const orderId = await newOrder(restaurantId, businessId, locationId);
    const item = await addItem(orderId, { name: 'Burger', qty: 1, unitCents: 1200, seat: 1 });
    const unknown = await invoke(appFlow.splitPosOrder, {
      params: { restaurantId: String(restaurantId), orderId: String(orderId) },
      body: { seatNumbers: [7] },
      user: { id: ownerId },
    });
    expect(unknown.error?.statusCode).toBe(400);
    const mixed = await invoke(appFlow.splitPosOrder, {
      params: { restaurantId: String(restaurantId), orderId: String(orderId) },
      body: { seatNumbers: [1], orderItemIds: [item.id] },
      user: { id: ownerId },
    });
    expect(mixed.error?.statusCode).toBe(400);
    // Nothing moved.
    expect((await itemStatuses(orderId))).toHaveLength(1);
  });

  test('seat split cannot empty the source ticket', async () => {
    const orderId = await newOrder(restaurantId, businessId, locationId);
    await addItem(orderId, { name: 'Burger', qty: 1, unitCents: 1200, seat: 1 });
    const result = await invoke(appFlow.splitPosOrder, {
      params: { restaurantId: String(restaurantId), orderId: String(orderId) },
      body: { seatNumber: 1 },
      user: { id: ownerId },
    });
    expect(result.error?.code).toBe('split_would_empty_ticket');
  });
});
