'use strict';

/**
 * WP-057 property and maintenance workflows — PostgreSQL evidence that a
 * tenant (even after becoming a helper) follows only their own request and
 * never sees internal notes, an assigned outside helper can progress but not
 * reassign the work, and site-A authority cannot attach records or
 * assignments to site B by combining ids. */

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








ddescribe('maintenance requests and property records stay scoped (WP-057, real database)', () => {
  let pool;
  let app;

  async function newUser(label, role = 'customer') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', $4, 'customer', TRUE, TRUE)`,
      [id, `pa-mnt-${label}-${id}@example.invalid`, label, role],
    );
    mockUsers.set(id, { id, role });
    return id;
  }
  async function newBusiness(ownerId, name) {
    const { rows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, $2, FALSE, TRUE, FALSE) RETURNING id`, [ownerId, name]);
    return rows[0].id;
  }
  async function requestFor(biz, owner, requester, unit) {
    return (await pool.query(
      `INSERT INTO property_maintenance_requests (business_id, owner_id, requester_id, issue_category, title, description, unit_label)
       VALUES ($1, $2, $3, 'Plumbing', 'Leaking sink in kitchen', 'Water pools under the sink every morning.', $4) RETURNING id`,
      [biz, owner, requester, unit])).rows[0].id;
  }
  const as = (u) => ({
    get: (url) => request(app).get(url).set('x-test-user', u),
    patch: (url, body = {}) => request(app).patch(url).set('x-test-user', u).send(body),
    post: (url, body = {}) => request(app).post(url).set('x-test-user', u).send(body),
  });

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/maintenance-requests', require('../routes/maintenanceRequests'));
    app.use('/api/property-operations', require('../routes/propertyOperations'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('tenant, outside helper and cross-site manager each stay in scope', async () => {
    const ownerA = await newUser('ownerA'); const ownerB = await newUser('ownerB');
    const mgr = await newUser('mgr'); const tenant = await newUser('tenant'); const neighbour = await newUser('neighbour');
    const plumber = await newUser('plumber', 'helper'); const other = await newUser('otherHelper', 'helper');
    const siteA = await newBusiness(ownerA, 'Alpha Apartments'); const siteB = await newBusiness(ownerB, 'Beta Apartments');
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'manager', $4, 'active', NOW())`, [siteA, ownerA, mgr, `mgr-${mgr}@example.invalid`]);
    const mine = await requestFor(siteA, ownerA, tenant, '2B');
    const theirs = await requestFor(siteA, ownerA, neighbour, '4C');
    const bReq = await requestFor(siteB, ownerB, neighbour, '9Z');

    // Owner assigns the plumber with an internal note and a tenant-facing note.
    const upd = await as(ownerA).patch(`/api/maintenance-requests/${mine}`, {
      assigned_helper_id: plumber, owner_notes: 'Internal: gate code 4711', tenant_visible_notes: 'Plumber visits Tuesday',
    });
    expect(upd.status).toBe(200);
    await as(ownerA).patch(`/api/maintenance-requests/${mine}`, { owner_notes: 'Internal: tenant owes deposit' });

    // The tenant becomes a helper and still follows only their own issue, without internal notes.
    await pool.query("UPDATE users SET role = 'helper' WHERE id = $1", [tenant]);
    mockUsers.set(tenant, { id: tenant, role: 'helper' });
    const own = await as(tenant).get(`/api/maintenance-requests/${mine}`);
    expect(own.status).toBe(200);
    const ownText = JSON.stringify(own.body);
    expect(ownText).toMatch(/Plumber visits Tuesday/);
    expect(ownText).not.toMatch(/gate code|owes deposit/);
    expect(own.body.request.owner_notes).toBeUndefined();
    const list = await as(tenant).get('/api/maintenance-requests/my');
    expect(list.body.requests.map((r) => String(r.id))).toEqual([String(mine)]);
    expect(JSON.stringify(list.body)).not.toMatch(/gate code|owes deposit|4C/);
    expect((await as(tenant).get(`/api/maintenance-requests/${theirs}`)).status).toBe(404);
    expect((await as(tenant).get(`/api/maintenance-requests/business/${siteA}`)).status).toBe(404);
    expect((await as(tenant).get('/api/maintenance-requests/assigned')).body.requests).toEqual([]);

    // The owner still sees internal notes.
    expect(JSON.stringify((await as(ownerA).get(`/api/maintenance-requests/${mine}`)).body)).toMatch(/owes deposit/);

    // Outside helper: progresses the job, cannot reassign or write internal notes.
    expect((await as(plumber).patch(`/api/maintenance-requests/${mine}`, { assigned_helper_id: other })).status).toBe(403);
    expect((await as(plumber).patch(`/api/maintenance-requests/${mine}`, { owner_notes: 'x' })).status).toBe(403);
    expect((await as(plumber).patch(`/api/maintenance-requests/${mine}`, { tenant_visible_notes: 'Parts ordered' })).status).toBe(200);
    expect((await pool.query('SELECT assigned_helper_id FROM property_maintenance_requests WHERE id = $1', [mine])).rows[0].assigned_helper_id).toBe(plumber);
    expect((await as(plumber).get(`/api/maintenance-requests/${theirs}`)).status).toBe(404);

    // Site-A manager cannot reach site B through ids.
    expect((await as(mgr).patch(`/api/maintenance-requests/${bReq}`, { assigned_helper_id: plumber })).status).toBe(403);
    expect((await as(mgr).post(`/api/maintenance-requests/${bReq}/convert-to-job`)).status).toBeGreaterThanOrEqual(403);
    const unitB = (await pool.query(
      `INSERT INTO property_portfolio_units (business_id, property_label) VALUES ($1, 'Beta Tower') RETURNING id`, [siteB])).rows[0].id;
    const unitA = (await pool.query(
      `INSERT INTO property_portfolio_units (business_id, property_label) VALUES ($1, 'Alpha Court') RETURNING id`, [siteA])).rows[0].id;
    expect((await as(mgr).post(`/api/property-operations/business/${siteA}/compliance-records`,
      { record_type: 'fire', title: 'Fire inspection', unit_id: unitB })).status).toBe(404);
    const okRec = await as(mgr).post(`/api/property-operations/business/${siteA}/compliance-records`,
      { record_type: 'fire', title: 'Fire inspection', unit_id: unitA });
    expect(okRec.status).toBe(201);
    expect((await request(app).put(`/api/property-operations/business/${siteA}/compliance-records/${okRec.body.record.id}`)
      .set('x-test-user', mgr).send({ unit_id: unitB })).status).toBe(404);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM property_compliance_records WHERE unit_id = $1', [unitB])).rows[0].n).toBe(0);

    // D-508 (326): compliance record_type is a closed enum going forward.
    expect((await as(mgr).post(`/api/property-operations/business/${siteA}/compliance-records`,
      { record_type: 'banana', title: 'Banana check', unit_id: unitA })).status).toBe(400);
    const upper = await as(mgr).post(`/api/property-operations/business/${siteA}/compliance-records`,
      { record_type: 'FIRE', title: 'Fire check', unit_id: unitA });
    expect(upper.status).toBe(201);
    expect(upper.body.record.record_type).toBe('fire');
    expect((await request(app).put(`/api/property-operations/business/${siteA}/compliance-records/${upper.body.record.id}`)
      .set('x-test-user', mgr).send({ record_type: 'banana' })).status).toBe(400);
    expect((await request(app).put(`/api/property-operations/business/${siteA}/compliance-records/${upper.body.record.id}`)
      .set('x-test-user', mgr).send({ record_type: 'safety' })).status).toBe(200);
  });
});
