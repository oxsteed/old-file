'use strict';

/**
 * WP-065 restaurant host stand and reservations — PostgreSQL evidence that a
 * store-A host seats/reserves on store-A tables only (a store-B table or store
 * B itself is refused without writing), and that a staffing-only promotion
 * (team/calendar permissions) does not imply host permissions. */

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











ddescribe('host stand at the exact store (WP-065, real database)', () => {
  let pool;
  let app;
  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-host-${label}-${id}@example.invalid`, label],
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

  test('reservations and seating stay on the host store; staffing rights do not imply hosting', async () => {
    const owner = await newUser('owner'); const host = await newUser('host'); const scheduler = await newUser('scheduler');
    const biz = (await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, 'Host Two Stores', FALSE, TRUE, FALSE) RETURNING id`, [owner])).rows[0].id;
    const r = (await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status) VALUES ($1, $2, 'Host Two Stores', 'active') RETURNING id`, [biz, owner])).rows[0].id;
    const storeA = (await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary', [r])).rows[0].id;
    const storeB = (await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Store B') RETURNING id`, [r])).rows[0].id;
    const table = async (loc, name) => (await pool.query(
      `INSERT INTO restaurant_tables (restaurant_id, location_id, name, capacity) VALUES ($1, $2, $3, 4) RETURNING id`, [r, loc, name])).rows[0].id;
    const tA = await table(storeA, 'A1'); const tB = await table(storeB, 'B1');
    const memberOf = async (u, role) => (await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW()) RETURNING id`, [biz, owner, u, role, `${role}-${u}@example.invalid`])).rows[0].id;
    const hostM = await memberOf(host, 'employee');
    await pool.query(`INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status) VALUES ($1, $2, $3, 'active')`, [r, storeA, hostM]);
    const schedM = await memberOf(scheduler, 'support_agent');
    await pool.query(
      `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect, reason, granted_by_user_id)
       SELECT $1, p.id, 'allow', 'staffing promotion', $2 FROM team_permissions p
        WHERE p.code IN ('team.view', 'team.edit_member', 'team.assign_roles', 'calendar.manage_all', 'calendar.view_all')`, [schedM, owner]);

    const startsAt = new Date(Date.now() + 86400000).toISOString();
    const endsAt = new Date(Date.now() + 90000000).toISOString();
    const reserve = (u, locationId, tableId, key) => request(app).post(`/api/restaurants/${r}/reservations`).set('x-test-user', u)
      .send({ locationId, tableId, guestName: 'Pat Guest', partySize: 2, startsAt, endsAt, idempotencyKey: key });
    const count = async () => (await pool.query('SELECT count(*)::int AS n FROM restaurant_reservations WHERE restaurant_id = $1', [r])).rows[0].n;

    expect((await reserve(host, storeA, tA, `k1-${r}`)).status).toBe(201);
    expect(await count()).toBe(1);
    // A store-B table under a store-A booking, and a store-B booking: refused, nothing written.
    expect([400, 403, 404, 409]).toContain((await reserve(host, storeA, tB, `k2-${r}`)).status);
    expect((await reserve(host, storeB, tB, `k3-${r}`)).status).toBe(403);
    expect(await count()).toBe(1);
    // Seating: store-A table yes, store-B table no.
    const seat = (u, t) => request(app).post(`/api/restaurants/${r}/tables/${t}/seating`).set('x-test-user', u).send({ partySize: 2 });
    expect([403, 404]).toContain((await seat(host, tB)).status);
    expect((await pool.query('SELECT count(*)::int AS n FROM restaurant_table_seatings WHERE table_id = $1', [tB])).rows[0].n).toBe(0);

    // Staffing-only promotion: no host stand.
    expect((await reserve(scheduler, storeA, tA, `k4-${r}`)).status).toBe(403);
    expect((await request(app).get(`/api/restaurants/${r}/reservations`).set('x-test-user', scheduler)).status).toBe(403);
    expect([403, 404]).toContain((await seat(scheduler, tA)).status);
    expect(await count()).toBe(1);
  });
});
