'use strict';

/**
 * WP-073 restaurant and multi-location statements — PostgreSQL evidence that
 * a manager approved for staffing but denied finance (payouts.view deny) gets
 * no restaurant settlement in the statement center and a 404 from the
 * archive; with finance read restored they see it; a store-scoped manager
 * never reads the restaurant-wide settlement; standing is re-checked on every
 * request, so a previously working link stops after the deny. */

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















ddescribe('statement finance standing (WP-073, real database)', () => {
  let pool;
  let app;
  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-stmt-${label}-${id}@example.invalid`, label],
    );
    mockUsers.set(id, { id, role: 'customer' });
    return id;
  }
  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api', require('../routes/statementCenter'));
    app.use('/api/settlement-statements', require('../routes/settlementStatementArchive'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('finance reads follow payouts.view and store scope, not membership', async () => {
    const perms = require('../services/permissionsService');
    const owner = await newUser('owner'); const mgr = await newUser('mgr'); const storeMgr = await newUser('storemgr');
    const biz = (await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, 'Stmt Bistro', FALSE, TRUE, FALSE) RETURNING id`, [owner])).rows[0].id;
    const r = (await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status) VALUES ($1, $2, 'Stmt Bistro', 'active') RETURNING id`, [biz, owner])).rows[0].id;
    const storeA = (await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary', [r])).rows[0].id;
    const memberOf = async (u) => (await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'manager', $4, 'active', NOW()) RETURNING id`, [biz, owner, u, `m-${u}@example.invalid`])).rows[0].id;
    const mgrM = await memberOf(mgr); const storeMgrM = await memberOf(storeMgr);
    await pool.query(`INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status) VALUES ($1, $2, $3, 'active')`, [r, storeA, storeMgrM]);

    const center = async (u) => (await request(app).get('/api/statements/center').set('x-test-user', u)).body;
    const hasSettlement = (body) => (body?.products?.restaurantSettlement?.scopes || [])
      .some((scope) => scope.restaurantId === String(r) && scope.statementStatus !== 'location_reports');
    const archive = (u) => request(app).get(`/api/settlement-statements/archive?product=restaurant_settlement&restaurantId=${r}`).set('x-test-user', u);

    expect(hasSettlement(await center(owner))).toBe(true);
    expect((await archive(owner)).status).toBe(200);
    // Default manager: finance read via payouts.view.
    expect(hasSettlement(await center(mgr))).toBe(true);
    expect((await archive(mgr)).status).toBe(200);

    // Approved for staffing only: deny finance read. The same link now 404s.
    await pool.query(
      `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect, reason, granted_by_user_id)
       SELECT $1, p.id, 'deny', 'staffing only', $2 FROM team_permissions p WHERE p.code = 'payouts.view'`, [mgrM, owner]);
    perms.invalidateCache(biz, mgr);
    expect(hasSettlement(await center(mgr))).toBe(false);
    expect((await archive(mgr)).status).toBe(404);

    // Restored.
    await pool.query('DELETE FROM membership_permission_overrides WHERE membership_id = $1', [mgrM]);
    perms.invalidateCache(biz, mgr);
    expect((await archive(mgr)).status).toBe(200);

    // Store-scoped manager: no restaurant-wide settlement.
    expect(hasSettlement(await center(storeMgr))).toBe(false);
    expect((await archive(storeMgr)).status).toBe(404);
  });
});
