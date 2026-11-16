'use strict';

/**
 * WP-059 continuity and operating health — PostgreSQL evidence with alerts in
 * two businesses and a manager approved for one: counts, detail and
 * acknowledgement stay with that business, finance-derived alerts need a
 * finance permission, and a revocation takes effect on the next request of
 * the same session. */

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








ddescribe('health alerts are scoped to the entity and the permission (WP-059, real database)', () => {
  let pool;
  let app;

  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-health-${label}-${id}@example.invalid`, label],
    );
    mockUsers.set(id, { id, role: 'customer' });
    return id;
  }
  async function newBusiness(ownerId, name) {
    const { rows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, $2, FALSE, TRUE, FALSE) RETURNING id`, [ownerId, name]);
    return rows[0].id;
  }
  async function member(biz, owner, user, role) {
    return (await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW()) RETURNING id`, [biz, owner, user, role, `${role}-${user}@example.invalid`])).rows[0].id;
  }
  const as = (u) => ({
    get: (url) => request(app).get(url).set('x-test-user', u),
    post: (url) => request(app).post(url).set('x-test-user', u).send({}),
  });

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/businesses', require('../routes/businessHealthAlerts'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('two entities, one approved manager, finance alerts and revocation', async () => {
    const ownerA = await newUser('ownerA'); const ownerB = await newUser('ownerB');
    const mgr = await newUser('mgr'); const rep = await newUser('rep'); const emp = await newUser('emp');
    const bizA = await newBusiness(ownerA, 'Alpha Health'); const bizB = await newBusiness(ownerB, 'Beta Health');
    const mgrId = await member(bizA, ownerA, mgr, 'manager');
    await member(bizA, ownerA, rep, 'representative');
    await member(bizA, ownerA, emp, 'employee');
    for (const [biz, owner] of [[bizA, ownerA], [bizB, ownerB]]) {
      await pool.query(
        `INSERT INTO business_invoices (user_id, business_id, invoice_number, client_name, status, subtotal, total)
         VALUES ($1, $2, $3, 'Late Larry', 'overdue', 100, 100)`, [owner, biz, `INV-${crypto.randomUUID().slice(0, 8)}`]);
    }
    expect((await as(ownerB).post(`/api/businesses/${bizB}/health-alerts/generate`)).status).toBe(200);

    const gen = await as(mgr).post(`/api/businesses/${bizA}/health-alerts/generate`);
    expect(gen.status).toBe(200);
    const types = (body) => body.map((a) => a.alert_type).sort();
    expect(types(gen.body)).toEqual(['no_recent_reviews', 'overdue_invoices']);
    const alertB = (await pool.query(`SELECT id FROM business_health_alerts WHERE business_id = $1 AND alert_type = 'no_recent_reviews'`, [bizB])).rows[0].id;

    // The A manager never reaches B's alerts, by path or by id.
    expect((await as(mgr).get(`/api/businesses/${bizB}/health-alerts`)).status).toBe(404);
    expect((await as(mgr).post(`/api/businesses/${bizA}/health-alerts/${alertB}/dismiss`)).status).toBe(404);
    expect((await pool.query('SELECT is_dismissed FROM business_health_alerts WHERE id = $1', [alertB])).rows[0].is_dismissed).toBe(false);

    // Representative: operating summary yes, finance-derived alert no (list and acknowledgement).
    const repList = await as(rep).get(`/api/businesses/${bizA}/health-alerts`);
    expect(types(repList.body)).toEqual(['no_recent_reviews']);
    const overdueA = (await pool.query(`SELECT id FROM business_health_alerts WHERE business_id = $1 AND alert_type = 'overdue_invoices'`, [bizA])).rows[0].id;
    expect((await as(rep).post(`/api/businesses/${bizA}/health-alerts/${overdueA}/dismiss`)).status).toBe(404);
    expect((await pool.query('SELECT is_dismissed FROM business_health_alerts WHERE id = $1', [overdueA])).rows[0].is_dismissed).toBe(false);
    // Employee without analytics: nothing.
    expect((await as(emp).get(`/api/businesses/${bizA}/health-alerts`)).status).toBe(403);
    expect((await as(emp).post(`/api/businesses/${bizA}/health-alerts/generate`)).status).toBe(403);

    // Regenerating never duplicates an alert.
    expect((await as(mgr).post(`/api/businesses/${bizA}/health-alerts/generate`)).status).toBe(200);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM business_health_alerts WHERE business_id = $1', [bizA])).rows[0].n).toBe(2);

    // Revocation applies to the very next request of the same session.
    expect((await as(mgr).get(`/api/businesses/${bizA}/health-alerts`)).body.length).toBe(2);
    await pool.query(`UPDATE business_members SET role = 'employee', role_updated_by = $2 WHERE id = $1`, [mgrId, ownerA]);
    expect((await as(mgr).get(`/api/businesses/${bizA}/health-alerts`)).status).toBe(403);
    await pool.query(`UPDATE business_members SET status = 'revoked' WHERE id = $1`, [mgrId]);
    expect((await as(mgr).get(`/api/businesses/${bizA}/health-alerts`)).status).toBe(404);
  });
});
