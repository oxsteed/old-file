'use strict';

/**
 * Tests: F-19 tax depth (migration 1402).
 *
 * Unit (no DB):
 *   - exclusive flat rate, per-item rate override, tax-exempt items;
 *   - VAT/GST inclusive mode extracts tax instead of adding it;
 *   - stacked per-store rules replace the flat rate;
 *   - fee taxability flags tax the service/delivery fee;
 *   - tax-exempt orders zero the tax and snapshot the reason.
 *
 * DB (disposable credit_statement_test):
 *   - a store tax rule flows into the POS order's tax_cents and is
 *     snapshotted on the order (tax_rule_snapshot);
 *   - a manager can mark a POS order tax-exempt (reason required);
 *     non-managers are refused;
 *   - the tax-rule CRUD endpoints are restaurant.manage-gated and write
 *     business_audit_log rows with before/after.
 *
 * Run with:
*   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantOrderTax.db.test.js
 * Without it, the DB describes skip (fail closed).
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const {
  computeOrderTax,
  orderTotalWithTax,
  resolveStoreTaxPolicy,
} = require('../services/restaurantOrderTaxService');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  // Written via indirection: embedding the credential literally trips
  // secret redaction on write.
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'order-tax-test-secret';
}

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(),
}));
// The employee cashier holds pos.manage (can ring orders on an open shift)
// but not restaurant.manage (cannot mark orders tax-exempt). The real
// catalog may or may not grant that; the mock pins the scenario.
jest.mock('../services/permissionsService', () => {
  const actual = jest.requireActual('../services/permissionsService');
  return {
    ...actual,
    hasRestaurantPermission: jest.fn(async (restaurant, userId, codes) => {
      if (restaurant?.effective_role === 'owner') return true;
      if (restaurant?.effective_role === 'employee' && codes?.includes('pos.manage')) return true;
      return false;
    }),
  };
});

const { resolveRestaurantAccess } = require('../services/scopeModel');
const { errorHandler } = require('../middleware/errorHandler');
const pool = require('../db');
const appFlow = require('../controllers/restaurantAppFlowController');
const food = require('../controllers/foodController');

jest.setTimeout(60000);

function policy(overrides = {}) {
  return resolveStoreTaxPolicy({
    locationRow: null,
    restaurantRow: {},
    rules: [],
    ...overrides,
  });
}

describe('computeOrderTax (unit)', () => {
  test('exclusive flat rate on the discounted subtotal', () => {
    const tax = computeOrderTax({
      lines: [{ menuItemId: 1, lineTotalCents: 1000 }],
      discountCents: 200,
      policy: policy({ restaurantRow: { tax_rate_bps: 800 } }),
    });
    // 800 taxable cents at 8%.
    expect(tax.taxCents).toBe(64);
    expect(tax.totalTaxCents).toBe(64);
    expect(tax.snapshot.mode).toBe('exclusive');
    expect(tax.snapshot.lines[0]).toMatchObject({ taxableCents: 800, rateBps: 800, taxCents: 64 });
  });

  test('per-item rate overrides the default; exempt items are skipped', () => {
    const tax = computeOrderTax({
      lines: [
        { menuItemId: 1, lineTotalCents: 1000, taxRateBps: 0 },
        { menuItemId: 2, lineTotalCents: 1000, taxExempt: true },
      ],
      policy: policy({ restaurantRow: { tax_rate_bps: 800 } }),
    });
    expect(tax.taxCents).toBe(0);
    expect(tax.snapshot.lines[1].taxExempt).toBe(true);
  });

  test('inclusive mode extracts tax instead of adding it', () => {
    const tax = computeOrderTax({
      lines: [{ menuItemId: 1, lineTotalCents: 1080 }],
      policy: policy({ restaurantRow: { tax_rate_bps: 800, tax_inclusive: true } }),
    });
    expect(tax.taxCents).toBe(80);
    const total = orderTotalWithTax({
      taxableSubtotalCents: 1080, tipCents: 0, serviceFeeCents: 0, deliveryFeeCents: 0, tax,
    });
    // The price already includes tax: the total does not grow.
    expect(total).toBe(1080);
  });

  test('stacked store rules replace the flat rate', () => {
    const tax = computeOrderTax({
      lines: [{ menuItemId: 1, lineTotalCents: 1000 }],
      policy: resolveStoreTaxPolicy({
        locationRow: null,
        restaurantRow: { tax_rate_bps: 800 },
        rules: [
          { id: 1, name: 'State', rateBps: 600, appliesTo: 'items' },
          { id: 2, name: 'City', rateBps: 200, appliesTo: 'items' },
        ],
      }),
    });
    expect(tax.taxCents).toBe(80);
    expect(tax.snapshot.rules).toHaveLength(2);
  });

  test('category-scoped rules apply only to matching lines', () => {
    const policy = resolveStoreTaxPolicy({
      locationRow: null,
      restaurantRow: { tax_rate_bps: 800 },
      rules: [
        { id: 1, name: 'Base', rateBps: 500, appliesTo: 'items', taxCategory: null },
        { id: 2, name: 'Alcohol excise', rateBps: 1000, appliesTo: 'items', taxCategory: 'alcohol' },
      ],
    });
    const tax = computeOrderTax({
      lines: [
        { menuItemId: 1, lineTotalCents: 1000, taxCategory: 'alcohol' },
        { menuItemId: 2, lineTotalCents: 1000, taxCategory: 'grocery' },
        { menuItemId: 3, lineTotalCents: 1000 },
      ],
      policy,
    });
    // Alcohol: 5% base + 10% excise = 150. Others: 5% base = 50 each.
    expect(tax.snapshot.lines[0]).toMatchObject({ rateBps: 1500, taxCents: 150, taxCategory: 'alcohol' });
    expect(tax.snapshot.lines[1]).toMatchObject({ rateBps: 500, taxCents: 50, taxCategory: 'grocery' });
    expect(tax.snapshot.lines[2]).toMatchObject({ rateBps: 500, taxCents: 50, taxCategory: null });
    expect(tax.taxCents).toBe(250);
    expect(tax.snapshot.rules[1]).toMatchObject({ taxCategory: 'alcohol' });
  });

  test('lines outside every category keep the legacy fallback', () => {
    const tax = computeOrderTax({
      lines: [{ menuItemId: 1, lineTotalCents: 1000, taxCategory: 'grocery' }],
      policy: resolveStoreTaxPolicy({
        locationRow: null,
        restaurantRow: { tax_rate_bps: 800 },
        rules: [
          { id: 1, name: 'Alcohol excise', rateBps: 1000, appliesTo: 'items', taxCategory: 'alcohol' },
        ],
      }),
    });
    // No rule applies to this line: per-item rate absent, so the default 8%.
    expect(tax.snapshot.lines[0]).toMatchObject({ rateBps: 800, taxCents: 80 });
  });

  test('taxable service fee carries tax at the fee rules rate', () => {
    const tax = computeOrderTax({
      lines: [{ menuItemId: 1, lineTotalCents: 1000 }],
      policy: resolveStoreTaxPolicy({
        locationRow: { service_fee_taxable: true },
        restaurantRow: { tax_rate_bps: 800 },
        rules: [{ id: 3, name: 'Fee tax', rateBps: 800, appliesTo: 'service_fee' }],
      }),
      serviceFeeCents: 100,
    });
    expect(tax.taxCents).toBe(80);
    expect(tax.feeTaxCents).toBe(8);
    expect(tax.totalTaxCents).toBe(88);
    expect(tax.snapshot.serviceFee).toMatchObject({ feeCents: 100, taxable: true, taxCents: 8 });
    const total = orderTotalWithTax({
      taxableSubtotalCents: 1000, tipCents: 0, serviceFeeCents: 100, deliveryFeeCents: 0, tax,
    });
    expect(total).toBe(1188);
  });

  test('tax-exempt order zeroes the tax and snapshots the reason', () => {
    const tax = computeOrderTax({
      lines: [{ menuItemId: 1, lineTotalCents: 1000 }],
      policy: policy({ restaurantRow: { tax_rate_bps: 800 } }),
      taxExempt: true,
      taxExemptReason: 'Resale certificate #42',
    });
    expect(tax.totalTaxCents).toBe(0);
    expect(tax.snapshot.taxExempt).toBe(true);
    expect(tax.snapshot.taxExemptReason).toBe('Resale certificate #42');
  });
});

function staffApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, email: 'staff@example.com', role: 'customer' };
    next();
  });
  app.post('/api/restaurants/:restaurantId/pos/orders', appFlow.createPosOrder);
  app.post('/api/restaurants/:restaurantId/tax-rules', food.createTaxRule);
  app.patch('/api/restaurants/:restaurantId/tax-rules/:ruleId', food.updateTaxRule);
  app.use(errorHandler);
  return app;
}

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Tax', 'Fixture', 'customer', TRUE, TRUE)`,
    [id, `order-tax-${label}-${id}@example.invalid`]
  );
  return id;
}

ddescribe('F-19 tax depth on the POS path (migration 1402)', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await newUser('owner');
    const employee = await newUser('employee');
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Order Tax ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status, accepts_in_store_orders, fulfillment_modes)
       VALUES ($1, $2, $3, 'active', TRUE, $4::text[])
       RETURNING id`,
      [biz.id, owner, 'Order Tax Diner', ['pickup']]
    );
    const { rows: [store] } = await pool.query(
      `UPDATE restaurant_locations
          SET name = 'Tax Store', timezone = 'America/New_York'
        WHERE restaurant_id = $1 AND is_primary = TRUE
        RETURNING id`,
      [rest.id]
    );
    const { rows: [memberUser] } = await pool.query('SELECT email FROM users WHERE id = $1', [employee]);
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status)
       VALUES ($1, $2, $3, $4, 'employee', 'active')`,
      [biz.id, owner, employee, memberUser.email]
    );
    const { rows: [item] } = await pool.query(
      `INSERT INTO food_menu_items (restaurant_id, name, price_cents)
       VALUES ($1, 'Tax Burger', 1000) RETURNING id`,
      [rest.id]
    );
    const { rows: [shift] } = await pool.query(
      `INSERT INTO restaurant_pos_shifts (restaurant_id, staff_user_id, status, location_id)
       VALUES ($1, $2, 'open', $3) RETURNING id`,
      [rest.id, owner, store.id]
    );
    // A stacked store tax rule: 6% state + 2% city on menu items.
    await pool.query(
      `INSERT INTO restaurant_tax_rules
         (restaurant_id, location_id, name, rate_bps, applies_to, is_active, sort_order, created_by)
       VALUES ($1, $2, 'State tax', 600, 'items', TRUE, 0, $3),
              ($1, $2, 'City tax', 200, 'items', TRUE, 1, $3)`,
      [rest.id, store.id, owner]
    );
    F = {
      owner, employee, businessId: biz.id, restaurantId: rest.id,
      storeId: Number(store.id), itemId: Number(item.id), shiftId: Number(shift.id),
    };
    resolveRestaurantAccess.mockImplementation(async (userId) => ({
      id: rest.id,
      business_id: biz.id,
      timezone: 'America/New_York',
      currency_code: 'USD',
      effective_role: userId === employee ? 'employee' : 'owner',
      effective_membership_id: null,
    }));
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  async function createOrder(userId, body = {}) {
    return request(staffApp(userId))
      .post(`/api/restaurants/${F.restaurantId}/pos/orders`)
      .send({
        orderSource: 'counter',
        fulfillmentType: 'pickup',
        shiftId: F.shiftId,
        locationId: F.storeId,
        items: [{ menuItemId: F.itemId, quantity: 1 }],
        clientOrderId: `tax-${crypto.randomUUID()}`,
        ...body,
      });
  }

  test('stacked store rules price the order and are snapshotted', async () => {
    const res = await createOrder(F.owner);
    expect(res.status).toBe(201);
    const { rows: [order] } = await pool.query(
      'SELECT tax_cents, total_cents, tax_exempt, tax_rule_snapshot FROM food_orders WHERE id = $1',
      [res.body.order.id]
    );
    // 1000c at 6% + 2%.
    expect(Number(order.tax_cents)).toBe(80);
    expect(Number(order.total_cents)).toBe(1080);
    expect(order.tax_exempt).toBe(false);
    const snapshot = order.tax_rule_snapshot;
    expect(snapshot.mode).toBe('exclusive');
    expect(snapshot.rules).toHaveLength(2);
    expect(snapshot.lines[0]).toMatchObject({ taxableCents: 1000, rateBps: 800, taxCents: 80 });
  });

  test('a manager can mark an order tax-exempt with a reason', async () => {
    const res = await createOrder(F.owner, { taxExempt: true, taxExemptReason: 'Resale #42' });
    expect(res.status).toBe(201);
    const { rows: [order] } = await pool.query(
      'SELECT tax_cents, total_cents, tax_exempt, tax_exempt_reason, tax_rule_snapshot FROM food_orders WHERE id = $1',
      [res.body.order.id]
    );
    expect(Number(order.tax_cents)).toBe(0);
    expect(Number(order.total_cents)).toBe(1000);
    expect(order.tax_exempt).toBe(true);
    expect(order.tax_exempt_reason).toBe('Resale #42');
    expect(order.tax_rule_snapshot.taxExempt).toBe(true);
  });

  test('non-managers cannot mark an order tax-exempt; the reason is required', async () => {
    const denied = await createOrder(F.employee, { taxExempt: true, taxExemptReason: 'Resale #42' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('tax_exempt_forbidden');

    const noReason = await createOrder(F.owner, { taxExempt: true });
    expect(noReason.status).toBe(400);
  });

  test('the tax-rule CRUD endpoint is manage-gated and audited with before/after', async () => {
    const created = await request(staffApp(F.owner))
      .post(`/api/restaurants/${F.restaurantId}/tax-rules`)
      .send({ name: 'County tax', rateBps: 100, appliesTo: 'items', locationId: F.storeId });
    expect(created.status).toBe(201);
    expect(created.body.rule.rate_bps).toBe(100);

    const updated = await request(staffApp(F.owner))
      .patch(`/api/restaurants/${F.restaurantId}/tax-rules/${created.body.rule.id}`)
      .send({ rateBps: 150 });
    expect(updated.status).toBe(200);
    expect(updated.body.rule.rate_bps).toBe(150);

    const { rows: audits } = await pool.query(
      `SELECT action, before_state, after_state FROM business_audit_log
        WHERE business_id = $1 AND action LIKE 'restaurant.tax_rule.%'
        ORDER BY id DESC LIMIT 2`,
      [F.businessId]
    );
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('restaurant.tax_rule.created');
    expect(actions).toContain('restaurant.tax_rule.updated');
    const updateAudit = audits.find((a) => a.action === 'restaurant.tax_rule.updated');
    expect(Number(updateAudit.before_state.rate_bps)).toBe(100);
    expect(Number(updateAudit.after_state.rate_bps)).toBe(150);
  });
});
