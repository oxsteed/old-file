'use strict';

// Admin public-visibility override for helper, business, and restaurant
// profiles: search must unify the three profile types, hiding must set the
// sticky admin flag (so owner self-toggles cannot undo it), and every public
// profile query must honor the flag.

const fs = require('fs');
const path = require('path');
const { mockQuery, resetMocks } = require('./setup');
const profileVisibility = require('../controllers/profileVisibilityController');

function reqDouble(overrides = {}) {
  return {
    body: {},
    query: {},
    user: { id: 'admin-1' },
    ...overrides,
  };
}

function resDouble() {
  const res = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  return res;
}

beforeEach(() => {
  resetMocks();
});

describe('manage_profile_visibility grant', () => {
  test('is registered in the permission catalogue', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'controllers/adminPermissionController.js'), 'utf8'
    );
    expect(src).toMatch(/manage_profile_visibility:\s*'[^']*visib/i);
  });
});

describe('searchProfiles', () => {
  test('short queries return empty results without touching the database', async () => {
    const res = resDouble();
    await profileVisibility.searchProfiles(reqDouble({ query: { q: 'a' } }), res);
    expect(res.payload).toEqual({ results: [] });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects an unknown profile type', async () => {
    const res = resDouble();
    await profileVisibility.searchProfiles(reqDouble({ query: { q: 'marie', type: 'alien' } }), res);
    expect(res.statusCode).toBe(400);
  });

  test('unifies helpers, businesses, and restaurants with computed visibility', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      {
        profile_type: 'helper', profile_id: 'helper-1', display_name: 'Marie J', detail: 'marie@example.com',
        is_hidden_by_admin: true, hidden_reason: 'non_compliance', owner_visible: true, is_active: true, total_count: 3,
      },
      {
        profile_type: 'business', profile_id: 'biz-1', display_name: 'Top Plumbing', detail: 'owner@example.com',
        is_hidden_by_admin: false, hidden_reason: null, owner_visible: false, is_active: true, total_count: 3,
      },
      {
        profile_type: 'restaurant', profile_id: '7', display_name: 'Chez Marie', detail: 'Top Plumbing',
        is_hidden_by_admin: false, hidden_reason: null, owner_visible: true, is_active: true, total_count: 3,
      },
    ] });

    const res = resDouble();
    await profileVisibility.searchProfiles(reqDouble({ query: { q: 'marie' } }), res);

    expect(res.payload.results).toHaveLength(3);
    const [helper, business, restaurant] = res.payload.results;
    expect(helper.profile_type).toBe('helper');
    expect(helper.is_hidden_by_admin).toBe(true);
    expect(helper.hidden_reason).toBe('non_compliance');
    expect(helper.is_visible).toBe(false); // admin hold wins over owner listing
    expect(business.profile_type).toBe('business');
    expect(business.owner_visible).toBe(false);
    expect(business.is_visible).toBe(false);
    expect(restaurant.profile_type).toBe('restaurant');
    expect(restaurant.is_visible).toBe(true);
  });

  test('supports bounded browse pagination and visibility filters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      profile_type: 'business', profile_id: 'b-1', display_name: 'Active Co', detail: 'owner@example.com',
      is_hidden_by_admin: false, hidden_reason: null, owner_visible: true, is_active: true, total_count: 26,
    }] });
    const res = resDouble();
    await profileVisibility.searchProfiles(reqDouble({ query: {
      q: '', type: 'business', visibility: 'active', page: '2', limit: '100',
    } }), res);
    expect(res.payload).toMatchObject({ page: 2, limit: 50, total: 26, hasMore: false });
    expect(res.payload.results[0].profile_type).toBe('business');
    expect(mockQuery.mock.calls[0][1]).toEqual(['', '%%', 'business', 'active', 50, 50]);
  });
});

