'use strict';

/**
 * WP-060 restaurant application and activation — PostgreSQL evidence that
 * opening a draft storefront (direct old endpoint) needs the canonical owner's
 * approved restaurant.own/business.own under ACCESS_BUSINESS_ENFORCEMENT=enforce,
 * a business-scoped grant opens only that business's store, a paused store can
 * re-open, and a manager cannot borrow approval the owner lacks. */

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








ddescribe('restaurant activation needs the owner approval (WP-060, real database)', () => {
  let pool;
  let app;

  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-rest-${label}-${id}@example.invalid`, label],
    );
    mockUsers.set(id, { id, role: 'customer' });
    return id;
  }
  async function restaurantFor(owner, name, status = 'draft') {
    const biz = (await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, $2, FALSE, TRUE, FALSE) RETURNING id`, [owner, name])).rows[0].id;
    const r = (await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status) VALUES ($1, $2, $3, $4) RETURNING id`,
      [biz, owner, name, status])).rows[0].id;
    return { biz, r };
  }
  const publish = (u, r, status = 'active') => request(app).patch(`/api/restaurants/${r}/publishing`).set('x-test-user', u).send({ status });
  const statusOf = async (r) => (await pool.query('SELECT status FROM food_restaurants WHERE id = $1', [r])).rows[0].status;

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/restaurants', require('../routes/restaurants'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => {
    delete process.env.ACCESS_BUSINESS_ENFORCEMENT;
    if (pool) await pool.end();
  });

  test('draft storefronts open only under an approval for that store', async () => {
    process.env.ACCESS_BUSINESS_ENFORCEMENT = 'enforce';
    const owner = await newUser('owner'); const mgr = await newUser('mgr');
    const a = await restaurantFor(owner, 'Alpha Bistro');
    const c = await restaurantFor(owner, 'Gamma Grill');
    const paused = await restaurantFor(owner, 'Paused Diner', 'paused');
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'manager', $4, 'active', NOW())`, [a.biz, owner, mgr, `mgr-${mgr}@example.invalid`]);

    // No approval: neither the owner nor the manager can open the draft via the old endpoint.
    const denied = await publish(owner, a.r);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'access_required', capability: 'restaurant.own' });
    expect((await publish(mgr, a.r)).body.code).toBe('access_required');
    expect(await statusOf(a.r)).toBe('draft');
    // A previously published (paused) store re-opens on its own state machine.
    expect((await publish(owner, paused.r)).status).toBe(200);

    // A grant scoped to business A opens A's store only.
    await pool.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_id, subject_key, status, provenance, policy_version)
       VALUES ($1, 'restaurant.own', 'business', $2, $3, 'active', 'admin', 'restaurant-owner-policy-1')`, [owner, String(a.biz), `business:${a.biz}`]);
    expect((await publish(mgr, a.r)).status).toBe(200);
    expect(await statusOf(a.r)).toBe('active');
    expect((await publish(owner, c.r)).body.code).toBe('access_required');
    expect(await statusOf(c.r)).toBe('draft');
    // ... and it gives the manager nothing at the other store.
    expect([403, 404]).toContain((await publish(mgr, c.r)).status);

    // Off (default): legacy behaviour, no gate.
    process.env.ACCESS_BUSINESS_ENFORCEMENT = 'off';
    expect((await publish(owner, c.r)).status).toBe(200);
  });
});
