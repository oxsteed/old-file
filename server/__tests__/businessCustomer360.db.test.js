'use strict';

// Customer 360 upgrade 6 on PostgreSQL through the real route, business
// access middleware, permission resolver (catalog + overrides) and store
// scope. Only the caller's own business relationship data is returned.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CUSTOMER360_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;

const mockUsers = new Map();
function mockFakeAuth(req, res, next) {
  const u = mockUsers.get(req.get('x-test-user'));
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  req.user = { ...u };
  return next();
}
jest.mock('../middleware/auth', () => ({
  authenticate: (...a) => mockFakeAuth(...a),
  requireAuth: (...a) => mockFakeAuth(...a),
}));

jest.setTimeout(120000);

test('customer keys are validated', () => {
  const { parseKey } = require('../services/businessCustomer360');
  expect(parseKey('c-12')).toEqual({ type: 'client', id: '12' });
  expect(() => parseKey('c-1;drop')).toThrow();
  expect(() => parseKey('u-not-a-uuid')).toThrow();
});

test('business customer 360 DB test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('business-scoped customer 360', () => {
  let pool;
  let app;
  const ids = {};
  async function newUser(label) {
    const id = crypto.randomUUID();
    const email = `b360-${label}-${id}@example.invalid`;
    await pool.query(`INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'x', $3, 'Zed', 'customer')`, [id, email, label]);
    mockUsers.set(id, { id, role: 'customer', email });
    return id;
  }
  async function member(biz, owner, user, role) {
    const { rows: [m] } = await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status) VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
      [biz, owner, user, mockUsers.get(user).email, role]);
    return Number(m.id);
  }
  const as = (u) => ({ get: (url) => request(app).get(url).set('x-test-user', u) });

  beforeAll(async () => {
    pool = require('../db');
    const { errorHandler } = require('../middleware/errorHandler');
    app = express();
    app.use(express.json());
    app.use('/api/businesses', require('../routes/businessCustomer360'));
    app.use(errorHandler);
    for (const k of ['owner', 'manager', 'employee', 'outsider', 'owner2', 'custA', 'custB']) ids[k] = await newUser(k);
    ({ rows: [{ id: ids.biz }] } = await pool.query(`INSERT INTO businesses (user_id, business_name) VALUES ($1, 'Lakay Grill') RETURNING id`, [ids.owner]));
    ({ rows: [{ id: ids.biz2 }] } = await pool.query(`INSERT INTO businesses (user_id, business_name) VALUES ($1, 'Other Cafe') RETURNING id`, [ids.owner2]));
    ({ rows: [{ id: ids.rest }] } = await pool.query(`INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, 'Lakay Grill') RETURNING id`, [ids.biz, ids.owner]));
    ({ rows: [{ id: ids.rest2 }] } = await pool.query(`INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, 'Other Cafe') RETURNING id`, [ids.biz2, ids.owner2]));
    ({ rows: [{ id: ids.loc1 }] } = await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Downtown') RETURNING id`, [ids.rest]));
    ({ rows: [{ id: ids.loc2 }] } = await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Airport') RETURNING id`, [ids.rest]));
    ({ rows: [{ id: ids.loc3 }] } = await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Main') RETURNING id`, [ids.rest2]));
    ids.managerMembership = await member(ids.biz, ids.owner, ids.manager, 'manager');
    ids.employeeMembership = await member(ids.biz, ids.owner, ids.employee, 'employee');
    await pool.query(`INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status) VALUES ($1, $2, $3, 'active')`,
      [ids.rest, ids.loc1, ids.managerMembership]);
    const order = (rest, biz, loc, cust, cents, n) => pool.query(
      `INSERT INTO food_orders (restaurant_id, business_id, location_id, customer_id, status, payment_status, total_cents, queue_number)
       VALUES ($1, $2, $3, $4, 'completed', 'paid', $5, $6)`, [rest, biz, loc, cust, cents, n]);
    await order(ids.rest, ids.biz, ids.loc1, ids.custA, 2500, 9101);
    await order(ids.rest, ids.biz, ids.loc2, ids.custA, 1000, 9102);
    await order(ids.rest, ids.biz, ids.loc2, ids.custB, 700, 9103);
    await order(ids.rest2, ids.biz2, ids.loc3, ids.custA, 9900, 9104);
    ({ rows: [{ id: ids.clientA }] } = await pool.query(
      `INSERT INTO business_clients (business_id, customer_id, display_name, email, internal_notes, created_by) VALUES ($1, $2, 'Anne Client', 'anne@biz.example', 'Prefers mornings', $3) RETURNING id`,
      [ids.biz, ids.custA, ids.owner]));
    ({ rows: [{ id: ids.walkIn }] } = await pool.query(
      `INSERT INTO business_clients (business_id, display_name, created_by) VALUES ($1, 'Walk-in Wally', $2) RETURNING id`, [ids.biz, ids.employee]));
    await pool.query(`INSERT INTO business_clients (business_id, customer_id, display_name, internal_notes) VALUES ($1, $2, 'Other biz Anne', 'SECRET-OTHER')`, [ids.biz2, ids.custA]);
    const { rows: [svc] } = await pool.query(`INSERT INTO business_services (business_id, name) VALUES ($1, 'Catering tasting') RETURNING id`, [ids.biz]);
    await pool.query(
      `INSERT INTO business_appointments (business_id, service_id, staff_id, customer_id, customer_email, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, 'anne@biz.example', NOW() - interval '2 days', NOW() - interval '2 days' + interval '1 hour', 'completed')`,
      [ids.biz, svc.id, ids.employee, ids.custA]);
    await pool.query(`INSERT INTO business_invoices (user_id, business_id, invoice_number, client_name, client_email, status, total, amount_paid)
      VALUES ($1, $2, 'INV-1', 'Anne', 'Anne@Biz.example', 'sent', 120, 20), ($3, $4, 'INV-X', 'Anne', 'anne@biz.example', 'sent', 999, 0)`,
      [ids.owner, ids.biz, ids.owner2, ids.biz2]);
  });
  afterAll(async () => { await pool.end?.(); });

  test('owner sees every relationship of their own business only', async () => {
    const res = await as(ids.owner).get(`/api/businesses/${ids.biz}/customer360/customers`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const keys = res.body.customers.map((c) => c.key).sort();
    expect(keys).toEqual([`c-${ids.walkIn}`, `u-${ids.custA}`, `u-${ids.custB}`].sort());
    expect(res.body.customers.find((c) => c.key === `u-${ids.custB}`).name).toBe('custB Z.');

    const p = await as(ids.owner).get(`/api/businesses/${ids.biz}/customer360/customers/u-${ids.custA}`);
    expect(p.status).toBe(200);
    expect(p.body.customer.name).toBe('Anne Client');
    expect(p.body.customer.client.notes).toBe('Prefers mornings');
    expect(p.body.sections.orders).toMatchObject({ state: 'ready', total: 2, paidCents: 3500, partialStores: false });
    expect(p.body.sections.appointments).toMatchObject({ state: 'ready', total: 1 });
    expect(p.body.sections.invoices).toMatchObject({ state: 'ready', total: 1, outstanding: 100 });
    const raw = JSON.stringify(p.body);
    expect(raw).not.toContain(mockUsers.get(ids.custA).email); // platform account email never leaks
    expect(raw).not.toContain('SECRET-OTHER');
    expect(raw).not.toContain('INV-X');
    expect(raw).not.toContain('9900');
    const { rows } = await pool.query(`SELECT action, target_id FROM business_audit_log WHERE business_id = $1 AND action LIKE 'customer360.%' ORDER BY id`, [ids.biz]);
    expect(rows.map((r) => r.action)).toEqual(['customer360.customers_listed', 'customer360.customer_viewed']);
    expect(rows[1].target_id).toBe(`u-${ids.custA}`);
  });

  test('a store-scoped manager only sees orders from their stores', async () => {
    const p = await as(ids.manager).get(`/api/businesses/${ids.biz}/customer360/customers/u-${ids.custA}`);
    expect(p.status).toBe(200);
    expect(p.body.sections.orders).toMatchObject({ total: 1, paidCents: 2500, partialStores: true });
    const list = await as(ids.manager).get(`/api/businesses/${ids.biz}/customer360/customers`);
    expect(list.body.customers.map((c) => c.key)).not.toContain(`u-${ids.custB}`); // B only ordered at the Airport store
  });

  test('assigned-only staff see only their customers; deny overrides apply immediately', async () => {
    const list = await as(ids.employee).get(`/api/businesses/${ids.biz}/customer360/customers`);
    expect(list.status).toBe(200);
    expect(list.body.customers.map((c) => c.key).sort()).toEqual([`c-${ids.walkIn}`, `u-${ids.custA}`].sort());
    // Restaurant employees hold orders.view by role default (restaurant resolver).
    expect(list.body.access).toMatchObject({ customers: 'assigned', appointments: 'self', invoices: false, orders: true });
    const p = await as(ids.employee).get(`/api/businesses/${ids.biz}/customer360/customers/u-${ids.custA}`);
    expect(p.body.sections.orders.total).toBe(2);
    expect(p.body.sections.invoices.state).toBe('restricted');
    expect(p.body.sections.appointments.total).toBe(1);
    expect((await as(ids.employee).get(`/api/businesses/${ids.biz}/customer360/customers/u-${ids.custB}`)).status).toBe(404);

    await pool.query(
      `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect)
       SELECT $1, id, 'deny' FROM team_permissions WHERE code = 'customers.view_assigned'`, [ids.employeeMembership]);
    require('../services/permissionsService').invalidateCache(ids.biz, ids.employee);
    const denied = await as(ids.employee).get(`/api/businesses/${ids.biz}/customer360/customers`);
    expect(denied.status).toBe(403);
    expect(denied.body.code || denied.body.error?.code).toBe('business_customer360_forbidden');
  });

  test('outsiders and other businesses get nothing', async () => {
    expect((await as(ids.outsider).get(`/api/businesses/${ids.biz}/customer360/customers`)).status).toBe(404);
    expect((await as(ids.owner2).get(`/api/businesses/${ids.biz}/customer360/customers/u-${ids.custA}`)).status).toBe(404);
    const other = await as(ids.owner2).get(`/api/businesses/${ids.biz2}/customer360/customers/u-${ids.custA}`);
    expect(other.body.sections.orders).toMatchObject({ total: 1, paidCents: 9900 });
    expect(JSON.stringify(other.body)).not.toContain('Prefers mornings');
    expect((await as(ids.owner).get(`/api/businesses/${ids.biz}/customer360/customers/c-99999999999`)).status).toBe(404);
    expect((await as(ids.owner).get(`/api/businesses/${ids.biz}/customer360/customers/x`)).status).toBe(400);
  });

  test('gap fill 14: every restaurant counts and keyset pages cover every customer exactly once', async () => {
    const { RESTAURANT_BATCH, PAGE } = require('../services/businessCustomer360');
    const owner3 = await newUser('owner3');
    const late = await newUser('lateCustomer');
    const { rows: [{ id: biz3 }] } = await pool.query(`INSERT INTO businesses (user_id, business_name) VALUES ($1, 'Big Chain') RETURNING id`, [owner3]);
    // More restaurants than one batch; the only order is at the last one.
    const { rows: rests } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name)
       SELECT $1, $2, 'Chain ' || g FROM generate_series(1, $3::int) g RETURNING id`, [biz3, owner3, RESTAURANT_BATCH + 5]);
    const lastRest = rests.map((r) => Number(r.id)).sort((a, b) => a - b).pop();
    const { rows: [{ id: lastLoc }] } = await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Far') RETURNING id`, [lastRest]);
    await pool.query(
      `INSERT INTO food_orders (restaurant_id, business_id, location_id, customer_id, status, payment_status, total_cents, queue_number)
       VALUES ($1, $2, $3, $4, 'completed', 'paid', 500, 9901)`, [lastRest, biz3, lastLoc, late]);
    // Many CRM clients with the same timestamp, so ties must page on the key.
    await pool.query(
      `INSERT INTO business_clients (business_id, display_name, created_by, updated_at)
       SELECT $1, 'Client ' || g, $2, TIMESTAMPTZ '2026-01-01 12:00:00+00' FROM generate_series(1, $3::int) g`, [biz3, owner3, PAGE * 2 + 7]);
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const res = await as(owner3).get(`/api/businesses/${biz3}/customer360/customers${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('nextOffset');
      seen.push(...res.body.customers.map((c) => c.key));
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);
    expect(cursor).toBeNull();
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(PAGE * 2 + 7 + 1);
    expect(seen).toContain(`u-${late}`);
    expect(pages).toBe(3);
    expect((await as(owner3).get(`/api/businesses/${biz3}/customer360/customers?cursor=not-a-cursor`)).status).toBe(400);
    const forged = Buffer.from(JSON.stringify(['2026-01-01T00:00:00Z', "x'; DROP TABLE users; --"])).toString('base64url');
    expect((await as(owner3).get(`/api/businesses/${biz3}/customer360/customers?cursor=${forged}`)).status).toBe(400);
  });
});
