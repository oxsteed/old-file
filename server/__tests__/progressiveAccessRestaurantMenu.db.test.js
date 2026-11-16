'use strict';

/**
 * WP-062 dining and public menu — PostgreSQL evidence that the shared (brand)
 * menu is changed only with menu.manage AND all-store scope: a store-A manager
 * gets location_scope_forbidden and a read-only editor flag, an all-store
 * manager and the owner can edit, the guest storefront read is unchanged by
 * the viewer, and the store-B per-store menu stays out of reach. */

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










ddescribe('shared menu needs all-store scope (WP-062, real database)', () => {
  let pool;
  let app;
  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-menu-${label}-${id}@example.invalid`, label],
    );
    mockUsers.set(id, { id, role: 'customer' });
    return id;
  }
  async function member(biz, owner, user, role) {
    return (await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW()) RETURNING id`, [biz, owner, user, role, `${role}-${user}@example.invalid`])).rows[0].id;
  }
  const as = (u, req) => (u ? req.set('x-test-user', u) : req);

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/food', require('../routes/food'));
    app.use('/api/restaurants', require('../routes/restaurants'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('store-scoped staff cannot change the shared menu; all-store staff can', async () => {
    const owner = await newUser('owner'); const storeMgr = await newUser('storemgr'); const hq = await newUser('hq');
    const biz = (await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, 'Menu Two Stores', FALSE, TRUE, FALSE) RETURNING id`, [owner])).rows[0].id;
    const r = (await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status) VALUES ($1, $2, 'Menu Two Stores', 'active') RETURNING id`, [biz, owner])).rows[0].id;
    const storeA = (await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary', [r])).rows[0].id;
    const storeB = (await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Store B') RETURNING id`, [r])).rows[0].id;
    const storeMgrM = await member(biz, owner, storeMgr, 'manager');
    await member(biz, owner, hq, 'manager');
    await pool.query(`INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status) VALUES ($1, $2, $3, 'active')`, [r, storeA, storeMgrM]);

    const managed = async (u) => as(u, request(app).get(`/api/food/restaurants/${r}/menu/manage`));
    expect((await managed(owner)).body.canEditBrandMenu).toBe(true);
    expect((await managed(hq)).body.canEditBrandMenu).toBe(true);
    const scoped = await managed(storeMgr);
    expect(scoped.status).toBe(200);
    expect(scoped.body.canEditBrandMenu).toBe(false);

    const cat = (u, name) => as(u, request(app).post(`/api/food/restaurants/${r}/categories`)).send({ name });
    const denied = await cat(storeMgr, 'Sneaky');
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('location_scope_forbidden');
    expect((await cat(hq, 'Soups')).status).toBe(201);
    expect((await cat(owner, 'Mains')).status).toBe(201);
    const names = (await pool.query('SELECT name FROM food_menu_categories WHERE restaurant_id = $1 ORDER BY name', [r])).rows.map((x) => x.name);
    expect(names).toEqual(['Mains', 'Soups']);

    // Store menus: A readable to the store-A manager, B is not.
    expect((await as(storeMgr, request(app).get(`/api/restaurants/${r}/locations/${storeA}/menu`))).status).toBe(200);
    expect((await as(storeMgr, request(app).get(`/api/restaurants/${r}/locations/${storeB}/menu`))).status).toBe(403);

    // The public storefront read does not depend on who is asking.
    const guest = await request(app).get(`/api/food/restaurants/${r}`);
    const staffView = await as(storeMgr, request(app).get(`/api/food/restaurants/${r}`));
    expect(staffView.status).toBe(guest.status);
    if (guest.status === 200) expect(Object.keys(staffView.body).sort()).toEqual(Object.keys(guest.body).sort());
  });
});
