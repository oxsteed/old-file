'use strict';

/**
 * DB tests: shared-POS staff identity and cash controls (staff review
 * S-06, S-07).
 *
 *   S-06  a staff PIN is unique per restaurant, validating it issues a
 *         short-lived staff sub-session scoped to the device/restaurant,
 *         failed attempts lock PIN entry out, a removed member's PIN
 *         stops working, and POS writes stamp acting_staff_user_id from
 *         the session (orders, payments, drawer events, receipt audits).
 *   S-07  opening a drawer requires pos.use; payouts/cash-outs above the
 *         threshold, no-sale opens, voids, refunds and large comps need
 *         a manager-PIN approval recorded in restaurant_pos_approvals
 *         and linked to the resulting row; voids and comps carry reason
 *         codes on the approval path.
 *
 * Run with:
 *   ST_T3_TEST_DATABASE_URL=postgresql://.../st_t3 \
 *     npx jest __tests__/restaurantStaffIdentity.db.test.js
 * Without it, the DB describes skip (fail closed) instead of touching a DB.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.ST_T3_TEST_DATABASE_URL || '';

function isTrackDatabase(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/st_t3';
  } catch { return false; }
}

const CAN_RUN_DB = isTrackDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable st_t3 database', () => {
  expect(isTrackDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'st-t3-test-secret';
}

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));

const { errorHandler } = require('../middleware/errorHandler');
const pool = require('../db');
const appFlow = require('../controllers/restaurantAppFlowController');

jest.setTimeout(60000);

function staffApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, email: 'staff@example.com', role: 'customer' };
    next();
  });
  app.post('/api/restaurants/:restaurantId/pos/staff-pins', appFlow.setStaffPin);
  app.post('/api/restaurants/:restaurantId/pos/staff-pins/validate', appFlow.validateStaffPin);
  app.post('/api/restaurants/:restaurantId/pos/staff-session', appFlow.createStaffSession);
  app.get('/api/restaurants/:restaurantId/pos/staff-session', appFlow.getStaffSession);
  app.delete('/api/restaurants/:restaurantId/pos/staff-session', appFlow.endStaffSession);
  app.post('/api/restaurants/:restaurantId/pos/shifts', appFlow.openShift);
  app.post('/api/restaurants/:restaurantId/pos/shifts/:shiftId/drawer-events', appFlow.recordDrawerEvent);
  app.post('/api/restaurants/:restaurantId/pos/orders', appFlow.createPosOrder);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/void', appFlow.voidPosOrder);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/payments', appFlow.recordPosPayment);
  app.use(errorHandler);
  return app;
}

function deviceApp() {
  const app = express();
  app.use(express.json());
  app.post('/api/restaurants/:restaurantId/devices/:deviceId/staff-session', appFlow.authenticatePosDevice, appFlow.createDeviceStaffSession);
  app.use(errorHandler);
  return app;
}

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Staff', 'Fixture', 'customer', TRUE, TRUE)`,
    [id, `staff-identity-${label}-${id}@example.invalid`]
  );
  return id;
}

ddescribe('staff identity and cash controls (S-06/S-07)', () => {
  let F = {};

  async function setPin(asUser, body) {
    return request(staffApp(asUser))
      .post(`/api/restaurants/${F.restaurantId}/pos/staff-pins`)
      .send(body);
  }

  async function unlock(asUser, pin) {
    return request(staffApp(asUser))
      .post(`/api/restaurants/${F.restaurantId}/pos/staff-session`)
      .send({ pin });
  }

  async function createOrder(asUser, { sessionToken, shiftId, clientOrderId } = {}) {
    let req = request(staffApp(asUser))
      .post(`/api/restaurants/${F.restaurantId}/pos/orders`);
    if (sessionToken) req = req.set('X-Staff-Session', sessionToken);
    return req.send({
      orderSource: 'counter',
      fulfillmentType: 'pickup',
      shiftId: shiftId || F.cashierShiftId,
      items: [{ menuItemId: F.itemId, quantity: 1 }],
      clientOrderId: clientOrderId || `st-t3-${crypto.randomUUID()}`,
    });
  }

  beforeAll(async () => {
    const owner = await newUser('owner');
    const manager = await newUser('manager');
    const cashier = await newUser('cashier');
    const support = await newUser('support');
    const departed = await newUser('departed');

    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Staff Identity ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status, accepts_in_store_orders, fulfillment_modes)
       VALUES ($1, $2, $3, 'active', TRUE, $4::text[])
       RETURNING id`,
      [biz.id, owner, 'Staff Identity Diner', ['pickup', 'dine_in']]
    );
    for (const [memberId, role] of [[manager, 'manager'], [cashier, 'employee'], [support, 'support_agent'], [departed, 'employee']]) {
      const { rows: [memberUser] } = await pool.query('SELECT email FROM users WHERE id = $1', [memberId]);
      await pool.query(
        `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status)
         VALUES ($1, $2, $3, $4, $5, 'active')`,
        [biz.id, owner, memberId, memberUser.email, role]
      );
    }
    const { rows: [item] } = await pool.query(
      `INSERT INTO food_menu_items (restaurant_id, name, price_cents)
       VALUES ($1, 'Identity Burger', 1000) RETURNING id`,
      [rest.id]
    );
    // Paired POS appliance for the device-credential session route.
    const deviceToken = `device-token-${crypto.randomUUID()}`;
    const deviceTokenHash = crypto.createHash('sha256').update(deviceToken).digest('hex');
    const { rows: [device] } = await pool.query(
      `INSERT INTO restaurant_app_devices
         (restaurant_id, app_key, device_name, status, device_token_hash, paired_at)
       VALUES ($1, 'pos', 'Counter tablet', 'paired', $2, NOW()) RETURNING id`,
      [rest.id, deviceTokenHash]
    );
    F = {
      owner, manager, cashier, support, departed,
      businessId: biz.id,
      restaurantId: rest.id,
      itemId: Number(item.id),
      deviceId: Number(device.id),
      deviceToken,
    };

    // PINs: manager 2468, cashier 1357, departed 9999.
    expect((await setPin(manager, { pin: '2468', staffUserId: manager, staffLabel: 'Manager' })).status).toBe(201);
    expect((await setPin(manager, { pin: '1357', staffUserId: cashier, staffLabel: 'Cashier' })).status).toBe(201);
    expect((await setPin(manager, { pin: '9999', staffUserId: departed, staffLabel: 'Departed' })).status).toBe(201);

    // The cashier's own open drawer shift.
    const shiftRes = await request(staffApp(cashier))
      .post(`/api/restaurants/${F.restaurantId}/pos/shifts`)
      .send({});
    expect(shiftRes.status).toBe(201);
    F.cashierShiftId = shiftRes.body.shift.id;
  });

  describe('S-06 PIN uniqueness and sessions', () => {
    test('a PIN value already in use at the restaurant cannot be set for someone else', async () => {
      const clash = await setPin(F.manager, { pin: '2468', staffUserId: F.cashier, staffLabel: 'Cashier' });
      expect(clash.status).toBe(409);
      expect(clash.body.error?.code || clash.body.code).toBe('pin_already_in_use');

      const labelClash = await setPin(F.manager, { pin: '1357', staffLabel: 'Floating drawer' });
      expect(labelClash.status).toBe(409);
    });

    test('validate issues a staff session and the session resolves', async () => {
      const res = await request(staffApp(F.manager))
        .post(`/api/restaurants/${F.restaurantId}/pos/staff-pins/validate`)
        .send({ pin: '1357' });
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.staff.userId).toBe(F.cashier);
      expect(res.body.token).toBeTruthy();

      const status = await request(staffApp(F.manager))
        .get(`/api/restaurants/${F.restaurantId}/pos/staff-session`)
        .set('X-Staff-Session', res.body.token);
      expect(status.status).toBe(200);
      expect(status.body.staffSession.staff.userId).toBe(F.cashier);

      const ended = await request(staffApp(F.manager))
        .delete(`/api/restaurants/${F.restaurantId}/pos/staff-session`)
        .set('X-Staff-Session', res.body.token)
        .send({ reason: 'switch_user' });
      expect(ended.status).toBe(200);
      expect(ended.body.ended).toBe(true);

      const after = await request(staffApp(F.manager))
        .get(`/api/restaurants/${F.restaurantId}/pos/staff-session`)
        .set('X-Staff-Session', res.body.token);
      expect(after.status).toBe(401);
    });

    test('a paired POS device unlocks with a staff PIN using only its device credential', async () => {
      const res = await request(deviceApp())
        .post(`/api/restaurants/${F.restaurantId}/devices/${F.deviceId}/staff-session`)
        .set('X-Device-Token', F.deviceToken)
        .send({ pin: '1357' });
      expect(res.status).toBe(201);
      expect(res.body.staff.userId).toBe(F.cashier);

      const { rows: [session] } = await pool.query(
        'SELECT * FROM restaurant_staff_sessions WHERE id = $1',
        [res.body.staffSession.id]
      );
      expect(Number(session.device_id)).toBe(F.deviceId);
      expect(session.staff_user_id).toBe(F.cashier);

      const bad = await request(deviceApp())
        .post(`/api/restaurants/${F.restaurantId}/devices/${F.deviceId}/staff-session`)
        .set('X-Device-Token', 'not-the-device-token')
        .send({ pin: '1357' });
      expect(bad.status).toBe(401);
    });

    test('an idle-expired session stops resolving and is ended as idle_timeout', async () => {
      const res = await unlock(F.manager, '1357');
      expect(res.status).toBe(201);
      await pool.query(
        "UPDATE restaurant_staff_sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1",
        [res.body.staffSession.id]
      );
      const status = await request(staffApp(F.manager))
        .get(`/api/restaurants/${F.restaurantId}/pos/staff-session`)
        .set('X-Staff-Session', res.body.token);
      expect(status.status).toBe(401);
      const { rows: [session] } = await pool.query(
        'SELECT ended_at, end_reason FROM restaurant_staff_sessions WHERE id = $1',
        [res.body.staffSession.id]
      );
      expect(session.ended_at).toBeTruthy();
      expect(session.end_reason).toBe('idle_timeout');
    });

    test('five failed attempts on one device lock PIN entry out', async () => {
      for (let i = 0; i < 5; i += 1) {
        const res = await request(deviceApp())
          .post(`/api/restaurants/${F.restaurantId}/devices/${F.deviceId}/staff-session`)
          .set('X-Device-Token', F.deviceToken)
          .send({ pin: '0000' });
        expect(res.status).toBe(401);
      }
      const locked = await request(deviceApp())
        .post(`/api/restaurants/${F.restaurantId}/devices/${F.deviceId}/staff-session`)
        .set('X-Device-Token', F.deviceToken)
        .send({ pin: '1357' });
      expect(locked.status).toBe(429);
      expect(locked.body.error?.code || locked.body.code).toBe('pin_locked');
    });

    test("a removed member's PIN stops working (S-11)", async () => {
      await pool.query(
        "UPDATE business_members SET status = 'revoked' WHERE business_id = $1 AND member_id = $2",
        [F.businessId, F.departed]
      );
      const res = await unlock(F.manager, '9999');
      expect(res.status).toBe(403);
      expect(res.body.error?.code || res.body.code).toBe('staff_not_member');
    });
  });

  describe('S-07 drawer access and approvals', () => {
    test('a support agent (no pos.use) cannot open a drawer', async () => {
      const res = await request(staffApp(F.support))
        .post(`/api/restaurants/${F.restaurantId}/pos/shifts`)
        .send({});
      expect(res.status).toBe(403);
    });

    test('payout above the threshold needs a manager PIN and writes a linked approval', async () => {
      const denied = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/shifts/${F.cashierShiftId}/drawer-events`)
        .send({ eventType: 'payout', amountCents: 15000, reason: 'Supplier' });
      expect(denied.status).toBe(403);
      expect(denied.body.error?.code || denied.body.code).toBe('manager_approval_required');

      const wrongPin = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/shifts/${F.cashierShiftId}/drawer-events`)
        .send({ eventType: 'payout', amountCents: 15000, reason: 'Supplier', approvalPin: '1357' });
      expect(wrongPin.status).toBe(403);

      const session = await unlock(F.manager, '1357');
      const approved = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/shifts/${F.cashierShiftId}/drawer-events`)
        .set('X-Staff-Session', session.body.token)
        .send({ eventType: 'payout', amountCents: 15000, reason: 'Supplier', approvalPin: '2468' });
      expect(approved.status).toBe(201);
      expect(approved.body.event.acting_staff_user_id).toBe(F.cashier);
      expect(approved.body.approval.approver_user_id).toBe(F.manager);
      expect(approved.body.approval.status).toBe('consumed');

      const { rows: [approval] } = await pool.query(
        'SELECT * FROM restaurant_pos_approvals WHERE id = $1',
        [approved.body.approval.id]
      );
      expect(approval.action).toBe('payout');
      expect(approval.amount_cents).toBe(15000);
      expect(approval.requester_user_id).toBe(F.cashier);
      expect(Number(approval.drawer_event_id)).toBe(Number(approved.body.event.id));

      const belowThreshold = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/shifts/${F.cashierShiftId}/drawer-events`)
        .send({ eventType: 'payout', amountCents: 5000, reason: 'Change run' });
      expect(belowThreshold.status).toBe(201);
      expect(belowThreshold.body.approval).toBeUndefined();
    });

    test('a no-sale drawer open always needs a manager PIN for non-managers', async () => {
      const denied = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/shifts/${F.cashierShiftId}/drawer-events`)
        .send({ eventType: 'no_sale', amountCents: 0 });
      expect(denied.status).toBe(403);

      const approved = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/shifts/${F.cashierShiftId}/drawer-events`)
        .send({ eventType: 'no_sale', amountCents: 0, approvalPin: '2468' });
      expect(approved.status).toBe(201);
      expect(approved.body.approval.action).toBe('no_sale');
    });
  });

  describe('S-06/S-07 acting stamps, voids, refunds, comps', () => {
    test('order creation stamps the acting staff member and the receipt audit', async () => {
      const session = await unlock(F.manager, '1357');
      const res = await createOrder(F.cashier, { sessionToken: session.body.token });
      expect(res.status).toBe(201);
      expect(res.body.order.acting_staff_user_id).toBe(F.cashier);

      const { rows: [audit] } = await pool.query(
        `SELECT acting_staff_user_id FROM restaurant_pos_receipt_events
          WHERE food_order_id = $1 AND event_type = 'order_created'`,
        [res.body.order.id]
      );
      expect(audit.acting_staff_user_id).toBe(F.cashier);
    });

    test('void: legacy refusal without a PIN, approval with manager PIN and reason code', async () => {
      const created = await createOrder(F.cashier, {});
      expect(created.status).toBe(201);
      const orderId = created.body.order.id;

      const legacy = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${orderId}/void`)
        .send({ reason: 'Mistake' });
      expect(legacy.status).toBe(403);
      expect(legacy.body.error?.code || legacy.body.code).toBe('forbidden');

      const noReason = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${orderId}/void`)
        .send({ approvalPin: '2468' });
      expect(noReason.status).toBe(400);

      const approved = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${orderId}/void`)
        .send({ approvalPin: '2468', reasonCode: 'wrong_order', reason: 'Rang up twice' });
      expect(approved.status).toBe(200);
      expect(approved.body.order.pos_ticket_state).toBe('voided');

      const { rows: [approval] } = await pool.query(
        `SELECT * FROM restaurant_pos_approvals WHERE food_order_id = $1 AND action = 'void'`,
        [orderId]
      );
      expect(approval).toBeTruthy();
      expect(approval.reason_code).toBe('wrong_order');
      expect(approval.approver_user_id).toBe(F.manager);
    });

    test('refund: cashier tenders, refund needs the manager PIN and links the approval', async () => {
      const session = await unlock(F.manager, '1357');
      const created = await createOrder(F.cashier, { sessionToken: session.body.token });
      const orderId = created.body.order.id;

      const paid = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${orderId}/payments`)
        .set('X-Staff-Session', session.body.token)
        .send({ paymentType: 'cash', amountCents: 1000, shiftId: F.cashierShiftId });
      expect(paid.status).toBe(201);
      expect(paid.body.payment.acting_staff_user_id).toBe(F.cashier);

      const denied = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${orderId}/payments`)
        .send({
          paymentType: 'refund',
          amountCents: 400,
          shiftId: F.cashierShiftId,
          idempotencyKey: `st-t3-refund-denied-${orderId}`,
        });
      expect(denied.status).toBe(403);

      const refunded = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${orderId}/payments`)
        .send({
          paymentType: 'refund',
          amountCents: 400,
          shiftId: F.cashierShiftId,
          approvalPin: '2468',
          idempotencyKey: `st-t3-refund-${orderId}`,
        });
      expect(refunded.status).toBe(201);
      expect(refunded.body.approval).toBeTruthy();
      const { rows: [approval] } = await pool.query(
        'SELECT * FROM restaurant_pos_approvals WHERE id = $1',
        [refunded.body.approval.id]
      );
      expect(approval.action).toBe('refund');
      expect(Number(approval.payment_id)).toBe(Number(refunded.body.payment.id));
    });

    test('comp: small comps are free, large comps need a manager PIN and a reason code', async () => {
      const smallOrder = await createOrder(F.cashier, {});
      const small = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${smallOrder.body.order.id}/payments`)
        .send({ paymentType: 'comp', amountCents: 1000, shiftId: F.cashierShiftId });
      expect(small.status).toBe(201);
      expect(small.body.approval).toBeUndefined();

      const bigOrder = await createOrder(F.cashier, {});
      expect(bigOrder.status).toBe(201);
      // Lower this restaurant's comp threshold via its approval policy
      // (settings.posApprovalPolicy) so a 1000-cent comp needs approval.
      await pool.query(
        `UPDATE food_restaurants SET settings = settings || '{"posApprovalPolicy":{"comp":{"thresholdCents":500}}}'::jsonb WHERE id = $1`,
        [F.restaurantId]
      );
      const denied = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${bigOrder.body.order.id}/payments`)
        .send({ paymentType: 'comp', amountCents: 1000, shiftId: F.cashierShiftId });
      expect(denied.status).toBe(403);
      expect(denied.body.error?.code || denied.body.code).toBe('manager_approval_required');

      const approved = await request(staffApp(F.cashier))
        .post(`/api/restaurants/${F.restaurantId}/pos/orders/${bigOrder.body.order.id}/payments`)
        .send({
          paymentType: 'comp',
          amountCents: 1000,
          shiftId: F.cashierShiftId,
          approvalPin: '2468',
          reasonCode: 'service_recovery',
        });
      expect(approved.status).toBe(201);
      expect(approved.body.approval.action).toBe('comp');
      expect(approved.body.approval.reason_code).toBe('service_recovery');
      expect(approved.body.payment.metadata.reasonCode).toBe('service_recovery');

      await pool.query(
        `UPDATE food_restaurants SET settings = settings - 'posApprovalPolicy' WHERE id = $1`,
        [F.restaurantId]
      );
    });
  });

  describe('auth-audit item 18: staff session tokens are device-bound', () => {
    let deviceA;
    let deviceB;
    let tokenA;

    async function pairDevice(name) {
      const raw = `device-token-18-${crypto.randomUUID()}`;
      const hash = crypto.createHash('sha256').update(raw).digest('hex');
      const { rows: [device] } = await pool.query(
        `INSERT INTO restaurant_app_devices
           (restaurant_id, app_key, device_name, status, device_token_hash, paired_at)
         VALUES ($1, 'pos', $2, 'paired', $3, NOW()) RETURNING id`,
        [F.restaurantId, name, hash]
      );
      return { id: Number(device.id), token: raw };
    }

    async function issueOnDevice(device, pin) {
      return request(deviceApp())
        .post(`/api/restaurants/${F.restaurantId}/devices/${device.id}/staff-session`)
        .set('X-Device-Token', device.token)
        .send({ pin });
    }

    beforeAll(async () => {
      deviceA = await pairDevice('Item18 tablet A');
      deviceB = await pairDevice('Item18 tablet B');
      // The manager PIN (2468) was set in the shared fixture; the device
      // fixtures are fresh so no lockout state interferes.
      const issued = await issueOnDevice(deviceA, '2468');
      expect(issued.status).toBe(201);
      tokenA = issued.body.token;
      expect(tokenA).toBeTruthy();
    });

    test('a device-issued token does not resolve on a request without its device credential', async () => {
      const status = await request(staffApp(F.manager))
        .get(`/api/restaurants/${F.restaurantId}/pos/staff-session`)
        .set('X-Staff-Session', tokenA);
      expect(status.status).toBe(401);
    });

    test('resolveStaffSession requires the recorded device', async () => {
      const { resolveStaffSession } = require('../services/restaurantStaffIdentityService');
      const fakeReq = (restaurantDevice) => ({
        get: (header) => (header === 'X-Staff-Session' ? tokenA : undefined),
        body: {},
        restaurantDevice,
      });

      const onDeviceA = await resolveStaffSession(fakeReq({ id: deviceA.id }), F.restaurantId);
      expect(onDeviceA).toBeTruthy();
      expect(Number(onDeviceA.device_id)).toBe(deviceA.id);

      const onDeviceB = await resolveStaffSession(fakeReq({ id: deviceB.id }), F.restaurantId);
      expect(onDeviceB).toBeNull();

      const noDevice = await resolveStaffSession(fakeReq(undefined), F.restaurantId);
      expect(noDevice).toBeNull();
    });

    test('the deviceId-less account-auth PIN path still issues unbound sessions', async () => {
      const res = await request(staffApp(F.manager))
        .post(`/api/restaurants/${F.restaurantId}/pos/staff-session`)
        .send({ pin: '1357' });
      expect(res.status).toBe(201);

      const { rows: [session] } = await pool.query(
        'SELECT device_id FROM restaurant_staff_sessions WHERE id = $1',
        [res.body.staffSession.id]
      );
      expect(session.device_id).toBeNull();

      const status = await request(staffApp(F.manager))
        .get(`/api/restaurants/${F.restaurantId}/pos/staff-session`)
        .set('X-Staff-Session', res.body.token);
      expect(status.status).toBe(200);
    });
  });
});
