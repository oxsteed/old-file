#!/usr/bin/env node
/**
 * Verifies the OxSteed Credit migration and ledger invariants against the
 * configured database. It is safe to run repeatedly and never mutates data.
 * Usage: DATABASE_URL=... node server/scripts/verify-oxsteed-credit.js
 */
'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const REQUIRED_TABLES = [
  'oxsteed_credit_partners',
  'oxsteed_credit_partner_agreements',
  'oxsteed_credit_customer_entitlements',
  'oxsteed_credit_accounts',
  'oxsteed_credit_transactions',
  'oxsteed_credit_transaction_entries',
  'oxsteed_credit_holds',
  'oxsteed_credit_settlements',
  'oxsteed_credit_reconciliation_runs',
  'oxsteed_credit_audit_events',
  'oxsteed_credit_disputes',
];

const REQUIRED_COLUMNS = {
  oxsteed_credit_accounts: ['balance_cents', 'reserved_cents', 'ledger_version', 'last_entry_hash'],
  oxsteed_credit_transactions: ['idempotency_key', 'posted_at', 'partner_id', 'agreement_id'],
  oxsteed_credit_transaction_entries: ['entry_hash', 'previous_entry_hash', 'sequence'],
  oxsteed_credit_holds: ['capture_idempotency_key', 'expires_at'],
};

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('verify-oxsteed-credit: DATABASE_URL is not set.');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    const checks = {};
    const { rows: migrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['421_oxsteed_credit_foundation.sql']
    );
    checks.foundationMigrationApplied = migrationRows.length === 1;
    const { rows: emergencyMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['422_oxsteed_credit_emergency_controls.sql']
    );
    checks.emergencyMigrationApplied = emergencyMigrationRows.length === 1;

    const { rows: emergencyRows } = await pool.query(
      `SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled' LIMIT 1`
    );
    checks.emergencyFlagSeeded = emergencyRows.length === 1;
    checks.emergencyFlagEnabled = emergencyRows[0]?.is_enabled === true;

    const { rows: tableRows } = await pool.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [REQUIRED_TABLES]
    );
    const presentTables = new Set(tableRows.map((row) => row.table_name));
    checks.missingTables = REQUIRED_TABLES.filter((table) => !presentTables.has(table));

    checks.missingColumns = [];
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      const { rows } = await pool.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2::text[])`,
        [table, columns]
      );
      const presentColumns = new Set(rows.map((row) => row.column_name));
      for (const column of columns) {
        if (!presentColumns.has(column)) checks.missingColumns.push(`${table}.${column}`);
      }
    }

    const { rows: transactionInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM (
           SELECT t.id
             FROM oxsteed_credit_transactions t
             LEFT JOIN oxsteed_credit_transaction_entries e ON e.transaction_id = t.id
            WHERE t.status = 'posted'
            GROUP BY t.id, t.amount_cents
           HAVING COUNT(e.id) <> 2
               OR COUNT(*) FILTER (WHERE e.entry_side = 'debit') <> 1
               OR COUNT(*) FILTER (WHERE e.entry_side = 'credit') <> 1
               OR COUNT(*) FILTER (WHERE e.amount_cents <> t.amount_cents) <> 0
         ) invalid`,
    );
    checks.invalidPostedTransactions = Number(transactionInvariantRows[0]?.invalid_count || 0);

    const { rows: balanceInvariantRows } = await pool.query(
      `WITH journal AS (
         SELECT e.account_id,
                SUM(CASE WHEN e.entry_side = 'credit' THEN e.amount_cents ELSE -e.amount_cents END)::bigint AS journal_balance
           FROM oxsteed_credit_transaction_entries e
           JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
          WHERE t.status = 'posted'
          GROUP BY e.account_id
       )
       SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_accounts a
         LEFT JOIN journal j ON j.account_id = a.id
        WHERE COALESCE(j.journal_balance, 0) <> a.balance_cents`,
    );
    checks.invalidAccountBalances = Number(balanceInvariantRows[0]?.invalid_count || 0);

    const { rows: purchaseInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions
        WHERE transaction_type = 'purchase'
          AND (partner_id IS NULL OR agreement_id IS NULL)`,
    );
    checks.invalidPurchases = Number(purchaseInvariantRows[0]?.invalid_count || 0);

    const { rows: hashInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transaction_entries
        WHERE (sequence = 1 AND previous_entry_hash IS NOT NULL)
           OR (sequence > 1 AND previous_entry_hash IS NULL)`,
    );
    checks.invalidHashLinks = Number(hashInvariantRows[0]?.invalid_count || 0);

    const { rows: staleHoldRows } = await pool.query(
      `SELECT COUNT(*)::int AS stale_count
         FROM oxsteed_credit_holds
        WHERE status = 'active' AND expires_at <= NOW()`,
    );
    checks.expiredActiveHolds = Number(staleHoldRows[0]?.stale_count || 0);

    const blockingFailures = [
      !checks.foundationMigrationApplied,
      !checks.emergencyMigrationApplied,
      !checks.emergencyFlagSeeded,
      checks.missingTables.length > 0,
      checks.missingColumns.length > 0,
      checks.invalidPostedTransactions > 0,
      checks.invalidAccountBalances > 0,
      checks.invalidPurchases > 0,
      checks.invalidHashLinks > 0,
    ].filter(Boolean).length;

    console.log(JSON.stringify({
      ok: blockingFailures === 0,
      checks,
      note: checks.expiredActiveHolds > 0
        ? 'Expired active holds are non-blocking but should be cleared by the hold-expiry worker.'
        : 'No expired active holds detected.',
    }, null, 2));
    process.exitCode = blockingFailures === 0 ? 0 : 1;
  } catch (error) {
    console.error(`verify-oxsteed-credit: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
