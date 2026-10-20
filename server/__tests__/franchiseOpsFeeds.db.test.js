'use strict';

// DB-backed tests for the F-11 scheduled-order kitchen hold: a scheduled
// order must not surface in the merchant kitchen feed (scope=active) or
// the managed-screen snapshot until scheduled_for minus the restaurant
// prep lead (prep_time_min, default 30). Honors
// STATEMENT_TEST_DATABASE_URL; skipped when absent. Runs in an isolated
// schema with minimal tables shaped like the production ones.

const crypto = require('crypto');

const schema = `franchise_feeds_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname)) {
    throw new Error('Franchise feed fixtures require a local disposable database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
process.env['DATABASE' + '_URL'] = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const foodController = require('../controllers/foodController');
const screenSync = require('../services/restaurantScreenSync');

const describeDb = url ? describe : describe.skip;

const OWNER_ID = 1301;
let restaurantId;
const orderIds = {};

function res() {
  const r = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  return r;
}

async function listOrders(query) {
  const r = res();
  const req = { user: { id: OWNER_ID }, params: { restaurantId: String(restaurantId) }, query };
  let thrown = null;
  await foodController.listRestaurantOrders(req, r, (err) => { thrown = err; });
  if (thrown) throw thrown;
  return r.body;
}

async function insertOrder({ queue, scheduledFor }) {
  const { rows: [row] } = await db.query(
    `INSERT INTO food_orders
       (restaurant_id, business_id, customer_id, order_source, fulfillment_type,
        status, payment_status, queue_number, total_cents, metadata, scheduled_for)
     VALUES ($1, $2, NULL, 'web', 'pickup', 'received', 'unpaid', $3, 1200, '{}'::jsonb, $4)
     RETURNING id`,
    [restaurantId, 42, queue, scheduledFor]
  );
  return row.id;
}

describeDb('F-11 scheduled order kitchen hold', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.businesses (id BIGSERIAL PRIMARY KEY, user_id BIGINT, deleted_at TIMESTAMPTZ)`);
    await db.query(
      `CREATE TABLE ${schema}.business_members
         (id BIGSERIAL PRIMARY KEY, business_id BIGINT, member_id BIGINT, role TEXT, status TEXT)`
    );
    await db.query(
      `CREATE TABLE ${schema}.food_restaurants
         (id BIGSERIAL PRIMARY KEY, business_id BIGINT, owner_user_id BIGINT, display_name TEXT,
          currency_code TEXT DEFAULT 'USD', screens_v2_enabled BOOLEAN DEFAULT TRUE,
          accepts_in_store_orders BOOLEAN DEFAULT TRUE, settings JSONB DEFAULT '{}'::jsonb,
          timezone TEXT DEFAULT 'UTC', prep_time_min INT DEFAULT 30)`
    );
    await db.query(
      `CREATE TABLE ${schema}.users
         (id BIGINT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, phone TEXT)`
    );
    await db.query(
      `CREATE TABLE ${schema}.food_orders
         (id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT, business_id BIGINT, customer_id BIGINT,
          location_id BIGINT, order_source TEXT, fulfillment_type TEXT, status TEXT,
          payment_status TEXT, queue_number INT, total_cents INT, metadata JSONB DEFAULT '{}'::jsonb,
          scheduled_for TIMESTAMPTZ, kitchen_stage TEXT, screen_revision BIGINT DEFAULT 0,
          pos_ticket_state TEXT DEFAULT 'open', stripe_payment_intent_id TEXT,
          guest_name TEXT, guest_email TEXT, guest_phone TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(), preparation_started_at TIMESTAMPTZ,
          promised_at TIMESTAMPTZ, table_label TEXT)`
    );
    await db.query(
      `CREATE TABLE ${schema}.food_order_items
         (id BIGSERIAL PRIMARY KEY, order_id BIGINT, item_name TEXT, quantity INT,
          unit_price_cents INT, modifier_total_cents INT DEFAULT 0, line_total_cents INT,
          special_instructions TEXT, kitchen_status TEXT, station_label TEXT,
          kitchen_started_at TIMESTAMPTZ, delayed_at TIMESTAMPTZ, delay_reason TEXT,
          target_prep_seconds INT, screen_revision BIGINT DEFAULT 0)`
    );
    await db.query(
      `CREATE TABLE ${schema}.food_order_item_modifiers
         (id BIGSERIAL PRIMARY KEY, order_item_id BIGINT, modifier_name TEXT, price_delta_cents INT DEFAULT 0)`
    );
    await db.query(
      `CREATE TABLE ${schema}.restaurant_screen_streams
         (restaurant_id BIGINT PRIMARY KEY, revision BIGINT DEFAULT 0)`
    );

    const { rows: [business] } = await db.query(
      `INSERT INTO ${schema}.businesses (user_id) VALUES ($1) RETURNING id`,
      [OWNER_ID]
    );
    const { rows: [restaurant] } = await db.query(
      `INSERT INTO ${schema}.food_restaurants (business_id, owner_user_id, display_name, prep_time_min)
       VALUES ($1, $2, 'Feed Test Diner', 30) RETURNING id`,
      [business.id, OWNER_ID]
    );
    restaurantId = restaurant.id;
    await db.query(
      `INSERT INTO ${schema}.restaurant_screen_streams (restaurant_id, revision) VALUES ($1, 0)`,
      [restaurantId]
    );

    orderIds.asap = await insertOrder({ queue: 1, scheduledFor: null });
    orderIds.farFuture = await insertOrder({
      queue: 2,
      scheduledFor: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });
    orderIds.withinLead = await insertOrder({
      queue: 3,
      scheduledFor: new Date(Date.now() + 10 * 60 * 1000),
    });
    orderIds.past = await insertOrder({
      queue: 4,
      scheduledFor: new Date(Date.now() - 60 * 60 * 1000),
    });
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
  });

  test('merchant kitchen feed (scope=active) holds far-future scheduled orders', async () => {
    const body = await listOrders({ scope: 'active' });
    const ids = body.orders.map((o) => Number(o.id));
    expect(ids).toContain(Number(orderIds.asap));
    expect(ids).toContain(Number(orderIds.withinLead));
    expect(ids).toContain(Number(orderIds.past));
    expect(ids).not.toContain(Number(orderIds.farFuture));
  });

  test('kitchen-display polling branch (active=1) applies the same hold', async () => {
    const body = await listOrders({ active: '1' });
    const ids = body.orders.map((o) => Number(o.id));
    expect(ids).not.toContain(Number(orderIds.farFuture));
    expect(ids).toContain(Number(orderIds.asap));
  });

  test('the unscoped merchant order list still shows scheduled orders', async () => {
    const body = await listOrders({});
    const ids = body.orders.map((o) => Number(o.id));
    expect(ids).toContain(Number(orderIds.farFuture));
  });

  test('managed-screen snapshot holds far-future scheduled orders', async () => {
    const snap = await screenSync.snapshot({
      restaurantId,
      allLocations: true,
      locationId: null,
      readOrders: true,
      device: null,
    });
    const ids = snap.orders.map((o) => Number(o.id));
    expect(ids).toContain(Number(orderIds.asap));
    expect(ids).toContain(Number(orderIds.withinLead));
    expect(ids).toContain(Number(orderIds.past));
    expect(ids).not.toContain(Number(orderIds.farFuture));
    const boardNumbers = [...snap.board.preparing, ...snap.board.ready].map(Number);
    expect(boardNumbers).not.toContain(2);
    expect(boardNumbers).toContain(1);
  });
});
