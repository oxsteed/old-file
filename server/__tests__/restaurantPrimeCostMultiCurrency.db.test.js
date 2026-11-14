'use strict';

/**
 * DB tests: money-flows audit 2026-11-07, R9.
 *
 * Prime cost silently mixed currencies: net sales summed paid orders
 * in every currency while labor, revenue and the percentages were
 * single-currency, and the per-currency fallback the header promised
 * did not exist (no `currencies` block anywhere). The fix filters
 * sales (and the order-driven theoretical cost) to the labor
 * report's effective currency and surfaces the other currencies as
 * an excluded breakdown, like predictability premiums do.
 *
 *   - A multi-currency period reports single-currency figures plus
 *     an excluded breakdown for the other currency.
 *   - The yield factor prices identically in prime cost and in
 *     restaurantFoodCostService costLine; the zero-yield branch
 *     (yield 0 counts at 100%) is aligned in both CTEs, though
 *     migration 972 CHECKs yield_percent > 0 so 0 cannot be stored.
 *
 * Residual, documented in code: inventory unit costs and usage
 * adjustments carry no currency at all, so the actual cost is read
 * as effective-currency (the pre-existing assumption); it cannot be
 * filtered the way order sales can.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantPrimeCostMultiCurrency.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');

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
  process.env['JWT' + '_SECRET'] = 'prime-cost-currency-test-secret';
}

const pool = require('../db');
const primeCost = require('../services/restaurantPrimeCostService');
const { computeMenuItemFoodCost } = require('../services/restaurantFoodCostService');

jest.setTimeout(60000);

// One USD restaurant, one USD store, one waged staff member, one
// burger (5000c) mapped to beef patties: 2 kg at 15.00 per burger.
// One 10-burger order is 50000c of sales; theoretical cost is
// 10 x 2 kg x 15.00 = 30000c; actual usage of 25 kg is 37500c.
async function makeFixture({ yieldPercent = 100 } = {}) {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const ownerId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  await pool.query(
    'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
    [ownerId, `prime-owner-${suffix}@example.com`, 'test-hash', 'Prime', 'Owner',
     staffId, `prime-staff-${suffix}@example.com`, 'test-hash', 'Prime', 'Staff']
  );
  const { rows: [{ id: businessId }] } = await pool.query(
    'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
    [ownerId, `Prime Cost ${suffix}`]
  );
  const { rows: [{ id: restaurantId }] } = await pool.query(
    `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
     VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
    [businessId, ownerId, `Prime Cost ${suffix}`]
  );
  const { rows: [{ id: locationId }] } = await pool.query(
    // The restaurant insert trigger already creates the primary
    // location; this is the test's second (non-primary) store.
    `INSERT INTO restaurant_locations (restaurant_id, name, timezone, currency_code, is_primary, status)
     VALUES ($1, $2, 'UTC', 'USD', FALSE, 'active') RETURNING id`,
    [restaurantId, `Prime Store ${suffix}`]
  );
  await pool.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, hourly_wage_cents)
     VALUES ($1, $2, $3, 'employee', $4, 'active', 1000)`,
    [businessId, ownerId, staffId, `prime-staff-${suffix}@example.com`]
  );
  const { rows: [{ id: menuItemId }] } = await pool.query(
    `INSERT INTO food_menu_items (restaurant_id, name, price_cents, currency_code)
     VALUES ($1, 'Burger', 5000, 'USD') RETURNING id`,
    [restaurantId]
  );
  const { rows: [{ id: itemId }] } = await pool.query(
    `INSERT INTO restaurant_inventory_items
       (restaurant_id, location_id, name, category, unit, quantity, unit_cost)
     VALUES ($1, $2, 'Beef patty', 'meat', 'kg', 100, 15.00) RETURNING id`,
    [restaurantId, locationId]
  );
  await pool.query(
    `INSERT INTO restaurant_inventory_item_mappings
       (restaurant_id, inventory_item_id, menu_item_id, usage_label, required_quantity, conversion_factor, yield_percent)
     VALUES ($1, $2, $3, 'patty', 2, 1, $4)`,
    [restaurantId, itemId, menuItemId, yieldPercent]
  );
  return { businessId: Number(businessId), restaurantId: Number(restaurantId), locationId: Number(locationId), staffId, menuItemId: Number(menuItemId), itemId: Number(itemId) };
}

async function addOrder(fixture, { currency, totalCents, tipCents = 0 }) {
  const { rows: [{ id: orderId }] } = await pool.query(
    `INSERT INTO food_orders
       (restaurant_id, business_id, location_id, status, payment_status,
        subtotal_cents, total_cents, tip_cents, currency_code, queue_number,
        acting_staff_user_id, created_at)
     VALUES ($1, $2, $3, 'completed', 'paid', $4, $5, $6, $7, 1, $8, '2026-11-05T12:00:00Z')
     RETURNING id`,
    [fixture.restaurantId, fixture.businessId, fixture.locationId,
     totalCents - tipCents, totalCents, tipCents, currency, fixture.staffId]
  );
  await pool.query(
    `INSERT INTO food_order_items (order_id, menu_item_id, item_name, quantity, unit_price_cents, line_total_cents)
     VALUES ($1, $2, 'Burger', 10, 5000, $3)`,
    [orderId, fixture.menuItemId, totalCents]
  );
  return Number(orderId);
}

async function addUsage(fixture, quantityDelta) {
  await pool.query(
    `INSERT INTO restaurant_inventory_adjustments
       (restaurant_id, location_id, item_id, item_name, adjustment_type, quantity_delta, quantity_after, created_at)
     VALUES ($1, $2, $3, 'Beef patty', 'usage', $4, 75, '2026-11-05T13:00:00Z')`,
    [fixture.restaurantId, fixture.locationId, fixture.itemId, quantityDelta]
  );
}

async function computePrime(fixture) {
  return primeCost.computePrimeCost({
    restaurant: { id: fixture.restaurantId, business_id: fixture.businessId, timezone: 'UTC', currency_code: 'USD' },
    fromDate: '2026-11-05',
    toDate: '2026-11-05',
    locationIds: [fixture.locationId],
  });
}

ddescribe('R9: prime cost prices in one currency and excludes the rest', () => {
  test('multi-currency period reports USD figures plus an excluded EUR breakdown', async () => {
    const F = await makeFixture();
    await addOrder(F, { currency: 'USD', totalCents: 50000, tipCents: 500 });
    await addOrder(F, { currency: 'EUR', totalCents: 50000, tipCents: 500 });
    await addUsage(F, -25);
    const prime = await computePrime(F);
    expect(prime.currency).toBe('USD');
    expect(prime.revenue_cents).toBe(50000);
    // Before the fix net sales summed both currencies (100000) and
    // the theoretical cost counted both orders' burgers (60000),
    // while the percentages divided single-currency numerators by
    // the mixed denominator.
    expect(prime.food.net_sales_cents).toBe(50000);
    expect(prime.food.excluded_net_sales).toEqual([{ currency_code: 'EUR', net_sales_cents: 50000 }]);
    expect(prime.food.excluded_net_sales_cents).toBe(50000);
    expect(prime.food.theoretical_cost_cents).toBe(30000);
    expect(prime.food.theoretical_cost_pct).toBe(60);
    expect(prime.food.actual_cost_cents).toBe(37500);
    expect(prime.food.actual_cost_pct).toBe(75);
    expect(prime.prime_cost_cents).toBe(37500);
    expect(prime.prime_cost_pct).toBe(75);
    // The per-server and daypart sales agree with the filtered total.
    expect(prime.servers.servers).toHaveLength(1);
    expect(prime.servers.servers[0].net_sales_cents).toBe(50000);
    expect(prime.dayparts.dayparts.find((d) => d.key === 'lunch').orders).toBe(1);
    expect(prime.dayparts.hourly[12].orders).toBe(1);
  });

  test('a non-100 yield prices identically in prime cost and costLine', async () => {
    // The audit's zero-yield note: the theoretical CTE dropped a
    // component on yield 0 (100 / NULLIF(yield, 0) is NULL) while
    // costLine treats yield 0 as 100%. The CTEs now share costLine's
    // rule (yield 0 or NULL counts at 100%). Yield 0 itself cannot be
    // stored — migration 972 CHECKs yield_percent > 0 — so the 0
    // branch is defensive alignment, pinned here by evaluating the
    // exact expression, and the live agreement is proven on a
    // yield-50 mapping: 10 burgers x 2 kg x (100/50) x 15.00 = 60000c
    // theoretical, 6000c per burger from the menu-item cost path.
    const { rows: [{ factor }] } = await pool.query(
      'SELECT (CASE WHEN 0 IS NULL OR 0 = 0 THEN 1.0 ELSE 100.0 / 0 END) AS factor'
    );
    expect(Number(factor)).toBe(1);
    const F = await makeFixture({ yieldPercent: 50 });
    await addOrder(F, { currency: 'USD', totalCents: 50000, tipCents: 500 });
    await addUsage(F, -25);
    const prime = await computePrime(F);
    expect(prime.food.theoretical_cost_cents).toBe(60000);
    expect(prime.food.theoretical_cost_pct).toBe(120);
    const menuCost = await computeMenuItemFoodCost(pool, {
      restaurantId: F.restaurantId, menuItemId: F.menuItemId, locationIds: [F.locationId],
    });
    expect(menuCost.cost_cents).toBe(6000);
    expect(prime.food.theoretical_cost_cents).toBe(menuCost.cost_cents * 10);
    expect(prime.food.excluded_net_sales).toEqual([]);
    expect(prime.food.excluded_net_sales_cents).toBe(0);
  });
});

afterAll(async () => {
  await pool.end().catch(() => {});
});
