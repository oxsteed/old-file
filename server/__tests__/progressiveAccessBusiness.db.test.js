'use strict';

/**
 * WP-046 business setup and existing ownership — PostgreSQL evidence:
 * no duplicate primary business under concurrent submits, no claim of
 * another person's business by copied id, and activation (publish) gated on
 * an approved application under ACCESS_BUSINESS_ENFORCEMENT.
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


ddescribe('business setup and ownership (WP-046, real database)', () => {
  let pool;
  let app;

  async function newUser(label, { role = 'customer', mode = 'customer' } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', $4, $5, TRUE, TRUE)`,
      [id, `pa-biz-${label}-${id}@example.invalid`, label, role, mode],
    );
    mockUsers.set(id, { id, role });
    return id;
  }
  const as = (userId) => ({
    get: (url) => request(app).get(url).set('x-test-user', userId),
    post: (url, body = {}, key) => {
      const r = request(app).post(url).set('x-test-user', userId);
      if (key) r.set('Idempotency-Key', key);
      return r.send(body);
    },
    put: (url, body = {}) => request(app).put(url).set('x-test-user', userId).send(body),
  });
  const SERVICE_BODY = { business_name: 'Fixture Fix', business_type: 'Auto Repair', industry_category: 'auto', business_mode: 'services_marketplace', address_city: 'Columbus', address_state: 'OH', address_country: 'US' };
  const primaries = async (userId) => Number((await pool.query('SELECT COUNT(*)::int AS n FROM businesses WHERE user_id = $1 AND is_primary', [userId])).rows[0].n);

  beforeAll(async () => {
    pool = require('../db');
    const ctrl = require('../controllers/businessController');
    const { errorHandler } = require('../middleware/errorHandler');
    const { authenticate } = require('../middleware/auth');
    const routes = require('../routes/progressiveAccess');
    app = express();
    app.use(express.json());
    app.post('/api/businesses', authenticate, ctrl.addBusiness);
    app.put('/api/businesses/:id/primary', authenticate, ctrl.setPrimary);
    app.post('/api/businesses/:id/onboarding/complete', authenticate, ctrl.completeBusinessOnboarding);
    app.use('/api/me', routes.meRouter);
    app.use(errorHandler);
  });

  afterAll(async () => {
    delete process.env.ACCESS_BUSINESS_ENFORCEMENT;
    if (pool) await pool.end();
  });

  test('duplicate wizard submits never create two primary businesses', async () => {
    const u = await newUser('dup');
    const results = await Promise.all([0, 1, 2, 3, 4].map((i) => as(u).post('/api/businesses', SERVICE_BODY, i < 3 ? 'same-wizard-key' : `other-key-${i}`)));
    expect(results.map((r) => r.status + ':' + JSON.stringify(r.body).slice(0, 200)).filter((x) => !/^20[01]/.test(x))).toEqual([]);
    expect(await primaries(u)).toBe(1);
    // The three same-key submits resolve to one row.
    const ids = new Set(results.slice(0, 3).map((r) => r.body.business.id));
    expect(ids.size).toBe(1);
  });

  test('concurrent primary switches leave exactly one primary; a foreign id changes nothing', async () => {
    const u = await newUser('switch');
    const other = await newUser('switch-other');
    const a = (await as(u).post('/api/businesses', SERVICE_BODY, 'sw-a')).body.business.id;
    const b = (await as(u).post('/api/businesses', SERVICE_BODY, 'sw-b')).body.business.id;
    const foreign = (await as(other).post('/api/businesses', SERVICE_BODY, 'sw-f')).body.business.id;
    await Promise.all([as(u).put(`/api/businesses/${a}/primary`), as(u).put(`/api/businesses/${b}/primary`), as(u).put(`/api/businesses/${a}/primary`)]);
    expect(await primaries(u)).toBe(1);
    const before = (await pool.query('SELECT id FROM businesses WHERE user_id = $1 AND is_primary', [u])).rows[0].id;
    expect((await as(u).put(`/api/businesses/${foreign}/primary`)).status).toBe(404);
    expect((await pool.query('SELECT id FROM businesses WHERE user_id = $1 AND is_primary', [u])).rows[0].id).toBe(before);
    expect(await primaries(other)).toBe(1);
  });

  test('a copied business id or exact name cannot claim someone else\'s business', async () => {
    const owner = await newUser('claim-owner');
    const claimant = await newUser('claimant');
    const biz = (await as(owner).post('/api/businesses', { ...SERVICE_BODY, business_name: 'Exact Name Plumbing' }, 'claim-1')).body.business;
    const byId = await as(claimant).post('/api/me/access-requests', { capability: 'business.own', subject: { type: 'business', id: String(biz.id) }, answers: { businessName: 'Exact Name Plumbing', businessType: 'llc', serviceArea: { country: 'US', city: 'Columbus' } } }, 'claim-id-1');
    expect(byId.status).toBe(404);
    expect(byId.body.code).toBe('subject_not_found');
    // Unknown id looks the same (resource hiding).
    const unknown = await as(claimant).post('/api/me/access-requests', { capability: 'business.own', subject: { type: 'business', id: '999999999' }, answers: {} }, 'claim-id-2');
    expect(unknown.status).toBe(404);
    // By exact name: a proposal never links to the existing business.
    const byName = await as(claimant).post('/api/me/access-requests', { capability: 'business.own', subject: { type: 'business_proposal' }, answers: { businessName: 'Exact Name Plumbing', businessType: 'llc', serviceArea: { country: 'US', city: 'Columbus' } } }, 'claim-name-1');
    expect(byName.status).toBe(201);
    expect(byName.body.request.subject.id).toBeNull();
    expect((await pool.query('SELECT user_id FROM businesses WHERE id = $1', [biz.id])).rows[0].user_id).toBe(owner);
  });

  test('activation is the reviewed step under ACCESS_BUSINESS_ENFORCEMENT', async () => {
    const u = await newUser('publish');
    const biz = (await as(u).post('/api/businesses', SERVICE_BODY, 'pub-1')).body.business;
    process.env.ACCESS_BUSINESS_ENFORCEMENT = 'enforce';
    const denied = await as(u).post(`/api/businesses/${biz.id}/onboarding/complete`);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'access_required', capability: 'business.own' });
    expect((await pool.query('SELECT is_listed FROM businesses WHERE id = $1', [biz.id])).rows[0].is_listed).toBe(false);
    process.env.ACCESS_BUSINESS_ENFORCEMENT = 'shadow';
    const shadow = await as(u).post(`/api/businesses/${biz.id}/onboarding/complete`);
    expect(shadow.body.code).not.toBe('access_required');
    process.env.ACCESS_BUSINESS_ENFORCEMENT = 'enforce';
    await pool.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES ($1, 'business.own', 'self', 'self', 'active', 'admin', 'business-owner-policy-1')`, [u]);
    const allowed = await as(u).post(`/api/businesses/${biz.id}/onboarding/complete`);
    expect(allowed.body.code).not.toBe('access_required');
    delete process.env.ACCESS_BUSINESS_ENFORCEMENT;
  });
});
