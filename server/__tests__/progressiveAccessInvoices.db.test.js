'use strict';

/**
 * WP-054 invoices, quotes and recurring billing — PostgreSQL evidence with one
 * identity issuing a personal (helper) invoice and, as a manager, a business
 * invoice. After the business finance role is revoked the business surfaces
 * close, the personal invoice is untouched, the business invoice stays the
 * business's (issuer = owner), and a committed recurring invoice is never
 * duplicated. */

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








ddescribe('personal and business invoices from one identity (WP-054, real database)', () => {
  let pool;
  let app;

  async function newUser(label) {
    const id = crypto.randomUUID();
    const email = `pa-inv-${label}-${id}@example.invalid`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active,
                          identity_verified, terms_accepted, terms_accepted_at, terms_version)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'helper', 'helper', TRUE, TRUE, TRUE, TRUE, NOW(), 'invoice-fixture')`, [id, email, label]);
    // Domain 6 enforce contract: every /api/helpers/invoices route is gated
    // by requireHelperCapability, so both identities need the backfilled
    // helper.offer_services grant (the owner later PUTs a helper path
    // expecting 404, which would 403 without a grant).
    await pool.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES ($1, 'helper.offer_services', 'self', 'self', 'active', 'legacy_backfill', 'helper-policy-1')`,
      [id],
    );
    mockUsers.set(id, { id, role: 'helper', email });
    return id;
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
    app.use('/api/businesses', require('../routes/businessFinance'));
    app.use('/api/businesses', require('../routes/businessRecurringBilling'));
    app.use('/api/businesses', require('../routes/businesses'));
    app.use('/api/helpers', require('../routes/helpers'));
    app.use('/api/invoices', require('../routes/invoices'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('revoking business finance rights closes business surfaces only, with no duplicate billing', async () => {
    const owner = await newUser('owner'); const mgr = await newUser('mgr');
    const { rows: [b] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, 'Ledger Cleaning', FALSE, TRUE, FALSE) RETURNING id`, [owner]);
    const biz = b.id;
    const { rows: [m] } = await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'manager', $4, 'active', NOW()) RETURNING id`, [biz, owner, mgr, `mgr-${mgr}@example.invalid`]);
    const line = [{ description: 'Deep clean', quantity: 1, unit_price: 120 }];

    const personal = await as(mgr).post('/api/helpers/invoices', { client_name: 'Neighbour Nia', line_items: line });
    expect(personal.status).toBe(201);
    expect(personal.body.invoice.business_id).toBeNull();
    expect(personal.body.invoice.user_id).toBe(mgr);
    const business = await as(mgr).post(`/api/businesses/${biz}/invoices`, { client_name: 'Corporate Carl', line_items: line });
    expect(business.status).toBe(201);
    expect(String(business.body.invoice.business_id)).toBe(String(biz));
    expect(business.body.invoice.user_id).toBe(owner); // issuer is the business owner, not the delegate

    const plan = await as(mgr).post(`/api/businesses/${biz}/recurring-billing`, {
      client_name: 'Monthly Mona', description: 'Office cleaning', amount_cents: 5000, frequency: 'monthly', next_billing_date: '2026-11-01',
    });
    expect(plan.status).toBe(201);
    expect((await as(mgr).post(`/api/businesses/${biz}/recurring-billing/${plan.body.id}/generate-invoice`)).status).toBe(201);
    const quote = await as(mgr).post(`/api/businesses/${biz}/quotes`, { client_name: 'Quote Quinn', title: 'Windows', line_items: line });
    expect(quote.status).toBe(201);

    // Revoke finance rights (demote to representative).
    await pool.query(`UPDATE business_members SET role = 'representative', role_updated_by = $2 WHERE id = $1`, [m.id, owner]);

    const bizInv = business.body.invoice.id;
    for (const res of [
      await as(mgr).get(`/api/businesses/${biz}/invoices`),
      await as(mgr).put(`/api/businesses/${biz}/invoices/${bizInv}`, { client_name: 'Changed' }),
      await as(mgr).post(`/api/businesses/${biz}/invoices/${bizInv}/send`),
      await as(mgr).post(`/api/businesses/${biz}/recurring-billing/${plan.body.id}/generate-invoice`),
      await as(mgr).get(`/api/businesses/${biz}/quotes`),
      await as(mgr).get(`/api/businesses/${biz}/recurring-billing`),
    ]) {
      expect([403, 404]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toMatch(/Corporate Carl|Monthly Mona/);
    }
    expect((await pool.query('SELECT client_name FROM business_invoices WHERE id = $1', [bizInv])).rows[0].client_name).toBe('Corporate Carl');

    // Personal surface is untouched and never lists the business invoice.
    const mine = await as(mgr).get('/api/invoices?view=issued');
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.body)).toMatch(/Neighbour Nia/);
    expect(JSON.stringify(mine.body)).not.toMatch(/Corporate Carl/);
    expect((await as(mgr).put(`/api/helpers/invoices/${personal.body.invoice.id}`, { client_name: 'Neighbour Nia', line_items: line, notes: 'still mine' })).status).toBe(200);
    // ... and the helper path cannot reach the business invoice.
    expect((await as(owner).put(`/api/helpers/invoices/${bizInv}`, { client_name: 'x', line_items: line })).status).toBe(404);

    // The owner retrying the committed period never mints a second invoice.
    const retry = await as(owner).post(`/api/businesses/${biz}/recurring-billing/${plan.body.id}/generate-invoice`);
    expect([200, 409]).toContain(retry.status);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM business_invoices WHERE recurring_billing_id = $1', [plan.body.id])).rows[0].n).toBe(1);

    // Quote ids route correctly (:quoteId) and foreign ids are a plain 404.
    const qid = quote.body.id;
    expect((await as(owner).get(`/api/businesses/${biz}/quotes/${qid}`)).status).toBe(200);
    expect((await as(owner).del(`/api/businesses/${biz}/quotes/999999999`)).status).toBe(404);
    expect((await as(owner).del(`/api/businesses/${biz}/quotes/${qid}`)).status).toBe(200);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM business_quotes WHERE id = $1', [qid])).rows[0].n).toBe(0);
  });
});
