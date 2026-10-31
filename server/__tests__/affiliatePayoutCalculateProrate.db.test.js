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

jest.mock('stripe', () => () => ({ transfers: { create: jest.fn() } }));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/sanctionsScreeningService', () => ({ assertSanctionsClear: jest.fn().mockResolvedValue({ cleared: false }) }));

const pool = require('../db');
const { calculateAndCreatePayout } = require('../controllers/affiliatePayoutsController');

test('affiliate payout pro-rate DB suite requires explicit synthetic disposable database opt-in', () => {
  expect(permitted).toBe(Boolean(databaseUrl && permitted));
});

dbDescribe('payout calculate pro-rates partially refunded orders on the kept share', () => {
  let customerId;
  let helperId;
  let programId;
  let productId;
  let partialOrderId;
  let cleanOrderId;
  let fullOrderId;
  let nullGuardOrderId;
  let partialCommissionId;
  let cleanCommissionId;
  let fullCommissionId;
  let nullGuardCommissionId;

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
    async function makeCommission(orderId, sale, rate, stored) {
      const { rows: [c] } = await pool.query(
        `INSERT INTO affiliate_commissions
           (order_id, affiliate_program_id, product_id, commission_cents, commission_rate,
            product_sale_amount_cents, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         RETURNING id`,
        [orderId, programId, productId, stored, rate, sale]
      );
      return c.id;
    }

    // Partial: sale 10000 at 10% = 1000 stored; 4000 refunded -> kept 6000 -> 600.
    partialOrderId = await makeOrder('paid');
    partialCommissionId = await makeCommission(partialOrderId, 10000, 10, 1000);
    const { rows: [txn] } = await pool.query(
      `INSERT INTO marketplace_transactions(order_id, payment_intent_id, amount_cents, status)
       VALUES ($1, $2, 10000, 'succeeded') RETURNING id`,
      [partialOrderId, `pi_synth_${tag}`]
    );
    await pool.query(
      `INSERT INTO marketplace_transaction_refunds
         (order_id, transaction_id, payment_intent_id, amount_cents, reason, idempotency_key, status)
       VALUES ($1, $2, $3, 4000, 'synthetic partial refund', $4, 'succeeded')`,
      [partialOrderId, txn.id, `pi_synth_${tag}`, `refund-${tag}`]
    );

    // Clean: no refunds, stored commission stands.
    cleanOrderId = await makeOrder('paid');
    cleanCommissionId = await makeCommission(cleanOrderId, 10000, 10, 1000);

    // Fully refunded: excluded entirely by the item-42 predicate.
    fullOrderId = await makeOrder('refunded');
    fullCommissionId = await makeCommission(fullOrderId, 10000, 10, 1000);

    // Uncomputable: succeeded refund exists but rate and sale are NULL,
    // so the kept commission cannot be derived exactly. Must stay pending.
    nullGuardOrderId = await makeOrder('paid');
    nullGuardCommissionId = await makeCommission(nullGuardOrderId, null, null, 1000);
    const { rows: [txn2] } = await pool.query(
      `INSERT INTO marketplace_transactions(order_id, payment_intent_id, amount_cents, status)
       VALUES ($1, $2, 10000, 'succeeded') RETURNING id`,
      [nullGuardOrderId, `pi_synth_${tag}-2`]
    );
    await pool.query(
      `INSERT INTO marketplace_transaction_refunds
         (order_id, transaction_id, payment_intent_id, amount_cents, reason, idempotency_key, status)
       VALUES ($1, $2, $3, 1000, 'synthetic partial refund', $4, 'succeeded')`,
      [nullGuardOrderId, txn2.id, `pi_synth_${tag}-2`, `refund-${tag}-2`]
    );
  }, 120000);

  afterAll(async () => {
    await pool.query(`DELETE FROM affiliate_payouts WHERE affiliate_program_id = $1`, [programId]);
    await pool.query(
      `DELETE FROM affiliate_commissions WHERE id IN ($1, $2, $3, $4)`,
      [partialCommissionId, cleanCommissionId, fullCommissionId, nullGuardCommissionId]
    );
    await pool.query(`DELETE FROM marketplace_transaction_refunds WHERE order_id IN ($1, $2)`, [partialOrderId, nullGuardOrderId]);
    await pool.query(`DELETE FROM marketplace_transactions WHERE order_id IN ($1, $2)`, [partialOrderId, nullGuardOrderId]);
    await pool.query(
      `DELETE FROM marketplace_orders WHERE id IN ($1, $2, $3, $4)`,
      [partialOrderId, cleanOrderId, fullOrderId, nullGuardOrderId]
    );
    await pool.query(`DELETE FROM affiliate_programs WHERE id = $1`, [programId]);
    await pool.query(`DELETE FROM marketplace_products WHERE id = $1`, [productId]);
    // Synthetic users are intentionally left behind: deleting users rows is
    // blocked schema-wide by the food_customer_wallet_ledger append-only
    // rewrite rule (known platform gap). Their tagged emails never collide.
    await pool.end();
  });

  test('partial pays on kept share, clean pays in full, refunded and uncomputable stay pending', async () => {
    const res = { json: jest.fn() };
    const next = jest.fn();
    await calculateAndCreatePayout(
      { user: { id: helperId }, body: { programId, periodStart: '2000-01-01', periodEnd: '2100-01-01' } },
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const payout = res.json.mock.calls[0][0].data;
    // 600 (partial kept share) + 1000 (clean) = 1600 across 2 claimed rows.
    expect(Number(payout.total_commission_cents)).toBe(1600);
    expect(Number(payout.commission_count)).toBe(2);

    const { rows } = await pool.query(
      `SELECT id, status, payout_id, commission_cents FROM affiliate_commissions
       WHERE id IN ($1, $2, $3, $4)`,
      [partialCommissionId, cleanCommissionId, fullCommissionId, nullGuardCommissionId]
    );
    const byId = Object.fromEntries(rows.map((r) => [String(r.id), r]));
    expect(byId[String(partialCommissionId)].status).toBe('confirmed');
    expect(String(byId[String(partialCommissionId)].payout_id)).toBe(String(payout.id));
    // Claimed rows keep their original stored commission; the payout row
    // carries the pro-rated total actually paid.
    expect(Number(byId[String(partialCommissionId)].commission_cents)).toBe(1000);
    expect(byId[String(cleanCommissionId)].status).toBe('confirmed');
    expect(String(byId[String(cleanCommissionId)].payout_id)).toBe(String(payout.id));
    expect(byId[String(fullCommissionId)].status).toBe('pending');
    expect(byId[String(fullCommissionId)].payout_id).toBeNull();
    expect(byId[String(nullGuardCommissionId)].status).toBe('pending');
    expect(byId[String(nullGuardCommissionId)].payout_id).toBeNull();
  });
});
