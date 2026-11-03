'use strict';

/**
 * One Truth scale benchmark (Q3 carried item, Nov 3 data-integrity audit).
 *
 * The largest existing One Truth test seed is 50 users, and the 5,000-row
 * cap was retired at oneTruthController.js getStats in favor of scoped
 * GROUP BY discovery plus a 100,000-pair guard (413
 * one_truth_pair_limit_exceeded). This harness is the missing proof that
 * the retired cap holds at 100k / 500k / 1M users. It is deliberately NOT
 * part of the default unit-test path (it seeds up to a million rows); run
 * it on demand against a scratch database.
 *
 * What it exercises (real code, not a reimplementation):
 * - _buildSuspectPairsScoped: the two indexed GROUP BY ... HAVING
 *   COUNT(*) > 1 queries plus linear linkSignalGroups pairing with the
 *   default 100,000 max-pairs guard.
 * - _countScopedUsers: the evaluated-users count that replaced
 *   min(scoped, 5000). The retired cap holds iff this equals the seeded
 *   count exactly at every scale.
 *
 * Cases per scale:
 * - sparse: duplicate groups of 2 every 1,000 users (pairs ~ N/1000, far
 *   under the guard). Expects success, exact pair count (computed from
 *   the seeded data by SQL, not hardcoded), and evaluated == N.
 * - guard-trip: every user shares one phone AND one last-login IP, so the
 *   linear pair count is 2*(N-1), over the guard at every scale. Expects
 *   a 413 one_truth_pair_limit_exceeded, and expects the count query to
 *   still return exactly N (the guard bounds materialized pairs, never
 *   coverage).
 *
 * Safety (fail closed):
 * - Requires ONE_TRUTH_BENCH_DATABASE_URL. Refuses to run unless the
 *   database name looks like a scratch database (contains test, bench,
 *   or dev); production-looking URLs abort before any statement runs.
 * - All data lives in a dedicated one_truth_bench schema holding only a
 *   minimal users table, resolved via search_path on the harness's own
 *   connection. The schema is dropped at the end unless --keep-schema is
 *   passed. No other schema or table is touched.
 * - Aborts if ONE_TRUTH_MAX_PAIRS is set: the guard expectation is the
 *   default 100,000, and an override would make results incomparable.
 *
 * Usage (from server/):
 *   ONE_TRUTH_BENCH_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test \
 *     NODE_ENV=test LOG_LEVEL=error JWT_SECRET=test-jwt-secret \
 *     ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
 *     SIGNED_URL_SECRET=test-signed-url-secret STRIPE_SECRET_KEY=sk_test_dummy \
 *     STRIPE_WEBHOOK_SECRET=whsec_test \
 *     node scripts/oneTruthBenchmark.js [--scales 100000,500000,1000000] [--keep-schema] [--json]
 *
 * The dummy secrets above are only for loading the controller module in
 * this scratch tool; the harness never signs, charges, or sends anything.
 * Results on the reference run (2026-11-03, local Postgres): all three
 * scales PASS in ~45s total; sparse pair query 0.4s / 4.4s / 3.4s and
 * guard-trip query 0.6s / 1.7s / 3.3s at 100k / 500k / 1M.
 */

const { Client } = require('pg');

const SCHEMA = 'one_truth_bench';
const DEFAULT_SCALES = [100000, 500000, 1000000];
const SCOPE = {};

function msSince(start) {
  return Math.round(Number(process.hrtime.bigint() - start) / 1e6);
}

function parseArgs(argv) {
  const args = { scales: DEFAULT_SCALES, keepSchema: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scales') args.scales = argv[++i].split(',').map((s) => parseInt(s.trim(), 10));
    else if (argv[i] === '--keep-schema') args.keepSchema = true;
    else if (argv[i] === '--json') args.json = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.scales.length || args.scales.some((n) => !Number.isSafeInteger(n) || n <= 0)) {
    throw new Error('--scales must be a comma-separated list of positive integers');
  }
  return args;
}

