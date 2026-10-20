'use strict';

/**
 * DB tests: per-restaurant POS discount definitions (franchise review
 * F-15) and the discount branch of the manager-approval policy
 * (staff-management review S-07).
 *
 *   F-15  merchant CRUD for restaurant_discount_definitions (migration
 *         953), gated by restaurant.manage through the unified
 *         permission resolver and audited via business_audit_log;
 *         createPosOrder computes definition discounts server-side
 *         (percent of subtotal or fixed cents), clamped to
 *         max_discount_cents and to the subtotal, with
 *         min_subtotal_cents enforced; active definitions ride the POS
 *         bootstrap payload and the discounts endpoint.
 *   S-07  a definition with requires_approval, or a computed discount
 *         above settings.posApprovalPolicy.discountAboveCents, needs a
 *         manager approval: 403 discount_approval_required without a
 *         PIN, and with a manager PIN the approval is consumed through
 *         restaurant_pos_approvals (action 'discount') inside the order
 *         transaction. Managers never need the PIN.
 *   Legacy global codes (WELCOME10 etc.) are untouched when no
 *   definition id is sent.
 *
 * Run with:
 *   RESTAURANT_DISCOUNT_TEST_DATABASE_URL=postgresql://...@127.0.0.1:5432/st_f15
 *     npx jest __tests__/restaurantDiscountDefinitions.db.test.js
 * Without it, the DB describes skip (fail closed) instead of touching a DB.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.RESTAURANT_DISCOUNT_TEST_DATABASE_URL || '';

function isTrackDatabase(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/st_f15';
  } catch { return false; }
}

const CAN_RUN_DB = isTrackDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable st_f15 database', () => {
  expect(isTrackDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'f15-discount-test-secret';
}

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));

const { errorHandler } = require('../middleware/errorHandler');
const pool = require('../db');
const appFlow = require('../controllers/restaurantAppFlowController');
const pos = require('../controllers/restaurantPosController');

jest.setTimeout(60000);

function staffApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, email: 'staff@example.com', role: 'customer' };
    next();
  });
  app.get('/api/restaurants/:restaurantId/pos/discount-definitions', pos.listDiscountDefinitions);
  app.post('/api/restaurants/:restaurantId/pos/discount-definitions', pos.createDiscountDefinition);
  app.patch('/api/restaurants/:restaurantId/pos/discount-definitions/:definitionId', pos.updateDiscountDefinition);
  app.delete('/api/restaurants/:restaurantId/pos/discount-definitions/:definitionId', pos.deactivateDiscountDefinition);
  app.get('/api/restaurants/:restaurantId/pos/discounts', pos.listDiscounts);
  app.get('/api/restaurants/:restaurantId/app/bootstrap', appFlow.getBootstrap);
  app.post('/api/restaurants/:restaurantId/pos/staff-pins', appFlow.setStaffPin);
  app.post('/api/restaurants/:restaurantId/pos/orders', appFlow.createPosOrder);
  app.use(errorHandler);
  return app;
}

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Discount', 'Fixture', 'customer', TRUE, TRUE)`,
    [id, `discount-defs-${label}-${id}@example.invalid`]
  );
  return id;
}

const codeOf = (res) => res.body.error?.code || res.body.code;

ddescribe('F-15 discount definitions + S-07 discount approval (st_f15)', () => {
  let F = {};

  async function createOrderAs(userId, body = {}) {
    return request(staffApp(userId))
      .post(`/api/restaurants/${F.restaurantId}/pos/orders`)
      .send({
        orderSource: 'counter',
        fulfillmentType: 'pickup',
        shiftId: F.shifts[userId],
        items: [{ menuItemId: F.itemId, quantity: 1 }],
        clientOrderId: `f15-${crypto.randomUUID()}`,
        ...body,
      });
  }

  async function defineAs(userId, body) {
    return request(staffApp(userId))
      .post(`/api/restaurants/${F.restaurantId}/pos/discount-definitions`)
      .send(body);
  }

  beforeAll(async () => {
    const owner = await newUser('owner');
    const manager = await newUser('manager');
    const employee = await newUser('employee');

    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Discount Defs ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status, accepts_in_store_orders, fulfillment_modes)
       VALUES ($1, $2, $3, 'active', TRUE, $4::text[])
       RETURNING id`,
      [biz.id, owner, 'Discount Defs Diner', ['pickup', 'dine_in']]
    );
    const { rows: [biz2] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Discount Defs Other ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest2] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status, accepts_in_store_orders, fulfillment_modes)
       VALUES ($1, $2, $3, 'active', TRUE, $4::text[])
       RETURNING id`,
      [biz2.id, owner, 'Discount Defs Other Store', ['pickup', 'dine_in']]
    );
    for (const [memberId, role] of [[manager, 'manager'], [employee, 'employee']]) {
      const { rows: [memberUser] } = await pool.query('SELECT email FROM users WHERE id = $1', [memberId]);
      await pool.query(
        `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status)
         VALUES ($1, $2, $3, $4, $5, 'active')`,
        [biz.id, owner, memberId, memberUser.email, role]
      );
    }
    const { rows: [item] } = await pool.query(
      `INSERT INTO food_menu_items (restaurant_id, name, price_cents)
       VALUES ($1, 'Defs Burger', 2000) RETURNING id`,
      [rest.id]
    );
    const shifts = {};
    for (const userId of [owner, manager, employee]) {
      const { rows: [s] } = await pool.query(
        `INSERT INTO restaurant_pos_shifts (restaurant_id, staff_user_id, status)
         VALUES ($1, $2, 'open') RETURNING id`,
        [rest.id, userId]
      );
      shifts[userId] = s.id;
    }
    F = {
      owner, manager, employee,
      businessId: biz.id,
      restaurantId: rest.id,
      restaurant2Id: rest2.id,
      itemId: Number(item.id),
      shifts,
    };

    // Manager PIN 2468 for the S-07 approval path.
    const pinRes = await request(staffApp(manager))
      .post(`/api/restaurants/${F.restaurantId}/pos/staff-pins`)
      .send({ pin: '2468', staffUserId: manager, staffLabel: 'Manager' });
    expect(pinRes.status).toBe(201);
  });

  describe('merchant CRUD, gate and audit', () => {
    let createdId;

    test('owner creates a definition; code is normalized and the write is audited', async () => {
      const res = await defineAs(F.owner, {
        code: 'staff25',
        name: 'Staff 25 percent',
        kind: 'percent',
        value: 25,
        max_discount_cents: 300,
      });
      expect(res.status).toBe(201);
      const def = res.body.discountDefinition;
      expect(def.code).toBe('STAFF25');
      expect(def.kind).toBe('percent');
      expect(def.value).toBe(25);
      expect(def.max_discount_cents).toBe(300);
      expect(def.min_subtotal_cents).toBe(0);
      expect(def.is_active).toBe(true);
      createdId = def.id;
      F.staff25Id = def.id;

      const { rows: audits } = await pool.query(
        `SELECT * FROM business_audit_log
          WHERE business_id = $1 AND action = 'restaurant.discount_definition.created'
            AND target_id = $2`,
        [F.businessId, String(def.id)]
      );
      expect(audits).toHaveLength(1);
      expect(audits[0].actor_user_id).toBe(F.owner);
      expect(audits[0].after_state.code).toBe('STAFF25');
    });

    test('a non-manager cannot create definitions', async () => {
      const res = await defineAs(F.employee, {
        code: 'NOPE10', name: 'Nope', kind: 'percent', value: 10,
      });
      expect(res.status).toBe(403);
      expect(codeOf(res)).toBe('forbidden');
    });

    test('duplicate code is a 409', async () => {
      const res = await defineAs(F.owner, {
        code: 'STAFF25', name: 'Duplicate', kind: 'percent', value: 5,
      });
      expect(res.status).toBe(409);
      expect(codeOf(res)).toBe('discount_definition_code_taken');
    });

    test('validation: percent range and fixed floor are enforced', async () => {
      const badPercent = await defineAs(F.owner, {
        code: 'TOOMUCH', name: 'Too much', kind: 'percent', value: 101,
      });
      expect(badPercent.status).toBe(400);
      expect(codeOf(badPercent)).toBe('validation_failed');

      const badFixed = await defineAs(F.owner, {
        code: 'ZERO', name: 'Zero', kind: 'fixed', value: 0,
      });
      expect(badFixed.status).toBe(400);
      expect(codeOf(badFixed)).toBe('validation_failed');
    });

    test('update changes the value and audits before/after', async () => {
      const res = await request(staffApp(F.owner))
        .patch(`/api/restaurants/${F.restaurantId}/pos/discount-definitions/${createdId}`)
        .send({ value: 20 });
      expect(res.status).toBe(200);
      expect(res.body.discountDefinition.value).toBe(20);

      const { rows: audits } = await pool.query(
        `SELECT * FROM business_audit_log
          WHERE business_id = $1 AND action = 'restaurant.discount_definition.updated'
            AND target_id = $2`,
        [F.businessId, String(createdId)]
      );
      expect(audits).toHaveLength(1);
      expect(audits[0].before_state.value).toBe(25);
      expect(audits[0].after_state.value).toBe(20);

      // Restore for the application tests below.
      const restore = await request(staffApp(F.owner))
        .patch(`/api/restaurants/${F.restaurantId}/pos/discount-definitions/${createdId}`)
        .send({ value: 25 });
      expect(restore.status).toBe(200);
    });

    test('merchant list includes active and inactive; deactivation is audited', async () => {
      const temp = await defineAs(F.owner, {
        code: 'TEMP5', name: 'Temporary', kind: 'percent', value: 5,
      });
      expect(temp.status).toBe(201);
      const tempId = temp.body.discountDefinition.id;
      F.tempId = tempId;

      const off = await request(staffApp(F.owner))
        .delete(`/api/restaurants/${F.restaurantId}/pos/discount-definitions/${tempId}`);
      expect(off.status).toBe(200);
      expect(off.body.discountDefinition.is_active).toBe(false);

      const { rows: audits } = await pool.query(
        `SELECT * FROM business_audit_log
          WHERE business_id = $1 AND action = 'restaurant.discount_definition.deactivated'
            AND target_id = $2`,
        [F.businessId, String(tempId)]
      );
      expect(audits).toHaveLength(1);
      expect(audits[0].before_state.is_active).toBe(true);
      expect(audits[0].after_state.is_active).toBe(false);

      const list = await request(staffApp(F.owner))
        .get(`/api/restaurants/${F.restaurantId}/pos/discount-definitions`);
      expect(list.status).toBe(200);
      const codes = list.body.discountDefinitions.map((d) => d.code);
      expect(codes).toContain('STAFF25');
      expect(codes).toContain('TEMP5');
    });
  });

  describe('POS application', () => {
    test('percent definition: amount computed server-side and clamped to max_discount_cents', async () => {
      // 25% of the 2000-cent subtotal is 500; the cap clamps it to 300.
      const res = await createOrderAs(F.employee, { discountDefinitionId: F.staff25Id });
      expect(res.status).toBe(201);
      expect(Number(res.body.order.discount_cents)).toBe(300);
      expect(Number(res.body.order.total_cents)).toBe(1700);
      const lines = res.body.order.metadata.posDiscounts;
      expect(lines).toHaveLength(1);
      expect(lines[0].source).toBe('discount_definition');
      expect(lines[0].code).toBe('STAFF25');
      expect(lines[0].amountCents).toBe(300);
      expect(lines[0].metadata.definitionId).toBe(F.staff25Id);
    });

    test('fixed definition applies its cents, clamped to the subtotal', async () => {
      const def = await defineAs(F.owner, {
        code: 'FLAT500', name: 'Flat 500 off', kind: 'fixed', value: 500,
      });
      expect(def.status).toBe(201);
      F.flat500Id = def.body.discountDefinition.id;

      const res = await createOrderAs(F.employee, { discount_definition_id: F.flat500Id });
      expect(res.status).toBe(201);
      expect(Number(res.body.order.discount_cents)).toBe(500);
      expect(Number(res.body.order.total_cents)).toBe(1500);
    });

    test('min subtotal is enforced with discount_min_subtotal_not_met', async () => {
      const def = await defineAs(F.owner, {
        code: 'BIGSPEND', name: 'Big spend', kind: 'percent', value: 10, min_subtotal_cents: 5000,
      });
      expect(def.status).toBe(201);
      const res = await createOrderAs(F.employee, { discountDefinitionId: def.body.discountDefinition.id });
      expect(res.status).toBe(400);
      expect(codeOf(res)).toBe('discount_min_subtotal_not_met');
    });

    test('inactive and unknown definitions are refused; another restaurant\'s definition is not visible', async () => {
      const inactive = await createOrderAs(F.employee, { discountDefinitionId: F.tempId });
      expect(inactive.status).toBe(400);
      expect(codeOf(inactive)).toBe('discount_definition_inactive');

      const missing = await createOrderAs(F.employee, { discountDefinitionId: 99999999 });
      expect(missing.status).toBe(404);
      expect(codeOf(missing)).toBe('discount_definition_not_found');

      const cross = await request(staffApp(F.employee))
        .post(`/api/restaurants/${F.restaurant2Id}/pos/orders`)
        .send({
          orderSource: 'counter',
          fulfillmentType: 'pickup',
          items: [{ menuItemId: F.itemId, quantity: 1 }],
          discountDefinitionId: F.flat500Id,
        });
      // The item belongs to restaurant 1, so this fails earlier or at the
      // definition lookup; either way the definition must not apply.
      expect(cross.status).not.toBe(201);
    });

    test('legacy global code path is unchanged when no definition id is sent', async () => {
      const res = await createOrderAs(F.employee, {
        discountLines: [{ code: 'WELCOME10', label: 'Welcome 10%', percent_bps: 1000 }],
      });
      expect(res.status).toBe(201);
      expect(Number(res.body.order.discount_cents)).toBe(200);
      expect(res.body.order.metadata.posDiscounts[0].source).toBe('pos_discount');
    });
  });

  describe('S-07 discount approval', () => {
    beforeAll(async () => {
      const def = await defineAs(F.owner, {
        code: 'VIPFLAG', name: 'VIP flagged', kind: 'percent', value: 10, requires_approval: true,
      });
      expect(def.status).toBe(201);
      F.vipFlagId = def.body.discountDefinition.id;
      const plain = await defineAs(F.owner, {
        code: 'PLAIN10', name: 'Plain ten', kind: 'percent', value: 10,
      });
      expect(plain.status).toBe(201);
      F.plain10Id = plain.body.discountDefinition.id;
    });

    test('requires_approval definition: 403 without a PIN and no order is written', async () => {
      const clientOrderId = `f15-approval-${crypto.randomUUID()}`;
      const res = await createOrderAs(F.employee, {
        discountDefinitionId: F.vipFlagId,
        clientOrderId,
      });
      expect(res.status).toBe(403);
      expect(codeOf(res)).toBe('discount_approval_required');

      const { rows: [count] } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM food_orders WHERE restaurant_id = $1 AND client_order_id = $2',
        [F.restaurantId, clientOrderId]
      );
      expect(count.n).toBe(0);
      F.approvalClientOrderId = clientOrderId;
    });

    test('the same checkout retried with a manager PIN succeeds and consumes an approval row', async () => {
      const res = await createOrderAs(F.employee, {
        discountDefinitionId: F.vipFlagId,
        clientOrderId: F.approvalClientOrderId,
        approvalPin: '2468',
      });
      expect(res.status).toBe(201);
      expect(Number(res.body.order.discount_cents)).toBe(200);
      const orderId = res.body.order.id;

      const { rows: [approval] } = await pool.query(
        `SELECT * FROM restaurant_pos_approvals
          WHERE restaurant_id = $1 AND food_order_id = $2 AND action = 'discount'`,
        [F.restaurantId, orderId]
      );
      expect(approval).toBeTruthy();
      expect(Number(approval.amount_cents)).toBe(200);
      expect(approval.approver_user_id).toBe(F.manager);
      expect(approval.requester_user_id).toBe(F.employee);
      expect(res.body.order.metadata.posDiscounts[0].metadata.approvalId).toBe(Number(approval.id));
    });

    test('a manager caller needs no PIN and writes no approval row', async () => {
      const res = await createOrderAs(F.manager, { discountDefinitionId: F.vipFlagId });
      expect(res.status).toBe(201);
      expect(Number(res.body.order.discount_cents)).toBe(200);
      const { rows: [count] } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM restaurant_pos_approvals
          WHERE restaurant_id = $1 AND food_order_id = $2`,
        [F.restaurantId, res.body.order.id]
      );
      expect(count.n).toBe(0);
    });

    test('discountAboveCents policy: discounts above the threshold need approval, at or below do not', async () => {
      await pool.query(
        `UPDATE food_restaurants
            SET settings = settings || '{"posApprovalPolicy":{"discountAboveCents":100}}'::jsonb
          WHERE id = $1`,
        [F.restaurantId]
      );
      try {
        // PLAIN10 computes 200 on the 2000-cent ticket: above 100.
        const denied = await createOrderAs(F.employee, { discountDefinitionId: F.plain10Id });
        expect(denied.status).toBe(403);
        expect(codeOf(denied)).toBe('discount_approval_required');

        const approved = await createOrderAs(F.employee, {
          discountDefinitionId: F.plain10Id,
          approvalPin: '2468',
        });
        expect(approved.status).toBe(201);

        const ownerFree = await createOrderAs(F.owner, { discountDefinitionId: F.plain10Id });
        expect(ownerFree.status).toBe(201);
      } finally {
        await pool.query(
          `UPDATE food_restaurants SET settings = settings - 'posApprovalPolicy' WHERE id = $1`,
          [F.restaurantId]
        );
      }
      // Threshold gone: the same definition applies without approval.
      const free = await createOrderAs(F.employee, { discountDefinitionId: F.plain10Id });
      expect(free.status).toBe(201);
      expect(Number(free.body.order.discount_cents)).toBe(200);
    });

    test('a wrong PIN is refused and no order is written', async () => {
      const clientOrderId = `f15-wrongpin-${crypto.randomUUID()}`;
      const res = await createOrderAs(F.employee, {
        discountDefinitionId: F.vipFlagId,
        clientOrderId,
        approvalPin: '0000',
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      const { rows: [count] } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM food_orders WHERE restaurant_id = $1 AND client_order_id = $2',
        [F.restaurantId, clientOrderId]
      );
      expect(count.n).toBe(0);
    });
  });

  describe('POS payloads carry the active definitions', () => {
    test('bootstrap includes active definitions and excludes inactive ones', async () => {
      const res = await request(staffApp(F.owner))
        .get(`/api/restaurants/${F.restaurantId}/app/bootstrap?app=pos`);
      expect(res.status).toBe(200);
      const codes = (res.body.discountDefinitions || []).map((d) => d.code);
      expect(codes).toContain('STAFF25');
      expect(codes).toContain('FLAT500');
      expect(codes).not.toContain('TEMP5');
    });

    test('the discounts endpoint returns legacy codes and definitions together', async () => {
      const res = await request(staffApp(F.employee))
        .get(`/api/restaurants/${F.restaurantId}/pos/discounts`);
      expect(res.status).toBe(200);
      expect(res.body.discounts.map((d) => d.code)).toContain('WELCOME10');
      expect(res.body.discountDefinitions.map((d) => d.code)).toContain('STAFF25');
    });
  });
});
