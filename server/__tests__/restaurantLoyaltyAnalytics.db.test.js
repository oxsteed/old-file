'use strict';

/**
 * DB tests: restaurant loyalty analytics (Analytics platform, Phase 2, Item 10).
 *
 * Covers the canonical computations in server/analytics/restaurantAnalytics.js:
 *   - getRepeatOrderRate: repeat_orders / total_identified_orders over the
 *     window; guest (customer_id NULL) orders excluded from numerator AND
 *     denominator; cancelled/refunded orders excluded; out-of-window orders
 *     excluded; NULL (not 0) when nothing is attributable.
 *   - getTopItemsByRevenue: revenue-ranked items from non-cancelled orders,
 *     cancelled order lines excluded.
 *
 * Also covers the thin loyaltySummary endpoint wiring (manager gate via the
 * canonical scope-model gate + response shape).
 *
 * Run with e.g.
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     npx jest __tests__/restaurantLoyaltyAnalytics.db.test.js
 * Without it, the DB describes skip (fail closed) instead of touching a DB.
 */
jest.unmock('pg');

const crypto = require('crypto');

const { disposableDatabaseOptIn, isDisposableDatabase, assertMigratedSchema } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('RESTAURANT_LOYALTY_TEST_DATABASE_URL');

const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = 'test-jwt-secret';
}

const pool = require('../db');
const { getRepeatOrderRate, getTopItemsByRevenue, getRetentionCohorts, REPEAT_ORDER_WINDOW_DAYS } = require('../analytics/restaurantAnalytics');

async function newUser() {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Loyalty', 'Fixture', 'customer', TRUE, TRUE)`,
    [id, `loyalty-${id}@example.invalid`]);
  return id;
}

async function newBusiness(ownerId) {
  const { rows: [b] } = await pool.query(
    'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
    [ownerId, `Loyalty Biz ${crypto.randomUUID().slice(0, 8)}`]);
  return b.id;
}

async function newRestaurant(businessId, ownerId) {
  const { rows: [r] } = await pool.query(
    'INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, $3) RETURNING id',
    [businessId, ownerId, `Loyalty Diner ${crypto.randomUUID().slice(0, 8)}`]);
  return r.id;
}

let queue = 1000;
async function newOrder(restaurantId, businessId, { customerId = null, status = 'completed', paymentStatus = 'paid', totalCents = 1000, daysAgo = 1 } = {}) {
  const created = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const { rows: [o] } = await pool.query(
    `INSERT INTO food_orders
       (restaurant_id, business_id, customer_id, status, total_cents, queue_number, created_at, payment_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [restaurantId, businessId, customerId, status, totalCents, queue++, created, paymentStatus]);
  return o.id;
}

async function addItem(orderId, { name, qty, unitCents, menuItemId = null }) {
  await pool.query(
    `INSERT INTO food_order_items
       (order_id, menu_item_id, item_name, quantity, unit_price_cents, line_total_cents)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [orderId, menuItemId, name, qty, unitCents, qty * unitCents]);
}

async function newMenuItem(restaurantId, name, priceCents) {
  const { rows: [m] } = await pool.query(
    `INSERT INTO food_menu_items (restaurant_id, name, price_cents)
     VALUES ($1, $2, $3) RETURNING id`,
    [restaurantId, name, priceCents]);
  return Number(m.id);
}

