'use strict';

/**
 * WP-053 catalog, pricing rules and marketplace publishing — PostgreSQL
 * evidence that authority over business A never reaches a product, rule or
 * tier of business B, legitimate price edits land only in A's catalog and are
 * audited, and public price reads keep their visibility filter. */

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








ddescribe('catalog and pricing stay inside the owning business (WP-053, real database)', () => {
  let pool;
  let app;

  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-cat-${label}-${id}@example.invalid`, label],
    );
    mockUsers.set(id, { id, role: 'customer' });
    return id;
  }
  async function newBusiness(ownerId, name, listed = false) {
    const { rows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed)
       VALUES ($1, $2, FALSE, TRUE, $3) RETURNING id`, [ownerId, name, listed]);
    return rows[0].id;
  }
  async function product(biz, name, cents) {
    const { rows } = await pool.query(
      `INSERT INTO business_products (business_id, name, sku, price_cents, is_active)
       VALUES ($1, $2, $3, $4, TRUE) RETURNING id`, [biz, name, `SKU-${crypto.randomUUID().slice(0, 8)}`, cents]);
    return rows[0].id;
  }
  const as = (u) => ({
    put: (url, body = {}) => request(app).put(url).set('x-test-user', u).send(body),
    post: (url, body = {}) => request(app).post(url).set('x-test-user', u).send(body),
    del: (url) => request(app).delete(url).set('x-test-user', u),
  });

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/businesses', require('../routes/businessProducts'));
    app.use('/api/businesses', require('../routes/businessProductPricing'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  test('a manager of A cannot edit B; a legitimate edit lands only in A and is audited', async () => {
    const ownerA = await newUser('ownerA'); const ownerB = await newUser('ownerB');
    const mgr = await newUser('mgr'); const emp = await newUser('emp');
    const bizA = await newBusiness(ownerA, 'Alpha Hardware');
    const bizB = await newBusiness(ownerB, 'Beta Hardware', true);
    for (const [u, role] of [[mgr, 'manager'], [emp, 'employee']]) {
      await pool.query(
        `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
         VALUES ($1, $2, $3, $4, $5, 'active', NOW())`, [bizA, ownerA, u, role, `${role}-${u}@example.invalid`]);
    }
    await pool.query(`UPDATE businesses SET setup_status = 'active', business_kind = 'service' WHERE id = ANY($1::int[])`, [[bizA, bizB]]);
    await pool.query('UPDATE users SET onboarding_completed = TRUE WHERE id = $1', [ownerB]);
    const pA = await product(bizA, 'Alpha Hammer', 1500);
    const pB = await product(bizB, 'Beta Wrench', 2500);
    const ruleB = (await pool.query(
      `INSERT INTO product_pricing_rules (business_id, rule_name, rule_type, description, priority, applies_to, applies_to_id, conditions_json, pricing_adjustment)
       VALUES ($1, 'Beta promo', 'promotion', '', 50, 'product', $2, '{}', '{"type":"percent","value":10}') RETURNING id`, [bizB, String(pB)])).rows[0].id;

    // Cross-business attempts through A's path all answer 404 and change nothing.
    expect((await as(mgr).put(`/api/businesses/${bizA}/products/${pB}`, { name: 'Hijacked', price: 1 })).status).toBe(404);
    expect((await as(mgr).post(`/api/businesses/${bizA}/product-pricing/rules`, {
      name: 'Steal', type: 'promotion', appliesToType: 'product', appliesTo: String(pB), adjustment: { type: 'percent', value: 90 },
    })).status).toBe(404);
    expect((await as(mgr).post(`/api/businesses/${bizA}/products/${pB}/bulk-pricing`, { tiers: [{ minQuantity: 1, discountPercent: 99 }] })).status).toBe(404);
    expect((await as(mgr).del(`/api/businesses/${bizA}/product-pricing/rules/${ruleB}`)).status).toBe(404);
    expect((await as(mgr).put(`/api/businesses/${bizA}/product-pricing/rules/${ruleB}`, { priority: 99 })).status).toBe(404);
    const { rows: [b] } = await pool.query('SELECT name, price_cents::int AS price_cents FROM business_products WHERE id = $1', [pB]);
    expect(b).toEqual({ name: 'Beta Wrench', price_cents: 2500 });
    expect((await pool.query('SELECT priority FROM product_pricing_rules WHERE id = $1', [ruleB])).rows[0].priority).toBe(50);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM product_pricing_rules WHERE applies_to_id = $1', [String(pB)])).rows[0].n).toBe(1);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM product_bulk_tiers WHERE product_id = $1', [pB])).rows[0].n).toBe(0);

    // Employee: can view the catalog but not change prices.
    expect((await as(emp).post(`/api/businesses/${bizA}/product-pricing/rules`, { name: 'x', type: 'promotion', appliesToType: 'all' })).status).toBe(403);
    expect((await as(emp).put(`/api/businesses/${bizA}/products/${pA}`, { price: 1 })).status).toBe(403);

    // Legitimate edits in A: integer cents kept, A only, audited.
    expect((await as(mgr).put(`/api/businesses/${bizA}/products/${pA}`, { price: 12.345 })).status).toBe(200);
    expect((await pool.query('SELECT price_cents FROM business_products WHERE id = $1', [pA])).rows[0].price_cents).toBe('1235');
    const created = await as(mgr).post(`/api/businesses/${bizA}/product-pricing/rules`, {
      name: 'Alpha promo', type: 'promotion', appliesToType: 'product', appliesTo: String(pA), adjustment: { type: 'percent', value: 10 },
    });
    expect(created.status).toBe(201);
    expect(String(created.body.data.business_id)).toBe(String(bizA));
    expect((await as(mgr).post(`/api/businesses/${bizA}/products/${pA}/bulk-pricing`, { tiers: [{ minQuantity: 5, discountPercent: 5 }] })).status).toBe(200);
    expect((await as(mgr).del(`/api/businesses/${bizA}/product-pricing/rules/${created.body.data.id}`)).status).toBe(200);
    const { rows: audit } = await pool.query(
      `SELECT action FROM business_audit_log WHERE business_id = $1 AND action LIKE 'business.product_%' ORDER BY id`, [bizA]);
    expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining([
      'business.product_pricing_rule.created', 'business.product_bulk_tiers.set', 'business.product_pricing_rule.deleted']));
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM business_audit_log WHERE business_id = $1 AND action LIKE 'business.product_%'`, [bizB])).rows[0].n).toBe(0);

    // Public reads keep the listing filter: B (listed) answers, A (unlisted) does not.
    expect((await request(app).get(`/api/businesses/${bizB}/products/${pB}/bulk-pricing`)).status).toBe(200);
    expect((await request(app).get(`/api/businesses/${bizA}/products/${pA}/bulk-pricing`)).status).toBe(404);
    expect((await request(app).get(`/api/businesses/${bizB}/products/${pA}/bulk-pricing`)).status).toBe(404);
  });
});
