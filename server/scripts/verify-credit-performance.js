#!/usr/bin/env node
'use strict';

/**
 * Measures bounded Credit reads and writes against a disposable database.
 * The database name and explicit test-mode flag prevent accidental live runs.
 */

const crypto = require('crypto');
const fs = require('node:fs');
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

const isolatedHarnessProject = /^oxsteed-credit-test-[a-z0-9-]+$/.test(process.env.CREDIT_TEST_PROJECT || '');
const isolatedDatabase = /^oxsteed_(verify|performance)_/.test(databaseName) || isolatedHarnessProject;
if (process.env.CREDIT_PERFORMANCE_TEST_MODE !== 'true' || !isolatedDatabase) {
  console.error('Refusing to run Credit performance verification outside an isolated oxsteed_verify_*, oxsteed_performance_*, or credit-test harness database.');
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
const readSampleCount = Number.parseInt(process.env.CREDIT_PERFORMANCE_READ_SAMPLES || '10', 10);
const purchaseCount = Number.parseInt(process.env.CREDIT_PERFORMANCE_PURCHASES || String(customerIds.length), 10);
const concurrency = Number.parseInt(process.env.CREDIT_PERFORMANCE_CONCURRENCY || '10', 10);
const sustainedDurationMs = Number.parseInt(process.env.CREDIT_PERFORMANCE_DURATION_MS || '0', 10);
const partnerCount = Number.parseInt(process.env.CREDIT_PERFORMANCE_PARTNERS || '1', 10);
if (!Number.isInteger(readSampleCount) || readSampleCount < 10 || readSampleCount > 500) {
  console.error('CREDIT_PERFORMANCE_READ_SAMPLES must be an integer from 10 through 500.');
  process.exit(1);
}
if (!Number.isInteger(purchaseCount) || purchaseCount < 1 || purchaseCount > 200) {
  console.error('CREDIT_PERFORMANCE_PURCHASES must be an integer from 1 through 200.');
  process.exit(1);
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
  console.error('CREDIT_PERFORMANCE_CONCURRENCY must be an integer from 1 through 10.');
  process.exit(1);
}
if (!Number.isInteger(sustainedDurationMs) || sustainedDurationMs < 0 || sustainedDurationMs > 120000) {
  console.error('CREDIT_PERFORMANCE_DURATION_MS must be an integer from 0 through 120000.');
  process.exit(1);
}
if (!Number.isInteger(partnerCount) || partnerCount < 1 || partnerCount > 4) {
  console.error('CREDIT_PERFORMANCE_PARTNERS must be an integer from 1 through 4.');
  process.exit(1);
}
if (partnerCount > purchaseCount) {
  console.error('CREDIT_PERFORMANCE_PARTNERS cannot exceed CREDIT_PERFORMANCE_PURCHASES.');
  process.exit(1);
}
const adminId = crypto.randomUUID();
const partnerFixtures = [];

async function query(text, values = []) {
  return pool.query(text, values);
}

async function createFixtures() {
  const client = await pool.connect();
  const execute = (text, values = []) => client.query(text, values);
  try {
    await execute('BEGIN');
    await execute(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, $3, 'Credit', 'Benchmark', 'super_admin', TRUE, TRUE)`,
      [adminId, `credit-performance-${adminId}@example.invalid`, 'isolated-test-password-hash']
    );
    for (const benchmarkCustomerId of customerIds) {
      await execute(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, $3, 'Performance', 'Customer', 'customer', TRUE, TRUE)`,
        [benchmarkCustomerId, `credit-performance-customer-${benchmarkCustomerId}@example.invalid`, 'isolated-test-password-hash']
      );
    }
    for (let index = 0; index < partnerCount; index += 1) {
      const business = await execute(
        `INSERT INTO businesses (user_id, business_name, is_active)
         VALUES ($1, $2, TRUE)
         RETURNING id`,
        [adminId, `Credit performance business ${adminId}-${index + 1}`]
      );
      const businessId = business.rows[0].id;
      const restaurant = await execute(
        `INSERT INTO food_restaurants
           (business_id, owner_user_id, display_name, address_city, address_state,
            address_zip, address_country, currency_code, status)
         VALUES ($1, $2, $3, 'Springfield', 'OH', '45501', 'US', 'USD', 'active')
         RETURNING id`,
        [businessId, adminId, `Credit performance restaurant ${adminId}-${index + 1}`]
      );
      const restaurantId = restaurant.rows[0].id;
      const partner = await execute(
        `INSERT INTO oxsteed_credit_partners
           (restaurant_id, business_id, status, settlement_currency_code, created_by)
         VALUES ($1, $2, 'active', 'USD', $3)
         RETURNING id`,
        [restaurantId, businessId, adminId]
      );
      const partnerId = partner.rows[0].id;
      const agreement = await execute(
        `INSERT INTO oxsteed_credit_partner_agreements
           (partner_id, version, status, starts_at, allowed_order_types,
            geography, max_transaction_cents, requires_customer_entitlement,
            created_by, approved_by)
         VALUES ($1, 1, 'active', NOW() - INTERVAL '1 minute', ARRAY['pickup']::text[],
                 '{}'::jsonb, 100000, FALSE, $2, $2)
         RETURNING id`,
        [partnerId, adminId]
      );
      partnerFixtures.push({
        businessId,
        restaurantId,
        partnerId,
        agreementId: agreement.rows[0].id,
      });
    }
    await execute(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', TRUE, 'isolated Credit performance verification')
       ON CONFLICT (key) DO UPDATE SET is_enabled = TRUE`,
    );
    await execute('COMMIT');
  } catch (error) {
    await execute('ROLLBACK');
    throw error;
  } finally {
    client.release();
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

async function runConcurrent(count, operation) {
  const results = new Array(count);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < count) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker));
  return results;
}

async function collectSamples(sampleCount, operation, durationMs = 0) {
  const startedAt = performance.now();
  const deadline = durationMs > 0 ? startedAt + durationMs : null;
  const samples = [];
  let rounds = 0;
  do {
    samples.push(...await runConcurrent(sampleCount, operation));
    rounds += 1;
  } while (deadline && performance.now() < deadline);
  return {
    samples,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    rounds,
  };
}

function percentile(samples, percentileRank) {
  const ordered = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const index = Math.min(ordered.length - 1, Math.ceil((percentileRank / 100) * ordered.length) - 1);
  return ordered[index];
}

function summarize(label, samples, thresholdMs, workload = {}) {
  const failed = samples.filter((sample) => !sample.ok);
  const summary = {
    requests: samples.length,
    failed: failed.length,
    errorRatePct: samples.length ? Number(((failed.length / samples.length) * 100).toFixed(2)) : 0,
    p50Ms: percentile(samples, 50),
    p95Ms: percentile(samples, 95),
    maxMs: samples.length ? Math.max(...samples.map((sample) => sample.durationMs)) : null,
    thresholdMs,
    elapsedMs: workload.elapsedMs ?? null,
    rounds: workload.rounds ?? 0,
  };
  return summary;
}

function resourceSnapshot() {
  const memory = process.memoryUsage();
  const usage = process.resourceUsage();
  return {
    rssMb: Number((memory.rss / 1024 / 1024).toFixed(2)),
    heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(2)),
    externalMb: Number((memory.external / 1024 / 1024).toFixed(2)),
    maxRssMb: Number((usage.maxRSS / 1024).toFixed(2)),
    userCpuMs: Number((usage.userCPUTime / 1000).toFixed(2)),
    systemCpuMs: Number((usage.systemCPUTime / 1000).toFixed(2)),
  };
}

function readNumericFile(paths) {
  for (const filePath of paths) {
    try {
      const value = Number.parseInt(fs.readFileSync(filePath, 'utf8').trim(), 10);
      if (Number.isFinite(value)) return value;
    } catch {
      // The verifier also runs outside a container during source-level tests.
    }
  }
  return null;
}

function containerResourceSnapshot() {
  const memoryCurrentBytes = readNumericFile(['/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory/memory.usage_in_bytes']);
  const memoryPeakBytes = readNumericFile(['/sys/fs/cgroup/memory.peak', '/sys/fs/cgroup/memory/memory.max_usage_in_bytes']);
  let cpuUsageUsec = null;
  let cpuUserUsec = null;
  let cpuSystemUsec = null;
  try {
    const cpuStat = fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8');
    for (const line of cpuStat.split('\n')) {
      const [key, rawValue] = line.trim().split(/\s+/);
      const value = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(value)) continue;
      if (key === 'usage_usec') cpuUsageUsec = value;
      if (key === 'user_usec') cpuUserUsec = value;
      if (key === 'system_usec') cpuSystemUsec = value;
    }
  } catch {
    // No cgroup CPU file is available in a non-container execution.
  }
  const measured = [memoryCurrentBytes, memoryPeakBytes, cpuUsageUsec, cpuUserUsec, cpuSystemUsec].some((value) => value !== null);
  return {
    measured,
    memoryCurrentMb: memoryCurrentBytes === null ? null : Number((memoryCurrentBytes / 1024 / 1024).toFixed(2)),
    memoryPeakMb: memoryPeakBytes === null ? null : Number((memoryPeakBytes / 1024 / 1024).toFixed(2)),
    cpuUsageUsec,
    cpuUserUsec,
    cpuSystemUsec,
  };
}

function deltaSnapshot(before, after) {
  return Object.fromEntries(Object.keys(after)
    .filter((key) => typeof before[key] === 'number' && typeof after[key] === 'number')
    .map((key) => [key, Number((after[key] - before[key]).toFixed(2))]));
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

  const resourcesBeforeWorkload = resourceSnapshot();
  const containerResourcesBeforeWorkload = containerResourceSnapshot();
  const accountReadWorkload = await collectSamples(readSampleCount, () => timed('accountRead', () => getCustomerCreditAccount(customerId, 'USD')), sustainedDurationMs);
  const transactionReadWorkload = await collectSamples(readSampleCount, () => timed('transactionRead', () => listCustomerCreditTransactions(customerId, { limit: 25, offset: 0, currencyCode: 'USD' })), sustainedDurationMs);
  const eligibilityReadWorkload = await collectSamples(readSampleCount, () => timed('eligibilityRead', () => getCustomerCreditEligibility({
    customerId,
    restaurantId: partnerFixtures[0].restaurantId,
    currencyCode: 'USD',
    amountCents: 100,
    orderType: 'pickup',
  })), sustainedDurationMs);
  const purchaseCustomerIds = Array.from({ length: purchaseCount }, (_, index) => customerIds[index % customerIds.length]);
  const purchaseWorkload = await collectSamples(purchaseCount, (index) => {
    const benchmarkCustomerId = purchaseCustomerIds[index];
    const partnerFixture = partnerFixtures[index % partnerFixtures.length];
    return timed('purchaseWrite', () => purchaseWithCredit({
      customerId: benchmarkCustomerId,
      partnerId: partnerFixture.partnerId,
      agreementId: partnerFixture.agreementId,
      amountCents: 10,
      currencyCode: 'USD',
      idempotencyKey: `credit-performance-purchase-${benchmarkCustomerId}-${index}`,
      actorUserId: benchmarkCustomerId,
      actorType: 'customer',
      orderType: 'pickup',
      referenceType: 'performance-test',
      referenceId: `performance-${benchmarkCustomerId}-${index}`,
      description: 'Isolated Credit performance purchase',
    }));
  });

  const summaries = {
    accountRead: summarize('accountRead', accountReadWorkload.samples, 3000, accountReadWorkload),
    transactionRead: summarize('transactionRead', transactionReadWorkload.samples, 2500, transactionReadWorkload),
    eligibilityRead: summarize('eligibilityRead', eligibilityReadWorkload.samples, 2000, eligibilityReadWorkload),
    // A single fixture intentionally shares one payable account by default.
    // Multi-partner mode proves independent restaurant ledgers under the same
    // bounded concurrent workload.
    purchaseWrite: summarize('purchaseWrite', purchaseWorkload.samples, 10000, purchaseWorkload),
  };
  const summaryFailures = Object.entries(summaries).flatMap(([label, summary]) => [
    ...(summary.failed ? [`${label} had ${summary.failed} failed requests`] : []),
    ...(summary.p95Ms > summary.thresholdMs ? [`${label} p95 ${summary.p95Ms}ms exceeded ${summary.thresholdMs}ms`] : []),
  ]);
  if (summaryFailures.length) {
    console.error(JSON.stringify({ ok: false, summaries }, null, 2));
    throw new Error(summaryFailures.join('; '));
  }
  const accounts = await Promise.all(customerIds.map((benchmarkCustomerId) => getCustomerCreditAccount(benchmarkCustomerId, 'USD')));
  const purchaseCountByCustomer = new Map(customerIds.map((id) => [id, 0]));
  purchaseCustomerIds.forEach((id) => purchaseCountByCustomer.set(id, purchaseCountByCustomer.get(id) + 1));
  if (accounts.some((account, index) => account.balanceCents !== 10000 - purchaseCountByCustomer.get(customerIds[index]) * 10 || account.reservedCents !== 0)) {
    throw new Error(`Unexpected benchmark balances: ${JSON.stringify(accounts.map(({ balanceCents, reservedCents }, index) => ({ balanceCents, reservedCents, expectedBalanceCents: 10000 - purchaseCountByCustomer.get(customerIds[index]) * 10 })))}`);
  }
  const partnerPurchaseCounts = new Map(partnerFixtures.map(({ partnerId }) => [String(partnerId), 0]));
  for (let index = 0; index < purchaseCount; index += 1) {
    const partnerFixture = partnerFixtures[index % partnerFixtures.length];
    const key = String(partnerFixture.partnerId);
    partnerPurchaseCounts.set(key, partnerPurchaseCounts.get(key) + 1);
  }
  const { rows: partnerPayableRows } = await query(
    `SELECT partner_id, balance_cents, reserved_cents
       FROM oxsteed_credit_accounts
      WHERE account_type = 'partner_payable'
        AND partner_id = ANY($1::bigint[])
      ORDER BY partner_id`,
    [partnerFixtures.map(({ partnerId }) => partnerId)]
  );
  if (partnerPayableRows.length !== partnerFixtures.length
    || partnerPayableRows.some((row) => Number(row.balance_cents) !== partnerPurchaseCounts.get(String(row.partner_id)) * 10
      || Number(row.reserved_cents) !== 0)) {
    throw new Error(`Unexpected partner payable balances: ${JSON.stringify(partnerPayableRows)}`);
  }

  const resourcesAfterWorkload = resourceSnapshot();
  const containerResourcesAfterWorkload = containerResourceSnapshot();

  console.log(JSON.stringify({
    ok: true,
    database: databaseName,
    redis: redisStatus,
    workload: {
      accountReads: accountReadWorkload.samples.length,
      transactionReads: transactionReadWorkload.samples.length,
      eligibilityReads: eligibilityReadWorkload.samples.length,
      purchases: purchaseCount,
      distinctCustomers: customerIds.length,
      partners: partnerCount,
      maxConcurrency: concurrency,
      sustainedDurationMs,
      sharedPartnerPayable: partnerCount === 1,
    },
    summaries,
    resources: {
      measuredProcess: true,
      beforeWorkload: resourcesBeforeWorkload,
      afterWorkload: resourcesAfterWorkload,
      delta: deltaSnapshot(resourcesBeforeWorkload, resourcesAfterWorkload),
    },
    container: {
      measured: containerResourcesBeforeWorkload.measured || containerResourcesAfterWorkload.measured,
      beforeWorkload: containerResourcesBeforeWorkload,
      afterWorkload: containerResourcesAfterWorkload,
      delta: deltaSnapshot(containerResourcesBeforeWorkload, containerResourcesAfterWorkload),
    },
    finalCustomerAccounts: {
      count: accounts.length,
      balanceCents: accounts.map(({ balanceCents }) => balanceCents),
      reservedCentsEach: 0,
    },
    finalPartnerPayables: {
      count: partnerPayableRows.length,
      balanceCents: partnerPayableRows.map(({ balance_cents: balanceCents }) => Number(balanceCents)),
      reservedCentsEach: 0,
    },
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
