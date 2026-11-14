'use strict';

/**
 * DB test: money-flows audit R10 (2026-11-07) — partially refunded
 * orders still pay the full tip.
 *
 * Repro: $100 order + $20 tip, $50 partial refund. The tip must be
 * pro-rated by net_collected / collected (5000/10000), contributing
 * a $10 tip — not the full $20. A second order with no refund keeps
 * its full tip; a fully refunded order contributes nothing.
 *
 * Run with:
 *   DATABASE_URL=STATEMENT_TEST_DATABASE_URL=STATEMENT_JOB_TEST_DATABASE_URL=STATEMENT_INVESTIGATION_TEST_DATABASE_URL=ADMIN_GRANT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     STATEMENT_REQUIRE_DB_TESTS=true npx jest __tests__/restaurantPayrollPartialRefundTipR10.db.test.js --runInBand --forceExit
 * Without it, the DB describes skip (fail closed), same pattern as
 * restaurantPunchCloseoutBatchLimit.db.test.js.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');

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
  process.env.DATABASE_URL = process.env.STATEMENT_TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

const pool = require('../db');
const { getOrderTips } = require('../services/restaurantPayrollService');

jest.setTimeout(120000);

const RUN = crypto.randomUUID().slice(0, 8);

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Tips', $3, 'customer', TRUE, TRUE)`,
    [id, `r10-${label}-${id}@example.invalid`, label]
  );
  return id;
}

async function mkOrder(restaurantId, businessId, workerId, {
  subtotal, tip, total, status = 'completed', paymentStatus = 'paid', createdAt,
}) {
  const { rows: [o] } = await pool.query(
    `INSERT INTO food_orders
       (restaurant_id, business_id, status, payment_status,
        subtotal_cents, tip_cents, total_cents, currency_code,
        queue_number, acting_staff_user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'USD', 1, $8, $9)
     RETURNING id`,
    [restaurantId, businessId, status, paymentStatus, subtotal, tip, total, workerId, createdAt]
  );
  return Number(o.id);
}

async function mkPayment(restaurantId, orderId, type, amount) {
  await pool.query(
    `INSERT INTO restaurant_pos_payments
       (restaurant_id, food_order_id, payment_type, amount_cents, status)
     VALUES ($1, $2, $3, $4, 'recorded')`,
    [restaurantId, orderId, type, amount]
  );
}

ddescribe('Money flows R10: partial refunds pro-rate the tip', () => {
  let restaurantId;
  let workerId;

  beforeAll(async () => {
    const owner = await newUser(`owner-${RUN}`);
    workerId = await newUser(`worker-${RUN}`);
    const { rows: [b] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name, timezone) VALUES ($1, $2, $3) RETURNING id',
      [owner, `R10 Bistro ${RUN}`, 'UTC']
    );
    const businessId = Number(b.id);
    const { rows: [r] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
      [businessId, owner, `R10 Bistro ${RUN}`]
    );
    restaurantId = Number(r.id);

    // Order 1: $100 + $20 tip, $50 partial refund -> $10 tip.
    const order1 = await mkOrder(restaurantId, businessId, workerId, {
      subtotal: 10000, tip: 2000, total: 10000, createdAt: '2026-11-03T12:00:00Z',
    });
    await mkPayment(restaurantId, order1, 'card', 10000);
    await mkPayment(restaurantId, order1, 'refund', 5000);

    // Order 2: $50 + $10 tip, no refund -> full $10 tip.
    const order2 = await mkOrder(restaurantId, businessId, workerId, {
      subtotal: 5000, tip: 1000, total: 5000, createdAt: '2026-11-04T12:00:00Z',
    });
    await mkPayment(restaurantId, order2, 'card', 5000);

    // Order 3: fully refunded -> no tip at all.
    const order3 = await mkOrder(restaurantId, businessId, workerId, {
      subtotal: 8000, tip: 3000, total: 8000, status: 'refunded',
      paymentStatus: 'refunded', createdAt: '2026-11-05T12:00:00Z',
    });
    await mkPayment(restaurantId, order3, 'card', 8000);
    await mkPayment(restaurantId, order3, 'refund', 8000);
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('$100 + $20 tip with a $50 partial refund contributes a $10 tip', async () => {
    const rows = await getOrderTips(restaurantId, '2026-11-02', '2026-11-07', 'UTC');
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe('USD');
    expect(rows[0].staff_user_id).toBe(workerId);
    // $10 (pro-rated) + $10 (unrefunded order) = $20, not $30.
    expect(Number(rows[0].tips_cents)).toBe(2000);
  });

  test('the single-employee slice pro-rates the same way', async () => {
    const rows = await getOrderTips(restaurantId, '2026-11-02', '2026-11-07', 'UTC', null, workerId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].tips_cents)).toBe(2000);
  });
});
