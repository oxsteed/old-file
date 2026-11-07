'use strict';

/**
 * Mocked-pool tests: design-review item 55 (goal goal_a0fc7c0f0394).
 *
 * The single-employee slice is only a win if the underlying queries
 * actually carry the user filter, so these tests assert on the SQL
 * each per-employee helper sends to the pool (and on the parameter
 * that carries the user id), with and without a location scope. The
 * DB suite (restaurantFixes3361.db.test.js) proves the slice equals
 * the whole-restaurant row; this suite proves the filter is in the
 * query instead of in JavaScript after the fact.
 *
 * No database needed: the pool is mocked and every helper is fed
 * empty rows.
 */
jest.mock('../db', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }));

const pool = require('../db');
const payroll = require('../services/restaurantPayrollService');

const USER = 'c1111111-1111-4111-8111-111111111111';
const BIZ = 7;
const REST = 9;

function lastCallSql() {
  const calls = pool.query.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return String(calls[calls.length - 1][0]);
}
function lastCallParams() {
  return pool.query.mock.calls[pool.query.mock.calls.length - 1][1];
}

beforeEach(() => { pool.query.mockClear(); });

describe('item 55: per-employee queries carry the user filter', () => {
  test('getHoursByUser filters by user, with and without a location scope', async () => {
    await payroll.getHoursByUser(BIZ, '2026-10-05', '2026-10-11', null, USER);
    expect(lastCallSql()).toMatch(/user_id = \$4/);
    expect(lastCallParams()).toEqual([BIZ, '2026-10-05', '2026-10-11', USER]);

    await payroll.getHoursByUser(BIZ, '2026-10-05', '2026-10-11', [12], USER);
    expect(lastCallSql()).toMatch(/location_id = ANY\(\$4::bigint\[\]\)/);
    expect(lastCallSql()).toMatch(/user_id = \$5/);
    expect(lastCallParams()).toEqual([BIZ, '2026-10-05', '2026-10-11', [12], USER]);
  });

  test('getSystemClosedByUser and getScheduledHoursByUser filter by user', async () => {
    await payroll.getSystemClosedByUser(BIZ, '2026-10-05', '2026-10-11', null, USER);
    expect(lastCallSql()).toMatch(/user_id = \$4/);
    expect(lastCallParams()).toContain(USER);

    await payroll.getScheduledHoursByUser(BIZ, REST, '2026-10-05', '2026-10-11', null, USER);
    expect(lastCallSql()).toMatch(/user_id = \$5/);
    expect(lastCallSql()).toMatch(/cancelled_at IS NULL/);
    expect(lastCallParams()).toEqual([BIZ, '2026-10-05', '2026-10-11', REST, USER]);
  });

  test('getPolicyHoursByUser narrows the widened-week fetch to the user', async () => {
    await payroll.getPolicyHoursByUser(BIZ, '2026-10-05', '2026-10-11', {
      overtime_threshold_hours: 40, overtime_multiplier_bps: 15000,
      doubletime_multiplier_bps: 20000, break_after_minutes: 360, break_duration_minutes: 30,
    }, null, null, USER);
    expect(lastCallSql()).toMatch(/user_id = \$4/);
    expect(lastCallParams()[3]).toBe(USER);
  });

  test('getOrderTips and getDeclaredCashTips filter by the attributed user', async () => {
    await payroll.getOrderTips(REST, '2026-10-05', '2026-10-11', 'America/New_York', null, USER);
    expect(lastCallSql()).toMatch(/COALESCE\(fo\.acting_staff_user_id, s\.staff_user_id\) = \$5/);
    expect(lastCallParams()).toContain(USER);

    await payroll.getDeclaredCashTips(REST, '2026-10-05', '2026-10-11', null, USER);
    expect(lastCallSql()).toMatch(/staff_user_id = \$4/);
    expect(lastCallParams()).toContain(USER);
  });

  test('getRoster returns the single employee, owner branch included', async () => {
    await payroll.getRoster(BIZ, null, null, USER);
    expect(lastCallSql()).toMatch(/bm\.member_id = \$2/);
    expect(lastCallSql()).toMatch(/b\.user_id = \$2/);
    expect(lastCallParams()).toEqual([BIZ, USER]);

    await payroll.getRoster(BIZ, [12], REST, USER);
    expect(lastCallSql()).toMatch(/bm\.member_id = \$5/);
    expect(lastCallSql()).toMatch(/b\.user_id = \$5/);
    expect(lastCallParams()).toEqual([BIZ, [12], REST, 12, USER]);
  });

  test('getPredictabilityPremiums filters by user', async () => {
    await payroll.getPredictabilityPremiums({
      businessId: BIZ, fromDate: '2026-10-05', toDate: '2026-10-11',
      timezone: 'America/New_York', locationIds: null, userId: USER,
    });
    expect(lastCallSql()).toMatch(/user_id = \$5/);
    expect(lastCallParams()).toContain(USER);
  });

  test('without a user id no user filter is added', async () => {
    await payroll.getHoursByUser(BIZ, '2026-10-05', '2026-10-11');
    expect(lastCallSql()).not.toMatch(/user_id = \$/);
    expect(lastCallParams()).toEqual([BIZ, '2026-10-05', '2026-10-11']);
  });
});
