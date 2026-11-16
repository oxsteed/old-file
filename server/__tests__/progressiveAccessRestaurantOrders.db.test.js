'use strict';

/**
 * WP-063 restaurant order management and service cycle — PostgreSQL evidence
 * that a store-A employee moves store-A orders only; a store-B order update
 * fails without writing; a retry with the same idempotency key after the
 * actor's membership is removed is refused, and the kitchen event log (the
 * service-cycle counter) and ordered items reflect only committed transitions. */

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











ddescribe('order status at the exact store (WP-063, real database)', () => {
  let pool;
  let app;
  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-orders-${label}-${id}@example.invalid`, label],
    );
    mockUsers.set(id, { id, role: 'customer' });
    return id;
  }
  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/food', require('../routes/food'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('store-scoped transitions, foreign-store refusal, retry after removal', async () => {
    const owner = await newUser('owner'); const cook = await newUser('cook');
    const biz = (await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, 'Orders Two Stores', FALSE, TRUE, FALSE) RETURNING id`, [owner])).rows[0].id;
    const r = (await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status) VALUES ($1, $2, 'Orders Two Stores', 'active') RETURNING id`, [biz, owner])).rows[0].id;
    const storeA = (await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary', [r])).rows[0].id;
    const storeB = (await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Store B') RETURNING id`, [r])).rows[0].id;
    const cookM = (await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'employee', $4, 'active', NOW()) RETURNING id`, [biz, owner, cook, `cook-${cook}@example.invalid`])).rows[0].id;
    await pool.query(`INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status) VALUES ($1, $2, $3, 'active')`, [r, storeA, cookM]);
    const order = async (loc, q) => (await pool.query(
      `INSERT INTO food_orders (restaurant_id, business_id, queue_number, location_id, status, fulfillment_type, subtotal_cents, total_cents, payment_status)
       VALUES ($1, $2, $3, $4, 'received', 'pickup', 1000, 1000, 'paid') RETURNING id`, [r, biz, q, loc])).rows[0].id;
    const orderA = await order(storeA, 901); const orderB = await order(storeB, 902);
    const events = async (o) => (await pool.query('SELECT count(*)::int AS n FROM restaurant_kitchen_events WHERE food_order_id = $1', [o])).rows[0].n;
    const statusOf = async (o) => (await pool.query('SELECT status FROM food_orders WHERE id = $1', [o])).rows[0].status;
    const move = (u, o, status, key) => request(app).patch(`/api/food/restaurants/${r}/orders/${o}/status`)
      .set('x-test-user', u).set('Idempotency-Key', key).send({ status });

    const canCook = await move(cook, orderA, 'accepted', `a1-${orderA}`);
    expect(canCook.status).toBe(200);
    expect(await statusOf(orderA)).toBe('accepted');
    const afterA = await events(orderA);
    expect(afterA).toBeGreaterThan(0);

    // Foreign store: refused, nothing written.
    const foreign = await move(cook, orderB, 'accepted', `b1-${orderB}`);
    expect([403, 404]).toContain(foreign.status);
    expect(await statusOf(orderB)).toBe('received');
    expect(await events(orderB)).toBe(0);

    // Removal racing a retry: the removal is in flight (row locked, not yet
    // committed) when the request starts, so access resolved before the lock
    // still says "active". The in-transaction re-read waits and then refuses.
    const remover = await pool.connect();
    try {
      await remover.query('BEGIN');
      await remover.query(`UPDATE business_members SET status = 'revoked' WHERE id = $1`, [cookM]);
      const racing = move(cook, orderA, 'preparing', `a2-${orderA}`).then((x) => x);
      await new Promise((done) => setTimeout(done, 400));
      await remover.query('COMMIT');
      const raced = await racing;
      expect(raced.status).toBe(403);
    } finally { remover.release(); }
    expect(await statusOf(orderA)).toBe('accepted');
    // Later retries of a new transition and a replay of the old key: refused.
    expect([403, 404]).toContain((await move(cook, orderA, 'preparing', `a2-${orderA}`)).status);
    expect([403, 404]).toContain((await move(cook, orderA, 'accepted', `a1-${orderA}`)).status);
    expect(await statusOf(orderA)).toBe('accepted');
    expect(await events(orderA)).toBe(afterA);

    // The owner continues the service cycle; history is intact.
    expect((await move(owner, orderA, 'preparing', `o1-${orderA}`)).status).toBe(200);
    expect(await events(orderA)).toBeGreaterThan(afterA);
  });
});
