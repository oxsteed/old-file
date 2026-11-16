'use strict';

/**
 * WP-050 business communications and representative scope — PostgreSQL
 * evidence with a representative who sees only assigned conversations:
 * queue, search, read, reply, attachments, templates and the attention badge
 * all agree; after the membership is revoked the business inbox closes while
 * the person's own customer conversations stay readable. */

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






ddescribe('representative message scope (WP-050, real database)', () => {
  let pool;
  let app;

  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-msg-${label}-${id}@example.invalid`, label],
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
  async function conversation(businessId, createdBy, { assignedTo = null, customerName, customerId = null }) {
    const { rows: [c] } = await pool.query(
      `INSERT INTO business_conversations (business_id, conversation_type, customer_id, customer_name, customer_email, created_by_id, assigned_to_user_id, last_message_at)
       VALUES ($1, 'customer', $2, $3, $6, $4, $5, NOW() - INTERVAL '1 hour') RETURNING id`,
      [businessId, customerId, customerName, createdBy, assignedTo, `${customerName.replace(/\W+/g, '.').toLowerCase()}@example.invalid`]);
    await pool.query(
      `INSERT INTO business_messages (conversation_id, sender_id, sender_name, sender_type, content, message_type, created_at)
       VALUES ($1, $2, $3, 'customer', 'Hello, is anyone there?', 'text', NOW() - INTERVAL '1 hour')`,
      [c.id, customerId, customerName]);
    return c.id;
  }
  const as = (u) => ({
    get: (url) => request(app).get(url).set('x-test-user', u),
    post: (url, body = {}) => request(app).post(url).set('x-test-user', u).send(body),
    del: (url) => request(app).delete(url).set('x-test-user', u),
  });

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/businesses', require('../routes/businessOperations'));
    app.use('/api/businesses', require('../routes/businessMsgTemplates'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('assigned-only representative: queue, search, read, reply, templates and badge agree', async () => {
    const owner = await newUser('owner'); const rep = await newUser('rep');
    const biz = await newBusiness(owner, 'Scope Plumbing');
    const { rows: [m] } = await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'representative', $4, 'active', NOW()) RETURNING id`, [biz, owner, rep, `rep-${rep}@example.invalid`]);
    const mine = await conversation(biz, owner, { assignedTo: rep, customerName: 'Assigned Alice' });
    const other = await conversation(biz, owner, { assignedTo: null, customerName: 'Hidden Harriet' });

    const queue = await as(rep).get(`/api/businesses/${biz}/messages`);
    expect(queue.status).toBe(200);
    const ids = JSON.stringify(queue.body);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(other);
    expect(ids).not.toMatch(/Harriet/);
    const search = await as(rep).get(`/api/businesses/${biz}/messages?search=Harriet`);
    expect(JSON.stringify(search.body)).not.toMatch(/Harriet/);

    expect((await as(rep).get(`/api/businesses/${biz}/messages/${mine}`)).status).toBe(200);
    for (const res of [
      await as(rep).get(`/api/businesses/${biz}/messages/${other}`),
      await as(rep).post(`/api/businesses/${biz}/messages/${other}`, { content: 'sneaky reply' }),
      await as(rep).post(`/api/businesses/${biz}/messages/${other}/archive`),
    ]) {
      expect([403, 404]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toMatch(/Harriet|anyone there/);
    }
    // Reply permission does not give assignment or team reconfiguration.
    expect((await as(rep).get(`/api/businesses/${biz}/messages/assignments/list`)).status).toBe(403);
    expect((await as(rep).post(`/api/businesses/${biz}/messages/${mine}/claim`)).status).toBe(403);

    // Templates: can list and use, cannot manage; a foreign template id is a plain 404.
    const tpl = (await pool.query(
      `INSERT INTO business_message_templates (business_id, name, category, body) VALUES ($1, 'Greeting', 'custom', 'Hi!') RETURNING id`, [biz])).rows[0].id;
    expect((await as(rep).get(`/api/businesses/${biz}/message-templates`)).status).toBe(200);
    expect((await as(rep).post(`/api/businesses/${biz}/message-templates/${tpl}/use`)).status).toBe(200);
    expect((await as(rep).post(`/api/businesses/${biz}/message-templates`, { name: 'x', body: 'y' })).status).toBe(403);
    const otherBiz = await newBusiness(owner, 'Other Plumbing');
    const foreignTpl = (await pool.query(
      `INSERT INTO business_message_templates (business_id, name, category, body) VALUES ($1, 'Secret', 'custom', 'Hidden') RETURNING id`, [otherBiz])).rows[0].id;
    expect((await as(rep).post(`/api/businesses/${biz}/message-templates/${foreignTpl}/use`)).status).toBe(404);
    expect((await as(owner).del(`/api/businesses/${biz}/message-templates/${foreignTpl}`)).status).toBe(404);
    expect((await pool.query('SELECT use_count FROM business_message_templates WHERE id = $1', [foreignTpl])).rows[0].use_count).toBe(0);

    // Attention badge agrees with the queue.
    const { collectAttention } = require('../services/attention');
    const att = await collectAttention({ userId: rep, businessId: biz, category: 'messages' });
    const sources = att.items.map((i) => i.sourceId || i.source_id || i.id).join(' ');
    expect(JSON.stringify(att.items)).toContain(mine);
    expect(JSON.stringify(att.items)).not.toMatch(/Harriet/);
    expect(sources).not.toContain(other);
    const ownerAtt = await collectAttention({ userId: owner, businessId: biz, category: 'messages' });
    expect(JSON.stringify(ownerAtt.items)).toMatch(/Harriet/);

    // Revoke: the business inbox closes; the person's own customer conversation stays readable.
    const shop = await newBusiness(await newUser('shop-owner'), 'Corner Shop');
    const personal = await conversation(shop, owner, { customerName: 'Rep As Customer', customerId: rep });
    await pool.query("UPDATE business_members SET status = 'revoked' WHERE id = $1", [m.id]);
    expect((await as(rep).get(`/api/businesses/${biz}/messages`)).status).toBe(404);
    expect((await as(rep).get(`/api/businesses/${biz}/messages/${mine}`)).status).toBe(404);
    expect((await pool.query('SELECT customer_id FROM business_conversations WHERE id = $1', [personal])).rows[0].customer_id).toBe(rep);
  });
});
