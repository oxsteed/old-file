'use strict';

/**
 * WP-052 business leads, campaigns and follow-ups — PostgreSQL evidence that
 * lead access is its own permission (members without leads.view see nothing),
 * lead access does not grant outreach, quotes cannot target another business's
 * lead, and a scheduled broadcast whose scheduler lost authority returns to
 * draft at execution instead of sending. */

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








ddescribe('lead access, outreach and execution-time authority (WP-052, real database)', () => {
  let pool;
  let app;

  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-leads-${label}-${id}@example.invalid`, label],
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
  async function member(biz, owner, user, role) {
    const { rows } = await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW()) RETURNING id`, [biz, owner, user, role, `${role}-${user}@example.invalid`]);
    return rows[0].id;
  }
  async function lead(biz, customer) {
    const { rows } = await pool.query(
      `INSERT INTO business_leads (business_id, customer_id, description) VALUES ($1, $2, 'Fix my sink please') RETURNING id`, [biz, customer]);
    return String(rows[0].id);
  }
  const as = (u) => ({
    get: (url) => request(app).get(url).set('x-test-user', u),
    post: (url, body = {}) => request(app).post(url).set('x-test-user', u).send(body),
    patch: (url, body = {}) => request(app).patch(url).set('x-test-user', u).send(body),
    del: (url) => request(app).delete(url).set('x-test-user', u),
  });

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/businesses', require('../routes/businessLeads'));
    app.use('/api/businesses', require('../routes/businessLeadPipeline'));
    app.use('/api/businesses', require('../routes/businessMarketing'));
    app.use('/api/leads', require('../routes/leads'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('lead access needs leads.* and never implies outreach; quotes stay in-business', async () => {
    const owner = await newUser('owner'); const rep = await newUser('rep'); const emp = await newUser('emp');
    const customer = await newUser('cust');
    const biz = await newBusiness(owner, 'Lead Plumbing');
    const otherBiz = await newBusiness(await newUser('other-owner'), 'Other Plumbing');
    await member(biz, owner, rep, 'representative');
    await member(biz, owner, emp, 'employee');
    const mine = await lead(biz, customer);
    const foreign = await lead(otherBiz, customer);

    // Employee (no leads.*): every lead surface is closed.
    expect((await as(emp).get(`/api/businesses/${biz}/leads`)).status).toBe(403);
    expect((await as(emp).get(`/api/businesses/${biz}/lead-pipeline`)).status).toBe(403);
    expect((await as(emp).post(`/api/businesses/${biz}/leads`, { name: 'x' })).status).toBe(403);
    expect((await as(emp).patch(`/api/businesses/${biz}/lead-pipeline/${mine}/notes`, { note: 'x' })).status).toBe(403);
    expect((await as(emp).del(`/api/businesses/${biz}/leads/${mine}`)).status).toBe(403);
    expect((await as(emp).get(`/api/leads/business/${biz}`)).status).toBe(403);
    const empGet = await as(emp).get(`/api/leads/${mine}`);
    expect(empGet.status).toBe(404);
    expect(JSON.stringify(empGet.body)).not.toMatch(/sink/);

    // Representative: lead access ...
    const list = await as(rep).get(`/api/businesses/${biz}/leads`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain('Fix my sink');
    expect((await as(rep).get(`/api/leads/business/${biz}`)).status).toBe(200);
    expect((await as(rep).get(`/api/leads/${mine}`)).status).toBe(200);
    // ... but no outreach, through the browser flow or a direct launch.
    expect((await as(rep).post(`/api/businesses/${biz}/broadcasts`, { subject: 'Hi', message: 'Promo' })).status).toBe(403);
    const draft = (await pool.query(
      `INSERT INTO business_broadcasts (business_id, subject, body, message, channel, audience, status, created_by)
       VALUES ($1, 'Hi', 'Promo', 'Promo', 'email', 'all', 'draft', $2) RETURNING id`, [biz, owner])).rows[0].id;
    expect((await as(rep).post(`/api/businesses/${biz}/broadcasts/${draft}/send`)).status).toBe(403);
    expect((await pool.query('SELECT status FROM business_broadcasts WHERE id = $1', [draft])).rows[0].status).toBe('draft');

    // Quotes and deletes cannot reach another business's lead.
    expect((await as(rep).post(`/api/businesses/${biz}/leads/${foreign}/quotes`, { amount_cents: 1000 })).status).toBe(404);
    expect((await as(rep).post(`/api/businesses/${biz}/lead-pipeline/${foreign}/to-quote`, { amount_cents: 1000 })).status).toBe(404);
    expect((await as(owner).del(`/api/businesses/${biz}/leads/${foreign}`)).status).toBe(404);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM business_leads WHERE id = $1', [foreign])).rows[0].n).toBe(1);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM lead_quotes WHERE lead_id = $1', [foreign])).rows[0].n).toBe(0);
  });

  test('scheduled outreach re-checks the scheduler at execution', async () => {
    const owner = await newUser('owner2'); const mgr = await newUser('mgr');
    const biz = await newBusiness(owner, 'Campaign Salon');
    const mId = await member(biz, owner, mgr, 'manager');
    await pool.query(
      `INSERT INTO business_clients (business_id, display_name, email, status) VALUES ($1, 'Pat Client', 'pat.client@example.invalid', 'active')`, [biz]);

    const future = new Date(Date.now() + 3600e3).toISOString();
    const byMgr = await as(mgr).post(`/api/businesses/${biz}/broadcasts`, { subject: 'Spring', message: 'Sale', scheduled_at: future });
    expect(byMgr.status).toBe(201);
    const byOwner = await as(owner).post(`/api/businesses/${biz}/broadcasts`, { subject: 'Owner', message: 'News', scheduled_at: future });
    expect(byOwner.status).toBe(201);
    for (const b of [byMgr.body.id, byOwner.body.id]) {
      expect((await (b === byMgr.body.id ? as(mgr) : as(owner)).post(`/api/businesses/${biz}/broadcasts/${b}/send`)).status).toBe(202);
    }

    // The manager is demoted before the schedule fires.
    await pool.query(
      `UPDATE business_members SET role = 'representative', role_updated_by = $2 WHERE id = $1`, [mId, owner]);
    await pool.query(`UPDATE business_broadcasts SET scheduled_at = NOW() - INTERVAL '1 minute' WHERE business_id = $1`, [biz]);

    const broadcasts = require('../services/broadcastDeliveryService');
    const promoted = await broadcasts.promoteScheduled(pool);
    const { rows } = await pool.query(
      `SELECT b.id, b.status, (SELECT COUNT(*)::int FROM business_broadcast_recipients r WHERE r.broadcast_id = b.id) AS recipients
         FROM business_broadcasts b WHERE b.business_id = $1`, [biz]);
    const byId = Object.fromEntries(rows.map((r) => [String(r.id), r]));
    expect(byId[String(byMgr.body.id)]).toMatchObject({ status: 'draft', recipients: 0 });
    expect(byId[String(byOwner.body.id)].status).not.toBe('draft');
    expect(byId[String(byOwner.body.id)].recipients).toBe(1);
    expect(promoted.map(String)).toEqual([String(byOwner.body.id)]);
  });
});
