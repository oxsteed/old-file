'use strict';

/**
 * Auth-audit item 23: region-scoped platform admins are strictly scoped to
 * their region on restaurant routes and never inherit owner-level access.
 *
 * Proves through the real scopeModel.resolveRestaurantAccess (stateful
 * in-memory pg fake) wrapped in runAsPlatformAdmin, exactly as
 * middleware/scopeGates.js drives it:
 *   - a region-scoped admin resolving an OUT-OF-REGION restaurant gets 404
 *     (same as no standing);
 *   - a region-scoped admin resolving an IN-REGION restaurant gets access
 *     but with effective_role 'regional_admin' (never 'owner'), still
 *     flagged platform_admin_access for the audit trail;
 *   - a global admin (no region grants) keeps the historical owner-level
 *     bypass;
 *   - a super_admin keeps the owner-level bypass even with region grants;
 *   - with effective_role 'regional_admin' the permission catalog resolves
 *     to an empty set, so an owner-level endpoint (tip-pool settings read,
 *     gated on payroll.view) returns 403 for the region admin while the
 *     same endpoint returns 200 for the global admin.
 */

const { mockQuery, resetMocks } = require('./setup');

const scopeModel = require('../services/scopeModel');

jest.mock('../services/restaurantPayrollService', () => {
  const actual = jest.requireActual('../services/restaurantPayrollService');
  return { ...actual, getTipPoolSettings: jest.fn(async () => ({ pooling_enabled: false })) };
});

const REGION_ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const GLOBAL_ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const SUPER_ADMIN_ID = '44444444-4444-4433-8433-444444444444';
const OWNER_ID = '55555555-5555-4533-8555-555555555555';

const REGION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let users;
let grants;
let regions;
let restaurants;
let businesses;
let memberships;

function installFakeDb() {
  users = new Map([
    [REGION_ADMIN_ID, { role: 'admin' }],
    [GLOBAL_ADMIN_ID, { role: 'admin' }],
    [SUPER_ADMIN_ID, { role: 'super_admin' }],
    [OWNER_ID, { role: 'customer' }],
  ]);
  regions = new Map([
    [REGION_ID, { boundary_definition: { type: 'city_state', entries: [{ city: 'Springfield', state: 'IL' }] } }],
  ]);
  grants = new Map([
    // Region admin: one active region grant (Springfield, IL).
    [REGION_ADMIN_ID, [{ region_id: REGION_ID, revoked_at: null, expires_at: new Date(Date.now() + 3600000).toISOString() }]],
    [GLOBAL_ADMIN_ID, []],
    [SUPER_ADMIN_ID, []],
  ]);
  businesses = new Map([
    [7, { id: 7, user_id: OWNER_ID, deleted_at: null }],
  ]);
  restaurants = new Map([
    [11, {
      id: 11, business_id: 7, owner_user_id: OWNER_ID,
      address_city: 'Springfield', address_state: 'IL', address_country: 'US',
      address_zip: '62701', latitude: 39.78, longitude: -89.65,
    }],
    [12, {
      id: 12, business_id: 7, owner_user_id: OWNER_ID,
      address_city: 'Austin', address_state: 'TX', address_country: 'US',
      address_zip: '78701', latitude: 30.27, longitude: -97.74,
    }],
  ]);
  memberships = new Map();

  mockQuery.mockImplementation(async (text, params = []) => {
    const sql = String(text);
    if (/^\s*BEGIN|^\s*COMMIT|^\s*ROLLBACK/.test(sql)) return { rows: [] };
    // scopeModel.getRegionRestrictedRegions: role lookup.
    if (sql.includes('SELECT role FROM users WHERE id = $1')) {
      const user = users.get(params[0]);
      return { rows: user ? [{ role: user.role }] : [] };
    }
    // scopeModel.getRegionRestrictedRegions: active region grants.
    if (sql.includes('FROM admin_permission_grants g') && sql.includes('JOIN admin_regions r')) {
      const rows = (grants.get(params[0]) || [])
        .filter((g) => g.region_id && !g.revoked_at && new Date(g.expires_at).getTime() > Date.now())
        .map((g) => ({ id: g.region_id, boundary_definition: regions.get(g.region_id).boundary_definition }));
      return { rows };
    }
    // resolveRestaurantAccess main query.
    if (sql.includes('FROM food_restaurants fr')) {
      const restaurant = restaurants.get(Number(params[0]));
      const userId = params[1];
      if (!restaurant) return { rows: [] };
      const business = businesses.get(restaurant.business_id);
      let effectiveRole = null;
      if (business.user_id === userId || restaurant.owner_user_id === userId) {
        effectiveRole = 'owner';
      } else {
        const key = `${business.id}|${userId}`;
        if (memberships.has(key)) effectiveRole = memberships.get(key);
      }
      return {
        rows: [{
          ...restaurant,
          business_owner_id: business.user_id,
          business_deleted_at: business.deleted_at,
          effective_role: effectiveRole,
          operator_role: effectiveRole,
          effective_membership_id: null,
          membership_id: null,
        }],
      };
    }
    // permissionsService.getEffectivePermissions: role defaults (no regional_admin row).
    if (sql.includes('FROM team_role_permissions rp')) {
      return { rows: [] };
    }
    // permissionsService owner short-circuit (not hit for regional_admin).
    if (sql.trim() === 'SELECT code FROM team_permissions') {
      return { rows: [{ code: 'payroll.view' }, { code: 'payroll.manage' }] };
    }
    throw new Error(`unexpected query in fake db: ${sql.slice(0, 140)}`);
  });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  installFakeDb();
});

