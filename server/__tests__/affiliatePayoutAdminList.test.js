'use strict';

// Audit fix (auth finding 15, UI track): admin-only affiliate payout list.
// GET /api/affiliate/payouts mirrors PayoutController.getPayouts' query
// shape without the helper scoping, so an admin sees every program's
// payouts. Guard chain (requireAdmin + rejectImpersonated +
// view_financials) is asserted at the route-registration level, the same
// pattern auditT4PayoutRoutes uses for the process routes: requireAdmin
// itself is token-based and cannot be exercised with a bare supertest
// caller, while requirePermission is covered by its own middleware tests.
const fs = require('fs');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('stripe', () => () => ({}));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/sanctionsScreeningService', () => ({ assertSanctionsClear: jest.fn().mockResolvedValue({ cleared: false }) }));

const { listAdminPayouts } = require('../controllers/affiliatePayoutsController');

const ROUTE_SRC = fs.readFileSync(require.resolve('../routes/affiliatePayouts.js'), 'utf8');

function res() {
  const r = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return r;
}

function routeList(rows, total) {
  mockQuery.mockImplementation(async (sql) => {
    if (/COUNT\(\*\)/.test(String(sql))) return { rows: [{ total }] };
    return { rows };
  });
}

beforeEach(() => {
  resetMocks();
});

describe('admin list route wiring', () => {
  test('GET /payouts mounts requireAdmin, rejectImpersonated and view_financials', () => {
    const at = ROUTE_SRC.indexOf("'/payouts'");
    expect(at).toBeGreaterThan(-1);
    const block = ROUTE_SRC.slice(at, at + 400);
    expect(block).toContain('requireAdmin');
    expect(block).toContain('rejectImpersonated');
    expect(block).toContain('view_financials');
    expect(block).toContain('listAdminPayouts');
  });

  test('list route is registered before /:programId so it is not swallowed', () => {
    const listAt = ROUTE_SRC.indexOf("'/payouts'");
    const programAt = ROUTE_SRC.indexOf("'/:programId'");
    expect(listAt).toBeGreaterThan(-1);
    expect(programAt).toBeGreaterThan(-1);
    expect(listAt).toBeLessThan(programAt);
  });
});

describe('listAdminPayouts handler', () => {
  test('lists all programs with the payable figure and default pagination', async () => {
    const rows = [
      { id: 1, status: 'pending', net_payout_cents: 1200, total_commission_cents: 1500, processor_fee_cents: 100, affiliate_first_name: 'Ada', affiliate_last_name: 'Lovelace' },
      { id: 2, status: 'completed', net_payout_cents: null, total_commission_cents: 1000, processor_fee_cents: 50, affiliate_first_name: null, affiliate_last_name: null },
    ];
    routeList(rows, 2);
    const r = res();
    await listAdminPayouts({ query: {} }, r);
    expect(r.status).not.toHaveBeenCalled();
    const body = r.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.payouts).toHaveLength(2);
    expect(body.payouts[0].payable_cents).toBe(1200);
    expect(body.payouts[1].payable_cents).toBe(950);
    expect(body.pagination).toEqual({ limit: 20, offset: 0, total: 2 });
    const listSql = String(mockQuery.mock.calls[0][0]);
    expect(listSql).not.toMatch(/helper_id = \$1/);
  });

  test('status filter constrains both the rows and the count', async () => {
    routeList([{ id: 3, status: 'pending', net_payout_cents: 500 }], 1);
    const r = res();
    await listAdminPayouts({ query: { status: 'pending' } }, r);
    const body = r.json.mock.calls[0][0];
    expect(body.payouts).toHaveLength(1);
    expect(String(mockQuery.mock.calls[0][1])).toContain('pending');
    expect(String(mockQuery.mock.calls[1][0])).toMatch(/WHERE status = \$1/);
    expect(mockQuery.mock.calls[1][1]).toEqual(['pending']);
  });

  test('unknown status fails closed with 400 and no rows query', async () => {
    const r = res();
    await listAdminPayouts({ query: { status: 'bogus' } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('pagination is respected and clamped', async () => {
    routeList([], 0);
    const r = res();
    await listAdminPayouts({ query: { limit: '500', offset: '10' } }, r);
    const body = r.json.mock.calls[0][0];
    expect(body.pagination.limit).toBe(100);
    expect(body.pagination.offset).toBe(10);
    expect(mockQuery.mock.calls[0][1]).toEqual([100, 10]);
  });

  test('database failure returns 500', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const r = res();
    await listAdminPayouts({ query: {} }, r);
    expect(r.status).toHaveBeenCalledWith(500);
  });
});