function checkSafety(connectionString) {
  if (!connectionString) {
    throw new Error('ONE_TRUTH_BENCH_DATABASE_URL is required; refusing to run without an explicit scratch database.');
  }
  if (process.env.ONE_TRUTH_MAX_PAIRS) {
    throw new Error('ONE_TRUTH_MAX_PAIRS is set; unset it so the guard expectation stays at the default 100,000.');
  }
  let dbName = '';
  try {
    dbName = new URL(connectionString).pathname.replace(/^\//, '');
  } catch {
    throw new Error('ONE_TRUTH_BENCH_DATABASE_URL is not a valid URL.');
  }
  if (!/(test|bench|dev)/i.test(dbName)) {
    throw new Error(`Database "${dbName}" does not look like a scratch database (name must contain test, bench, or dev); refusing to run.`);
  }
}

async function seedSparse(client, n) {
  await client.query(`TRUNCATE ${SCHEMA}.users`);
  await client.query(
    `INSERT INTO ${SCHEMA}.users (id, phone, last_login_ip, created_at, deleted_at, role)
     SELECT 'bench-' || g::text,
       CASE WHEN g % 1000 IN (0, 1) THEN 'dup-' || (g / 1000)::text ELSE 'u-' || g::text END,
       'ip-' || g::text,
       '2024-01-01'::timestamptz + (g || ' seconds')::interval,
       NULL, 'customer'
     FROM generate_series(1, $1) AS g`,
    [n]
  );
}

async function seedGuardTrip(client, n) {
  await client.query(`TRUNCATE ${SCHEMA}.users`);
  await client.query(
    `INSERT INTO ${SCHEMA}.users (id, phone, last_login_ip, created_at, deleted_at, role)
     SELECT 'bench-' || g::text,
       'shared-phone',
       '10.9.9.9',
       '2024-01-01'::timestamptz + (g || ' seconds')::interval,
       NULL, 'customer'
     FROM generate_series(1, $1) AS g`,
    [n]
  );
}

async function expectedLinearPairs(client) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(cnt - 1), 0)::int AS pairs FROM (
       SELECT COUNT(*)::int AS cnt FROM ${SCHEMA}.users
       WHERE phone IS NOT NULL AND phone != '' GROUP BY phone HAVING COUNT(*) > 1
       UNION ALL
       SELECT COUNT(*)::int AS cnt FROM ${SCHEMA}.users
       WHERE last_login_ip IS NOT NULL GROUP BY last_login_ip HAVING COUNT(*) > 1
     ) s`
  );
  return rows[0].pairs;
}

async function runScale(client, controller, n) {
  const result = { scale: n, cases: {} };

  // Sparse case: under the guard, full evaluation expected.
  {
    const seedStart = process.hrtime.bigint();
    await seedSparse(client, n);
    const seedMs = msSince(seedStart);
    const expectedPairs = await expectedLinearPairs(client);
    const countStart = process.hrtime.bigint();
    const evaluated = await controller._countScopedUsers(client, SCOPE, null);
    const countMs = msSince(countStart);
    const pairsStart = process.hrtime.bigint();
    const linked = await controller._buildSuspectPairsScoped(client, SCOPE, null, { withGroups: true });
    const pairsMs = msSince(pairsStart);
    const pass = evaluated === n && linked.pairs.length === expectedPairs && linked.pairs.length <= 100000;
    result.cases.sparse = {
      seedMs, countMs, pairsMs, evaluated, pairs: linked.pairs.length, expectedPairs,
      pass,
      detail: pass
        ? `evaluated ${evaluated} of ${n} seeded; pairs ${linked.pairs.length} match SQL expectation; retired 5,000 cap holds`
        : `MISMATCH: evaluated=${evaluated} (want ${n}), pairs=${linked.pairs.length} (want ${expectedPairs})`,
    };
  }

  // Guard-trip case: over the guard, explicit 413 expected, count intact.
  {
    const seedStart = process.hrtime.bigint();
    await seedGuardTrip(client, n);
    const seedMs = msSince(seedStart);
    const countStart = process.hrtime.bigint();
    const evaluated = await controller._countScopedUsers(client, SCOPE, null);
    const countMs = msSince(countStart);
    const pairsStart = process.hrtime.bigint();
    let guardError = null;
    try {
      await controller._buildSuspectPairsScoped(client, SCOPE, null, { withGroups: true });
    } catch (err) {
      guardError = err;
    }
    const pairsMs = msSince(pairsStart);
    const pass = evaluated === n
      && guardError !== null
      && guardError.statusCode === 413
      && guardError.code === 'one_truth_pair_limit_exceeded';
    result.cases.guardTrip = {
      seedMs, countMs, pairsMs, evaluated,
      guard: guardError ? `${guardError.statusCode} ${guardError.code}` : 'no error (pairs materialized)',
      pass,
      detail: pass
        ? `guard tripped with 413 as designed; count still exact at ${evaluated}`
        : `GUARD FAILURE: evaluated=${evaluated} (want ${n}), guard=${guardError ? `${guardError.statusCode} ${guardError.code}` : 'none'}`,
    };
  }

  result.pass = result.cases.sparse.pass && result.cases.guardTrip.pass;
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = process.env.ONE_TRUTH_BENCH_DATABASE_URL;
  checkSafety(connectionString);

  // Point the controller's own pool at the same scratch database before
  // loading it, so no pool in this process can reach another database.
  // The harness itself only queries through its own client below.
  process.env.DATABASE_URL = connectionString;
  const controller = require('../controllers/oneTruthController');
  if (controller._oneTruthMaxPairs() !== 100000) {
    throw new Error('ONE_TRUTH_MAX_PAIRS default is not 100,000; refusing to run with a changed guard.');
  }

  const client = new Client({ connectionString });
  await client.connect();
  const results = [];
  try {
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(
      `CREATE TABLE ${SCHEMA}.users (
         id TEXT PRIMARY KEY,
         phone TEXT,
         last_login_ip TEXT,
         created_at TIMESTAMPTZ,
         deleted_at TIMESTAMPTZ,
         role TEXT
       )`
    );
    for (const n of args.scales) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await runScale(client, controller, n));
    }
  } finally {
    if (!args.keepSchema) {
      await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    }
    await client.end().catch(() => {});
  }

  const allPass = results.every((r) => r.pass);
  if (args.json) {
    console.log(JSON.stringify({ pass: allPass, results }, null, 2));
  } else {
    for (const r of results) {
      console.log(`\nscale ${r.scale}: ${r.pass ? 'PASS' : 'FAIL'}`);
      for (const [name, c] of Object.entries(r.cases)) {
        console.log(`  ${name}: ${c.pass ? 'PASS' : 'FAIL'} — ${c.detail} (seed ${c.seedMs}ms, count ${c.countMs}ms, pairs ${c.pairsMs}ms)`);
      }
    }
    console.log(`\nOVERALL: ${allPass ? 'PASS' : 'FAIL'}${args.keepSchema ? ` (schema ${SCHEMA} kept)` : ''}`);
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(`oneTruthBenchmark failed: ${err.message}`);
  process.exit(2);
});
