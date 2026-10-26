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

test('per-store hours, overtime and cost with currency-safe totals', async () => {
  jest.spyOn(payroll, 'computeLabor').mockImplementation(async ({ locationIds }) => (locationIds[0] === 1
    ? { total_hours: 30, scheduled_hours: 28, overtime_hours: 0, labor_cost_cents: 45000, revenue_cents: 150000, labor_percent: 30, currency: 'USD', employees: [{}], missing_wage_user_ids: [] }
    : { total_hours: 25, scheduled_hours: 20, overtime_hours: 5, labor_cost_cents: 40000, revenue_cents: 100000, labor_percent: 40, currency: 'USD', employees: [{}, {}], missing_wage_user_ids: ['x'] }));
  const { status, body } = await run();
  expect(status).toBe(200);
  expect(body.stores.map((s) => [s.location_id, s.overtime_hours, s.missing_wage_count])).toEqual([[1, 0, 0], [2, 5, 1]]);
  expect(body.totals).toMatchObject({ total_hours: 55, overtime_hours: 5, labor_cost_cents: 85000, currency: 'USD', labor_percent: 34 });
});

test('mixed currencies never produce a summed money total', async () => {
  jest.spyOn(payroll, 'computeLabor').mockImplementation(async ({ locationIds }) => ({ total_hours: 10, overtime_hours: 1, labor_cost_cents: 1000, revenue_cents: 5000, currency: locationIds[0] === 1 ? 'USD' : 'CAD', employees: [], missing_wage_user_ids: [] }));
  const { body } = await run();
  expect(body.totals).toMatchObject({ overtime_hours: 2, labor_cost_cents: null, labor_percent: null, currency: null });
});

test('payroll.view is required and assigned managers only see their stores', async () => {
  permissions.hasRestaurantPermission.mockImplementation(async (_r, _u, codes) => !codes.includes('payroll.view'));
  expect((await run()).body.code).toBe('payroll_permission_required');
  permissions.hasRestaurantPermission.mockResolvedValue(true);
  getLocationScope.mockResolvedValue({ mode: 'assigned', location_ids: [2] });
  pool.query.mockResolvedValue({ rows: [{ id: 2, display_name: 'Airport' }] });
  jest.spyOn(payroll, 'computeLabor').mockResolvedValue({ total_hours: 1, overtime_hours: 0, labor_cost_cents: 1, revenue_cents: 1, currency: 'USD', employees: [], missing_wage_user_ids: [] });
  const { body } = await run();
  expect(pool.query.mock.calls.at(-1)[1]).toEqual([7, [2]]);
  expect(body.stores).toHaveLength(1);
});
