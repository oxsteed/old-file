#!/usr/bin/env node
'use strict';

/**
 * Measures bounded Credit reads and writes against a disposable database.
 * The database name and explicit test-mode flag prevent accidental live runs.
 */

const crypto = require('crypto');
const { performance } = require('node:perf_hooks');
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

if (process.env.CREDIT_PERFORMANCE_TEST_MODE !== 'true' || !/^oxsteed_(verify|performance)_/.test(databaseName)) {
  console.error('Refusing to run Credit performance verification outside an isolated oxsteed_verify_* database.');
  process.exit(1);
}

if (!databaseUrl || !process.env.REDIS_URL) {
  console.error('DATABASE_URL and REDIS_URL are required for Credit performance verification.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 10 });
const redis = new Redis(process.env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});
const customerIds = Array.from({ length: 8 }, () => crypto.randomUUID());
const customerId = customerIds[0];
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
       VALUES ($1, $2, $3, 'Credit', 'Benchmark', 'super_admin', TRUE, TRUE)`,
      [adminId, `credit-performance-${adminId}@example.invalid`, 'isolated-test-password-hash']
    );
    for (const benchmarkCustomerId of customerIds) {
      await query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, $3, 'Performance', 'Customer', 'customer', TRUE, TRUE)`,
        [benchmarkCustomerId, `credit-performance-customer-${benchmarkCustomerId}@example.invalid`, 'isolated-test-password-hash']
      );
    }
    const business = await query(
      `INSERT INTO businesses (user_id, business_name, is_active)
       VALUES ($1, $2, TRUE)
       RETURNING id`,
      [adminId, `Credit performance business ${adminId}`]
    );
    businessId = business.rows[0].id;
    const restaurant = await query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, address_city, address_state,
          address_zip, address_country, currency_code, status)
       VALUES ($1, $2, $3, 'Springfield', 'OH', '45501', 'US', 'USD', 'active')
       RETURNING id`,
      [businessId, adminId, `Credit performance restaurant ${adminId}`]
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
       VALUES ('oxsteed_credit_enabled', TRUE, 'isolated Credit performance verification')
       ON CONFLICT (key) DO UPDATE SET is_enabled = TRUE`,
    );
    await query('COMMIT');
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
}

async function timed(label, operation) {
  const startedAt = performance.now();
  try {
    await operation();
    return { label, ok: true, durationMs: Number((performance.now() - startedAt).toFixed(2)) };
  } catch (error) {
    return { label, ok: false, durationMs: Number((performance.now() - startedAt).toFixed(2)), error: error.message };
  }
}

function percentile(samples, percentileRank) {
  const ordered = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const index = Math.min(ordered.length - 1, Math.ceil((percentileRank / 100) * ordered.length) - 1);
  return ordered[index];
}

function summarize(label, samples, thresholdMs) {
  const failed = samples.filter((sample) => !sample.ok);
  const summary = {
    requests: samples.length,
    failed: failed.length,
    p50Ms: percentile(samples, 50),
    p95Ms: percentile(samples, 95),
    maxMs: samples.length ? Math.max(...samples.map((sample) => sample.durationMs)) : null,
    thresholdMs,
  };
  if (failed.length) throw new Error(`${label} had ${failed.length} failed requests: ${failed[0].error}`);
  if (summary.p95Ms > thresholdMs) throw new Error(`${label} p95 ${summary.p95Ms}ms exceeded ${thresholdMs}ms`);
  return summary;
}

