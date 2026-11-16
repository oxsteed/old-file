'use strict';

/**
 * WP-069 crew shifts, time clock and reports — PostgreSQL evidence that an
 * employee promoted to manager at store A while their own time entry is open
 * keeps that entry and gains store-A crew-shift controls, cannot edit a
 * store-B shift, cannot export payroll without payroll.view, and with it can
 * export store A but not store B. */

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














ddescribe('crew and payroll authority (WP-069, real database)', () => {
  let pool;
  let app;
  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-crew-${label}-${id}@example.invalid`, label],
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

  test('promotion mid-shift, foreign store, payroll export authority', async () => {
    const perms = require('../services/permissionsService');
    const owner = await newUser('owner'); const lead = await newUser('lead');
    const biz = (await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, 'Crew Two Stores', FALSE, TRUE, FALSE) RETURNING id`, [owner])).rows[0].id;
    const r = (await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status) VALUES ($1, $2, 'Crew Two Stores', 'active') RETURNING id`, [biz, owner])).rows[0].id;
    const storeA = (await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary', [r])).rows[0].id;
    const storeB = (await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Store B') RETURNING id`, [r])).rows[0].id;
    const leadM = (await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'employee', $4, 'active', NOW()) RETURNING id`, [biz, owner, lead, `lead-${lead}@example.invalid`])).rows[0].id;
    await pool.query(`INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status) VALUES ($1, $2, $3, 'active')`, [r, storeA, leadM]);
    const startsAt = new Date(Date.now() - 3600000).toISOString();
    const endsAt = new Date(Date.now() + 3600000).toISOString();
    const shiftB = (await pool.query(
      `INSERT INTO restaurant_crew_shifts (restaurant_id, location_id, label, starts_at, ends_at, created_by) VALUES ($1, $2, 'B lunch', $3, $4, $5) RETURNING id`,
      [r, storeB, startsAt, endsAt, owner])).rows[0].id;
    const openEntry = (await pool.query(
      `INSERT INTO business_time_entries (business_id, user_id, location_id, clock_in_at) VALUES ($1, $2, $3, NOW() - interval '30 minutes') RETURNING id`, [biz, lead, storeA])).rows[0].id;

    const createShift = (loc) => request(app).post(`/api/restaurants/${r}/crew/shifts`).set('x-test-user', lead)
      .send({ label: 'A dinner', startsAt, endsAt, locationId: loc });
    expect((await createShift(storeA)).status).toBe(403);

    // Promotion while on the clock.
    await pool.query(`UPDATE business_members SET role = 'manager', role_updated_by = $2 WHERE id = $1`, [leadM, owner]);
    perms.invalidateCache(biz, lead);
    expect((await createShift(storeA)).status).toBe(201);
    expect((await createShift(storeB)).status).toBe(403);
    expect([403, 404]).toContain((await request(app).patch(`/api/restaurants/${r}/crew/shifts/${shiftB}`).set('x-test-user', lead).send({ label: 'hijacked' })).status);
    expect((await pool.query('SELECT label FROM restaurant_crew_shifts WHERE id = $1', [shiftB])).rows[0].label).toBe('B lunch');
    const entry = (await pool.query('SELECT clock_out_at, voided_at FROM business_time_entries WHERE id = $1', [openEntry])).rows[0];
    expect(entry).toEqual({ clock_out_at: null, voided_at: null });

    // Payroll export is its own authority.
    const exportCsv = (loc) => request(app).get(`/api/restaurants/${r}/reports/payroll/export.csv${loc ? `?locationId=${loc}` : ''}`).set('x-test-user', lead);
    expect((await exportCsv(storeA)).status).toBe(403);
    await pool.query(
      `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect, reason, granted_by_user_id)
       SELECT $1, p.id, 'allow', 'finance grant', $2 FROM team_permissions p WHERE p.code = 'payroll.view'`, [leadM, owner]);
    perms.invalidateCache(biz, lead);
    expect((await exportCsv(storeA)).status).toBe(200);
    expect([403, 404]).toContain((await exportCsv(storeB)).status);
  });
});
