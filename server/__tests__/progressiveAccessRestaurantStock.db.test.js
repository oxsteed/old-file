'use strict';

/**
 * WP-068 inventory and purchase operations — PostgreSQL evidence that an
 * representative (view-only by role) promoted to inventory (inventory.update override) and assigned to
 * store A counts store-A stock and raises store-A purchase requests, cannot
 * adjust a store-B item or forge a store-B purchase request, and that after
 * the promotion is revoked the history stays intact but writes stop. */

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













ddescribe('inventory at the exact store (WP-068, real database)', () => {
  let pool;
  let app;
  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-stock-${label}-${id}@example.invalid`, label],
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

  test('promoted at A: counts A, cannot touch B, history survives revoke', async () => {
    const owner = await newUser('owner'); const clerk = await newUser('clerk');
    const biz = (await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, 'Stock Two Stores', FALSE, TRUE, FALSE) RETURNING id`, [owner])).rows[0].id;
    const r = (await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status) VALUES ($1, $2, 'Stock Two Stores', 'active') RETURNING id`, [biz, owner])).rows[0].id;
    const storeA = (await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary', [r])).rows[0].id;
    const storeB = (await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Store B') RETURNING id`, [r])).rows[0].id;
    const clerkM = (await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'representative', $4, 'active', NOW()) RETURNING id`, [biz, owner, clerk, `clerk-${clerk}@example.invalid`])).rows[0].id;
    await pool.query(`INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status) VALUES ($1, $2, $3, 'active')`, [r, storeA, clerkM]);
    await pool.query(
      `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect, reason, granted_by_user_id)
       SELECT $1, p.id, 'allow', 'inventory promotion', $2 FROM team_permissions p WHERE p.code IN ('inventory.view', 'inventory.update')`, [clerkM, owner]);
    const item = async (loc, name) => (await pool.query(
      `INSERT INTO restaurant_inventory_items (restaurant_id, location_id, name) VALUES ($1, $2, $3) RETURNING id`, [r, loc, name])).rows[0].id;
    const flourA = await item(storeA, 'Flour'); const flourB = await item(storeB, 'Flour');

    const adjust = (it, body) => request(app).post(`/api/restaurants/${r}/inventory/items/${it}/adjust`).set('x-test-user', clerk).send(body);
    const pr = (body) => request(app).post(`/api/restaurants/${r}/inventory/purchase-requests`).set('x-test-user', clerk).send(body);
    const adjustments = async () => (await pool.query('SELECT item_id FROM restaurant_inventory_adjustments WHERE restaurant_id = $1', [r])).rows;
    const requests = async () => (await pool.query('SELECT location_id FROM restaurant_inventory_purchase_requests WHERE restaurant_id = $1', [r])).rows;

    const count = await adjust(flourA, { type: 'count', quantity: 12 });
    expect(count.status).toBeLessThan(300);
    expect([403, 404]).toContain((await adjust(flourB, { type: 'count', quantity: 0 })).status);
    expect([403, 404]).toContain((await adjust(flourB, { type: 'waste', delta: -5, locationId: storeA })).status);
    expect((await adjustments()).map((x) => String(x.item_id))).toEqual([String(flourA)]);

    expect((await pr({ itemName: 'Flour', requestedQuantity: 10, locationId: storeA })).status).toBeLessThan(300);
    expect([403, 404]).toContain((await pr({ itemName: 'Flour', requestedQuantity: 10, locationId: storeB })).status);
    expect((await requests()).map((x) => String(x.location_id))).toEqual([String(storeA)]);

    // Promotion revoked: writes stop, history stays.
    await pool.query('DELETE FROM membership_permission_overrides WHERE membership_id = $1', [clerkM]);
    require('../services/permissionsService').invalidateCache(biz, clerk); // what the overrides endpoint does
    expect((await adjust(flourA, { type: 'count', quantity: 99 })).status).toBe(403);
    expect((await pr({ itemName: 'Sugar', requestedQuantity: 1, locationId: storeA })).status).toBe(403);
    expect(await adjustments()).toHaveLength(1);
    expect(await requests()).toHaveLength(1);
    const history = await request(app).get(`/api/restaurants/${r}/inventory/adjustments`).set('x-test-user', owner);
    expect(history.status).toBe(200);
    expect(JSON.stringify(history.body)).toContain('count');
  });
});