async function run() {
  await redis.connect();
  const redisStatus = await redis.ping();
  if (redisStatus !== 'PONG') throw new Error(`Redis ping failed: ${redisStatus}`);

  await createFixtures();
  // pg_restore does not include planner statistics. Refresh the disposable
  // database so this measures the workload, not a known restore artifact.
  await query(`ANALYZE users, food_restaurants, oxsteed_credit_partners,
                      oxsteed_credit_partner_agreements, oxsteed_credit_accounts,
                      oxsteed_credit_transactions, oxsteed_credit_transaction_entries,
                      oxsteed_credit_holds`);
  const { loadCustomerCredit, purchaseWithCredit, getCustomerCreditAccount, getCustomerCreditEligibility, listCustomerCreditTransactions } = require('../services/oxsteedCreditService');
  for (const benchmarkCustomerId of customerIds) {
    await loadCustomerCredit({
      customerId: benchmarkCustomerId,
      amountCents: 10000,
      currencyCode: 'USD',
      idempotencyKey: `credit-performance-load-${benchmarkCustomerId}`,
      actorUserId: adminId,
      reason: 'Isolated Credit performance verification load',
      referenceType: 'isolated_funding',
      referenceId: `funding-${benchmarkCustomerId}`,
    });
  }
  const { rows: fixtureRows } = await query(
    `SELECT COUNT(*) FILTER (WHERE u.role = 'customer' AND u.is_active = TRUE) AS active_customers,
            COUNT(a.id) AS customer_wallets
       FROM users u
       LEFT JOIN oxsteed_credit_accounts a
         ON a.customer_id = u.id
        AND a.account_type = 'customer_wallet'
        AND a.currency_code = 'USD'
      WHERE u.id = ANY($1::uuid[])`,
    [customerIds]
  );
  if (Number(fixtureRows[0]?.active_customers || 0) !== customerIds.length
    || Number(fixtureRows[0]?.customer_wallets || 0) !== customerIds.length) {
    throw new Error(`Performance fixture visibility check failed: ${JSON.stringify(fixtureRows[0] || {})}`);
  }

  const accountReads = await Promise.all(Array.from({ length: 10 }, () => timed('accountRead', () => getCustomerCreditAccount(customerId, 'USD'))));
  const transactionReads = await Promise.all(Array.from({ length: 10 }, () => timed('transactionRead', () => listCustomerCreditTransactions(customerId, { limit: 25, offset: 0, currencyCode: 'USD' }))));
  const eligibilityReads = await Promise.all(Array.from({ length: 10 }, () => timed('eligibilityRead', () => getCustomerCreditEligibility({
    customerId,
    restaurantId,
    currencyCode: 'USD',
    amountCents: 100,
    orderType: 'pickup',
  }))));
  const purchases = await Promise.all(customerIds.map((benchmarkCustomerId, index) => timed('purchaseWrite', () => purchaseWithCredit({
    customerId: benchmarkCustomerId,
    partnerId,
    agreementId,
    amountCents: 10,
    currencyCode: 'USD',
    idempotencyKey: `credit-performance-purchase-${benchmarkCustomerId}-${index}`,
    actorUserId: benchmarkCustomerId,
    actorType: 'customer',
    orderType: 'pickup',
    referenceType: 'performance-test',
    referenceId: `performance-${benchmarkCustomerId}-${index}`,
    description: 'Isolated Credit performance purchase',
  }))));

  const summaries = {
    accountRead: summarize('accountRead', accountReads, 3000),
    transactionRead: summarize('transactionRead', transactionReads, 2500),
    eligibilityRead: summarize('eligibilityRead', eligibilityReads, 2000),
    // Purchases intentionally share one partner-payable account. The ledger
    // row lock keeps that balance exact, so this threshold captures bounded
    // serialized settlement rather than pretending those writes are independent.
    purchaseWrite: summarize('purchaseWrite', purchases, 10000),
  };
  const accounts = await Promise.all(customerIds.map((benchmarkCustomerId) => getCustomerCreditAccount(benchmarkCustomerId, 'USD')));
  if (accounts.some((account) => account.balanceCents !== 9990 || account.reservedCents !== 0)) {
    throw new Error(`Unexpected benchmark balances: ${JSON.stringify(accounts.map(({ balanceCents, reservedCents }) => ({ balanceCents, reservedCents })))}`);
  }

  console.log(JSON.stringify({
    ok: true,
    database: databaseName,
    redis: redisStatus,
    workload: { accountReads: 10, transactionReads: 10, eligibilityReads: 10, purchases: 8 },
    summaries,
    finalCustomerAccounts: { count: accounts.length, balanceCentsEach: 9990, reservedCentsEach: 0 },
  }, null, 2));
}

run()
  .catch((error) => {
    console.error(`Credit performance verification failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await redis.quit().catch(() => {});
    await pool.end().catch(() => {});
  });
