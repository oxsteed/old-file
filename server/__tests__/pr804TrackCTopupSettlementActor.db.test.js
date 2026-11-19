'use strict';

// R-3 (PR #804 Track C): top-up lot creation is broken on databases
// where migration 487 is applied. The webhook settlement posted the
// journal load as actorType 'system', and 487's trigger raises unless
// the actor is an admin with a user id and a real reason, so Stripe-paid
// top-ups never credit. The fix resolves a configured service-admin
// actor from OXSTEED_CREDIT_SERVICE_ADMIN_ID and posts as that admin;
// when unconfigured the current behavior is preserved exactly.
// Reproduction: on this database 487 IS applied, so the unconfigured
// call fails and the top-up stays pending (the 487 error aborts the
// settlement transaction, so the catch block's parking UPDATE cannot
// run either: the call throws 'current transaction is aborted').

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const TEST_DB_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
if (!TEST_DB_URL.includes('/credit_statement_test_pr804_c')) {
  throw new Error('Refusing to run: STATEMENT_TEST_DATABASE_URL must point at credit_statement_test_pr804_c');
}
// The shared jest setup points DATABASE_URL at a dummy; the real pool
// reads DATABASE_URL at require time, so point it at our DB first.
process.env.DATABASE_URL = TEST_DB_URL;
process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS = String(50_000_000_000);

const crypto = require('crypto');
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { ensureAccount } = require('../services/oxsteedCreditService');
const topupService = require('../services/oxsteedCreditTopupService');

describe('R-3 top-up settlement actor (migration 487)', () => {
  let customerId;
  let serviceAdminId;
  let plainCustomerId;
  let walletId;
  let railWasEnabled = null;
  const originalEnv = process.env.OXSTEED_CREDIT_SERVICE_ADMIN_ID;

  async function createUser(tag, role) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, 'synthetic-unusable', 'R3', $3, $4)`,
      [id, `r3-${tag}-${id.slice(0, 8)}@example.invalid`, tag, role]
    );
    return id;
  }

  async function pendingTopup(paymentIntentId) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO oxsteed_credit_topups
         (customer_id, amount_cents, currency_code, status, stripe_payment_intent_id, idempotency_key, expires_at)
       VALUES ($1, 5000, 'USD', 'pending', $2, $3, NOW() + INTERVAL '1 hour')
       RETURNING id`,
      [customerId, paymentIntentId, `r3-${paymentIntentId}`]
    );
    return row.id;
  }

  async function topupStatus(topupId) {
    const { rows: [row] } = await pool.query(
      `SELECT status FROM oxsteed_credit_topups WHERE id = $1`, [topupId]
    );
    return row.status;
  }

  async function walletBalance() {
    const { rows: [row] } = await pool.query(
      `SELECT balance_cents FROM oxsteed_credit_accounts WHERE id = $1`, [walletId]
    );
    return Number(row.balance_cents);
  }

  beforeAll(async () => {
    const { rows: [flag] } = await pool.query(
      `SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`
    );
    railWasEnabled = flag ? flag.is_enabled : null;
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', true, 'R-3 test')
       ON CONFLICT (key) DO UPDATE SET is_enabled = true`
    );
    customerId = await createUser('customer', 'customer');
    serviceAdminId = await createUser('service-admin', 'admin');
    plainCustomerId = await createUser('plain', 'customer');
    await withTransaction(pool, async (client) => {
      const wallet = await ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode: 'USD' });
      walletId = wallet.id;
      await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: 'USD' });
    }, 'r3_setup');
  });

  afterAll(async () => {
    try {
      if (railWasEnabled === null) {
        await pool.query(`DELETE FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
      } else {
        await pool.query(`UPDATE feature_flags SET is_enabled = $1 WHERE key = 'oxsteed_credit_enabled'`, [railWasEnabled]);
      }
    } catch { /* best effort */ }
    if (originalEnv === undefined) delete process.env.OXSTEED_CREDIT_SERVICE_ADMIN_ID;
    else process.env.OXSTEED_CREDIT_SERVICE_ADMIN_ID = originalEnv;
    await pool.end();
  });

  afterEach(() => {
    delete process.env.OXSTEED_CREDIT_SERVICE_ADMIN_ID;
  });

  test('configured service admin: the top-up completes and the journal load carries the admin actor', async () => {
    process.env.OXSTEED_CREDIT_SERVICE_ADMIN_ID = serviceAdminId;
    const paymentIntentId = `pi_r3_ok_${crypto.randomUUID().slice(0, 8)}`;
    const topupId = await pendingTopup(paymentIntentId);
    const result = await topupService.completeCreditTopupFromWebhook({ paymentIntentId });
    expect(result.outcome).toBe('completed');
    expect(result.topupId).toBe(String(topupId));
    expect(await topupStatus(topupId)).toBe('completed');
    expect(await walletBalance()).toBe(5000);
    const { rows: [tx] } = await pool.query(
      `SELECT actor_type, actor_user_id, reason FROM oxsteed_credit_transactions WHERE id = $1`,
      [result.transactionId]
    );
    expect(tx.actor_type).toBe('admin');
    expect(String(tx.actor_user_id)).toBe(String(serviceAdminId));
    expect(tx.reason).toBe('stripe top-up settlement');
    const { rows: lots } = await pool.query(
      `SELECT source, amount_cents FROM oxsteed_credit_balance_lots WHERE customer_id = $1 AND source = 'purchased'`,
      [customerId]
    );
    expect(lots).toHaveLength(1);
    expect(Number(lots[0].amount_cents)).toBe(5000);
  });

  test('unconfigured: the 487 trigger rejects the system actor and the top-up stays pending', async () => {
    const paymentIntentId = `pi_r3_unset_${crypto.randomUUID().slice(0, 8)}`;
    const topupId = await pendingTopup(paymentIntentId);
    // The 487 error aborts the settlement transaction, so the catch
    // block's parking UPDATE cannot run either: the call throws
    // 'current transaction is aborted' and the top-up stays pending
    // (the KNOWN DEFECT noted at the top of
    // completeCreditTopupFromWebhook). No incident is recorded for
    // this path: the rethrow happens before the incident code runs.
    await expect(topupService.completeCreditTopupFromWebhook({ paymentIntentId }))
      .rejects.toThrow('current transaction is aborted');
    expect(await topupStatus(topupId)).toBe('pending');
    expect(await walletBalance()).toBe(5000); // only the configured top-up credited
  });

  test('configured with a nonexistent user id: falls back to the system actor and 487 rejects it', async () => {
    process.env.OXSTEED_CREDIT_SERVICE_ADMIN_ID = crypto.randomUUID();
    const paymentIntentId = `pi_r3_nope_${crypto.randomUUID().slice(0, 8)}`;
    const topupId = await pendingTopup(paymentIntentId);
    await expect(topupService.completeCreditTopupFromWebhook({ paymentIntentId }))
      .rejects.toThrow('current transaction is aborted');
    expect(await topupStatus(topupId)).toBe('pending');
  });

  test('configured with a non-admin user: falls back to the system actor and 487 rejects it', async () => {
    process.env.OXSTEED_CREDIT_SERVICE_ADMIN_ID = plainCustomerId;
    const paymentIntentId = `pi_r3_plain_${crypto.randomUUID().slice(0, 8)}`;
    const topupId = await pendingTopup(paymentIntentId);
    await expect(topupService.completeCreditTopupFromWebhook({ paymentIntentId }))
      .rejects.toThrow('current transaction is aborted');
    expect(await topupStatus(topupId)).toBe('pending');
  });
});
