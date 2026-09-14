#!/usr/bin/env node
'use strict';

/**
 * Runs a destructive Credit race against a disposable database. The caller
 * must restore a production-shaped dump into that database before invoking
 * this script; the database name guard prevents accidental live execution.
 */

const crypto = require('crypto');
const { Pool } = require('pg');
const Redis = require('ioredis');

const databaseUrl = String(process.env.DATABASE_URL || '');
const databaseName = (() => {
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, '').split('?')[0];
  } catch {
    return '';
  }
})();

if (process.env.CREDIT_CONCURRENCY_TEST_MODE !== 'true' || !/^oxsteed_(verify|concurrency)_/.test(databaseName)) {
  console.error('Refusing to run Credit concurrency verification outside an isolated oxsteed_verify_* database.');
  process.exit(1);
}

if (!databaseUrl || !process.env.REDIS_URL) {
  console.error('DATABASE_URL and REDIS_URL are required for Credit concurrency verification.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, ssl: false });
const redis = new Redis(process.env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});
const customerId = crypto.randomUUID();
const adminId = crypto.randomUUID();
let partnerId;
let restaurantId;
let businessId;
let agreementId;

async function query(text, values = []) {
  return pool.query(text, values);
}

async function createFixtures() {
  await query('BEGIN');
  try {
    await query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, $3, 'Credit', 'Verifier', 'super_admin', TRUE, TRUE),
              ($4, $5, $3, 'Concurrency', 'Customer', 'customer', TRUE, TRUE)`,
      [adminId, `credit-verifier-${adminId}@example.invalid`, 'isolated-test-password-hash', customerId, `credit-customer-${customerId}@example.invalid`]
    );
    const business = await query(
      `INSERT INTO businesses (user_id, business_name, is_active)
       VALUES ($1, $2, TRUE)
       RETURNING id`,
      [adminId, `Credit concurrency business ${adminId}`]
    );
    businessId = business.rows[0].id;
    const restaurant = await query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, address_city, address_state,
          address_zip, address_country, currency_code, status)
       VALUES ($1, $2, $3, 'Springfield', 'OH', '45501', 'US', 'USD', 'active')
       RETURNING id`,
      [businessId, adminId, `Credit concurrency restaurant ${adminId}`]
    );
    restaurantId = restaurant.rows[0].id;
    const partner = await query(
      `INSERT INTO oxsteed_credit_partners
         (restaurant_id, business_id, status, settlement_currency_code, created_by)
       VALUES ($1, $2, 'active', 'USD', $3)
       RETURNING id`,
      [restaurantId, businessId, adminId]
    );
    partnerId = partner.rows[0].id;
    const agreement = await query(
      `INSERT INTO oxsteed_credit_partner_agreements
         (partner_id, version, status, starts_at, allowed_order_types,
          geography, max_transaction_cents, requires_customer_entitlement,
          created_by, approved_by)
       VALUES ($1, 1, 'active', NOW() - INTERVAL '1 minute', ARRAY['pickup']::text[],
               '{}'::jsonb, 100000, FALSE, $2, $2)
       RETURNING id`,
      [partnerId, adminId]
    );
    agreementId = agreement.rows[0].id;
    await query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', TRUE, 'isolated Credit concurrency verification')
       ON CONFLICT (key) DO UPDATE SET is_enabled = TRUE`,
    );
    await query('COMMIT');
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
}

async function run() {
  await redis.connect();
  const redisStatus = await redis.ping();
  if (redisStatus !== 'PONG') throw new Error(`Redis ping failed: ${redisStatus}`);

  await createFixtures();

  const { loadCustomerCredit, purchaseWithCredit } = require('../services/oxsteedCreditService');
  await loadCustomerCredit({
    customerId,
    amountCents: 2000,
    currencyCode: 'USD',
    idempotencyKey: `credit-concurrency-load-${customerId}`,
    actorUserId: adminId,
    reason: 'Isolated concurrency verification load',
    referenceType: 'isolated_funding',
    referenceId: `funding-${customerId}`,
  });

  const spend = (idempotencyKey, amountCents = 1500) => purchaseWithCredit({
    customerId,
    partnerId,
    agreementId,
    amountCents,
    currencyCode: 'USD',
    idempotencyKey,
    actorUserId: customerId,
    actorType: 'customer',
    orderType: 'pickup',
    referenceType: 'concurrency-test',
    referenceId: idempotencyKey,
    description: 'Isolated concurrent purchase',
  });

  const raced = await Promise.allSettled([
    spend(`credit-concurrency-race-a-${customerId}`),
    spend(`credit-concurrency-race-b-${customerId}`),
  ]);
  const successfulRaces = raced.filter((result) => result.status === 'fulfilled');
  const rejectedRaces = raced.filter((result) => result.status === 'rejected');
  if (successfulRaces.length !== 1 || rejectedRaces.length !== 1) {
    throw new Error(`Expected one successful and one rejected concurrent spend; got ${successfulRaces.length}/${rejectedRaces.length}`);
  }

  const replayKey = `credit-concurrency-replay-${customerId}`;
  const replays = await Promise.all([spend(replayKey, 200), spend(replayKey, 200)].map(async (result) => result));
  if (replays.length !== 2 || String(replays[0].transaction.id) !== String(replays[1].transaction.id)) {
    throw new Error('Idempotent concurrent replay did not return the same transaction');
  }

  const { rows: beforeFailureRows } = await query(
    `SELECT balance_cents, reserved_cents
       FROM oxsteed_credit_accounts
      WHERE account_type = 'customer_wallet' AND customer_id = $1 AND currency_code = 'USD'`,
    [customerId]
  );
  const { rows: beforeFailureTransactions } = await query(
    `SELECT COUNT(*) FILTER (WHERE transaction_type = 'purchase')::int AS transaction_count
       FROM oxsteed_credit_transactions
      WHERE idempotency_key LIKE $1`,
    [`credit-concurrency-%-${customerId}`]
  );
  const failureKey = `credit-concurrency-failure-${customerId}`;
  const failedPurchase = await Promise.allSettled([spend(failureKey, 500)]);
  if (failedPurchase.length !== 1 || failedPurchase[0].status !== 'rejected') {
    throw new Error('Insufficient-funds failure injection unexpectedly succeeded');
  }

  const { rows: accountRows } = await query(
    `SELECT balance_cents, reserved_cents
       FROM oxsteed_credit_accounts
      WHERE account_type = 'customer_wallet' AND customer_id = $1 AND currency_code = 'USD'`,
    [customerId]
  );
  const { rows: transactionRows } = await query(
    `SELECT COUNT(*) FILTER (WHERE transaction_type = 'purchase')::int AS purchase_count,
            COALESCE(SUM(amount_cents) FILTER (WHERE transaction_type = 'purchase'), 0)::int AS purchase_total
       FROM oxsteed_credit_transactions
      WHERE idempotency_key LIKE $1`,
    [`credit-concurrency-%-${customerId}`]
  );
  const account = accountRows[0];
  const transactions = transactionRows[0];
  const beforeFailureAccount = beforeFailureRows[0];
  const beforeFailureTransaction = beforeFailureTransactions[0];
  if (!account || Number(account.balance_cents) !== 300 || Number(account.reserved_cents) !== 0) {
    throw new Error(`Unexpected final customer balance/reservation: ${JSON.stringify(account)}`);
  }
  if (Number(transactions.purchase_count) !== 2 || Number(transactions.purchase_total) !== 1700) {
    throw new Error(`Unexpected purchase journal totals: ${JSON.stringify(transactions)}`);
  }
  if (!beforeFailureAccount
    || Number(beforeFailureAccount.balance_cents) !== Number(account.balance_cents)
    || Number(beforeFailureAccount.reserved_cents) !== Number(account.reserved_cents)
    || Number(beforeFailureTransaction?.transaction_count) !== Number(transactions.purchase_count)) {
    throw new Error('Rejected insufficient-funds purchase changed Credit state');
  }

  console.log(JSON.stringify({
    ok: true,
    database: databaseName,
    redis: redisStatus,
    concurrentSpend: { successful: successfulRaces.length, rejected: rejectedRaces.length },
    idempotentReplay: { calls: replays.length, sharedTransaction: true },
    failureRecovery: {
      rejectedInsufficientFunds: true,
      stateUnchanged: true,
    },
    finalCustomerAccount: {
      balanceCents: Number(account.balance_cents),
      reservedCents: Number(account.reserved_cents),
    },
    purchaseJournal: {
      transactionCount: Number(transactions.purchase_count),
      totalCents: Number(transactions.purchase_total),
    },
  }, null, 2));
}

run()
  .catch((error) => {
    console.error(`Credit concurrency verification failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await redis.quit().catch(() => {});
    await pool.end().catch(() => {});
  });
