'use strict';

/**
 * WP-051 business client records — PostgreSQL evidence that one account can be
 * a customer and an employee at once: the employee's own view stays inside the
 * assigned scope, and the employer's view of that person never exposes another
 * business's customer record, unrelated history or personal wallet data. */

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







ddescribe('customer 360 scope when a customer is also an employee (WP-051, real database)', () => {
  let pool;
  let app;

  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-c360-${label}-${id}@example.invalid`, label],
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
  async function client(businessId, createdBy, { customerId = null, name, notes }) {
    const { rows } = await pool.query(
      `INSERT INTO business_clients (business_id, customer_id, display_name, email, internal_notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [businessId, customerId, name, `${name.replace(/\W+/g, '.').toLowerCase()}@example.invalid`, notes, createdBy]);
    return String(rows[0].id);
  }
  const get = (u, url) => request(app).get(url).set('x-test-user', u);

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/businesses', require('../routes/businessCustomer360'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('employer view, employee view and another business stay separate', async () => {
    const ownerA = await newUser('ownerA'); const ownerB = await newUser('ownerB');
    const emp = await newUser('Eve'); const other = await newUser('Oscar');
    const bizA = await newBusiness(ownerA, 'Alpha Salon');
    const bizB = await newBusiness(ownerB, 'Beta Barber');
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'employee', $4, 'active', NOW())`, [bizA, ownerA, emp, `emp-${emp}@example.invalid`]);

    await client(bizA, ownerA, { customerId: emp, name: 'Eve At Alpha', notes: 'Alpha note' });
    const otherAtA = await client(bizA, ownerA, { customerId: other, name: 'Oscar Unassigned', notes: 'Alpha private' });
    const eveAtB = await client(bizB, ownerB, { customerId: emp, name: 'Eve At Beta', notes: 'Beta secret note' });

    // Employer: sees the person as Alpha's customer only.
    const prof = await get(ownerA, `/api/businesses/${bizA}/customer360/customers/u-${emp}`);
    expect(prof.status).toBe(200);
    const body = JSON.stringify(prof.body);
    expect(body).toMatch(/Alpha note/);
    expect(body).not.toMatch(/Beta|secret/);
    expect(body).not.toMatch(/wallet|balance|payout|stripe/i);
    const cross = await get(ownerA, `/api/businesses/${bizA}/customer360/customers/c-${eveAtB}`);
    expect(cross.status).toBe(404);
    expect(JSON.stringify(cross.body)).not.toMatch(/Beta/);
    const listA = JSON.stringify((await get(ownerA, `/api/businesses/${bizA}/customer360/customers`)).body);
    expect(listA).not.toMatch(/Beta/);

    // Employee: assigned scope only — neither unassigned customers nor other businesses.
    const empList = await get(emp, `/api/businesses/${bizA}/customer360/customers`);
    expect(empList.status).toBe(200);
    expect(empList.body.access.customers).toBe('assigned');
    expect(JSON.stringify(empList.body)).not.toMatch(/Oscar|Alpha private/);
    expect((await get(emp, `/api/businesses/${bizA}/customer360/customers/c-${otherAtA}`)).status).toBe(404);
    expect([403, 404]).toContain((await get(emp, `/api/businesses/${bizB}/customer360/customers`)).status);

    // Every read is audited against the business it belongs to.
    const { rows } = await pool.query(
      `SELECT DISTINCT action FROM business_audit_log WHERE business_id = $1 AND action LIKE 'customer360.%'`, [bizA]);
    expect(rows.map((r) => r.action).sort()).toEqual(['customer360.customer_viewed', 'customer360.customers_listed']);
  });
});