describe('setProfileVisibility', () => {
  test('validates profile_type, profile_id, is_visible, and reason', async () => {
    for (const body of [
      { profile_type: 'alien', profile_id: 'x', is_visible: false },
      { profile_type: 'helper', profile_id: '', is_visible: false },
      { profile_type: 'helper', profile_id: 'h1', is_visible: 'no' },
      { profile_type: 'business', profile_id: 'b1', is_visible: false, reason: 'bogus' },
    ]) {
      const res = resDouble();
      await profileVisibility.setProfileVisibility(reqDouble({ body }), res);
      expect(res.statusCode).toBe(400);
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('hiding sets the sticky admin flag with reason, actor, and timestamp', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: false, hidden_reason: null }] }) // current state
      .mockResolvedValueOnce({ rows: [{ user_id: 'helper-1' }] }) // active-work owner lookup
      .mockResolvedValueOnce({ rows: [] }) // active jobs
      .mockResolvedValueOnce({ rows: [] }) // upcoming appointments
      .mockResolvedValueOnce({ rows: [] }) // booking requests
      .mockResolvedValueOnce({ rows: [] }) // recent payments
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: true, hidden_reason: 'non_compliance', hidden_at: '2026-09-30' }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // audit log insert
    const res = resDouble();
    await profileVisibility.setProfileVisibility(reqDouble({
      body: { profile_type: 'helper', profile_id: 'helper-1', is_visible: false, reason: 'non_compliance', note: 'Missing license' },
    }), res);

    expect(res.payload.success).toBe(true);
    expect(res.payload.is_hidden_by_admin).toBe(true);
    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE helper_profiles/.test(sql));
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toMatch(/is_hidden_by_admin/);
    expect(updateCall[0]).toMatch(/hidden_by\s*=\s*CASE WHEN \$1 THEN \$3::uuid ELSE NULL END/);
    expect(updateCall[1]).toEqual([true, 'non_compliance', 'admin-1', 'helper-1']);
  });

  test('restoring clears the flag, reason, actor, and timestamp', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: true, hidden_reason: 'non_compliance' }] }) // current state
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: false, hidden_reason: null, hidden_at: null }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // audit log insert
    const res = resDouble();
    await profileVisibility.setProfileVisibility(reqDouble({
      body: { profile_type: 'restaurant', profile_id: 7, is_visible: true },
    }), res);

    expect(res.payload.is_visible).toBe(true);
    expect(res.payload.is_hidden_by_admin).toBe(false);
    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE food_restaurants/.test(sql));
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toEqual([false, null, 'admin-1', 7]);
  });

  test('hiding a profile with active work requires an approval', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: false, hidden_reason: null }] }) // current state
      .mockResolvedValueOnce({ rows: [{ user_id: 'helper-1' }] }) // active-work owner lookup
      .mockResolvedValueOnce({ rows: [{ id: 'job-1' }] }) // active jobs -> has_active_work
      .mockResolvedValueOnce({ rows: [] }) // upcoming appointments
      .mockResolvedValueOnce({ rows: [] }) // booking requests
      .mockResolvedValueOnce({ rows: [] }) // recent payments
      .mockResolvedValueOnce({ rows: [] }) // approval request insert (no row)
      .mockResolvedValueOnce({ rows: [] }); // approval request lookup (none)
    const res = resDouble();
    await profileVisibility.setProfileVisibility(reqDouble({
      body: { profile_type: 'helper', profile_id: 'helper-1', is_visible: false, reason: 'non_compliance' },
    }), res);

    expect(res.statusCode).toBe(409);
    expect(res.payload.approval_required).toBe(true);
    expect(res.payload.active_work.has_active_work).toBe(true);
    expect(res.payload.active_work.active_jobs).toBe(1);
    expect(mockQuery.mock.calls.some(([sql]) => /^UPDATE helper_profiles/.test(sql))).toBe(false);
  });

  test('returns 404 when the profile does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = resDouble();
    await profileVisibility.setProfileVisibility(reqDouble({
      body: { profile_type: 'business', profile_id: 'nope', is_visible: false },
    }), res);
    expect(res.statusCode).toBe(404);
  });
});

describe('getProfileHistory', () => {
  test('returns only visibility actions for the requested profile', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, action: 'profile_visibility_hidden', actor_name: 'Admin' }] });
    const res = resDouble();
    await profileVisibility.getProfileHistory(reqDouble({ params: { type: 'business', id: 'b-1' } }), res);
    expect(res.payload.history).toHaveLength(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(['business', 'b-1']);
    expect(mockQuery.mock.calls[0][0]).toMatch(/profile_visibility_hidden/);
  });

  test('rejects invalid profile references', async () => {
    const res = resDouble();
    await profileVisibility.getProfileHistory(reqDouble({ params: { type: 'unknown', id: 'x' } }), res);
    expect(res.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('public profile enforcement (static contract)', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  test('helper profile and directory honor the admin hold', () => {
    const src = read('controllers/helpersController.js');
    expect(src.match(/COALESCE\(hp\.is_hidden_by_admin, FALSE\) = FALSE/g).length).toBeGreaterThanOrEqual(2);
  });

  test('business public profile honors the admin hold', () => {
    const src = read('controllers/businessController.js');
    expect(src).toMatch(/COALESCE\(b\.is_hidden_by_admin, FALSE\) = FALSE/);
  });

  test.each([
    'listMarkets',
    'listRestaurants',
    'getRestaurant',
    'quoteOrder',
    'createOrder',
    'createCardPaymentIntent',
    'getQueueBoard',
    'listRestaurantPromotions',
    'listRestaurantLocations',
  ])('%s honors the admin hold alongside discovery', (handlerName) => {
    // Check each public surface rather than counting query fragments: adding
    // a guarded endpoint must not fail CI, nor mask an unguarded existing one.
    const handler = require('../controllers/foodController')[handlerName];
    expect(typeof handler).toBe('function');
    const src = handler.toString();
    expect(src).toMatch(/fr\.discovery_status\s*=\s*'visible'/);
    expect(src).toMatch(/COALESCE\(fr\.is_hidden_by_admin,\s*FALSE\)\s*=\s*FALSE/);
  });

  test('migration 614 adds the override columns to all three profile tables', () => {
    const sql = read('migrations/614_profile_visibility_admin_override.sql');
    for (const table of ['helper_profiles', 'businesses', 'food_restaurants']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table}[\\s\\S]*?is_hidden_by_admin`, 'm'));
    }
  });
});
