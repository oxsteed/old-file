'use strict';
// N-07 specific denial areas; N-08 deterministic, multi-restaurant lookups.
const fs = require('fs');
const path = require('path');
const { mockQuery, resetMocks } = require('./setup');

beforeEach(() => { resetMocks(); jest.clearAllMocks(); });

describe('N-07 restaurant permission denials', () => {
  const ctrl = require('../controllers/restaurantAppFlowController');
  test.each([
    [['pos.use', 'pos.manage', 'orders.manage'], 'pos'],
    [['kitchen.update', 'kitchen.manage', 'orders.manage'], 'kitchen'],
    [['runner.update', 'runner.manage', 'orders.manage'], 'runner'],
    [['menu.manage', 'restaurant.manage'], 'menu'],
    [['settings.view', 'settings.manage', 'restaurant.manage'], 'settings'],
    [['orders.manage', 'issue_refunds'], 'refunds'],
    [['orders.view', 'orders.manage', 'kitchen.view'], 'orders'],
    [['orders.manage', 'kitchen.update'], 'kitchen'],
  ])('%j -> %s', (perms, area) => {
    expect(ctrl._restaurantPermissionArea(perms)).toBe(area);
    expect(ctrl._RESTAURANT_PERMISSION_DENIALS[area]).toMatch(/permission/);
  });
  test('no denial mentions the kitchen unless it is the kitchen', () => {
    for (const [area, text] of Object.entries(ctrl._RESTAURANT_PERMISSION_DENIALS)) {
      if (area !== 'kitchen') expect(text).not.toMatch(/kitchen/i);
    }
  });
});

describe('N-08 deterministic restaurant lookups', () => {
  test('single-row restaurant-by-business lookups are ordered', () => {
    const files = ['controllers/businessController.js', 'controllers/foodController.js', 'services/stripeConnectSoTService.js',
      'services/restaurantWorkforceScope.js', 'services/attention/index.js'];
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      const bad = src.match(/FROM food_restaurants WHERE business_id\s*=\s*\$1(?!\s*ORDER BY)[^`'"]*LIMIT 1/g) || [];
      expect({ f, bad }).toEqual({ f, bad: [] });
    }
  });

  test('workforce scope unions stores across every restaurant of the business', async () => {
    const { combineScopes } = require('../services/restaurantWorkforceScope');
    const ctx = combineScopes([
      { restaurant: { id: 1 }, scope: { mode: 'assigned', location_ids: [10, 11], assignments: [] } },
      { restaurant: { id: 2 }, scope: { mode: 'assigned', location_ids: [20], assignments: [] } },
    ], 2, 5, 'u');
    expect(ctx.scope).toMatchObject({ mode: 'assigned', location_ids: [10, 11, 20] });
    expect(ctx.restaurantIds).toEqual([1, 2]);
  });

  test('all-store access on every restaurant stays unscoped; partial access is scoped', () => {
    const { combineScopes } = require('../services/restaurantWorkforceScope');
    const all = { mode: 'all', location_ids: null, assignments: [] };
    expect(combineScopes([{ restaurant: { id: 1 }, scope: all }, { restaurant: { id: 2 }, scope: all }], 2, 5, 'u').scope.mode).toBe('all');
    const partial = combineScopes([{ restaurant: { id: 1 }, scope: all }], 2, 5, 'u');
    expect(partial.scope.mode).toBe('assigned');
    expect(partial.pendingAll).toEqual([1]);
  });

  test('context resolves restaurants in id order and loads all-store locations', async () => {
    jest.resetModules();
    jest.doMock('../services/scopeModel', () => ({ resolveRestaurantAccess: jest.fn(async (u, id) => ({ id, effective_role: 'manager' })) }));
    jest.doMock('../services/restaurantLocationAccessService', () => ({
      getLocationScope: jest.fn(async (r) => (r.id === 1 ? { mode: 'assigned', location_ids: [10], assignments: [] } : { mode: 'all', location_ids: null, assignments: [] })),
    }));
    const { mockQuery: q } = require('./setup');
    q.mockResolvedValueOnce({ rows: [{ restaurant_id: 1 }, { restaurant_id: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 20 }, { id: 21 }] });
    const scope = require('../services/restaurantWorkforceScope');
    const ctx = await scope.context({ params: { businessId: 5 }, user: { id: 'u' } });
    expect(q.mock.calls[0][0]).toMatch(/ORDER BY id ASC/);
    expect(ctx.scope.location_ids).toEqual([10, 20, 21]);
    const params = [];
    expect(scope.staffClause(ctx, 'bm.member_id', params)).toMatch(/restaurant_id=ANY/);
    expect(params[0]).toEqual([1, 2]);
  });
});