function resolveAsPlatformAdmin(userId, restaurantId) {
  return scopeModel.runAsPlatformAdmin(userId, () => scopeModel.resolveRestaurantAccess(userId, restaurantId));
}

describe('item 23: region-scoped admins on restaurant routes', () => {
  test('out-of-region restaurant is invisible (404) to the region admin', async () => {
    await expect(resolveAsPlatformAdmin(REGION_ADMIN_ID, 12)).rejects.toMatchObject({
      status: 404,
      code: 'restaurant_not_found',
    });
  });

  test('in-region restaurant resolves with a non-owner role, still audited as platform access', async () => {
    const restaurant = await resolveAsPlatformAdmin(REGION_ADMIN_ID, 11);
    expect(restaurant.platform_admin_access).toBe(true);
    expect(restaurant.region_restricted_access).toBe(true);
    expect(restaurant.effective_role).toBe('regional_admin');
    expect(restaurant.effective_role).not.toBe('owner');
  });

  test('global admin keeps the historical owner-level bypass', async () => {
    const restaurant = await resolveAsPlatformAdmin(GLOBAL_ADMIN_ID, 12);
    expect(restaurant.effective_role).toBe('owner');
    expect(restaurant.platform_admin_access).toBe(true);
    expect(restaurant.region_restricted_access).toBeUndefined();
  });

  test('super_admin keeps the owner-level bypass', async () => {
    const restaurant = await resolveAsPlatformAdmin(SUPER_ADMIN_ID, 12);
    expect(restaurant.effective_role).toBe('owner');
  });

  test('with no active region grants the admin falls back to the global bypass (opt-in scoping)', async () => {
    // Revoke the only grant: no active regions -> falls back to the global
    // admin bypass (region scoping is opt-in once a region is assigned).
    grants.set(REGION_ADMIN_ID, []);
    const restaurant = await resolveAsPlatformAdmin(REGION_ADMIN_ID, 12);
    expect(restaurant.effective_role).toBe('owner');
  });

  test('owner-level endpoint returns 403 for the region admin, 200 for the global admin', async () => {
    const ctrl = require('../controllers/restaurantPayrollController');
    const payrollService = require('../services/restaurantPayrollService');

    const runEndpoint = async (userId, restaurantId) => {
      const req = { params: { restaurantId: String(restaurantId) }, user: { id: userId }, query: {} };
      const res = {};
      res.status = jest.fn(() => res);
      res.json = jest.fn((body) => { res.body = body; return res; });
      const next = jest.fn();
      await scopeModel.runAsPlatformAdmin(userId, () => ctrl.getTipPoolSettings(req, res, next));
      return { res, next };
    };

    // Region admin, in-region restaurant: gate passes, payroll.view denied.
    const denied = await runEndpoint(REGION_ADMIN_ID, 11);
    expect(payrollService.getTipPoolSettings).not.toHaveBeenCalled();
    expect(denied.next).toHaveBeenCalledTimes(1);
    expect(denied.next.mock.calls[0][0]).toMatchObject({ status: 403 });

    // Global admin: owner bypass -> payroll.view held -> 200.
    const allowed = await runEndpoint(GLOBAL_ADMIN_ID, 11);
    expect(allowed.next).not.toHaveBeenCalled();
    expect(allowed.res.json).toHaveBeenCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ pooling_enabled: false }) })
    );
  });
});
