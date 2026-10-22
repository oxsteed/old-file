'use strict';

/**
 * Payroll location scoping (auth-audit finding 22).
 *
 * restaurantPayrollService had zero location_id references: labor/tip/
 * exception rollups aggregated across all stores, so a location-restricted
 * manager saw cross-location wages and tips.
 *
 * computeLabor / computeTipAllocations / computeExceptions now accept a
 * locationScope ({ mode: 'assigned', location_ids }) from getLocationScope:
 * store-attributable queries filter to those stores (F-07 pattern), and the
 * visible employee set is restricted to members assigned to the viewer's
 * stores. Unscoped viewers ('all') see everything, as before.
 *
 * These mock-based tests assert the SQL wiring (filter clause + bound ids);
 * payrollLocationScope.db.test.js covers the real-SQL behavior of the cash
 * tip path against the migrated schema.
 */

const { mockQuery, resetMocks } = require('./setup');

const payroll = require('../services/restaurantPayrollService');

const RESTAURANT = { id: 42, business_id: 7, currency_code: 'USD', timezone: 'UTC', settings: {} };
const SCOPED = { mode: 'assigned', location_ids: [7, 9], assignments: [] };
const UNSCOPED = { mode: 'all', location_ids: null, assignments: [] };

function sqlCallsWithAny() {
  return mockQuery.mock.calls.filter(
    ([sql]) => typeof sql === 'string' && /= ANY\(\$\d+::bigint\[\]\)/.test(sql)
  );
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('finding 22: scopedLocationIds', () => {
  test('returns ids for assigned scopes', () => {
    expect(payroll.scopedLocationIds(SCOPED)).toEqual([7, 9]);
  });
  test('returns null for all-store scopes', () => {
    expect(payroll.scopedLocationIds(UNSCOPED)).toBeNull();
    expect(payroll.scopedLocationIds(null)).toBeNull();
    expect(payroll.scopedLocationIds({ mode: 'assigned', location_ids: [] })).toBeNull();
  });
  test('sanitizes non-integer ids', () => {
    expect(payroll.scopedLocationIds({ mode: 'assigned', location_ids: [7, 'x', -3, 7] })).toEqual([7]);
  });
});

describe('finding 22: computeTipAllocations threads the scope', () => {
  test('order tips + cash tips filter to the scoped stores', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await payroll.computeTipAllocations({
      restaurant: RESTAURANT, fromDate: '2026-10-01', toDate: '2026-10-21', locationScope: SCOPED,
    });
    const filtered = sqlCallsWithAny();
    // getOrderTips (fo.location_id) + getDeclaredCashTips (location_id).
    expect(filtered.length).toBe(2);
    for (const [, params] of filtered) {
      expect(params[params.length - 1]).toEqual([7, 9]);
    }
  });

  test('unscoped viewers get no location filter (back-compat)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await payroll.computeTipAllocations({
      restaurant: RESTAURANT, fromDate: '2026-10-01', toDate: '2026-10-21', locationScope: UNSCOPED,
    });
    expect(sqlCallsWithAny().length).toBe(0);
  });
});

describe('finding 22: computeLabor threads the scope', () => {
  test('revenue filters to scoped stores and member visibility is resolved', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const labor = await payroll.computeLabor({
      restaurant: RESTAURANT, fromDate: '2026-10-01', toDate: '2026-10-21', locationScope: SCOPED,
    });
    const filtered = sqlCallsWithAny();
    // getRevenueByCurrency + getOrderTips + getDeclaredCashTips + the
    // member-visibility query.
    expect(filtered.length).toBe(4);
    // The visibility query ran against restaurant_location_memberships.
    const visibility = mockQuery.mock.calls.find(([sql]) => sql.includes('restaurant_location_memberships'));
    expect(visibility).toBeTruthy();
    expect(visibility[1]).toEqual([42, [7, 9]]);
    // No visible members -> no employees leak through.
    expect(labor.employees).toEqual([]);
  });

  test('unscoped labor has no location filter and no visibility query', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await payroll.computeLabor({
      restaurant: RESTAURANT, fromDate: '2026-10-01', toDate: '2026-10-21', locationScope: UNSCOPED,
    });
    expect(sqlCallsWithAny().length).toBe(0);
    const visibility = mockQuery.mock.calls.find(([sql]) => sql.includes('restaurant_location_memberships'));
    expect(visibility).toBeUndefined();
  });
});

describe('finding 22: computeExceptions threads the scope', () => {
  test('payments, discounts and drawer events filter to scoped stores', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await payroll.computeExceptions({
      restaurant: RESTAURANT, fromDate: '2026-10-01', toDate: '2026-10-21', locationScope: SCOPED,
    });
    const filtered = sqlCallsWithAny();
    // payments + discounts + drawer events + the member-visibility query.
    expect(filtered.length).toBe(4);
    const tables = filtered.map(([sql]) =>
      sql.includes('restaurant_pos_payments') ? 'payments'
        : sql.includes('restaurant_pos_drawer_events') ? 'drawer'
          : sql.includes('food_orders') ? 'orders' : 'other');
    expect(tables.sort()).toEqual(['drawer', 'orders', 'other', 'payments']);
  });

  test('unscoped exceptions have no location filter', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await payroll.computeExceptions({
      restaurant: RESTAURANT, fromDate: '2026-10-01', toDate: '2026-10-21', locationScope: UNSCOPED,
    });
    expect(sqlCallsWithAny().length).toBe(0);
  });
});
