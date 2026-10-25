'use strict';

// Connected HTTP-handler acceptance against the complete migrated schema.
// Authentication supplies fixture identities; membership, permissions, store
// scope, transactions, inventory, kitchen, payments and reports stay real.
// CI runs this alongside restaurantStoreIsolation in restaurant_store_test.
jest.unmock('pg');
jest.unmock('../utils/transaction');
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(async () => ({ success: true })),
}));

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const db = require('../db');
const permissions = require('../services/permissionsService');
const pos = require('../controllers/restaurantAppFlowController');
const food = require('../controllers/foodController');
const reports = require('../controllers/restaurantReportsController');
const { errorHandler } = require('../middleware/errorHandler');

const url = process.env.RESTAURANT_STORE_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    || target.pathname !== '/restaurant_store_test') {
    throw new Error('Requires disposable migrated loopback restaurant_store_test');
  }
}

(url ? describe : describe.skip)('two-store connected restaurant service cycle', () => {
  let pool;
  let http;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 8 });
    db.query.mockImplementation((...args) => pool.query(...args));
    db.connect.mockImplementation(() => pool.connect());
    http = express();
    http.use(express.json());
    http.use((req, _res, next) => {
      req.user = { id: req.get('X-Fixture-User') };
      next();
    });
    const root = '/api/restaurants/:restaurantId';
    http.post(`${root}/pos/shifts`, pos.openShift);
    http.post(`${root}/pos/shifts/:shiftId/close`, pos.closeShift);
    http.post(`${root}/pos/orders`, pos.createPosOrder);
    http.post(`${root}/pos/orders/:orderId/split`, pos.splitPosOrder);
    http.post(`${root}/pos/orders/:orderId/payments`, pos.recordPosPayment);
    http.get(`${root}/kitchen/feed`, pos.getKitchenFeed);
    http.post(`${root}/kitchen/orders/:orderId/action`, pos.performKitchenOrderAction);
    http.post(`${root}/kitchen/items/:orderItemId/action`, pos.performKitchenItemAction);
    http.post(`${root}/kitchen/orders/:orderId/courses/:courseNumber/action`, pos.performKitchenCourseAction);
    http.patch(`${root}/orders/:orderId/status`, food.updateOrderStatus);
    http.get(`${root}/reports/sales`, reports.salesSummary);
    http.get(`${root}/reports/sales.csv`, reports.salesExportCsv);
    http.use(errorHandler);
  });
  afterAll(async () => { if (pool) await pool.end(); });
  beforeEach(() => permissions.invalidateCache());

  async function seed(mode) {
    const owner = crypto.randomUUID();
    const managerA = crypto.randomUUID();
    const managerB = crypto.randomUUID();
    const cashier = crypto.randomUUID();
    for (const id of [owner, managerA, managerB, cashier]) {
      await pool.query(
        `INSERT INTO users(id,email,password_hash,first_name,last_name)
         VALUES($1,$2,'synthetic','Cycle','Fixture')`,
        [id, `${id}@example.test`],
      );
    }
    const { rows: [business] } = await pool.query(
      'INSERT INTO businesses(user_id,business_name) VALUES($1,$2) RETURNING id',
      [owner, `Service cycle ${crypto.randomUUID()}`],
    );
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants(business_id,owner_user_id,display_name,timezone,status,accepts_in_store_orders)
       VALUES($1,$2,'Service cycle','America/New_York','active',TRUE) RETURNING id`,
      [business.id, owner],
    );
    const restaurantId = restaurant.id;
    const { rows: [a] } = await pool.query(
      `UPDATE restaurant_locations SET kitchen_fire_mode=$2
       WHERE restaurant_id=$1 AND is_primary=TRUE RETURNING id`,
      [restaurantId, mode],
    );
    const { rows: [b] } = await pool.query(
      `INSERT INTO restaurant_locations(restaurant_id,name,status,timezone,kitchen_fire_mode)
       VALUES($1,'Sibling B','active','America/New_York',$2) RETURNING id`,
      [restaurantId, mode],
    );
    for (const [member, role, location] of [
      [managerA, 'manager', a.id], [managerB, 'manager', b.id], [cashier, 'employee', a.id],
    ]) {
      const { rows: [membership] } = await pool.query(
        `INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status)
         VALUES($1,$2,$3,$4,$5,'active') RETURNING id`,
        [business.id, owner, member, `${member}@example.test`, role],
      );
      await pool.query(
        `INSERT INTO restaurant_location_memberships(restaurant_id,location_id,membership_id,status)
         VALUES($1,$2,$3,'active')`, [restaurantId, location, membership.id],
      );
    }
    const { rows: [meal] } = await pool.query(
      `INSERT INTO food_menu_items(restaurant_id,name,price_cents)
       VALUES($1,'Meal',1000) RETURNING id`, [restaurantId],
    );
    for (const location of [a.id, b.id]) {
      await pool.query(
        `INSERT INTO restaurant_kitchen_stations(restaurant_id,location_id,name)
         VALUES($1,$2,$3)`, [restaurantId, location, `Hot line ${location}`],
      );
      const { rows: [stock] } = await pool.query(
        `INSERT INTO restaurant_inventory_items(restaurant_id,location_id,name,quantity)
         VALUES($1,$2,'Meal stock',100) RETURNING id`, [restaurantId, location],
      );
      await pool.query(
        `INSERT INTO restaurant_inventory_item_mappings(restaurant_id,inventory_item_id,menu_item_id,usage_label,required_quantity,auto_manage)
         VALUES($1,$2,$3,'One meal',1,TRUE)`, [restaurantId, stock.id, meal.id],
      );
    }
    return { restaurantId, owner, managerA, managerB, cashier, locationA: a.id, locationB: b.id, itemId: meal.id };
  }

  function send(f, user, method, path, body = {}, key) {
    const req = request(http)[method](`/api/restaurants/${f.restaurantId}${path}`)
      .set('X-Fixture-User', user);
    if (key) req.set('Idempotency-Key', key);
    return method === 'get' ? req.query(body) : req.send(body);
  }
  function ok(response, status = 200) {
    expect({ status: response.status, error: response.body }).toEqual({ status, error: expect.any(Object) });
    return response.body;
  }
  function denied(response) {
    expect([403, 404, 409]).toContain(response.status);
    expect(response.body.order).toBeUndefined();
    expect(response.body.payment).toBeUndefined();
  }
  async function orderRow(id) {
    return (await pool.query('SELECT * FROM food_orders WHERE id=$1', [id])).rows[0];
  }
  async function jobs(id, type = 'kitchen_ticket') {
    return (await pool.query(
      `SELECT * FROM restaurant_printer_jobs WHERE food_order_id=$1 AND job_type='kitchen_ticket'
       AND ($2='kitchen_ticket' OR idempotency_key LIKE $3) ORDER BY id`,
      [id, type, `course:${id}:%:${type.replace('course_', '')}:%`],
    )).rows;
  }

  test.each(['on_send', 'on_pay'])('%s: split, concurrent tender retry, courses, pickup, refund, close and reports', async (mode) => {
    const f = await seed(mode);
    const shiftA = ok(await send(f, f.cashier, 'post', '/pos/shifts', {
      locationId: f.locationA, openingCashCents: 5000,
    }), 201).shift;
    const shiftB = ok(await send(f, f.managerB, 'post', '/pos/shifts', {
      locationId: f.locationB, openingCashCents: 8000,
    }), 201).shift;
    denied(await send(f, f.managerA, 'post', `/pos/shifts/${shiftB.id}/close`, { closingCashCents: 8000 }));

    const ticket = {
      shiftId: shiftA.id, locationId: f.locationA, clientOrderId: crypto.randomUUID(),
      fulfillmentType: 'pickup',
      items: [
        { menuItemId: f.itemId, quantity: 1, courseNumber: 1, seatNumber: 1 },
        { menuItemId: f.itemId, quantity: 2, courseNumber: 2, seatNumber: 2 },
      ],
    };
    const created = ok(await send(f, f.cashier, 'post', '/pos/orders', ticket), 201).order;
    const replay = ok(await send(f, f.cashier, 'post', '/pos/orders', ticket));
    expect(replay.replayed).toBe(true);
    expect(replay.order.id).toBe(created.id);
    denied(await send(f, f.managerB, 'post', '/pos/orders', ticket));
    denied(await send(f, f.managerB, 'post', `/pos/orders/${created.id}/split`, { seatNumbers: [2] }));
    const split = ok(await send(f, f.cashier, 'post', `/pos/orders/${created.id}/split`, { seatNumbers: [2] }), 201);
    const orders = [split.sourceOrder, split.splitOrder];
    expect(orders.map(o => Number(o.total_cents))).toEqual([1000, 2000]);
    expect(orders.every(o => String(o.location_id) === String(f.locationA))).toBe(true);
    expect(orders[1].metadata.clientOrderId).toBeUndefined();
    expect(orders[1].client_order_id).toBeNull();
    expect(orders[1].metadata.splitFromOrderId).toBe(created.id);
    const splitReplay = ok(await send(f, f.cashier, 'post', '/pos/orders', ticket));
    expect(splitReplay.order.id).toBe(created.id);
    expect(Number(splitReplay.order.total_cents)).toBe(1000);
    expect(Boolean((await orderRow(orders[1].id)).kitchen_ticket_fired_at)).toBe(mode === 'on_send');
    expect((await jobs(created.id)).length).toBe(mode === 'on_send' ? 1 : 0);

    let feed = ok(await send(f, f.managerA, 'get', '/kitchen/feed'));
    expect(feed.orders.map(o => String(o.id)).sort()).toEqual(mode === 'on_send' ? orders.map(o => String(o.id)).sort() : []);

    // Store B has real sales too, so accidental all-store reports cannot pass.
    const sibling = ok(await send(f, f.managerB, 'post', '/pos/orders', {
      shiftId: shiftB.id, locationId: f.locationB, clientOrderId: crypto.randomUUID(),
      items: [{ menuItemId: f.itemId, quantity: 9 }],
    }), 201).order;
    ok(await send(f, f.managerB, 'post', `/pos/orders/${sibling.id}/payments`, {
      shiftId: shiftB.id, paymentType: 'cash', amountCents: 9000,
    }, crypto.randomUUID()), 201);
    denied(await send(f, f.cashier, 'post', `/pos/orders/${sibling.id}/payments`, {
      shiftId: shiftA.id, paymentType: 'cash', amountCents: 9000,
    }, crypto.randomUUID()));

    const payments = [];
    for (const order of orders) {
      const payKey = crypto.randomUUID();
      const payment = { shiftId: shiftA.id, paymentType: 'cash', amountCents: Number(order.total_cents) };
      payments.push({ id: order.id, body: payment, key: payKey });
      denied(await send(f, f.managerB, 'post', `/pos/orders/${order.id}/payments`, payment, payKey));
      const retries = await Promise.all([0, 1].map(() => send(f, f.cashier, 'post', `/pos/orders/${order.id}/payments`, payment, payKey)));
      expect(retries.map(r => r.status).sort()).toEqual([200, 201]);
      expect(new Set(retries.map(r => r.body.payment.id)).size).toBe(1);
      expect((await orderRow(order.id)).payment_status).toBe('paid');
      expect((await orderRow(order.id)).kitchen_ticket_fired_at).toBeTruthy();
      const paidFeed = ok(await send(f, f.managerA, 'get', '/kitchen/feed'));
      expect(paidFeed.orders.some(o => String(o.id) === String(order.id))).toBe(true);
      expect(paidFeed.orders.some(o => String(o.id) === String(sibling.id))).toBe(false);
      const printCount = (await jobs(order.id)).length;
      expect(printCount).toBe(mode === 'on_pay' || String(order.id) === String(created.id) ? 1 : 0);
      const conflict = await send(f, f.cashier, 'post', `/pos/orders/${order.id}/payments`, { ...payment, amountCents: 1 }, payKey);
      expect(conflict.status).toBe(409);
      expect((await jobs(order.id)).length).toBe(printCount);

      const { rows: lines } = await pool.query('SELECT * FROM food_order_items WHERE order_id=$1', [order.id]);
      expect(lines).toHaveLength(1);
      const line = lines[0];
      expect(line.course_number).toBe(String(order.id) === String(created.id) ? 1 : 2);
      expect(line.seat_number).toBe(line.course_number);
      const coursePath = `/kitchen/orders/${order.id}/courses/${line.course_number}/action`;
      denied(await send(f, f.managerB, 'post', coursePath, { action: 'hold' }, crypto.randomUUID()));
      const holdKey = crypto.randomUUID();
      ok(await send(f, f.managerA, 'post', coursePath, { action: 'hold' }, holdKey), 201);
      const holdReplay = ok(await send(f, f.managerA, 'post', coursePath, { action: 'hold' }, holdKey));
      expect(holdReplay.replayed).toBe(true);
      denied(await send(f, f.managerB, 'post', coursePath, { action: 'hold' }, holdKey));
      const fireKey = crypto.randomUUID();
      const fires = await Promise.all([0, 1].map(() => send(f, f.managerA, 'post', coursePath, { action: 'fire' }, fireKey)));
      expect(fires.map(r => r.status).sort()).toEqual([200, 201]);
      expect(fires.filter(r => r.body.replayed)).toHaveLength(1);
      expect(await jobs(order.id, 'course_hold')).toHaveLength(1);
      expect(await jobs(order.id, 'course_fire')).toHaveLength(1);
      denied(await send(f, f.managerB, 'post', `/kitchen/items/${line.id}/action`, { action: 'start' }, crypto.randomUUID()));
      ok(await send(f, f.managerA, 'post', `/kitchen/items/${line.id}/action`, { action: 'start' }, crypto.randomUUID()), 201);
      const prematureReady = await send(f, f.managerA, 'patch', `/orders/${order.id}/status`, { status: 'ready', action: 'mark_ready' });
      expect(prematureReady.status).toBe(409);
      expect(prematureReady.body.code).toBe('kitchen_items_incomplete');
      ok(await send(f, f.managerA, 'post', `/kitchen/items/${line.id}/action`, { action: 'ready' }, crypto.randomUUID()), 201);
      denied(await send(f, f.managerB, 'patch', `/orders/${order.id}/status`, { status: 'completed' }));
      expect((await orderRow(order.id)).kitchen_stage).toBe('quality_check');
      ok(await send(f, f.managerA, 'patch', `/orders/${order.id}/status`, { status: 'ready', action: 'mark_ready' }));
      // Expo marks the finished ticket ready, then the cashier hands it out.
      expect((await orderRow(order.id)).status).toBe('ready');
      ok(await send(f, f.cashier, 'patch', `/orders/${order.id}/status`, { status: 'completed' }));
      expect((await orderRow(order.id)).status).toBe('completed');
    }
    feed = ok(await send(f, f.managerA, 'get', '/kitchen/feed'));
    expect(feed.orders).toHaveLength(0);
    expect(feed.events.every(e => String(e.location_id) === String(f.locationA))).toBe(true);

    const refundKey = crypto.randomUUID();
    const refund = { shiftId: shiftA.id, paymentType: 'refund', amountCents: 400, reason: 'Controlled cycle refund' };
    denied(await send(f, f.cashier, 'post', `/pos/orders/${created.id}/payments`, refund, refundKey));
    denied(await send(f, f.managerB, 'post', `/pos/orders/${created.id}/payments`, refund, refundKey));
    const refunds = await Promise.all([0, 1].map(() => send(f, f.managerA, 'post', `/pos/orders/${created.id}/payments`, refund, refundKey)));
    expect(refunds.map(r => r.status).sort()).toEqual([200, 201]);
    expect(new Set(refunds.map(r => r.body.payment.id)).size).toBe(1);
    const closed = ok(await send(f, f.cashier, 'post', `/pos/shifts/${shiftA.id}/close`, { closingCashCents: 7600 }));
    expect(closed.summary).toMatchObject({ expectedCashCents: 7600, cashRefundsCents: 400, cashOverShortCents: 0, paidOrderCount: 2 });
    expect(closed.shift.status).toBe('closed');
    for (const payment of payments) {
      expect(ok(await send(f, f.cashier, 'post', `/pos/orders/${payment.id}/payments`, payment.body, payment.key)).replayed).toBe(true);
    }
    // Lost payment response after drawer close must still replay, never retender.
    const refunded = ok(await send(f, f.managerA, 'post', `/pos/orders/${created.id}/payments`, refund, refundKey));
    expect(refunded.replayed).toBe(true);
    const reportA = ok(await send(f, f.managerA, 'get', '/reports/sales'));
    const reportB = ok(await send(f, f.managerB, 'get', '/reports/sales'));
    const reportHQ = ok(await send(f, f.owner, 'get', '/reports/sales'));
    expect(reportA.totals.revenue_cents).toBe(2600);
    expect(reportA.totals.refunds_cents).toBe(400);
    expect(reportB.totals.revenue_cents).toBe(9000);
    expect(reportHQ.totals.revenue_cents).toBe(11600);
    const csv = await send(f, f.managerA, 'get', '/reports/sales.csv');
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('2600');
    expect(csv.text).not.toContain('9000');
    const { rows: [ledger] } = await pool.query(
      `SELECT COUNT(*)::int AS payments, SUM(CASE WHEN payment_type='refund' THEN -amount_cents ELSE amount_cents END)::int AS net
       FROM restaurant_pos_payments WHERE shift_id=$1`, [shiftA.id],
    );
    expect(ledger).toEqual({ payments: 3, net: 2600 });
    const { rows: stock } = await pool.query(
      'SELECT location_id,quantity FROM restaurant_inventory_items WHERE restaurant_id=$1 ORDER BY location_id', [f.restaurantId],
    );
    expect(stock.map(s => [String(s.location_id), Number(s.quantity)])).toEqual([
      [String(f.locationA), 97], [String(f.locationB), 100],
    ]);
    const { rows: reservations } = await pool.query(
      'SELECT food_order_id,status FROM restaurant_inventory_order_reservations WHERE food_order_id=ANY($1::bigint[]) ORDER BY food_order_id',
      [orders.map(o => o.id)],
    );
    expect(reservations).toHaveLength(2);
    expect(reservations.every(r => r.status === 'consumed')).toBe(true);
  }, 60000);
});
