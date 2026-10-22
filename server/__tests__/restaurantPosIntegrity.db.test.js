'use strict';

/**
 * DB tests: POS integrity and permissions (franchise review F-03, F-04,
 * F-12, F-13, F-16, F-17, F-31).
 *
 *   F-04  createPosOrder replays on a stable client_order_id (migration
 *         942) instead of inserting a duplicate ticket on a pay retry.
 *   F-03  staff with the catalog permission pos.use tender cash/external
 *         payments inside their OWN open drawer shift; refunds stay
 *         manager-only.
 *   F-12  an empty fulfillment_modes array falls back to the schema
 *         default set in createPosOrder.
 *   F-13  table_name / tableName are accepted for table_label.
 *   F-16  an unpaid order cannot be completed by staff or by a kitchen
 *         display token; a manager may override with
 *         complete_unpaid_reason, which is written to the kitchen event
 *         log; paid completion is unaffected.
 *   F-17  kitchen.update / pos.use staff can 86 and restore menu items,
 *         with the availability event log as the audit entry.
 *   F-31  ticket hold/reopen and card capture require pos.use (or
 *         orders.manage); membership alone no longer suffices.
 *
 * Run with:
 *   FR_T2_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/fr_t2 \
 *     npx jest __tests__/restaurantPosIntegrity.db.test.js
 * Without it, the DB describes skip (fail closed) instead of touching a DB.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.FR_T2_TEST_DATABASE_URL || '';

function isTrackDatabase(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/fr_t2';
  } catch { return false; }
}

const CAN_RUN_DB = isTrackDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable fr_t2 database', () => {
  expect(isTrackDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = 'pos-integrity-test-secret';
}

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));

const { errorHandler } = require('../middleware/errorHandler');
const pool = require('../db');
const appFlow = require('../controllers/restaurantAppFlowController');
const food = require('../controllers/foodController');

jest.setTimeout(60000);

function staffApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, email: 'staff@example.com', role: 'customer' };
    next();
  });
  app.post('/api/restaurants/:restaurantId/pos/orders', appFlow.createPosOrder);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/payments', appFlow.recordPosPayment);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/hold', appFlow.holdPosOrder);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/reopen', appFlow.reopenPosOrder);
  app.post('/api/restaurants/:restaurantId/pos/payments/:paymentId/capture', appFlow.capturePosCardPayment);
  app.post('/api/restaurants/:restaurantId/pos/menu-items/:itemId/sold-out', (req, _res, next) => {
    req.body.isAvailable = false;
    next();
  }, appFlow.setMenuItemAvailability);
  app.patch('/api/restaurants/:restaurantId/menu-items/:itemId/availability', appFlow.setMenuItemAvailability);
  app.patch('/api/food/restaurants/:restaurantId/orders/:orderId/status', food.updateOrderStatus);
  app.use(errorHandler);
  return app;
}

function deviceApp(restaurantId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.displayDevice = { pairingId: 7, restaurantId, label: 'KDS', deviceRole: 'kitchen' };
    next();
  });
  app.patch('/api/food/restaurants/:restaurantId/orders/:orderId/status', food.updateOrderStatus);
  app.use(errorHandler);
  return app;
}

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'POS', 'Fixture', 'customer', TRUE, TRUE)`,
    [id, `pos-integrity-${label}-${id}@example.invalid`]
  );
  return id;
}

let queue = 5000;

ddescribe('POS integrity (franchise F-03/F-04/F-12/F-13/F-16/F-17/F-31)', () => {
  let F = {};

  async function seedOrder(overrides = {}) {
    const { rows: [o] } = await pool.query(
      `INSERT INTO food_orders
         (restaurant_id, business_id, status, payment_status, fulfillment_type,
          order_source, subtotal_cents, total_cents, currency_code, queue_number, metadata)
       VALUES ($1, $2, $3, $4, $5, 'counter', $6, $6, 'USD', $7, $8::jsonb)
       RETURNING id`,
      [
        overrides.restaurantId || F.restaurantId,
        overrides.businessId || F.businessId,
        overrides.status || 'ready',
        overrides.paymentStatus || 'unpaid',
        overrides.fulfillmentType || 'pickup',
        overrides.totalCents || 1000,
        queue++,
        JSON.stringify(overrides.metadata || { paymentMode: 'pay_at_restaurant' }),
      ]
    );
    return o.id;
  }

  async function createPosOrderAs(userId, body = {}) {
    return request(staffApp(userId))
      .post(`/api/restaurants/${F.restaurantId}/pos/orders`)
      .send({
        orderSource: 'counter',
        fulfillmentType: 'pickup',
        shiftId: F.ownerShiftId,
        items: [{ menuItemId: F.itemId, quantity: 1 }],
        ...body,
      });
  }

  beforeAll(async () => {
    const owner = await newUser('owner');
    const manager = await newUser('manager');
    const employee = await newUser('employee');
    const rep = await newUser('rep');

    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `POS Integrity ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [biz2] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `POS Integrity Fresh ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status, accepts_in_store_orders, fulfillment_modes)
       VALUES ($1, $2, $3, 'active', TRUE, $4::text[])
       RETURNING id`,
      [biz.id, owner, 'POS Integrity Diner', ['pickup', 'dine_in']]
    );
    // F-12 fixture: a restaurant whose onboarding persisted no modes.
    const { rows: [rest2] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status, accepts_in_store_orders, fulfillment_modes)
       VALUES ($1, $2, $3, 'active', TRUE, '{}'::text[])
       RETURNING id`,
      [biz2.id, owner, 'POS Integrity Fresh Diner']
    );
    for (const [memberId, role] of [[manager, 'manager'], [employee, 'employee'], [rep, 'representative']]) {
      const { rows: [memberUser] } = await pool.query(
        'SELECT email FROM users WHERE id = $1',
        [memberId]
      );
      await pool.query(
        `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status)
         VALUES ($1, $2, $3, $4, $5, 'active')`,
        [biz.id, owner, memberId, memberUser.email, role]
      );
    }
    const { rows: [item] } = await pool.query(
      `INSERT INTO food_menu_items (restaurant_id, name, price_cents)
       VALUES ($1, 'Integrity Burger', 1000) RETURNING id`,
      [rest.id]
    );
    const { rows: [item2] } = await pool.query(
      `INSERT INTO food_menu_items (restaurant_id, name, price_cents)
       VALUES ($1, 'Fresh Fries', 500) RETURNING id`,
      [rest2.id]
    );
    async function openShift(restaurantId, userId) {
      const { rows: [s] } = await pool.query(
        `INSERT INTO restaurant_pos_shifts (restaurant_id, staff_user_id, status)
         VALUES ($1, $2, 'open') RETURNING id`,
        [restaurantId, userId]
      );
      return s.id;
    }
    F = {
      owner, manager, employee, rep,
      businessId: biz.id, business2Id: biz2.id,
      restaurantId: rest.id, restaurant2Id: rest2.id,
      itemId: Number(item.id), item2Id: Number(item2.id),
      ownerShiftId: await openShift(rest.id, owner),
      managerShiftId: await openShift(rest.id, manager),
      employeeShiftId: await openShift(rest.id, employee),
      repShiftId: await openShift(rest.id, rep),
      ownerShift2Id: await openShift(rest2.id, owner),
    };
  });

  describe('F-04 checkout replay', () => {
    test('a retried create with the same client_order_id returns the original order', async () => {
      const clientOrderId = `checkout-${crypto.randomUUID()}`;
      const first = await createPosOrderAs(F.owner, { clientOrderId });
      expect(first.status).toBe(201);
      const orderId = first.body.order.id;

      const retry = await createPosOrderAs(F.owner, { clientOrderId });
      expect(retry.status).toBe(200);
      expect(retry.body.replayed).toBe(true);
      expect(retry.body.order.id).toBe(orderId);

      const { rows: [count] } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM food_orders WHERE restaurant_id = $1 AND client_order_id = $2',
        [F.restaurantId, clientOrderId]
      );
      expect(count.n).toBe(1);
      // Printer/broadcast side effects fired once: the creation receipt
      // audit exists exactly once for the order.
      const { rows: [events] } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM restaurant_pos_receipt_events
          WHERE food_order_id = $1 AND event_type = 'order_created'`,
        [orderId]
      );
      expect(events.n).toBe(1);
    });

    test('a different client_order_id creates a new order; no id keeps legacy behavior', async () => {
      const a = await createPosOrderAs(F.owner, { clientOrderId: `checkout-${crypto.randomUUID()}` });
      const b = await createPosOrderAs(F.owner, { clientOrderId: `checkout-${crypto.randomUUID()}` });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.order.id).not.toBe(b.body.order.id);

      const c = await createPosOrderAs(F.owner, {});
      const d = await createPosOrderAs(F.owner, {});
      expect(c.status).toBe(201);
      expect(d.status).toBe(201);
      expect(c.body.order.id).not.toBe(d.body.order.id);
    });
  });

  describe('F-12 / F-13 order creation details', () => {
    test('empty fulfillment_modes falls back to the default set (first dine-in works)', async () => {
      const res = await request(staffApp(F.owner))
        .post(`/api/restaurants/${F.restaurant2Id}/pos/orders`)
        .send({
          orderSource: 'counter',
          fulfillmentType: 'dine_in',
          shiftId: F.ownerShift2Id,
          items: [{ menuItemId: F.item2Id, quantity: 1 }],
        });
      expect(res.status).toBe(201);
      expect(res.body.order.fulfillment_type).toBe('dine_in');
    });

    test('explicit modes still reject an unlisted mode', async () => {
      const res = await createPosOrderAs(F.owner, { fulfillmentType: 'kiosk' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('fulfillment_mode_unavailable');
    });

    test('table_name sent by the web POS lands in table_label', async () => {
      const res = await createPosOrderAs(F.owner, {
        fulfillmentType: 'dine_in',
        table_name: 'Patio 4',
      });
      expect(res.status).toBe(201);
      expect(res.body.order.table_label).toBe('Patio 4');
    });
  });

  describe('F-03 cashier tender inside own drawer shift', () => {
    async function unpaidOrder() {
      const res = await createPosOrderAs(F.owner, {});
      expect(res.status).toBe(201);
      return res.body.order;
    }

    test('employee with pos.use records a cash payment in their own shift', async () => {
      const order = await unpaidOrder();
      const res = await request(staffApp(F.employee))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${order.id}/payments`)
        .send({ paymentType: 'cash', amountCents: order.total_cents, shiftId: F.employeeShiftId });
      expect(res.status).toBe(201);
      expect(res.body.order.payment_status).toBe('paid');
    });

    test('employee payment without a shift is refused', async () => {
      const order = await unpaidOrder();
      const res = await request(staffApp(F.employee))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${order.id}/payments`)
        .send({ paymentType: 'cash', amountCents: order.total_cents });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('open_pos_shift_required');
    });

    test('employee payment against another staff member shift is refused', async () => {
      const order = await unpaidOrder();
      const res = await request(staffApp(F.employee))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${order.id}/payments`)
        .send({ paymentType: 'cash', amountCents: order.total_cents, shiftId: F.managerShiftId });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('pos_shift_not_owned');
    });

    test('a member without pos.use cannot tender, even in their own shift', async () => {
      const order = await unpaidOrder();
      const res = await request(staffApp(F.rep))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${order.id}/payments`)
        .send({ paymentType: 'cash', amountCents: order.total_cents, shiftId: F.repShiftId });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
    });

    test('refunds stay manager-only; the manager refund succeeds', async () => {
      const order = await unpaidOrder();
      const pay = await request(staffApp(F.employee))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${order.id}/payments`)
        .send({ paymentType: 'cash', amountCents: order.total_cents, shiftId: F.employeeShiftId });
      expect(pay.status).toBe(201);

      const denied = await request(staffApp(F.employee))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${order.id}/payments`)
        .send({
          paymentType: 'refund',
          amountCents: order.total_cents,
          shiftId: F.employeeShiftId,
          idempotencyKey: `refund-denied-${order.id}`,
        });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('forbidden');

      const refund = await request(staffApp(F.manager))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${order.id}/payments`)
        .send({
          paymentType: 'refund',
          amountCents: order.total_cents,
          shiftId: F.managerShiftId,
          idempotencyKey: `refund-ok-${order.id}`,
        });
      expect(refund.status).toBe(201);
      expect(refund.body.order.payment_status).toBe('refunded');
    });
  });

  describe('F-31 ticket actions and card capture require pos.use', () => {
    test('employee holds and reopens a ticket; a member without pos.use cannot hold', async () => {
      const created = await createPosOrderAs(F.owner, {});
      const orderId = created.body.order.id;

      const denied = await request(staffApp(F.rep))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${orderId}/hold`)
        .send({ reason: 'Waiting' });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('forbidden');

      const held = await request(staffApp(F.employee))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${orderId}/hold`)
        .send({ reason: 'Waiting' });
      expect(held.status).toBe(200);
      expect(held.body.order.pos_ticket_state).toBe('held');

      const reopened = await request(staffApp(F.employee))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${orderId}/reopen`)
        .send({});
      expect(reopened.status).toBe(200);
      expect(reopened.body.order.pos_ticket_state).toBe('open');
    });

    test('card capture gate: no pos.use is 403, pos.use reaches the payment lookup', async () => {
      const denied = await request(staffApp(F.rep))
        .post(`/api/restaurants/${F.restaurantId}/pos/payments/999999999/capture`)
        .send({});
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('forbidden');

      const allowed = await request(staffApp(F.employee))
        .post(`/api/restaurants/${F.restaurantId}/pos/payments/999999999/capture`)
        .send({});
      expect(allowed.status).toBe(404);
      expect(allowed.body.code).toBe('pos_payment_not_found');
    });
  });

  describe('F-17 staff 86 with audit event', () => {
    test('employee can 86 and restore; a member without kitchen/pos permission cannot', async () => {
      const denied = await request(staffApp(F.rep))
        .post(`/api/restaurants/${F.restaurantId}/pos/menu-items/${F.itemId}/sold-out`)
        .send({});
      expect(denied.status).toBe(403);

      const soldOut = await request(staffApp(F.employee))
        .post(`/api/restaurants/${F.restaurantId}/pos/menu-items/${F.itemId}/sold-out`)
        .send({ reason: 'Out of buns' });
      expect(soldOut.status).toBe(200);
      expect(soldOut.body.item.is_available).toBe(false);

      const { rows: [event] } = await pool.query(
        `SELECT * FROM restaurant_inventory_availability_events
          WHERE restaurant_id = $1 AND menu_item_id = $2
          ORDER BY id DESC LIMIT 1`,
        [F.restaurantId, F.itemId]
      );
      expect(event).toBeTruthy();
      expect(String(event.created_by)).toBe(String(F.employee));
      expect(event.next_available).toBe(false);

      const restored = await request(staffApp(F.employee))
        .patch(`/api/restaurants/${F.restaurantId}/menu-items/${F.itemId}/availability`)
        .send({ isAvailable: true });
      expect(restored.status).toBe(200);
      expect(restored.body.item.is_available).toBe(true);
    });
  });

  describe('F-16 unpaid completion gate', () => {
    test('staff cannot complete an unpaid pay_at_restaurant order', async () => {
      const orderId = await seedOrder();
      const res = await request(staffApp(F.employee))
        .patch(`/api/food/restaurants/${F.restaurantId}/orders/${orderId}/status`)
        .send({ status: 'completed' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('order_unpaid');
      const { rows: [o] } = await pool.query('SELECT status FROM food_orders WHERE id = $1', [orderId]);
      expect(o.status).toBe('ready');
    });

    test('a kitchen display token cannot complete an unpaid order', async () => {
      const orderId = await seedOrder();
      const res = await request(deviceApp(F.restaurantId))
        .patch(`/api/food/restaurants/${F.restaurantId}/orders/${orderId}/status`)
        .send({ status: 'completed' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('order_unpaid');
    });

    test('a manager without a reason cannot complete an unpaid order', async () => {
      const orderId = await seedOrder();
      const res = await request(staffApp(F.manager))
        .patch(`/api/food/restaurants/${F.restaurantId}/orders/${orderId}/status`)
        .send({ status: 'completed' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('order_unpaid');
    });

    test('staff cannot use the override, even with a reason', async () => {
      const orderId = await seedOrder();
      const res = await request(staffApp(F.employee))
        .patch(`/api/food/restaurants/${F.restaurantId}/orders/${orderId}/status`)
        .send({ status: 'completed', complete_unpaid_reason: 'Regular customer, pays Friday' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('order_unpaid');
    });

    test('a manager override with a reason completes and is audit-logged', async () => {
      const orderId = await seedOrder();
      const reason = 'House account guest, billed monthly';
      const res = await request(staffApp(F.manager))
        .patch(`/api/food/restaurants/${F.restaurantId}/orders/${orderId}/status`)
        .send({ status: 'completed', complete_unpaid_reason: reason });
      expect(res.status).toBe(200);
      expect(res.body.order.status).toBe('completed');

      const { rows: [event] } = await pool.query(
        `SELECT * FROM restaurant_kitchen_events
          WHERE food_order_id = $1 AND event_type = 'order_completed'
          ORDER BY id DESC LIMIT 1`,
        [orderId]
      );
      expect(event).toBeTruthy();
      expect(event.reason).toBe(reason);
      expect(event.metadata.completeUnpaidOverride).toBe(true);
      expect(event.metadata.completeUnpaidReason).toBe(reason);
      expect(String(event.created_by)).toBe(String(F.manager));
    });

    test('paid orders complete normally for staff', async () => {
      const orderId = await seedOrder({ paymentStatus: 'paid' });
      const res = await request(staffApp(F.employee))
        .patch(`/api/food/restaurants/${F.restaurantId}/orders/${orderId}/status`)
        .send({ status: 'completed' });
      expect(res.status).toBe(200);
      expect(res.body.order.status).toBe('completed');
    });
  });
});