ddescribe('restaurant loyalty analytics', () => {
  let F = {};

  beforeAll(async () => {
    await assertMigratedSchema(pool);
    const owner = await newUser();
    const businessId = await newBusiness(owner);
    const restaurantId = await newRestaurant(businessId, owner);
    const custA = await newUser(); // 2 in-window orders -> repeat
    const custB = await newUser(); // 1 in-window order  -> one-timer
    const custC = await newUser(); // 1 completed + 1 cancelled -> one-timer
    F = { owner, businessId, restaurantId, custA, custB, custC };

    // In-window cohort.
    const a1 = await newOrder(restaurantId, businessId, { customerId: custA, totalCents: 2000, daysAgo: 5 });
    const a2 = await newOrder(restaurantId, businessId, { customerId: custA, totalCents: 3000, daysAgo: 40 });
    const b1 = await newOrder(restaurantId, businessId, { customerId: custB, totalCents: 1500, daysAgo: 10 });
    const c1 = await newOrder(restaurantId, businessId, { customerId: custC, totalCents: 1200, daysAgo: 3 });
    await newOrder(restaurantId, businessId, { customerId: custC, status: 'cancelled', totalCents: 9000, daysAgo: 2 });
    await newOrder(restaurantId, businessId, { customerId: null, totalCents: 5000, daysAgo: 6 });  // guest
    await newOrder(restaurantId, businessId, { customerId: null, totalCents: 7000, daysAgo: 20 }); // guest
    // Out of the 90-day window: must not count for A.
    await newOrder(restaurantId, businessId, { customerId: custA, totalCents: 99999, daysAgo: 120 });

    // Items: Burger wins on revenue; the cancelled order's Lobster must not count.
    const burgerItemId = await newMenuItem(restaurantId, 'Burger', 800);
    F.burgerItemId = burgerItemId;
    await addItem(a1, { name: 'Burger', qty: 2, unitCents: 800, menuItemId: burgerItemId });
    await addItem(a2, { name: 'Burger', qty: 1, unitCents: 800, menuItemId: burgerItemId });
    await addItem(b1, { name: 'Fries', qty: 3, unitCents: 300 });
    await addItem(c1, { name: 'Soda', qty: 1, unitCents: 200 });
    const cancelledOrder = await newOrder(restaurantId, businessId, { customerId: custB, status: 'cancelled', totalCents: 50000, daysAgo: 4 });
    await addItem(cancelledOrder, { name: 'Lobster', qty: 1, unitCents: 50000 });
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('unpaid orders contribute neither loyalty nor item revenue; acquisition cohorts remain paid-only', async () => {
    const guest = await newUser();
    const unpaid = await newOrder(F.restaurantId,F.businessId,{ customerId: guest, paymentStatus: 'unpaid' });
    await addItem(unpaid,{ name: 'Unpaid item', qty: 1, unitCents: 999999 });
    const window = { from: new Date(Date.now()-89*86400000).toISOString(), to: new Date().toISOString() };
    const repeat = await getRepeatOrderRate(pool,F.restaurantId,window);
    expect(repeat.total_identified_orders).toBe(4);
    expect((await getTopItemsByRevenue(pool,F.restaurantId,window)).some(row=>row.item_name==='Unpaid item')).toBe(false);
    const cohorts = await getRetentionCohorts(pool,F.restaurantId,window);
    expect(cohorts.length).toBeGreaterThan(0);
    expect(cohorts.filter(row=>row.month_index===0).every(row=>row.retention_rate===1)).toBe(true);
  });

  test('repeat rate = repeat-customer orders / identified orders; guests and cancelled excluded', async () => {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 89 * 86400000).toISOString();
    const r = await getRepeatOrderRate(pool, F.restaurantId, { from, to });
    // Identified: A(2) + B(1) + C(1) = 4. Repeat: A's 2. Guests (2) excluded.
    // The 120-day-old A order is outside the window; C's cancelled order excluded.
    expect(r.total_identified_orders).toBe(4);
    expect(r.repeat_orders).toBe(2);
    expect(r.repeat_customers).toBe(1);
    expect(r.guest_orders_excluded).toBe(2);
    expect(r.repeat_order_rate).toBeCloseTo(2 / 4, 10);
  });

  test('repeat rate is NULL (not 0) when no orders are attributable', async () => {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 89 * 86400000).toISOString();
    const owner2 = await newUser();
    const biz2 = await newBusiness(owner2);
    const rest2 = await newRestaurant(biz2, owner2);
    await newOrder(rest2, biz2, { customerId: null, totalCents: 1000, daysAgo: 1 });
    const r = await getRepeatOrderRate(pool, rest2, { from, to });
    expect(r.total_identified_orders).toBe(0);
    expect(r.repeat_order_rate).toBeNull();
    expect(r.guest_orders_excluded).toBe(1);
  });

  test('top items ranked by revenue; cancelled order lines excluded', async () => {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 89 * 86400000).toISOString();
    const items = await getTopItemsByRevenue(pool, F.restaurantId, { from, to, limit: 10 });
    const names = items.map((i) => i.item_name);
    expect(names).toEqual(['Burger', 'Fries', 'Soda']);
    expect(names).not.toContain('Lobster');
    const burger = items[0];
    expect(burger.menu_item_id).toBe(F.burgerItemId);
    expect(burger.revenue_cents).toBe('2400');
    expect(burger.units_sold).toBe(3);
    expect(burger.orders).toBe(2);
  });

  test('90-day window constant matches the documented default', () => {
    expect(REPEAT_ORDER_WINDOW_DAYS).toBe(90);
  });

  test('loyaltySummary endpoint: manager gate + response shape', async () => {
    const ctrl = require('../controllers/restaurantReportsController');
    const req = { params: { restaurantId: String(F.restaurantId) }, user: { id: F.owner }, query: {} };
    let body;
    const res = { json: (b) => { body = b; } };
    const next = (err) => { throw err || new Error('next() called'); };
    await ctrl.loyaltySummary(req, res, next);
    expect(body.window_days).toBe(90);
    expect(body.repeat_order_rate).toBeCloseTo(0.5, 10);
    expect(Array.isArray(body.top_items)).toBe(true);
    expect(body.top_items[0].item_name).toBe('Burger');
  });

  test('loyaltySummary endpoint: stranger gets 404 (canonical gate)', async () => {
    const ctrl = require('../controllers/restaurantReportsController');
    const stranger = await newUser();
    const req = { params: { restaurantId: String(F.restaurantId) }, user: { id: stranger }, query: {} };
    const res = { json: () => { throw new Error('should not succeed'); } };
    let caught = null;
    await ctrl.loyaltySummary(req, res, (err) => { caught = err; });
    expect(caught).toBeTruthy();
    expect(caught.status || caught.statusCode).toBe(404);
  });
});
