'use strict';

/**
 * WP-056 integrations and brand linkage — PostgreSQL evidence that two owners'
 * integrations stay separate: an intercepted or stale Stripe Connect callback
 * cannot attach to the other business or after ownership is lost, integration
 * settings and webhook URLs are not readable by members without
 * settings.integrations, and webhook ids cannot be combined across businesses. */

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
process.env.STRIPE_CLIENT_ID = 'ca_test_fixture';
process.env.STRIPE_SECRET_KEY = 'sk_test_fixture_not_used';
process.env.STRIPE_CONNECT_STATE_SECRET = 'wp056-fixture-secret';

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








ddescribe('integration setup stays bound to its business (WP-056, real database)', () => {
  let pool;
  let app;

  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-int-${label}-${id}@example.invalid`, label],
    );
    mockUsers.set(id, { id, role: 'customer' });
    return id;
  }
  async function newBusiness(ownerId, name) {
    const { rows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, $2, FALSE, TRUE, FALSE) RETURNING id`, [ownerId, name]);
    return rows[0].id;
  }
  async function startAuth(owner, biz) {
    const res = await request(app).post(`/api/businesses/${biz}/integrations/stripe/auth`).set('x-test-user', owner);
    expect(res.status).toBe(200);
    const state = new URL(res.body.auth_url).searchParams.get('state');
    const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('oxsteed_stripe_oauth='));
    return { state, cookie: cookie.split(';')[0] };
  }
  const pending = async (biz) => (await pool.query(
    `SELECT config_json ? 'stripe_oauth_pending' AS p FROM business_integrations WHERE business_id = $1 AND integration_type = 'stripe'`, [biz])).rows[0]?.p ?? false;

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/businesses', require('../routes/businessIntegrations'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('callbacks, settings reads and webhook ids are bound to one business', async () => {
    const ownerA = await newUser('ownerA'); const ownerB = await newUser('ownerB');
    const mgr = await newUser('mgr'); const emp = await newUser('emp');
    const bizA = await newBusiness(ownerA, 'Alpha Scan'); const bizB = await newBusiness(ownerB, 'Beta Scan');
    for (const [u, role] of [[mgr, 'manager'], [emp, 'employee']]) {
      await pool.query(
        `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
         VALUES ($1, $2, $3, $4, $5, 'active', NOW())`, [bizA, ownerA, u, role, `${role}-${u}@example.invalid`]);
    }

    const a = await startAuth(ownerA, bizA);
    const b = await startAuth(ownerB, bizB);

    // A's state presented on B's callback path (intercepted / re-pointed): rejected, nothing consumed.
    const crossed = await request(app).get(`/api/businesses/${bizB}/integrations/stripe/callback`)
      .query({ state: a.state, error: 'access_denied' }).set('Cookie', a.cookie);
    expect(crossed.status).toBe(302);
    expect(crossed.headers.location).toMatch(/stripe=error/);
    expect(await pending(bizA)).toBe(true);
    expect(await pending(bizB)).toBe(true);
    // B's state with A's browser cookie: rejected.
    const wrongCookie = await request(app).get('/api/businesses/integrations/stripe/callback')
      .query({ state: b.state, error: 'access_denied' }).set('Cookie', a.cookie);
    expect(wrongCookie.headers.location).toMatch(/stripe=error/);
    expect(await pending(bizB)).toBe(true);

    // Stale: ownership of A moves away before the callback arrives.
    await pool.query('UPDATE businesses SET user_id = $2 WHERE id = $1', [bizA, ownerB]);
    const stale = await request(app).get('/api/businesses/integrations/stripe/callback')
      .query({ state: a.state, error: 'access_denied' }).set('Cookie', a.cookie);
    expect(stale.headers.location).toMatch(/stripe=error/);
    expect(await pending(bizA)).toBe(true);
    await pool.query('UPDATE businesses SET user_id = $2 WHERE id = $1', [bizA, ownerA]);

    // The genuine callback consumes exactly once; a replay is refused.
    const ok = await request(app).get('/api/businesses/integrations/stripe/callback')
      .query({ state: b.state, error: 'access_denied' }).set('Cookie', b.cookie);
    expect(ok.headers.location).toMatch(new RegExp(`stripe=error&businessId=${bizB}&message=access_denied`));
    expect(await pending(bizB)).toBe(false);
    const replay = await request(app).get('/api/businesses/integrations/stripe/callback')
      .query({ state: b.state, error: 'access_denied' }).set('Cookie', b.cookie);
    expect(replay.headers.location).toMatch(/already%20used|expired/);

    // Settings and webhook URLs: manager yes, employee no; ids never cross businesses.
    const hookB = (await pool.query(
      `INSERT INTO business_webhooks (business_id, webhook_url, event_types, created_by_id, is_active)
       VALUES ($1, 'https://beta.example.invalid/hook?token=secret-b', ARRAY['order.created'], $2, TRUE) RETURNING id`, [bizB, ownerB])).rows[0].id;
    expect((await request(app).get(`/api/businesses/${bizA}/integrations`).set('x-test-user', emp)).status).toBe(403);
    expect((await request(app).get(`/api/businesses/${bizA}/webhooks`).set('x-test-user', emp)).status).toBe(403);
    const mgrHooks = await request(app).get(`/api/businesses/${bizA}/webhooks`).set('x-test-user', mgr);
    expect(mgrHooks.status).toBe(200);
    expect(JSON.stringify(mgrHooks.body)).not.toMatch(/secret-b/);
    expect((await request(app).delete(`/api/businesses/${bizA}/webhooks/${hookB}`).set('x-test-user', mgr)).status).toBe(404);
    expect((await pool.query('SELECT is_active FROM business_webhooks WHERE id = $1', [hookB])).rows[0].is_active).toBe(true);
  });
});
