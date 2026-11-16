'use strict';

/**
 * WP-066 cashier POS and drawer operations / shared inventory records —
 * PostgreSQL evidence that a store-A manager cannot create or overwrite the
 * restaurant-wide storage areas and suppliers (shared by store B), that a
 * responsible person must be on the team, and that an all-store manager and
 * the owner still can. Cashier/drawer/device isolation is covered by the
 * CI-run restaurantStoreIsolation.db.test.js (two stores, device and receipt). */

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
  authenticateIfPresent: (req, res, next) => (req.get('x-test-user') ? mockFakeAuth(req, res, next) : next()),
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












ddescribe('shared inventory records need all-store scope (WP-066, real database)', () => {
  let pool;
  let app;
  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-inv-${label}-${id}@example.invalid`, label],
    );
    mockUsers.set(id, { id, role: 'customer' });
    return id;
  }
  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/restaurants', require('../routes/restaurants'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('store-scoped managers cannot rewrite shared areas or suppliers', async () => {
    const owner = await newUser('owner'); const storeMgr = await newUser('storemgr'); const hq = await newUser('hq'); const stranger = await newUser('stranger');
    const biz = (await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, 'Inventory Two Stores', FALSE, TRUE, FALSE) RETURNING id`, [owner])).rows[0].id;
    const r = (await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status) VALUES ($1, $2, 'Inventory Two Stores', 'active') RETURNING id`, [biz, owner])).rows[0].id;
    const storeA = (await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary', [r])).rows[0].id;
    await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Store B')`, [r]);
    const memberOf = async (u, role) => (await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW()) RETURNING id`, [biz, owner, u, role, `${role}-${u}@example.invalid`])).rows[0].id;
    const storeMgrM = await memberOf(storeMgr, 'manager');
    await memberOf(hq, 'manager');
    await pool.query(`INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status) VALUES ($1, $2, $3, 'active')`, [r, storeA, storeMgrM]);

    const post = (u, path, body) => request(app).post(`/api/restaurants/${r}/inventory/${path}`).set('x-test-user', u).send(body);
    expect((await post(owner, 'suppliers', { name: 'Fresh Co', phone: '555-0100' })).status).toBe(201);
    // Store-A manager: an upsert would overwrite the supplier store B relies on.
    const hijack = await post(storeMgr, 'suppliers', { name: 'Fresh Co', phone: '555-9999' });
    expect(hijack.status).toBe(403);
    expect(hijack.body.code).toBe('location_scope_forbidden');
    expect((await post(storeMgr, 'areas', { name: 'Walk-in' })).body.code).toBe('location_scope_forbidden');
    expect((await pool.query('SELECT phone FROM restaurant_inventory_suppliers WHERE restaurant_id = $1', [r])).rows[0].phone).toBe('555-0100');
    expect((await pool.query('SELECT count(*)::int AS n FROM restaurant_inventory_storage_areas WHERE restaurant_id = $1', [r])).rows[0].n).toBe(0);

    // All-store manager: allowed; responsible person must be on the team.
    expect((await post(hq, 'areas', { name: 'Walk-in', responsibleUserId: stranger })).status).toBe(400);
    const ok = await post(hq, 'areas', { name: 'Walk-in', responsibleUserId: storeMgr });
    expect(ok.status).toBe(201);
    expect(ok.body.area.responsible_user_id).toBe(storeMgr);
    expect((await post(hq, 'suppliers', { name: 'Fresh Co', phone: '555-0101' })).status).toBe(201);
  });
});
