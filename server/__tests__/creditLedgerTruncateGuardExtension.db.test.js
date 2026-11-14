'use strict';

/**
 * Domain 8 #18: the ledger truncate guard omits half the append-only tables.
 *
 * Migration 20261103100200 installs BEFORE TRUNCATE guards on 9 tables
 * while its header claims "every append-only Credit ledger and audit
 * table", but eight more tables carry no-update/no-delete rules (or a
 * raising immutability trigger) and no truncate guard:
 * oxsteed_credit_partner_funding_records, oxsteed_credit_currency_conversions,
 * food_customer_wallet_ledger, food_customer_wallet_operator_audit_events,
 * platform_ledger, main_app_payment_request_events,
 * helper_payment_policy_history, admin_user_action_log. Row triggers and
 * rules never fire on TRUNCATE, so the statement-level guard is the
 * only real protection on these tables.
 *
 *   - the guard triggers exist on all eight tables in the migrated
 *     schema (the extension migration must have run);
 *   - the extension migration's own SQL, replayed against scratch
 *     copies of the eight tables, blocks TRUNCATE on each of them.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 * The test database must be migrated first.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TABLES = [
  'oxsteed_credit_partner_funding_records',
  'oxsteed_credit_currency_conversions',
  'food_customer_wallet_ledger',
  'food_customer_wallet_operator_audit_events',
  'platform_ledger',
  'main_app_payment_request_events',
  'helper_payment_policy_history',
  'admin_user_action_log',
];

const MIGRATION_FILE = '20261113180000_credit_ledger_truncate_guard_extension.sql';

const schema = `truncate_guard_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Disposable database required');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');

jest.setTimeout(120000);

(url ? describe : describe.skip)('ledger truncate guard extension', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    for (const table of TABLES) {
      await db.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  });

  test('all eight append-only tables carry the BEFORE TRUNCATE guard', async () => {
    // pg_trigger, not information_schema.triggers: the latter hides
    // triggers on tables this role does not own, while pg_trigger
    // shows the installed guards directly.
    const { rows } = await db.query(
      `SELECT c.relname AS table_name, t.tgname AS trigger_name
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND t.tgname LIKE '%_no_truncate'
          AND c.relname = ANY($1::text[])`,
      [TABLES],
    );
    const guarded = new Set(rows.map((r) => r.table_name));
    for (const table of TABLES) {
      expect(guarded.has(table)).toBe(true);
    }
  });

  test('the extension migration SQL blocks TRUNCATE on every guarded table', async () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', MIGRATION_FILE),
      'utf8',
    );
    // Replays the migration against the scratch copies (search_path is
    // schema,public for this pool): the guard function and triggers land
    // in the scratch schema, and each table's TRUNCATE is then refused.
    await db.query(sql);
    for (const table of TABLES) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await expect(client.query(`TRUNCATE ${schema}.${table}`)).rejects
          .toThrow(/append-only; TRUNCATE is not permitted/);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    }
  });
});
