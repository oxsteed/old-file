'use strict';

/**
 * WP-055 business packages, services and waitlists — PostgreSQL evidence that
 * a delegated scheduler acts only on bookings they serve, cannot change
 * package pricing or see another business's queue, and that issuing a package
 * to a team member grants no team permission. */

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








ddescribe('packages and waitlist scope (WP-055, real database)', () => {
  let pool;
  let app;

  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-pkg-${label}-${id}@example.invalid`, label],
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
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW())`, [biz, owner, user, role, `${role}-${user}@example.invalid`]);
  }
  async function service(biz) {
    return (await pool.query(`INSERT INTO business_services (business_id, name) VALUES ($1, 'Haircut') RETURNING id`, [biz])).rows[0].id;
  }
  async function waiting(svc, customer) {
    return (await pool.query(
      `INSERT INTO appointment_waitlist (service_id, customer_id, position_in_queue, status) VALUES ($1, $2, 1, 'waiting') RETURNING id`, [svc, customer])).rows[0].id;
  }
  const as = (u) => ({
    get: (url) => request(app).get(url).set('x-test-user', u),
    post: (url, body = {}) => request(app).post(url).set('x-test-user', u).send(body),
    put: (url, body = {}) => request(app).put(url).set('x-test-user', u).send(body),
    del: (url) => request(app).delete(url).set('x-test-user', u),
  });

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/businesses', require('../routes/businessPackages'));
    app.use('/api/businesses', require('../routes/businessWaitlist'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('scheduler scope, queue isolation and no permission side effects', async () => {
    const ownerA = await newUser('ownerA'); const ownerB = await newUser('ownerB');
    const mgr = await newUser('mgr'); const emp = await newUser('emp');
    const served = await newUser('served'); const unserved = await newUser('unserved');
    const bizA = await newBusiness(ownerA, 'Alpha Cuts'); const bizB = await newBusiness(ownerB, 'Beta Cuts');
    await member(bizA, ownerA, mgr, 'manager');
    await member(bizA, ownerA, emp, 'employee');
    const svcA = await service(bizA); const svcB = await service(bizB);
    const wA = await waiting(svcA, unserved); const wB = await waiting(svcB, served);
    await pool.query(
      `INSERT INTO business_appointments (business_id, service_id, customer_id, staff_id, start_time, end_time, status, payment_status, base_price_cents, final_price_cents, cancellation_fee_cents)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day', NOW() + INTERVAL '25 hours', 'confirmed', 'pending', 3000, 3000, 0)`, [bizA, svcA, served, emp]);

    const pkg = await as(ownerA).post(`/api/businesses/${bizA}/packages`, { name: 'Five cuts', total_sessions: 5, price_cents: 12000 });
    expect(pkg.status).toBe(201);
    const issue = async (customer) => (await as(ownerA).post(`/api/businesses/${bizA}/client-packages`, { customer_id: customer, package_id: pkg.body.id })).body.id;
    const cpServed = await issue(served); const cpOther = await issue(unserved);

    // Employee (calendar.manage_self, customers.view_assigned): only the customer they serve.
    const list = await as(emp).get(`/api/businesses/${bizA}/client-packages`);
    expect(list.status).toBe(200);
    expect(list.body.map((r) => String(r.id))).toEqual([String(cpServed)]);
    expect((await as(emp).post(`/api/businesses/${bizA}/client-packages/${cpServed}/redeem`)).status).toBe(200);
    expect((await as(emp).post(`/api/businesses/${bizA}/client-packages/${cpOther}/redeem`)).status).toBe(404);
    expect((await pool.query('SELECT sessions_used FROM business_client_packages WHERE id = $1', [cpOther])).rows[0].sessions_used).toBe(0);
    // ... cannot change pricing or see the business queue.
    expect((await as(emp).put(`/api/businesses/${bizA}/packages/${pkg.body.id}`, { name: 'Five cuts', total_sessions: 5, price_cents: 1 })).status).toBe(403);
    expect((await as(emp).post(`/api/businesses/${bizA}/packages`, { name: 'Cheap', total_sessions: 1, price_cents: 1 })).status).toBe(403);
    expect((await as(emp).get(`/api/businesses/${bizA}/waitlist`)).status).toBe(403);
    expect((await as(emp).put(`/api/businesses/${bizA}/waitlist/${wA}`, { status: 'offered' })).status).toBe(403);

    // Manager: A's queue only; B's entry cannot be reached by combining ids.
    const q = await as(mgr).get(`/api/businesses/${bizA}/waitlist`);
    expect(q.status).toBe(200);
    const ids = JSON.stringify(q.body);
    expect(ids).toContain(String(wA));
    expect(ids).not.toMatch(new RegExp(`"id":"?${wB}"?[,}]`));
    expect((await as(mgr).put(`/api/businesses/${bizA}/waitlist/${wB}`, { status: 'cancelled' })).status).toBe(404);
    expect((await as(mgr).del(`/api/businesses/${bizA}/waitlist/${wB}`)).status).toBe(404);
    expect((await pool.query('SELECT status FROM appointment_waitlist WHERE id = $1', [wB])).rows[0].status).toBe('waiting');
    expect((await as(mgr).post(`/api/businesses/${bizA}/client-packages/${cpOther}/redeem`)).status).toBe(200);

    // Issuing a package to a team member grants nothing.
    const before = (await pool.query('SELECT role, status FROM business_members WHERE business_id = $1 AND member_id = $2', [bizA, emp])).rows;
    await issue(emp);
    expect((await pool.query('SELECT role, status FROM business_members WHERE business_id = $1 AND member_id = $2', [bizA, emp])).rows).toEqual(before);
    expect((await as(emp).get(`/api/businesses/${bizA}/waitlist`)).status).toBe(403);
  });
});
