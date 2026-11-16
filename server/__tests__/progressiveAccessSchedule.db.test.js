'use strict';

/**
 * WP-049 staff scheduling and dispatch — PostgreSQL evidence with one person
 * on staff at two businesses: they see their own published assignments,
 * manage only the roster where they are a manager, and a foreign shift id
 * under a correct tenant id fails as a plain 404 that reveals nothing. */

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





ddescribe('staff scheduling across two businesses (WP-049, real database)', () => {
  let pool;
  let app;

  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-sched-${label}-${id}@example.invalid`, label],
    );
    mockUsers.set(id, { id, role: 'customer' });
    return id;
  }
  async function newBusiness(ownerId, name) {
    const { rows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed)
       VALUES ($1, $2, FALSE, TRUE, FALSE) RETURNING id`, [ownerId, name]);
    return rows[0].id;
  }
  async function member(businessId, ownerId, memberId, role) {
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW())`,
      [businessId, ownerId, memberId, role, `m-${memberId}-${businessId}@example.invalid`]);
  }
  const as = (u) => ({
    get: (url) => request(app).get(url).set('x-test-user', u),
    post: (url, body = {}) => request(app).post(url).set('x-test-user', u).send(body),
    put: (url, body = {}) => request(app).put(url).set('x-test-user', u).send(body),
    del: (url) => request(app).delete(url).set('x-test-user', u),
  });
  const shift = (userId, day, notes) => ({ user_id: userId, shift_start: `2031-03-${day}T09:00`, shift_end: `2031-03-${day}T13:00`, notes });

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/businesses', require('../routes/businessStaff'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('own assignments, roster management only where managing, foreign ids hidden', async () => {
    const ownerA = await newUser('ownerA'); const ownerB = await newUser('ownerB');
    const staff = await newUser('two-jobs'); const coworker = await newUser('coworker');
    const A = await newBusiness(ownerA, 'Alpha Cafe'); const B = await newBusiness(ownerB, 'Beta Fix');
    await member(A, ownerA, staff, 'employee'); await member(A, ownerA, coworker, 'employee');
    await member(B, ownerB, staff, 'manager'); await member(B, ownerB, coworker, 'employee');

    // Owner A schedules both; publishes only the staff member's shift.
    const mine = (await as(ownerA).post(`/api/businesses/${A}/staff/shifts`, shift(staff, '03', 'alpha-own'))).body;
    const draft = (await as(ownerA).post(`/api/businesses/${A}/staff/shifts`, shift(coworker, '04', 'alpha-secret-draft'))).body;
    expect(mine.id && draft.id).toBeTruthy();
    await pool.query('UPDATE business_staff_shifts SET published_at = NOW() WHERE id = $1', [mine.id]);

    // At A (employee): sees the published own assignment, never the draft; cannot manage the roster.
    const listA = (await as(staff).get(`/api/businesses/${A}/staff/shifts`)).body;
    expect(listA.map((r) => r.id)).toEqual([mine.id]);
    expect((await as(staff).post(`/api/businesses/${A}/staff/shifts`, shift(coworker, '05'))).status).toBe(403);
    expect((await as(staff).put(`/api/businesses/${A}/staff/shifts/${draft.id}`, { notes: 'x' })).status).toBe(403);

    // At B (manager): manages B's roster.
    const bShift = await as(staff).post(`/api/businesses/${B}/staff/shifts`, shift(coworker, '06', 'beta-shift'));
    expect(bShift.status).toBe(201);

    // Correct tenant id (B, where they manage) + a foreign shift id from A: plain 404, no details.
    for (const res of [
      await as(staff).put(`/api/businesses/${B}/staff/shifts/${draft.id}`, { notes: 'hijack' }),
      await as(staff).del(`/api/businesses/${B}/staff/shifts/${draft.id}`),
    ]) {
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/alpha|secret|2031|coworker/i);
    }
    const { rows: [intact] } = await pool.query('SELECT notes, cancelled_at FROM business_staff_shifts WHERE id = $1', [draft.id]);
    expect(intact).toEqual({ notes: 'alpha-secret-draft', cancelled_at: null });

    // Deleting B's own shift twice: success, then idempotent success (history kept).
    expect((await as(staff).del(`/api/businesses/${B}/staff/shifts/${bShift.body.id}`)).status).toBe(200);
    expect((await as(staff).del(`/api/businesses/${B}/staff/shifts/${bShift.body.id}`)).status).toBe(200);
    expect((await pool.query('SELECT cancelled_at IS NOT NULL AS c FROM business_staff_shifts WHERE id = $1', [bShift.body.id])).rows[0].c).toBe(true);

    // Self-action vs roster: an employee cannot request a swap of someone else's shift at A.
    await pool.query('UPDATE business_staff_shifts SET published_at = NOW() WHERE id = $1', [draft.id]);
    const swap = await as(staff).post(`/api/businesses/${A}/staff/shifts/${draft.id}/swap-requests`, { target_user_id: staff });
    expect(swap.status).toBe(403);
  });
});
