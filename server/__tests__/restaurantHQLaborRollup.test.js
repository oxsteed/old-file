'use strict';
// S-18: HQ per-store labor and overtime totals.
jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/scopeModel', () => ({ resolveRestaurantAccess: jest.fn() }));
jest.mock('../services/permissionsService', () => ({ hasRestaurantPermission: jest.fn() }));
jest.mock('../services/restaurantLocationAccessService', () => ({ getLocationScope: jest.fn() }));
const pool = require('../db');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const { getLocationScope } = require('../services/restaurantLocationAccessService');
const payroll = require('../services/restaurantPayrollService');
const hq = require('../controllers/restaurantHQController');

function run(query = {}) {
  return new Promise((resolve, reject) => {
    const req = { params: { restaurantId: '7' }, query: { from: '2026-10-01', to: '2026-10-07', ...query }, user: { id: 'u' } };
    const res = { json: (body) => resolve({ status: 200, body }) };
    hq.laborRollup(req, res, (err) => (err ? resolve({ status: err.statusCode || 500, body: { code: err.code } }) : reject(new Error('no response'))));
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  resolveRestaurantAccess.mockResolvedValue({ id: 7, business_id: 3, timezone: 'America/New_York' });
  permissions.hasRestaurantPermission.mockResolvedValue(true);
  getLocationScope.mockResolvedValue({ mode: 'all' });
  pool.query.mockResolvedValue({ rows: [{ id: 1, display_name: 'Downtown' }, { id: 2, display_name: 'Airport' }] });
});

function runCsv(query = {}) {
  return new Promise((resolve, reject) => {
    const req = { params: { restaurantId: '7' }, query: { from: '2026-10-01', to: '2026-10-07', ...query }, user: { id: 'u' } };
    const res = {
      setHeader: jest.fn(),
      send: (body) => resolve({ status: 200, body }),
    };
    hq.laborRollupCsv(req, res, (err) => (err ? resolve({ status: err.statusCode || 500, body: { code: err.code } }) : reject(new Error('no response'))));
  });
}

test('per-store hours, overtime and cost with currency-safe totals', async () => {
  jest.spyOn(payroll, 'computeLabor').mockImplementation(async ({ locationIds }) => (locationIds[0] === 1
    ? { total_hours: 30, scheduled_hours: 28, overtime_hours: 0, labor_cost_cents: 45000, revenue_cents: 150000, labor_percent: 30, currency: 'USD', employees: [{}], missing_wage_user_ids: [] }
    : { total_hours: 25, scheduled_hours: 20, overtime_hours: 5, labor_cost_cents: 40000, revenue_cents: 100000, labor_percent: 40, currency: 'USD', employees: [{}, {}], missing_wage_user_ids: ['x'] }));
  const { status, body } = await run();
  expect(status).toBe(200);
  expect(body.stores.map((s) => [s.location_id, s.overtime_hours, s.missing_wage_count])).toEqual([[1, 0, 0], [2, 5, 1]]);
  expect(body.totals).toMatchObject({ total_hours: 55, overtime_hours: 5, labor_cost_cents: 85000, currency: 'USD', labor_percent: 34 });
  // The FX lookup cannot run against the stubbed pool, so the native
  // rollup is returned with converted null, never a failed read.
  expect(body.totals.converted).toBeNull();
});

test('mixed currencies never produce a summed money total', async () => {
  jest.spyOn(payroll, 'computeLabor').mockImplementation(async ({ locationIds }) => ({ total_hours: 10, overtime_hours: 1, labor_cost_cents: 1000, revenue_cents: 5000, currency: locationIds[0] === 1 ? 'USD' : 'CAD', employees: [], missing_wage_user_ids: [] }));
  const { body } = await run();
  expect(body.totals).toMatchObject({ overtime_hours: 2, labor_cost_cents: null, labor_percent: null, currency: null });
});

// Domain 8 #28: the CSV export serves the same 15-minute cached rollup
// as the JSON endpoint but carried no freshness marker, so a manager
// filing the file could not tell it was up to 15 minutes old.
test('CSV export carries the same freshness markers as the JSON rollup', async () => {
  jest.spyOn(payroll, 'computeLabor').mockImplementation(async ({ locationIds }) => (locationIds[0] === 1
    ? { total_hours: 30, scheduled_hours: 28, overtime_hours: 0, labor_cost_cents: 45000, revenue_cents: 150000, labor_percent: 30, currency: 'USD', employees: [{}], missing_wage_user_ids: [] }
    : { total_hours: 25, scheduled_hours: 20, overtime_hours: 5, labor_cost_cents: 40000, revenue_cents: 100000, labor_percent: 40, currency: 'USD', employees: [{}, {}], missing_wage_user_ids: ['x'] }));
  const { status, body } = await runCsv();
  expect(status).toBe(200);
  const lines = body.split('\n');
  expect(lines[0]).toMatch(/^# computed_at=\S+/);
  expect(lines[1]).toBe('# is_cached=false');
  expect(lines[2]).toBe('# stale_after_seconds=900');
  // Data rows are byte-identical to before: the header is next, then
  // one row per store plus the totals row.
  expect(lines[3]).toMatch(/^from_date,to_date,location_id,location_name,currency,/);
  expect(lines[4]).toContain('Downtown');
  expect(lines[5]).toContain('Airport');
  expect(lines[6]).toContain('TOTAL');
});

test('payroll.view is required and assigned managers only see their stores', async () => {
  permissions.hasRestaurantPermission.mockImplementation(async (_r, _u, codes) => !codes.includes('payroll.view'));
  expect((await run()).body.code).toBe('payroll_permission_required');
  permissions.hasRestaurantPermission.mockResolvedValue(true);
  getLocationScope.mockResolvedValue({ mode: 'assigned', location_ids: [2] });
  pool.query.mockResolvedValue({ rows: [{ id: 2, display_name: 'Airport' }] });
  jest.spyOn(payroll, 'computeLabor').mockResolvedValue({ total_hours: 1, overtime_hours: 0, labor_cost_cents: 1, revenue_cents: 1, currency: 'USD', employees: [], missing_wage_user_ids: [] });
  const { body } = await run();
  // The locations query carries the assigned scope; the FX policy
  // lookup runs after it, and the stubbed query log accumulates
  // across tests, so take the last locations call.
  const locationCalls = pool.query.mock.calls.filter(([sql]) => String(sql).includes('FROM restaurant_locations'));
  expect(locationCalls.at(-1)[1]).toEqual([7, [2]]);
  expect(body.stores).toHaveLength(1);
});
