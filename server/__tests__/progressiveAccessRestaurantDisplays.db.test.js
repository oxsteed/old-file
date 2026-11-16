'use strict';

/**
 * WP-067 kitchen and queue displays — PostgreSQL evidence that a kitchen
 * display paired to store A reads and acknowledges store-A tickets only (feed
 * and ack were restaurant-wide for paired displays), keeps working for its own
 * store after a manager's human grant is revoked, and that a kiosk-role
 * pairing token cannot write kitchen tickets. */

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












ddescribe('paired kitchen displays stay on their store (WP-067, real database)', () => {
  let pool;
  let app;
  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-kds-${label}-${id}@example.invalid`, label],
    );
    mockUsers.set(id, { id, role: 'customer' });
    return id;
  }
  const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/restaurants', require('../routes/restaurants'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('store-A display: feed and ack for store A only; kiosk token cannot write', async () => {
    const owner = await newUser('owner'); const mgr = await newUser('mgr');
    const biz = (await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, 'KDS Two Stores', FALSE, TRUE, FALSE) RETURNING id`, [owner])).rows[0].id;
    const r = (await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status) VALUES ($1, $2, 'KDS Two Stores', 'active') RETURNING id`, [biz, owner])).rows[0].id;
    const storeA = (await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary', [r])).rows[0].id;
    const storeB = (await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Store B') RETURNING id`, [r])).rows[0].id;
    const mgrM = (await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'manager', $4, 'active', NOW()) RETURNING id`, [biz, owner, mgr, `mgr-${mgr}@example.invalid`])).rows[0].id;
    const pair = async (loc, role) => {
      const token = crypto.randomBytes(32).toString('hex');
      const id = (await pool.query(
        `INSERT INTO display_pairings (restaurant_id, location_id, code_hash, expires_at, paired_at, pairing_token_hash, device_role, label)
         VALUES ($1, $2, $3, NOW() + interval '1 hour', NOW(), $4, $5, 'Pass') RETURNING id`,
        [r, loc, sha(crypto.randomUUID()), sha(token), role])).rows[0].id;
      await pool.query(
        `INSERT INTO restaurant_devices (restaurant_id, location_id, device_role, pairing_source, source_key, source_display_pairing_id, status)
         VALUES ($1, $2, $3, 'display_pairing', $4, $5, 'active')`,
        [r, loc, role === 'kiosk' ? 'kiosk' : 'kitchen', `display:${id}`, id]);
      return token;
    };
    const kds = await pair(storeA, 'kitchen');
    const kiosk = await pair(storeA, 'kiosk');
    const order = async (loc, q) => (await pool.query(
      `INSERT INTO food_orders (restaurant_id, business_id, queue_number, location_id, status, fulfillment_type, subtotal_cents, total_cents, payment_status)
       VALUES ($1, $2, $3, $4, 'received', 'pickup', 1000, 1000, 'paid') RETURNING id`, [r, biz, q, loc])).rows[0].id;
    const orderA = await order(storeA, 7701); const orderB = await order(storeB, 7702);
    const statusOf = async (o) => (await pool.query('SELECT status FROM food_orders WHERE id = $1', [o])).rows[0].status;
    const asDevice = (tok, req) => req.set('Authorization', `Bearer ${tok}`);

    // The manager's human grant goes away; the device credential is independent.
    await pool.query(`UPDATE business_members SET status = 'revoked' WHERE id = $1`, [mgrM]);

    const feed = await asDevice(kds, request(app).get(`/api/restaurants/${r}/kitchen/feed`));
    expect(feed.status).toBe(200);
    const ids = JSON.stringify(feed.body);
    expect(ids).toContain('7701');
    expect(ids).not.toContain('7702');

    const ack = (tok, o) => asDevice(tok, request(app).post(`/api/restaurants/${r}/kitchen/orders/${o}/ack`)).send({});
    expect([403, 404]).toContain((await ack(kds, orderB)).status);
    expect(await statusOf(orderB)).toBe('received');
    expect((await ack(kds, orderA)).status).toBe(201);
    expect(await statusOf(orderA)).toBe('accepted');

    // A kiosk pairing is not a kitchen credential.
    expect((await ack(kiosk, orderB)).status).toBe(401);
    expect(await statusOf(orderB)).toBe('received');
  });
});
