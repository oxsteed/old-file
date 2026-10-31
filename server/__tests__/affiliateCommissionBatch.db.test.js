'use strict';

// Explicit opt-in to the shared disposable synthetic database; never load .env.
jest.unmock('pg');
const databaseUrl = process.env.STATEMENT_TEST_DATABASE_URL;
const permitted = (() => {
  try {
    const u = new URL(databaseUrl);
    return ['postgres:', 'postgresql:'].includes(u.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
      && u.pathname === '/credit_statement_test';
  } catch { return false; }
})();
if (permitted) process.env.DATABASE_URL = databaseUrl;
const dbDescribe = permitted ? describe : describe.skip;
const crypto = require('crypto');
const pool = require('../db');
const { runAffiliateCommissionBatch } = require('../jobs/affiliateCommissionBatch');

test('affiliate auto-confirm DB suite requires explicit synthetic disposable database opt-in', () => {
  expect(permitted).toBe(Boolean(databaseUrl && permitted));
});

dbDescribe('affiliate auto-confirm never confirms refunded orders', () => {
  let customerId;
  let helperId;
  let programId;
  let productId;
  let refundedOrderId;
  let partialRefundOrderId;
  let cleanOrderId;
  let refundedCommissionId;
  let partialCommissionId;
  let cleanCommissionId;

  beforeAll(async () => {
    const tag = crypto.randomBytes(8).toString('hex');
    customerId = crypto.randomUUID();
    helperId = crypto.randomUUID();
    for (const [id, label, role] of [[customerId, 'customer', 'customer'], [helperId, 'helper', 'helper']]) {
      await pool.query(
        `INSERT INTO users(id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, 'synthetic-fixture', 'Synthetic', $3, $4, true, true)`,
        [id, `${label}-${tag}@example.test`, label, role]
      );
    }
    const { rows: [prod] } = await pool.query(
      `INSERT INTO marketplace_products(name) VALUES ($1) RETURNING id`,
      [`Synthetic product ${tag}`]
    );
    productId = prod.id;
    const { rows: [prog] } = await pool.query(
      `INSERT INTO affiliate_programs(helper_id, program_type, commission_rate, status)
       VALUES ($1, 'custom', 10, 'active') RETURNING id`,
      [helperId]
    );
    programId = prog.id;

    async function makeOrder(status) {
      const { rows: [o] } = await pool.query(
        `INSERT INTO marketplace_orders(customer_id, total_cents, subtotal_cents, status)
         VALUES ($1, 10000, 10000, $2) RETURNING id`,
        [customerId, status]
      );
      return o.id;
    }
    async function makeCommission(orderId) {
      const { rows: [c] } = await pool.query(
        `INSERT INTO affiliate_commissions
           (order_id, affiliate_program_id, product_id, commission_cents, commission_rate,
            product_sale_amount_cents, status, created_at)
         VALUES ($1, $2, $3, 1000, 10, 10000, 'pending', NOW() - INTERVAL '40 days')
         RETURNING id`,
        [orderId, programId, productId]
      );
      return c.id;
    }

    refundedOrderId = await makeOrder('refunded');
    refundedCommissionId = await makeCommission(refundedOrderId);

    partialRefundOrderId = await makeOrder('paid');
    partialCommissionId = await makeCommission(partialRefundOrderId);
    const { rows: [txn] } = await pool.query(
      `INSERT INTO marketplace_transactions(order_id, payment_intent_id, amount_cents, status)
       VALUES ($1, $2, 10000, 'succeeded') RETURNING id`,
      [partialRefundOrderId, `pi_synth_${tag}`]
    );
    await pool.query(
      `INSERT INTO marketplace_transaction_refunds
         (order_id, transaction_id, payment_intent_id, amount_cents, reason, idempotency_key, status)
       VALUES ($1, $2, $3, 4000, 'synthetic partial refund', $4, 'succeeded')`,
      [partialRefundOrderId, txn.id, `pi_synth_${tag}`, `refund-${tag}`]
    );

    cleanOrderId = await makeOrder('paid');
    cleanCommissionId = await makeCommission(cleanOrderId);
  }, 120000);

  afterAll(async () => {
    await pool.query(`DELETE FROM affiliate_commissions WHERE id IN ($1, $2, $3)`, [refundedCommissionId, partialCommissionId, cleanCommissionId]);
    await pool.query(`DELETE FROM marketplace_transaction_refunds WHERE order_id = $1`, [partialRefundOrderId]);
    await pool.query(`DELETE FROM marketplace_transactions WHERE order_id = $1`, [partialRefundOrderId]);
    await pool.query(`DELETE FROM marketplace_orders WHERE id IN ($1, $2, $3)`, [refundedOrderId, partialRefundOrderId, cleanOrderId]);
    await pool.query(`DELETE FROM affiliate_programs WHERE id = $1`, [programId]);
    await pool.query(`DELETE FROM marketplace_products WHERE id = $1`, [productId]);
    // Synthetic users are intentionally left behind: deleting users rows is
    // blocked schema-wide by the food_customer_wallet_ledger append-only
    // rewrite rule (known platform gap, also blocks the scheduled user
    // deletion job). Their tagged emails never collide across runs.
    await pool.end();
  });

  test('refunded, partially refunded, and clean commissions confirm correctly', async () => {
    await runAffiliateCommissionBatch();
    const { rows } = await pool.query(
      `SELECT id, status FROM affiliate_commissions WHERE id IN ($1, $2, $3)`,
      [refundedCommissionId, partialCommissionId, cleanCommissionId]
    );
    const byId = Object.fromEntries(rows.map((r) => [String(r.id), r.status]));
    // Money-back states never confirm: no commission is paid out on them.
    expect(byId[String(refundedCommissionId)]).toBe('pending');
    expect(byId[String(partialCommissionId)]).toBe('pending');
    // The clean paid order's old pending commission still confirms.
    expect(byId[String(cleanCommissionId)]).toBe('confirmed');
  });
});
