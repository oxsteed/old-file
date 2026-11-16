'use strict';

/**
 * WP-070 restaurant runner and delivery — PostgreSQL evidence that a runner at
 * restaurant A claims an A task; another restaurant's task cannot be claimed
 * and never appears; once runner availability is withdrawn (deny override) the
 * runner gets no new offers and cannot claim, while the committed delivery
 * stays visible in their inbox. */

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














ddescribe('runner work at the assigned restaurant (WP-070, real database)', () => {
  let pool;
  let app;
  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-runner-${label}-${id}@example.invalid`, label],
    );
    mockUsers.set(id, { id, role: 'customer' });
    return id;
  }
  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/restaurants', require('../routes/restaurants'));
    app.use('/api/runner', require('../routes/runner'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('claim at A, B invisible, availability withdrawn keeps the committed delivery', async () => {
    const perms = require('../services/permissionsService');
    const ownerA = await newUser('ownerA'); const ownerB = await newUser('ownerB'); const runner = await newUser('runner');
    const mk = async (owner, name) => {
      const biz = (await pool.query(
        `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, $2, FALSE, TRUE, FALSE) RETURNING id`, [owner, name])).rows[0].id;
      const r = (await pool.query(
        `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status) VALUES ($1, $2, $3, 'active') RETURNING id`, [biz, owner, name])).rows[0].id;
      const loc = (await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary', [r])).rows[0].id;
      return { biz, r, loc };
    };
    const A = await mk(ownerA, 'Runner A'); const B = await mk(ownerB, 'Runner B');
    const runnerM = (await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'employee', $4, 'active', NOW()) RETURNING id`, [A.biz, ownerA, runner, `runner-${runner}@example.invalid`])).rows[0].id;
    const task = async (X, ref) => (await pool.query(
      `INSERT INTO restaurant_runner_tasks (restaurant_id, location_id, order_reference, stop_name, status, task_type)
       VALUES ($1, $2, $3, 'Front door', 'Ready', 'Delivery') RETURNING id`, [X.r, X.loc, ref])).rows[0].id;
    const a1 = await task(A, 'A-1'); const a2 = await task(A, 'A-2'); const b1 = await task(B, 'B-1');
    const claim = (X, t) => request(app).post(`/api/restaurants/${X.r}/runner/tasks/${t}/claim`).set('x-test-user', runner).send({});
    const inbox = async () => (await request(app).get('/api/runner/inbox').set('x-test-user', runner)).body;

    expect((await claim(A, a1)).status).toBeLessThan(300);
    expect([403, 404]).toContain((await claim(B, b1)).status);
    expect([403, 404]).toContain((await claim(A, b1)).status);
    let box = await inbox();
    expect(box.assignments.map((t) => String(t.id))).toEqual([String(a1)]);
    expect(box.offers.map((t) => String(t.id))).toEqual([String(a2)]);

    // Withdraw future runner availability (deny override), as the team page does.
    await pool.query(
      `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect, reason, granted_by_user_id)
       SELECT $1, p.id, 'deny', 'off runner duty', $2 FROM team_permissions p WHERE p.code = 'runner.update'`, [runnerM, ownerA]);
    perms.invalidateCache(A.biz, runner);
    expect((await claim(A, a2)).status).toBe(403);
    box = await inbox();
    expect(box.offers).toEqual([]);
    expect(box.assignments.map((t) => String(t.id))).toEqual([String(a1)]);
    expect((await pool.query('SELECT assigned_to FROM restaurant_runner_tasks WHERE id = $1', [a2])).rows[0].assigned_to).toBeNull();
    expect((await pool.query('SELECT assigned_to FROM restaurant_runner_tasks WHERE id = $1', [b1])).rows[0].assigned_to).toBeNull();
  });
});
