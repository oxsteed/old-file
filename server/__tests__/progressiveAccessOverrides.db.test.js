'use strict';

/**
 * WP-048 permission overrides and delegated administration — PostgreSQL
 * evidence: the next direct mutation sees a new deny (cache freshness),
 * delegated edits are scope-bound (owner-placed and out-of-scope overrides
 * survive a manager's edit), a former manager or a stale grantor cannot
 * write, wrong-workspace targets are hidden, expired overrides grant nothing.
 *
 * Skips unless ACCESS_TEST_DATABASE_URL is a loopback disposable database
 * (credit_statement_test or pa_tN) that has been migrated.
 */

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




ddescribe('permission overrides and delegated administration (WP-048, real database)', () => {
  let pool;
  let app;

  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-ov-${label}-${id}@example.invalid`, label],
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
    const { rows } = await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW()) RETURNING id`,
      [businessId, ownerId, memberId, role, `m-${memberId}-${businessId}@example.invalid`]);
    return rows[0].id;
  }
  const overrides = (actor, businessId, membershipId, list) => request(app)
    .put(`/api/businesses/${businessId}/memberships/${membershipId}/overrides`)
    .set('x-test-user', actor).send({ overrides: list });
  const calendarWrite = (actor, businessId) => request(app)
    .post(`/api/businesses/${businessId}/calendar-write`).set('x-test-user', actor).send({});
  const stored = async (membershipId) => (await pool.query(
    `SELECT p.code, o.effect FROM membership_permission_overrides o JOIN team_permissions p ON p.id = o.permission_id
      WHERE o.membership_id = $1 ORDER BY p.code`, [membershipId])).rows.map((r) => `${r.code}:${r.effect}`);

  let owner; let manager; let employee; let biz; let mMgr; let mEmp;

  beforeAll(async () => {
    pool = require('../db');
    const requireBusinessAccess = require('../middleware/requireBusinessAccess');
    const requirePermission = require('../middleware/requirePermission');
    const { authenticate } = require('../middleware/auth');
    app = express();
    app.use(express.json());
    app.use('/api/businesses', require('../routes/businessTeam'));
    // A representative direct mutation gated on calendar.manage_all.
    app.post('/api/businesses/:businessId/calendar-write', authenticate, requireBusinessAccess({ minRole: 'any' }),
      requirePermission(['calendar.manage_all']), (req, res) => res.json({ ok: true }));
    owner = await newUser('owner');
    manager = await newUser('manager');
    employee = await newUser('employee');
    biz = await newBusiness(owner, 'Override Co');
    mMgr = await member(biz, owner, manager, 'manager');
    mEmp = await member(biz, owner, employee, 'employee');
  });

  afterAll(async () => { if (pool) await pool.end(); });

  test('grant then deny: the next direct mutation uses the new effective result', async () => {
    expect((await calendarWrite(employee, biz)).status).toBe(403);
    expect((await overrides(owner, biz, mEmp, [{ permission_code: 'calendar.manage_all', effect: 'allow' }])).status).toBe(200);
    expect((await calendarWrite(employee, biz)).status).toBe(200); // warms the permission cache
    expect((await overrides(owner, biz, mEmp, [{ permission_code: 'calendar.manage_all', effect: 'deny' }])).status).toBe(200);
    expect((await calendarWrite(employee, biz)).status).toBe(403);
  });

  test('a manager cannot lift or replace an owner-placed override; their own scope still works', async () => {
    // Owner-placed deny from the previous test stays in force.
    let r = await overrides(manager, biz, mEmp, [{ permission_code: 'calendar.manage_all', effect: 'allow' }]);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('override_protected');
    // Dropping it from the list is not a revocation of the owner's override.
    r = await overrides(manager, biz, mEmp, [{ permission_code: 'jobs.assign', effect: 'allow' }]);
    expect(r.status).toBe(200);
    expect(await stored(mEmp)).toEqual(['calendar.manage_all:deny', 'jobs.assign:allow']);
    expect((await calendarWrite(employee, biz)).status).toBe(403);
    // The manager may change what they administer, re-sending the protected row unchanged.
    r = await overrides(manager, biz, mEmp, [{ permission_code: 'calendar.manage_all', effect: 'deny' }]);
    expect(r.status).toBe(200);
    expect(await stored(mEmp)).toEqual(['calendar.manage_all:deny']);
    // Granting above the manager's own level is refused.
    r = await overrides(manager, biz, mEmp, [{ permission_code: 'careers.approve_above_range', effect: 'allow' }]);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('cannot_grant_above_level');
  });

  test('former manager, stale grantor standing and wrong workspace are refused', async () => {
    const other = await newBusiness(owner, 'Other Co');
    const otherEmp = await member(other, owner, await newUser('other-emp'), 'employee');
    // Wrong workspace: a membership of another business is hidden.
    let r = await overrides(manager, biz, otherEmp, [{ permission_code: 'jobs.assign', effect: 'allow' }]);
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('membership_not_found');
    r = await overrides(manager, other, otherEmp, [{ permission_code: 'jobs.assign', effect: 'allow' }]);
    expect(r.status).toBe(404);

    // Stale standing: the request was authorized as manager, then the role
    // changed before the write transaction (simulated by a stale req).
    await pool.query("UPDATE business_members SET role = 'employee', role_updated_by = $2, role_updated_at = NOW() WHERE id = $1", [mMgr, owner]);
    const ctrl = require('../controllers/businessTeamController');
    const permissionsService = require('../services/permissionsService');
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.payload = b; return this; } };
    await ctrl.setMembershipOverrides({
      params: { businessId: String(biz), membershipId: String(mEmp) },
      body: { overrides: [{ permission_code: 'jobs.assign', effect: 'allow' }] },
      user: { id: manager }, businessRole: 'manager', business: { id: biz, owner_id: owner },
      permissions: (await permissionsService.getEffectivePermissions({ businessId: biz, userId: owner, role: 'owner', membershipId: null })).permissions,
      get: () => null, headers: {}, ip: '127.0.0.1',
    }, res, (e) => { throw e; });
    expect(res.statusCode).toBe(403);
    expect(res.payload.code).toBe('grantor_standing_changed');

    // Former manager through the mounted route.
    r = await overrides(manager, biz, mEmp, [{ permission_code: 'jobs.assign', effect: 'allow' }]);
    expect(r.status).toBe(403);
    expect(await stored(mEmp)).toEqual(['calendar.manage_all:deny']);
  });

  test('an expired allow override grants nothing', async () => {
    const e2 = await newUser('expired');
    const m2 = await member(biz, owner, e2, 'employee');
    await pool.query(
      `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect, granted_by_user_id, expires_at)
       SELECT $1, id, 'allow', $2, NOW() - INTERVAL '1 minute' FROM team_permissions WHERE code = 'calendar.manage_all'`, [m2, owner]);
    expect((await calendarWrite(e2, biz)).status).toBe(403);
  });
});
