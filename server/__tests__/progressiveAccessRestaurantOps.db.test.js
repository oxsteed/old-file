'use strict';

/**
 * WP-071 training, SOPs and operational quality — PostgreSQL evidence that an
 * employee completes their assigned crew task, is promoted to manager at store
 * A, creates a store-A task for a store-A worker, cannot assign it to a
 * store-B-only worker or create one at store B, and that the earlier
 * completion and its event history stay attributed to them. */

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















ddescribe('crew assignments and authoring (WP-071, real database)', () => {
  let pool;
  let app;
  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-sop-${label}-${id}@example.invalid`, label],
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

  test('complete, get promoted, assign within scope; history stays attributable', async () => {
    const perms = require('../services/permissionsService');
    const owner = await newUser('owner'); const lead = await newUser('lead'); const workerA = await newUser('workerA'); const workerB = await newUser('workerB');
    const biz = (await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, 'Ops Two Stores', FALSE, TRUE, FALSE) RETURNING id`, [owner])).rows[0].id;
    const r = (await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status) VALUES ($1, $2, 'Ops Two Stores', 'active') RETURNING id`, [biz, owner])).rows[0].id;
    const storeA = (await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary', [r])).rows[0].id;
    const storeB = (await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Store B') RETURNING id`, [r])).rows[0].id;
    const member = async (u, loc) => {
      const m = (await pool.query(
        `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
         VALUES ($1, $2, $3, 'employee', $4, 'active', NOW()) RETURNING id`, [biz, owner, u, `e-${u}@example.invalid`])).rows[0].id;
      await pool.query(`INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status) VALUES ($1, $2, $3, 'active')`, [r, loc, m]);
      return m;
    };
    const leadM = await member(lead, storeA); await member(workerA, storeA); await member(workerB, storeB);
    const assigned = (await pool.query(
      `INSERT INTO restaurant_crew_tasks (restaurant_id, location_id, title, assigned_to, created_by) VALUES ($1, $2, 'Close fryer', $3, $4) RETURNING id`,
      [r, storeA, lead, owner])).rows[0].id;

    const step = (status) => request(app).patch(`/api/restaurants/${r}/crew/tasks/${assigned}`).set('x-test-user', lead).send({ status });
    expect((await step('in_progress')).status).toBe(200);
    const done = await step('completed');
    expect(done.status).toBe(200);
    const finalStatus = done.body.task?.status || done.body.status;
    expect(['completed', 'needs_approval']).toContain(finalStatus);
    const create = (body) => request(app).post(`/api/restaurants/${r}/crew/tasks`).set('x-test-user', lead).send({ title: 'Temp log', ...body });
    expect((await create({ locationId: storeA, assignedTo: workerA })).status).toBe(403); // not a manager yet

    await pool.query(`UPDATE business_members SET role = 'manager', role_updated_by = $2 WHERE id = $1`, [leadM, owner]);
    perms.invalidateCache(biz, lead);
    expect((await create({ locationId: storeA, assignedTo: workerA })).status).toBe(201);
    const wrongWorker = await create({ locationId: storeA, assignedTo: workerB });
    expect(wrongWorker.status).toBe(400);
    expect(wrongWorker.body.details?.assignedTo || wrongWorker.body.fields?.assignedTo || JSON.stringify(wrongWorker.body)).toMatch(/store/);
    expect((await create({ locationId: storeB, assignedTo: workerB })).status).toBe(403);
    // SOP authoring is brand-level: a store-scoped manager cannot author.
    expect((await request(app).post(`/api/restaurants/${r}/sops`).set('x-test-user', lead).send({ title: 'Fryer SOP', body: 'x' })).status).toBe(403);

    const prior = (await pool.query('SELECT status, assigned_to FROM restaurant_crew_tasks WHERE id = $1', [assigned])).rows[0];
    expect(prior).toEqual({ status: finalStatus, assigned_to: lead });
    const events = (await pool.query(`SELECT actor_user_id, new_status FROM restaurant_crew_task_events WHERE task_id = $1 ORDER BY id`, [assigned])).rows;
    expect(events.some((e) => e.actor_user_id === lead && e.new_status === finalStatus)).toBe(true);
    const tasks = (await pool.query('SELECT location_id, assigned_to FROM restaurant_crew_tasks WHERE restaurant_id = $1 ORDER BY id', [r])).rows;
    expect(tasks).toHaveLength(2);
    expect(String(tasks[1].location_id)).toBe(String(storeA));
  });
});
