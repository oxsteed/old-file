'use strict';

/**
 * WP-058 trades, creative, professional and appointment templates —
 * PostgreSQL evidence, one flow per template family with a customer, the
 * owner and a restricted employee: child records (quotes, diagnostic
 * requests, intake/engagement requests, appointments, staff) can only be
 * linked within the owning business, public submitters cannot pick links or
 * staff, and the owner's legitimate links still work. */

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








ddescribe('template workflows keep child records inside the business (WP-058, real database)', () => {
  let pool;
  let app;

  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-tpl-${label}-${id}@example.invalid`, label],
    );
    mockUsers.set(id, { id, role: 'customer' });
    return id;
  }
  async function newBusiness(ownerId, name) {
    const { rows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, $2, FALSE, TRUE, FALSE) RETURNING id`, [ownerId, name]);
    return rows[0].id;
  }
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0].id;
  const as = (u) => ({
    get: (url) => request(app).get(url).set('x-test-user', u),
    post: (url, body = {}) => request(app).post(url).set('x-test-user', u).send(body),
    put: (url, body = {}) => request(app).put(url).set('x-test-user', u).send(body),
  });

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/trades-operations', require('../routes/tradesOperations'));
    app.use('/api/beauty-operations', require('../routes/beautyOperations'));
    app.use('/api/creative-operations', require('../routes/creativeOperations'));
    app.use('/api/professional-operations', require('../routes/professionalOperations'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('cross-organization child ids are refused in every template family', async () => {
    const ownerA = await newUser('ownerA'); const ownerB = await newUser('ownerB');
    const emp = await newUser('emp'); const customer = await newUser('customer'); const outsider = await newUser('outsider');
    const bizA = await newBusiness(ownerA, 'Alpha Studio'); const bizB = await newBusiness(ownerB, 'Beta Studio');
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'employee', $4, 'active', NOW())`, [bizA, ownerA, emp, `emp-${emp}@example.invalid`]);
    const quoteA = await one(`INSERT INTO business_quotes (business_id, client_name) VALUES ($1, 'Alpha client') RETURNING id`, [bizA]);
    const quoteB = await one(`INSERT INTO business_quotes (business_id, client_name) VALUES ($1, 'Beta client') RETURNING id`, [bizB]);
    const diagB = await one(
      `INSERT INTO trades_diagnostic_requests (business_id, issue_type, title, description) VALUES ($1, 'hvac', 'Beta furnace', 'Beta private description') RETURNING id`, [bizB]);
    const creativeB = await one(`INSERT INTO creative_intake_requests (business_id, project_type) VALUES ($1, 'Beta brand film') RETURNING id`, [bizB]);
    const engagementB = await one(`INSERT INTO professional_engagement_requests (business_id, service_need) VALUES ($1, 'Beta tax audit') RETURNING id`, [bizB]);
    const svcB = await one(`INSERT INTO business_services (business_id, name) VALUES ($1, 'Beta cut') RETURNING id`, [bizB]);
    const apptB = await one(
      `INSERT INTO business_appointments (business_id, service_id, start_time, end_time, status, payment_status, base_price_cents, final_price_cents, cancellation_fee_cents)
       VALUES ($1, $2, NOW() + INTERVAL '1 day', NOW() + INTERVAL '25 hours', 'confirmed', 'pending', 100, 100, 0) RETURNING id`, [bizB, svcB]);

    // Trades: the customer files a request (cannot choose its quote or helper); the owner and employee follow up.
    const filed = await as(customer).post(`/api/trades-operations/business/${bizA}/requests`, {}).catch(() => null);
    expect([403, 404]).toContain(filed.status); // the member-only path is closed to a customer
    const diagA = await one(
      `INSERT INTO trades_diagnostic_requests (business_id, requester_id, issue_type, title, description) VALUES ($1, $2, 'plumbing', 'Alpha leak', 'Under the sink') RETURNING id`, [bizA, customer]);
    expect((await as(emp).post(`/api/trades-operations/business/${bizA}/recommendations`, { title: 'Swap', diagnostic_request_id: diagB })).status).toBe(404);
    expect((await as(emp).post(`/api/trades-operations/business/${bizA}/recommendations`, { title: 'Swap', diagnostic_request_id: diagA, quote_id: quoteB })).status).toBe(404);
    const rec = await as(emp).post(`/api/trades-operations/business/${bizA}/recommendations`, { title: 'Replace trap', diagnostic_request_id: diagA, quote_id: quoteA });
    expect(rec.status).toBe(201);
    expect((await as(ownerA).put(`/api/trades-operations/business/${bizA}/recommendations/${rec.body.recommendation?.id || rec.body.id}`, { diagnostic_request_id: diagB })).status).toBe(404);
    expect((await as(ownerA).put(`/api/trades-operations/business/${bizA}/requests/${diagA}`, { linked_quote_id: quoteB })).status).toBe(404);
    // Restricted employee cannot change template settings.
    expect((await as(emp).put(`/api/trades-operations/business/${bizA}/settings`, {})).status).toBe(403);
    // Workspace never shows B's linked rows.
    expect(JSON.stringify((await as(ownerA).get(`/api/trades-operations/business/${bizA}`)).body)).not.toMatch(/Beta/);

    // Creative / professional: approvals and compliance records cannot point at B's intake.
    expect((await as(emp).post(`/api/creative-operations/business/${bizA}/approval-records`, { record_type: 'proof', title: 'Cut 1', intake_request_id: creativeB })).status).toBe(404);
    expect((await as(emp).post(`/api/professional-operations/business/${bizA}/compliance-records`, { record_type: 'kyc', title: 'ID check', engagement_request_id: engagementB })).status).toBe(404);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM creative_approval_records WHERE intake_request_id = $1', [creativeB])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM professional_compliance_records WHERE engagement_request_id = $1', [engagementB])).rows[0].n).toBe(0);

    // Beauty (appointments): B's appointment or a non-team "staff" cannot be attached.
    const intakeA = await one(`INSERT INTO beauty_intake_requests (business_id, requester_id, desired_service) VALUES ($1, $2, 'Colour') RETURNING id`, [bizA, customer]);
    expect((await as(emp).put(`/api/beauty-operations/business/${bizA}/intakes/${intakeA}`, { linked_appointment_id: apptB })).status).toBe(404);
    expect((await as(emp).put(`/api/beauty-operations/business/${bizA}/intakes/${intakeA}`, { assigned_staff_id: outsider })).status).toBe(404);
    expect((await as(emp).put(`/api/beauty-operations/business/${bizA}/intakes/${intakeA}`, { assigned_staff_id: emp })).status).toBe(200);
    const { rows: [bi] } = await pool.query('SELECT linked_appointment_id, assigned_staff_id FROM beauty_intake_requests WHERE id = $1', [intakeA]);
    expect(bi).toEqual({ linked_appointment_id: null, assigned_staff_id: emp });
  });

  test('public intake cannot pick links or staff', async () => {
    const { stripPrivilegedIntakeFields } = require('../middleware/publicIntake');
    const req = { body: { title: 't', linked_quote_id: 1, linked_appointment_id: 2, assigned_staff_id: 'x', assigned_helper_id: 'y', quote_id: 3, status: 'done' } };
    stripPrivilegedIntakeFields(req, {}, () => {});
    expect(req.body).toEqual({ title: 't' });
  });
});
