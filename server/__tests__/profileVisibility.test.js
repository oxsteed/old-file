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
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        profile_id: 'helper-1', display_name: 'Marie J', detail: 'marie@example.com',
        is_hidden_by_admin: true, hidden_reason: 'non_compliance', owner_listed: true,
      }] })
      .mockResolvedValueOnce({ rows: [{
        profile_id: 'biz-1', display_name: 'Top Plumbing', detail: 'owner@example.com',
        is_hidden_by_admin: false, hidden_reason: null, owner_listed: false, owner_active: true,
      }] })
      .mockResolvedValueOnce({ rows: [{
        profile_id: 7, display_name: 'Chez Marie', detail: 'Top Plumbing',
        is_hidden_by_admin: false, hidden_reason: null, discovery_status: 'visible',
      }] });

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
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: true, hidden_reason: 'non_compliance', hidden_at: '2026-09-30' }] })
      .mockResolvedValueOnce({ rows: [] }); // audit log insert
    const res = resDouble();
    await profileVisibility.setProfileVisibility(reqDouble({
      body: { profile_type: 'helper', profile_id: 'helper-1', is_visible: false, reason: 'non_compliance', note: 'Missing license' },
    }), res);

    expect(res.payload.success).toBe(true);
    expect(res.payload.is_hidden_by_admin).toBe(true);
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).toMatch(/UPDATE helper_profiles/);
    expect(updateSql).toMatch(/is_hidden_by_admin/);
    expect(mockQuery.mock.calls[0][1]).toEqual([true, 'non_compliance', 'admin-1', 'helper-1']);
  });

  test('restoring clears the flag, reason, actor, and timestamp', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: false, hidden_reason: null, hidden_at: null }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = resDouble();
    await profileVisibility.setProfileVisibility(reqDouble({
      body: { profile_type: 'restaurant', profile_id: 7, is_visible: true },
    }), res);

    expect(res.payload.is_visible).toBe(true);
    expect(res.payload.is_hidden_by_admin).toBe(false);
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).toMatch(/UPDATE food_restaurants/);
    expect(mockQuery.mock.calls[0][1]).toEqual([false, null, 'admin-1', 7]);
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

  test('every public restaurant surface honors the admin hold alongside discovery', () => {
    const src = read('controllers/foodController.js');
    const pairs = src.match(/AND fr\.discovery_status = 'visible'\n *AND COALESCE\(fr\.is_hidden_by_admin, FALSE\) = FALSE/g) || [];
    expect(pairs.length).toBe(7);
  });

  test('migration 614 adds the override columns to all three profile tables', () => {
    const sql = read('migrations/614_profile_visibility_admin_override.sql');
    for (const table of ['helper_profiles', 'businesses', 'food_restaurants']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table}[\\s\\S]*?is_hidden_by_admin`, 'm'));
    }
  });
});
