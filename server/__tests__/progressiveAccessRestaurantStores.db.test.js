'use strict';

/**
 * WP-061 restaurant membership and assigned store scope — PostgreSQL evidence
 * that a manager assigned to store A cannot administer store assignments (brand
 * surface) or write store B's menu; an all-store manager cannot edit their own
 * or a peer's boundary or grant a store role at their rank; the owner can;
 * refused attempts write nothing; removal ends access. */

jest.unmock('pg');
// Real BEGIN/COMMIT on one connection: the per-owner lock must be exercised.
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.ACCESS_TEST_DATABASE_URL || '';
function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/(credit_statement_test|pa_t\d+)$/.test(url.pathname);
  } catch { return false; }
}
if (RAW_URL && !isDisposableDb(RAW_URL)) throw new Error('Progressive access DB tests require a loopback disposable database');
const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.LOG_LEVEL = 'error';
}
process.env.ACCESS_REQUESTS_ENABLED = 'true';
process.env.ACCESS_PROJECTION_ENABLED = 'true';

const mockUsers = new Map();
function mockFakeAuth(req, res, next) {
  const id = req.get('x-test-user');
  const u = id && mockUsers.get(id);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  req.user = { ...u };
  return next();
}
jest.mock('../middleware/auth', () => ({
  authenticate: (...a) => mockFakeAuth(...a),
  requireAuth: (...a) => mockFakeAuth(...a),
  optionalAuth: (req, res, next) => (req.get('x-test-user') ? mockFakeAuth(req, res, next) : next()),
}));
jest.mock('../middleware/adminAuth', () => {
  const actual = jest.requireActual('../middleware/adminAuth');
  return {
    ...actual,
    requireAdmin: (req, res, next) => mockFakeAuth(req, res, () => {
      if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required.' });
      req.isSuper = req.user.role === 'super_admin';
      return next();
    }),
  };
});

jest.setTimeout(120000);

const HELPER_ANSWERS = { serviceCategories: ['plumbing'], serviceArea: { country: 'US', region: 'OH', city: 'Springfield' } };









ddescribe('restaurant assigned store scope (WP-061, real database)', () => {
  let pool;
  let app;
  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-store-${label}-${id}@example.invalid`, label],
    );
    mockUsers.set(id, { id, role: 'customer' });
    return id;
  }
  async function member(biz, owner, user, role) {
    return (await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW()) RETURNING id`, [biz, owner, user, role, `${role}-${user}@example.invalid`])).rows[0].id;
  }
  const put = (u, r, m, body) => request(app).put(`/api/restaurants/${r}/location-access/${m}`).set('x-test-user', u).send(body);
  const clear = (u, r, m) => request(app).delete(`/api/restaurants/${r}/location-access/${m}`).set('x-test-user', u);
  const menuPatch = (u, r, l, item) => request(app).patch(`/api/restaurants/${r}/locations/${l}/menu-items/${item}`).set('x-test-user', u).send({ isAvailable: false });

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/restaurants', require('../routes/restaurants'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('a store-A manager administers only store A', async () => {
    const owner = await newUser('owner'); const mgr = await newUser('mgr'); const emp = await newUser('emp');
    const biz = (await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, 'Two Stores', FALSE, TRUE, FALSE) RETURNING id`, [owner])).rows[0].id;
    const r = (await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status) VALUES ($1, $2, 'Two Stores', 'active') RETURNING id`, [biz, owner])).rows[0].id;
    const loc = async (name, primary) => (await pool.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, is_primary) VALUES ($1, $2, $3) RETURNING id`, [r, name, primary])).rows[0].id;
    const existing = (await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary', [r])).rows[0];
    const storeA = existing ? existing.id : await loc('Store A', true); const storeB = await loc('Store B', false);
    const mgrM = await member(biz, owner, mgr, 'manager');
    const empM = await member(biz, owner, emp, 'employee');
    await pool.query(`INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status) VALUES ($1, $2, $3, 'active')`, [r, storeA, mgrM]);

    const hq = await newUser('hq'); const hqM = await member(biz, owner, hq, 'manager');
    // A store-A manager cannot administer store assignments at all (brand-level surface).
    for (const res of [await put(mgr, r, empM, { locationIds: [storeA] }), await put(mgr, r, empM, { locationIds: [storeA, storeB] }),
      await put(mgr, r, mgrM, { locationIds: [storeA, storeB] }), await clear(mgr, r, empM)]) {
      expect(res.status).toBe(403);
    }
    // An all-store manager: may scope an employee, but not themself, a peer manager,
    // and may not hand out a store role at their own rank.
    expect((await put(hq, r, empM, { locationIds: [storeA] })).status).toBe(200);
    expect((await put(hq, r, hqM, { locationIds: [storeA] })).body.code).toBe('store_scope_self');
    expect((await put(hq, r, mgrM, { locationIds: [storeA, storeB] })).body.code).toBe('store_scope_rank');
    expect((await clear(hq, r, mgrM)).body.code).toBe('store_scope_rank');
    expect((await put(hq, r, empM, { locationIds: [storeA], roleOverride: 'manager' })).body.code).toBe('store_scope_rank');
    const still = await pool.query(`SELECT location_id FROM restaurant_location_memberships WHERE membership_id = $1 AND status = 'active'`, [mgrM]);
    expect(still.rows.map((x) => String(x.location_id))).toEqual([String(storeA)]);
    // Store menus: A is theirs to 86, B is out of reach (existing F-02 boundary).
    const item = (await pool.query(`INSERT INTO food_menu_items (restaurant_id, name, price_cents) VALUES ($1, 'Soup', 500) RETURNING id`, [r])).rows[0].id;
    expect((await menuPatch(mgr, r, storeA, item)).status).toBe(200);
    expect((await menuPatch(mgr, r, storeB, item)).status).toBe(403);
    expect((await pool.query('SELECT count(*)::int AS n FROM restaurant_store_menu_overrides WHERE location_id = $1', [storeB])).rows[0].n).toBe(0);

    // The owner is not store-scoped.
    expect((await put(owner, r, empM, { locationIds: [storeA, storeB] })).status).toBe(200);
    expect((await clear(owner, r, empM)).status).toBe(200);
    const audit = await pool.query(
      `SELECT action FROM business_audit_log WHERE business_id = $1 AND action LIKE 'restaurant.location_memberships.%' ORDER BY id`, [biz]);
    expect(audit.rows.map((x) => x.action)).toEqual([
      'restaurant.location_memberships.replaced', 'restaurant.location_memberships.replaced', 'restaurant.location_memberships.cleared']);
    expect(audit.rows).toHaveLength(3); // refused attempts leave no audit write

    // Removal ends store access.
    await pool.query(`UPDATE business_members SET status = 'revoked' WHERE id = $1`, [mgrM]);
    await pool.query(`UPDATE business_members SET status = 'revoked' WHERE id = $1`, [hqM]);
    expect([403, 404]).toContain((await put(hq, r, empM, { locationIds: [storeA] })).status);
    expect([403, 404]).toContain((await menuPatch(mgr, r, storeA, item)).status);
  });
});
