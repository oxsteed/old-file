'use strict';

/**
 * WP-064 restaurant menu and catalog management — PostgreSQL evidence that a
 * store-A manager can reprice/86 an item at store A only, cannot touch store B
 * or an item from another restaurant, cannot change the shared menu, and that
 * guest reads per store show the intended override only (drafts stay hidden). */

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











ddescribe('store vs brand menu scope (WP-064, real database)', () => {
  let pool;
  let app;
  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE, TRUE)`,
      [id, `pa-catalog-${label}-${id}@example.invalid`, label],
    );
    mockUsers.set(id, { id, role: 'customer' });
    return id;
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

  test('store override at A only; B, foreign items and the shared menu refused; guests see the intended update', async () => {
    const owner = await newUser('owner'); const mgr = await newUser('mgr'); const other = await newUser('other');
    const mkRestaurant = async (u, name) => {
      const biz = (await pool.query(
        `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed, setup_status) VALUES ($1, $2, FALSE, TRUE, TRUE, 'active') RETURNING id`, [u, name])).rows[0].id;
      const r = (await pool.query(
        `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status, discovery_status) VALUES ($1, $2, $3, 'active', 'visible') RETURNING id`, [biz, u, name])).rows[0].id;
      return { biz, r };
    };
    const { biz, r } = await mkRestaurant(owner, 'Catalog Two Stores');
    const foreign = await mkRestaurant(other, 'Elsewhere Diner');
    const storeA = (await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary', [r])).rows[0].id;
    const storeB = (await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Store B') RETURNING id`, [r])).rows[0].id;
    const mgrM = (await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'manager', $4, 'active', NOW()) RETURNING id`, [biz, owner, mgr, `mgr-${mgr}@example.invalid`])).rows[0].id;
    await pool.query(`INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status) VALUES ($1, $2, $3, 'active')`, [r, storeA, mgrM]);
    const item = async (rid, name, pub) => (await pool.query(
      `INSERT INTO food_menu_items (restaurant_id, name, price_cents, publication_status) VALUES ($1, $2, 1000, $3) RETURNING id`, [rid, name, pub])).rows[0].id;
    const soup = await item(r, 'Soup', 'published');
    const secret = await item(r, 'Secret Draft', 'draft');
    const foreignItem = await item(foreign.r, 'Foreign Pie', 'published');

    const storePatch = (loc, it, body) => as(mgr, request(app).patch(`/api/restaurants/${r}/locations/${loc}/menu-items/${it}`)).send(body);
    expect((await storePatch(storeA, soup, { priceCents: 1250 })).status).toBe(200);
    expect((await storePatch(storeB, soup, { priceCents: 1 })).status).toBe(403);
    expect([403, 404]).toContain((await storePatch(storeA, foreignItem, { priceCents: 1 })).status);
    expect((await as(mgr, request(app).patch(`/api/food/restaurants/${r}/menu-items/${soup}`)).send({ priceCents: 1 })).body.code).toBe('location_scope_forbidden');
    const overrides = await pool.query('SELECT location_id FROM restaurant_store_menu_overrides WHERE restaurant_id = $1', [r]);
    expect(overrides.rows.map((x) => String(x.location_id))).toEqual([String(storeA)]);
    expect((await pool.query('SELECT price_cents FROM food_menu_items WHERE id = $1', [soup])).rows[0].price_cents).toBe(1000);
    expect((await pool.query('SELECT count(*)::int AS n FROM restaurant_store_menu_overrides WHERE restaurant_id = $1', [foreign.r])).rows[0].n).toBe(0);

    // Guests: store A shows the override, store B the brand price; the draft never shows.
    const guestMenu = async (loc) => {
      const res = await request(app).get(`/api/food/restaurants/${r}?locationId=${loc}`);
      expect(res.status).toBe(200);
      return JSON.stringify(res.body);
    };
    const atA = await guestMenu(storeA); const atB = await guestMenu(storeB);
    expect(atA).toContain('Soup'); expect(atB).toContain('Soup');
    expect(atA).not.toContain('Secret Draft'); expect(atB).not.toContain('Secret Draft');
    expect(atA).toMatch(/"price_cents":1250/);
    expect(atB).not.toMatch(/"price_cents":1250/);
    void secret;
  });
});
