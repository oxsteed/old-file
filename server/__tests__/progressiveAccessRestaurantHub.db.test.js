'use strict';

/**
 * WP-072 offline POS and store hub — PostgreSQL evidence that when a hub
 * replays its queued offline cash sales after the cashier's store membership
 * was revoked, the sale is held for manager review (no order, no payment
 * posted), while a sale on a drawer whose cashier is still at the store is
 * not held for that reason. Offline tickets from screens accept only
 * pay-at-counter, so there is no offline card capture to double. */

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
  authenticateIfPresent: (req, res, next) => (req.get('x-test-user') ? mockFakeAuth(req, res, next) : next()),
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















ddescribe('offline replay after membership revoke (WP-072, real database)', () => {
  let pool;
  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-hub-${label}-${id}@example.invalid`, label],
    );
    return id;
  }
  beforeAll(() => { pool = require('../db'); });
  afterAll(async () => { if (pool) await pool.end(); });

  test('revoked cashier: held for review; current cashier: not held for that reason', async () => {
    const hub = require('../services/storeHubService');
    const owner = await newUser('owner'); const cashier = await newUser('cashier'); const stayer = await newUser('stayer');
    const biz = (await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active, is_listed) VALUES ($1, 'Hub Store', FALSE, TRUE, FALSE) RETURNING id`, [owner])).rows[0].id;
    const r = (await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status) VALUES ($1, $2, 'Hub Store', 'active') RETURNING id`, [biz, owner])).rows[0].id;
    const loc = (await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary', [r])).rows[0].id;
    const memberOf = async (u) => (await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'employee', $4, 'active', NOW()) RETURNING id`, [biz, owner, u, `c-${u}@example.invalid`])).rows[0].id;
    const cashierM = await memberOf(cashier); await memberOf(stayer);
    const hubId = (await pool.query(`INSERT INTO store_hubs (restaurant_id, location_id, name) VALUES ($1, $2, 'Back office') RETURNING id`, [r, loc])).rows[0].id;
    const shift = async (u) => (await pool.query(
      `INSERT INTO restaurant_pos_shifts (restaurant_id, location_id, staff_user_id, status, opening_cash_cents) VALUES ($1, $2, $3, 'open', 0) RETURNING id`, [r, loc, u])).rows[0].id;
    const shiftC = await shift(cashier); const shiftS = await shift(stayer);
    const item = (await pool.query(`INSERT INTO food_menu_items (restaurant_id, name, price_cents) VALUES ($1, 'Tea', 300) RETURNING id`, [r])).rows[0].id;
    const sale = async (shiftId) => (await pool.query(
      `INSERT INTO store_hub_offline_sales (restaurant_id, location_id, hub_id, hub_sale_uuid, idempotency_key, shift_id, payload, total_cents, cash_tendered_cents, currency_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 300, 500, 'USD') RETURNING id`,
      [r, loc, hubId, crypto.randomUUID(), `k-${crypto.randomUUID()}`, shiftId,
        JSON.stringify({ lines: [{ menuItemId: Number(item), quantity: 1, unitPriceCents: 300, name: 'Tea' }], subtotalCents: 300, taxCents: 0, taxIncluded: false, tipCents: 0, discountCents: 0 })])).rows[0].id;
    const saleC = await sale(shiftC); const saleS = await sale(shiftS);

    // The cashier is removed while the hub was offline.
    await pool.query(`UPDATE business_members SET status = 'revoked' WHERE id = $1`, [cashierM]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await hub.replaySales(client, { restaurantId: r, hubId });
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }

    const row = async (id) => (await pool.query('SELECT status, replay_error, food_order_id, pos_payment_id FROM store_hub_offline_sales WHERE id = $1', [id])).rows[0];
    const held = await row(saleC);
    expect(held.status).toBe('held');
    expect(held.replay_error).toMatch(/Cashier no longer has access/);
    expect(held.food_order_id).toBeNull();
    expect(held.pos_payment_id).toBeNull();
    const other = await row(saleS);
    expect(other.replay_error || '').not.toMatch(/Cashier no longer has access/);
    expect(other.status).toBe('replayed');
  });
});
