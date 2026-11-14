'use strict';

// Domain 8 #5 (F-13): production probe + repair check for the unique
// PaymentIntent index.
//
// The 20261110104300 migration created uq_food_orders_stripe_payment_intent
// only when no duplicate intents existed, and left no durable record either
// way when it skipped. This script answers, against any database, the two
// questions the skipped migration left unknown:
//
//   1. Does the index exist?
//   2. Do duplicate stripe_payment_intent_id values exist, and which?
//
// Read-only by default. With --create-index it also creates the index when
// the duplicate count is zero (the repair step after manual reconciliation);
// it refuses to create it while duplicates exist.
//
//   DATABASE_URL=postgresql://... node server/scripts/check-f13-payment-intent-index.cjs [--json] [--create-index]
//
// Exit codes: 0 = index present and no duplicates; 1 = duplicates exist
// (reconcile them first: refund or merge the extra orders, then re-run with
// --create-index or deploy migration 20261114010200); 2 = index missing but
// no duplicates (safe to create); 3 = usage / connection error.
// Do NOT run this against production without an ops decision: the duplicate
// list is read-only, but --create-index writes.

const { Pool } = require('pg');
const { getDatabaseSslConfig } = require('../utils/databaseConfig');

const INDEX_NAME = 'uq_food_orders_stripe_payment_intent';

async function check(pool) {
  const { rows: [indexRow] } = await pool.query(
    `SELECT 1 AS present FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
    [INDEX_NAME]
  );
  const { rows: dupes } = await pool.query(
    `SELECT stripe_payment_intent_id AS intent, COUNT(*)::int AS order_count,
            array_agg(id ORDER BY id) AS order_ids
       FROM food_orders
      WHERE stripe_payment_intent_id IS NOT NULL
      GROUP BY stripe_payment_intent_id
     HAVING COUNT(*) > 1
      ORDER BY stripe_payment_intent_id
      LIMIT 10`
  );
  const { rows: [countRow] } = await pool.query(
    `SELECT COUNT(*)::int AS duplicate_intent_count FROM (
       SELECT stripe_payment_intent_id FROM food_orders
        WHERE stripe_payment_intent_id IS NOT NULL
        GROUP BY stripe_payment_intent_id HAVING COUNT(*) > 1
     ) d`
  );
  return {
    indexPresent: Boolean(indexRow),
    duplicateIntentCount: countRow.duplicate_intent_count,
    duplicates: dupes.map((d) => ({
      intent: d.intent,
      orderCount: d.order_count,
      orderIds: d.order_ids.map(String),
    })),
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const asJson = args.has('--json');
  const createIndex = args.has('--create-index');
  const unknown = [...args].filter((a) => a !== '--json' && a !== '--create-index');
  if (unknown.length > 0) {
    console.error(`Unknown arguments: ${unknown.join(' ')}. Usage: check-f13-payment-intent-index.cjs [--json] [--create-index]`);
    process.exitCode = 3;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.');
    process.exitCode = 3;
    return;
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: getDatabaseSslConfig(process.env.DATABASE_URL, process.env.NODE_ENV),
  });
  try {
    const result = await check(pool);
    if (createIndex) {
      if (result.duplicateIntentCount > 0) {
        console.error(`Refusing to create ${INDEX_NAME}: ${result.duplicateIntentCount} duplicated intent(s) still exist. Reconcile them first.`);
        process.exitCode = 1;
        return;
      }
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX_NAME} ON food_orders (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL`
      );
      result.indexPresent = true;
      result.indexCreated = true;
    }
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`F-13 PaymentIntent index (${INDEX_NAME}): ${result.indexPresent ? 'present' : 'MISSING'}${result.indexCreated ? ' (created by this run)' : ''}`);
      console.log(`Duplicated PaymentIntents: ${result.duplicateIntentCount}`);
      for (const d of result.duplicates) {
        console.log(`  ${d.intent}: ${d.orderCount} orders (${d.orderIds.join(', ')})`);
      }
      if (result.duplicateIntentCount > 10) console.log('  (showing first 10)');
      if (result.duplicateIntentCount > 0) {
        console.log('Action: reconcile the duplicated intents (refund or merge the extra orders), then re-run with --create-index.');
      } else if (!result.indexPresent) {
        console.log('Action: no duplicates, safe to create the index with --create-index.');
      }
    }
    process.exitCode = result.duplicateIntentCount > 0 ? 1 : result.indexPresent ? 0 : 2;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`F-13 check failed: ${error.message}`);
    process.exitCode = 3;
  });
}

module.exports = { check, INDEX_NAME };
