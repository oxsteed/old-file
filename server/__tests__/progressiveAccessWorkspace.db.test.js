'use strict';

/**
 * WP-047 workspace context and multiple organizations — PostgreSQL evidence
 * that the remembered workspace is navigation only: every sensitive request
 * names its entity and membership is resolved per action, so a preference
 * change in one tab can neither redirect nor authorize another tab's write.
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



ddescribe('workspace context and multiple organizations (WP-047, real database)', () => {
  let pool;
  let app;
  const writes = [];

  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-ws-${label}-${id}@example.invalid`, label],
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
  async function member(businessId, ownerId, memberId, role, status = 'active') {
    const { rows } = await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6::varchar, CASE WHEN $6::varchar = 'active' THEN NOW() END) RETURNING id`,
      [businessId, ownerId, memberId, role, `m-${memberId}-${businessId}@example.invalid`, status]);
    return rows[0].id;
  }
  const tab = (userId) => ({
    select: (businessId) => request(app).post('/api/me/workspace-context').set('x-test-user', userId).send({ business_id: businessId }),
    managerWrite: (businessId) => request(app).post(`/api/businesses/${businessId}/manager-write`).set('x-test-user', userId).send({}),
  });

  beforeAll(async () => {
    pool = require('../db');
    const requireBusinessAccess = require('../middleware/requireBusinessAccess');
    const { authenticate } = require('../middleware/auth');
    app = express();
    app.use(express.json());
    app.use('/api/me', require('../routes/meWorkspace'));
    // A representative manager-level write: the entity comes from the URL only.
    app.post('/api/businesses/:id/manager-write', authenticate, requireBusinessAccess({ paramName: 'id', minRole: 'manager' }),
      (req, res) => { writes.push({ user: req.user.id, business: req.business.id, role: req.businessRole }); res.json({ business: req.business.id, role: req.businessRole }); });
  });

  afterAll(async () => { if (pool) await pool.end(); });

  test('two tabs, two organizations: the preference never redirects or authorizes a write', async () => {
    const owner = await newUser('ws-owner');
    const u = await newUser('ws-member');
    const a = await newBusiness(owner, 'Alpha Co');
    const b = await newBusiness(owner, 'Beta Co');
    await member(a, owner, u, 'manager');
    const bMembership = await member(b, owner, u, 'employee');
    const tabA = tab(u); const tabB = tab(u);

    // Tab B selects Beta; tab A keeps writing to Alpha (its own URL entity).
    expect((await tabB.select(b)).body.data).toMatchObject({ business_id: b, role: 'employee' });
    let r = await tabA.managerWrite(a);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ business: a, role: 'manager' });
    // The preference (Beta) does not lend Alpha's manager role to Beta.
    expect((await tabB.managerWrite(b)).status).toBe(403);
    // Selecting Alpha in tab A does not lend its manager role to tab B's Beta write either.
    await tabA.select(a);
    expect((await tabB.managerWrite(b)).status).toBe(403);

    // Approve staffing in Beta (employee → manager): effective on the next
    // request, and nothing about tab A's target changes.
    await pool.query("UPDATE business_members SET role = 'manager', role_updated_at = NOW(), role_updated_by = $2 WHERE id = $1", [bMembership, owner]);
    r = await tabB.managerWrite(b);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ business: b, role: 'manager' });
    r = await tabA.managerWrite(a);
    expect(r.body).toEqual({ business: a, role: 'manager' });
    expect(writes.filter((w) => w.user === u).map((w) => w.business)).toEqual([a, b, a]);
  });

  test('a foreign or pending organization cannot become the workspace, and the stored preference is unchanged', async () => {
    const owner = await newUser('ws-owner2');
    const u = await newUser('ws-member2');
    const mine = await newBusiness(owner, 'Mine Co');
    const foreign = await newBusiness(owner, 'Foreign Co');
    const pending = await newBusiness(owner, 'Pending Co');
    await member(mine, owner, u, 'employee');
    await member(pending, owner, u, 'manager', 'pending');
    await tab(u).select(mine);
    for (const id of [foreign, pending, 999999999]) {
      const res = await tab(u).select(id);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('business_not_found');
      expect((await tab(u).managerWrite(id)).status).toBe(404);
    }
    const { rows } = await pool.query('SELECT business_id FROM user_workspace_contexts WHERE user_id = $1', [u]);
    expect(rows.map((x) => x.business_id)).toEqual([mine]);
  });
});
