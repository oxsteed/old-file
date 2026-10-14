'use strict';

/**
 * Behavior tests for the multi-product statement investigation extension
 * (capabilities 7, 8, 10): settlement/earnings/business drilldown, the
 * fixed role guard, statement-level reports, and correction diffs.
 *
 * These tests run against the disposable `credit_statement_test` database
 * only. The local database cannot run the full migration chain (no
 * PostGIS), so beforeAll applies the REAL migration files this workstream
 * needs (046, 688, 690, 694, 869) plus the two idempotency columns the
 * support-ticket case path needs (mirroring migration 542, which cannot be
 * applied wholesale here). All statements are idempotent, so the same
 * setup also passes against a fully migrated CI database.
 *
 * The real JWT auth middleware cannot run here, so `../middleware/auth`
 * is stubbed with the same contract: req.user = { id, role } from the
 * x-test-user-id / x-test-user-role headers. Record-level authorization
 * is implemented in the router under test and is what these tests exercise.
 *
 * Run with e.g.
 *   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/statementInvestigationProducts.test.js --forceExit
 * Without it, the DB tests skip (fail closed) instead of touching a DB.
 */

jest.unmock('pg');

const fs = require('fs');
const path = require('path');
const { disposableDatabaseOptIn, isDisposableDatabase } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('STATEMENT_INVESTIGATION_PRODUCTS_TEST_DATABASE_URL');

const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  if (!CAN_RUN_DB) {
    // eslint-disable-next-line no-console
    console.log('statementInvestigationProducts DB tests skipped: set STATEMENT_TEST_DATABASE_URL to the disposable credit_statement_test database to run them');
  }
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = 'postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    const userId = req.headers['x-test-user-id'];
    const role = req.headers['x-test-user-role'] || 'customer';
    if (!userId) return res.status(401).json({ error: 'No token provided' });
    req.user = { id: userId, role };
    next();
  },
  requireRole: (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  },
}));

jest.setTimeout(60000);

ddescribe('statement investigation: all products (disposable DB)', () => {
  const express = require('express');
  const request = require('supertest');
  const crypto = require('crypto');
  const pool = require('../db');
  const { hashDocument } = require('../services/creditStatementService');

  const app = express();
  app.use(express.json());
  app.use('/api', require('../routes/statementInvestigation'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ code: err.code }));

  const PERIOD = { from: '2026-09-01', to: '2026-09-30' };

  function applyMigration(filename) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', filename), 'utf8');
    return pool.query(sql);
  }

  // Applies the DDL this workstream needs from migration 694 verbatim.
  // The full 694 file cannot run here: its backfill needs the production
  // business_invoices/jobs/payments tables, which this partial database does
  // not have. The table, its indexes, the projection function, the capture
  // function, the guard, and the immutability guard are extracted from the
  // real migration text so the schema cannot drift. Minimal source tables
  // are created when absent so fixtures write through the real capture path
  // (the guard trigger rejects direct inserts into settlement_source_history).
  async function applySourceHistoryDdl() {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '694_settlement_source_history.sql'), 'utf8');
    const table = sql.match(/CREATE TABLE IF NOT EXISTS settlement_source_history \([\s\S]*?\);\n/);
    const indexes = [...sql.matchAll(/CREATE INDEX IF NOT EXISTS settlement_source_history_\w+[\s\S]*?;\n/g)];
    const projection = sql.match(/CREATE OR REPLACE FUNCTION settlement_source_projection\([\s\S]*?\$\$;\n/);
    const capture = sql.match(/CREATE OR REPLACE FUNCTION capture_settlement_source_history\(\)[\s\S]*?END \$\$;\n/);
    const guard = sql.match(/CREATE OR REPLACE FUNCTION guard_settlement_source_history_insert\(\)[\s\S]*?END \$\$;\n/);
    const rejectMutation = sql.match(/CREATE OR REPLACE FUNCTION reject_settlement_source_history_mutation\(\)[\s\S]*?END \$\$;\n/);
    if (!table || indexes.length !== 2 || !projection || !capture || !guard || !rejectMutation) {
      throw new Error('694 DDL extraction failed');
    }
    await pool.query(table[0]);
    for (const index of indexes) await pool.query(index[0]);
    await pool.query(projection[0]);
    await pool.query(capture[0]);
    await pool.query(guard[0]);
    await pool.query(rejectMutation[0]);
    // Minimal source tables with the columns the capture projection reads.
    // No-op when the real tables exist (production migrations or CI's full
    // chain). The capture triggers are installed from the real 694 text.
    await pool.query(`CREATE TABLE IF NOT EXISTS jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID,
      assigned_helper_id UUID,
      title VARCHAR(255),
      description TEXT,
      status TEXT,
      payout_status VARCHAR(24),
      completed_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      helper_payout_cents INTEGER,
      platform_fee_cents INTEGER,
      customer_total_cents INTEGER,
      currency_code TEXT
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS business_invoices (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID,
      business_id INT,
      invoice_number VARCHAR(40),
      client_name VARCHAR(120),
      status VARCHAR(20),
      issue_date DATE,
      due_date DATE,
      total NUMERIC(12,2),
      amount_paid NUMERIC(12,2),
      paid_at TIMESTAMPTZ,
      currency_code TEXT
    )`);
    // Install the capture triggers from the real 694 text when the source
    // tables exist. DROP first for idempotency.
    const triggers = [
      ['business_invoice_source_history', 'business_invoices', 'business_invoice'],
      ['helper_job_source_history', 'jobs', 'helper_job'],
    ];
    for (const [triggerName, tableName, kind] of triggers) {
      const { rows: [{ exists }] } = await pool.query(
        `SELECT to_regclass($1) IS NOT NULL AS exists`, [`public.${tableName}`]);
      if (!exists) continue;
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${tableName}`);
      await pool.query(
        `CREATE TRIGGER ${triggerName} AFTER INSERT OR UPDATE OR DELETE ON ${tableName}
         FOR EACH ROW EXECUTE FUNCTION capture_settlement_source_history('${kind}')`);
    }
    // Install the guard and immutability triggers on settlement_source_history.
    await pool.query(`DROP TRIGGER IF EXISTS settlement_source_history_capture_only ON settlement_source_history`);
    await pool.query(`CREATE TRIGGER settlement_source_history_capture_only BEFORE INSERT ON settlement_source_history
      FOR EACH ROW EXECUTE FUNCTION guard_settlement_source_history_insert()`);
    await pool.query(`DROP TRIGGER IF EXISTS settlement_source_history_immutable ON settlement_source_history`);
    await pool.query(`CREATE TRIGGER settlement_source_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON settlement_source_history
      FOR EACH STATEMENT EXECUTE FUNCTION reject_settlement_source_history_mutation()`);
  }

  async function ensureSchema() {
    // Real migration DDL only: 046 (support tickets), 688 (settlement
    // archive), 690 (settlement amendments), 694 (source history), 869
    // (statement reports). Idempotent, so safe on a fully migrated DB too.
    await applyMigration('046_support_tickets.sql');
    await applyMigration('688_settlement_statement_documents.sql');
    await applyMigration('690_settlement_statement_amendments.sql');
    await applySourceHistoryDdl();
    await applyMigration('869_statement_reports.sql');
    // Mirrors migration 542 for the two columns the linked-ticket case path
    // needs; 542 itself cannot be applied here (other tables are absent).
    await pool.query('ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS client_request_id UUID');
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_support_tickets_client_request_id
      ON support_tickets (client_request_id) WHERE client_request_id IS NOT NULL`);
    await pool.query('ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS client_message_id UUID');
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_support_messages_ticket_client_id
      ON support_messages (ticket_id, client_message_id) WHERE client_message_id IS NOT NULL`);
    // listEntryCases joins these tables; the stub database lacks them.
    // Minimal join-compatible columns so the query plans; formatDispute only
    // runs on returned rows (none in these fixtures). No-op where the real
    // tables exist.
    await pool.query(`CREATE TABLE IF NOT EXISTS oxsteed_credit_disputes
      (id UUID PRIMARY KEY, partner_id BIGINT, transaction_id UUID, customer_id UUID, opened_at TIMESTAMPTZ)`);
    await pool.query(`ALTER TABLE oxsteed_credit_disputes ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ`);
    await pool.query(`CREATE TABLE IF NOT EXISTS oxsteed_credit_partners
      (id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT)`);
    // The disposable database carries stub versions of several tables
    // (users has only id/email; food_orders only id). Add the nullable
    // production columns the fixtures and the router read. All guarded, so
    // this is a no-op on a fully migrated database.
    for (const ddl of [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(255)`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(255)`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN`,
      `ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS restaurant_id BIGINT`,
      `ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS business_id BIGINT`,
      `ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS customer_id UUID`,
      `ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS queue_number INTEGER`,
      `ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS status TEXT`,
      `ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS payment_status TEXT`,
      `ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS total_cents BIGINT`,
      `ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS currency_code CHAR(3)`,
      `ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE oxsteed_credit_accounts ADD COLUMN IF NOT EXISTS partner_id BIGINT`,
      `ALTER TABLE oxsteed_credit_accounts ADD COLUMN IF NOT EXISTS restaurant_id BIGINT`,
      `ALTER TABLE oxsteed_credit_transactions ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
      `ALTER TABLE oxsteed_credit_transaction_entries ADD COLUMN IF NOT EXISTS entry_hash TEXT`,
    ]) await pool.query(ddl);
  }

  async function newUser(role) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'synthetic', 'Stmt', 'Fixture', $3, TRUE, TRUE)`,
      [id, `${id}@example.invalid`, role]);
    return id;
  }

  // Fresh, mutually-unlinked fixtures per test.
  async function newFixture() {
    const ownerId = await newUser('customer');
    const helperId = await newUser('helper');
    const intruderId = await newUser('customer');
    const adminId = await newUser('admin');
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, 'Synthetic Eats') RETURNING id`, [ownerId]);
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status)
       VALUES ($1, $2, 'Testaurant', 'active') RETURNING id`, [business.id, ownerId]);
    const { rows: [order] } = await pool.query(
      `INSERT INTO food_orders (restaurant_id, business_id, customer_id, queue_number, status, payment_status, total_cents, currency_code)
       VALUES ($1, $2, $3, 1, 'completed', 'paid', 2500, 'USD') RETURNING id`,
      [restaurant.id, business.id, ownerId]);

    // ── helper_earnings document + source observation ──
    // Written through the jobs table so the real capture trigger populates
    // settlement_source_history (the guard rejects direct inserts).
    const { rows: [job] } = await pool.query(
      `INSERT INTO jobs
         (client_id, assigned_helper_id, title, description, status, payout_status,
          completed_at, helper_payout_cents, platform_fee_cents, customer_total_cents, currency_code)
       VALUES ($1, $2, 'Sink fix', 'Synthetic fixture job', 'completed', 'paid',
         '2026-09-15T12:00:00.000Z', 1000, 250, 1250, 'USD')
       RETURNING id`,
      [ownerId, helperId]);
    const { rows: [observation] } = await pool.query(
      `SELECT id, source FROM settlement_source_history
        WHERE source_kind = 'helper_job' AND source_id = $1
        ORDER BY id DESC LIMIT 1`,
      [String(job.id)]);
    const helperDocId = crypto.randomUUID();
    const helperMovement = {
      sourceHistoryId: String(observation.id), sourceId: String(job.id), sourceKind: 'helper_job',
      recordedAt: '2026-09-15T12:00:00.000Z', postedEarningsCents: 1000,
      settledPayoutsCents: 0, statusRemovalsCents: 0, payableAfterCents: 1000,
    };
    const helperDocument = {
      id: helperDocId, version: 2, kind: 'monthly', product: 'helper_earnings',
      helperId, ownerName: 'Stmt Fixture', accountLabel: 'Helper earnings',
      currencyCode: 'USD', period: { ...PERIOD }, generatedAt: '2026-10-01T00:00:00.000Z',
      openingPayableCents: 0, postedEarningsCents: 1000, settledPayoutsCents: 0,
      statusRemovalsCents: 0, closingPayableCents: 1000, movements: [helperMovement],
    };
    helperDocument.contentHash = hashDocument(helperDocument);
    await pool.query(
      `INSERT INTO settlement_statement_documents
         (id, product, scope_helper_user_id, currency_code, period_from, period_to, generated_at, document, content_hash)
       VALUES ($1, 'helper_earnings', $2, 'USD', $3, $4, NOW(), $5, $6)`,
      [helperDocId, helperId, PERIOD.from, PERIOD.to, JSON.stringify(helperDocument), helperDocument.contentHash]);

    // ── restaurant_settlement document + sub-bank journal transaction ──
    // The journal rows are inserted directly: the stub database lacks the
    // idempotency/balance columns postJournalTransaction writes, and the
    // route only reads the identity columns below.
    const credit = require('../services/oxsteedCreditService');
    const treasury = await credit.ensureAccount(pool, { accountType: 'platform_treasury', currencyCode: 'USD' });
    const subBank = await credit.ensureAccount(pool, { accountType: 'restaurant_sub_bank', restaurantId: restaurant.id, currencyCode: 'USD' });
    const settleTxId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO oxsteed_credit_transactions
         (id, transaction_type, status, debit_account_id, credit_account_id, amount_cents,
          currency_code, reference_type, reference_id, description, posted_at, created_at, idempotency_key)
       VALUES ($1, 'sub_bank_load', 'posted', $2, $3, 12000, 'USD', 'food_order', $4,
         'Synthetic settlement load', NOW(), NOW(), $5)`,
      [settleTxId, treasury.id, subBank.id, String(order.id), `stmt-fixture-${settleTxId}`]);
    await pool.query(
      `INSERT INTO oxsteed_credit_transaction_entries
         (transaction_id, account_id, entry_side, amount_cents, balance_after_cents, sequence, entry_hash)
       VALUES ($1, $2, 'credit', 12000, 12000, 1, $3),
              ($1, $4, 'debit', 12000, 0, 2, $3)`,
      [settleTxId, subBank.id, crypto.createHash('sha256').update(settleTxId).digest('hex'), treasury.id]);
    const settlementDocId = crypto.randomUUID();
    const settlementDocument = {
      id: settlementDocId, version: 2, kind: 'monthly', product: 'restaurant_settlement',
      currencyCode: 'USD', period: { ...PERIOD }, generatedAt: '2026-10-01T00:00:00.000Z',
      openingBalanceCents: 0, totalCreditsCents: 12000, totalDebitsCents: 0, closingBalanceCents: 12000,
      transactionCount: 1,
      transactions: [{
        id: String(settleTxId), date: '2026-09-15T12:00:00.000Z', type: 'credit',
        description: 'Synthetic settlement load', debitCents: 0, creditCents: 12000,
        balanceAfterCents: 12000, referenceType: 'food_order', referenceId: String(order.id),
      }],
    };
    settlementDocument.contentHash = hashDocument(settlementDocument);
    await pool.query(
      `INSERT INTO settlement_statement_documents
         (id, product, scope_restaurant_id, currency_code, period_from, period_to, generated_at, document, content_hash)
       VALUES ($1, 'restaurant_settlement', $2, 'USD', $3, $4, NOW(), $5, $6)`,
      [settlementDocId, restaurant.id, PERIOD.from, PERIOD.to, JSON.stringify(settlementDocument), settlementDocument.contentHash]);

    // ── business document + source observation ──
    // Written through business_invoices so the real capture trigger fires.
    const { rows: [invoice] } = await pool.query(
      `INSERT INTO business_invoices
         (user_id, business_id, invoice_number, client_name, status, issue_date,
          total, amount_paid, currency_code)
       VALUES ($1, $2, 'INV-001', 'Acme', 'sent', '2026-09-16', 500.00, 0, 'USD')
       RETURNING id`,
      [ownerId, business.id]);
    const { rows: [invoiceObservation] } = await pool.query(
      `SELECT id, source FROM settlement_source_history
        WHERE source_kind = 'business_invoice' AND source_id = $1
        ORDER BY id DESC LIMIT 1`,
      [String(invoice.id)]);
    const businessDocId = crypto.randomUUID();
    const businessMovement = {
      sourceHistoryId: String(invoiceObservation.id), sourceId: String(invoice.id), sourceKind: 'business_invoice',
      recordedAt: '2026-09-16T12:00:00.000Z', invoicedCents: 50000,
      collectedOrAdjustedCents: 0, cancelledCents: 0, outstandingAfterCents: 50000,
    };
    const businessDocument = {
      id: businessDocId, version: 2, kind: 'monthly', product: 'business',
      currencyCode: 'USD', period: { ...PERIOD }, generatedAt: '2026-10-01T00:00:00.000Z',
      receivables: {
        openingOutstandingCents: 0, movements: [businessMovement], closingOutstandingCents: 50000,
      },
    };
    businessDocument.contentHash = hashDocument(businessDocument);
    await pool.query(
      `INSERT INTO settlement_statement_documents
         (id, product, scope_business_id, currency_code, period_from, period_to, generated_at, document, content_hash)
       VALUES ($1, 'business', $2, 'USD', $3, $4, NOW(), $5, $6)`,
      [businessDocId, business.id, PERIOD.from, PERIOD.to, JSON.stringify(businessDocument), businessDocument.contentHash]);

    // ── oxsteed credit document (reports + diff fixtures) ──
    const { rows: [creditAccount] } = await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code)
       VALUES ('customer_wallet', $1, 'USD') RETURNING id`, [ownerId]);
    const creditDocId = crypto.randomUUID();
    const txA = crypto.randomUUID();
    const txB = crypto.randomUUID();
    const creditDocument = {
      id: creditDocId, version: 1, kind: 'monthly', product: 'oxsteed',
      ownerName: 'Stmt Fixture', accountLabel: 'OxSteed Credit', accountReference: 'OC-••••0000',
      currencyCode: 'USD', period: { ...PERIOD }, generatedAt: '2026-10-01T00:00:00.000Z',
      openingBalanceCents: 10000,
      transactions: [
        { id: txA, date: '2026-09-15T12:00:00.000Z', type: 'purchase', description: 'Groceries', debitCents: 2500, creditCents: 0, balanceAfterCents: 7500 },
        { id: txB, date: '2026-09-16T12:00:00.000Z', type: 'load', description: 'Top-up', debitCents: 0, creditCents: 5000, balanceAfterCents: 12500 },
      ],
      closingBalanceCents: 12500, totalCreditsCents: 5000, totalDebitsCents: 2500,
      transactionCount: 2, holds: [], holdsAsOf: null, totalHeldCents: 0,
    };
    creditDocument.contentHash = hashDocument(creditDocument);
    await pool.query(
      `INSERT INTO credit_statement_documents
         (id, customer_id, product, account_id, currency_code, period_from, period_to, generated_at, document, content_hash)
       VALUES ($1, $2, 'oxsteed', $3, 'USD', $4, $5, NOW(), $6, $7)`,
      [creditDocId, ownerId, creditAccount.id, PERIOD.from, PERIOD.to, JSON.stringify(creditDocument), creditDocument.contentHash]);

    return {
      ownerId, helperId, intruderId, adminId, businessId: business.id, restaurantId: restaurant.id, orderId: order.id,
      helperDocId, helperEntryId: `history:${observation.id}`,
      settlementDocId, settleTxId: String(settleTxId),
      businessDocId, businessEntryId: `history:${invoiceObservation.id}`,
      creditDocId, creditAccountId: creditAccount.id, txA, txB,
    };
  }

  const as = (userId, role = 'customer') => ({ 'x-test-user-id': userId, 'x-test-user-role': role });
  const entriesUrl = (docId) => `/api/statements/${docId}/entries`;
  const entryUrl = (docId, entryId) => `/api/statements/${docId}/entries/${entryId}`;
  const reportsUrl = (product, docId) => `/api/statements/${product}/documents/${docId}/reports`;
  const diffUrl = (product, docId, correctionId) =>
    `/api/statements/${product}/documents/${docId}/corrections/${correctionId}/diff`;

  beforeAll(async () => { await ensureSchema(); }, 120000);
  afterAll(async () => { await pool.end(); });

  test('migration 869 creates the statement_reports table with its checks', async () => {
    const { rows: [table] } = await pool.query(
      `SELECT to_regclass('public.statement_reports') AS name`);
    expect(table.name).toBe('statement_reports');
    const { rows: checks } = await pool.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'statement_reports'::regclass AND contype = 'c'`);
    const names = checks.map((row) => row.conname).join(',');
    expect(names).toMatch('statement_reports_product_check');
    expect(names).toMatch('statement_reports_report_type_check');
    expect(names).toMatch('statement_reports_status_check');
    // Re-applying the migration file is a no-op (idempotent).
    await applyMigration('869_statement_reports.sql');
    // The CHECK constraints reject bad enums and empty descriptions.
    const f = await newFixture();
    await expect(pool.query(
      `INSERT INTO statement_reports (user_id, product, document_id, report_type, description)
       VALUES ($1, 'bogus', $2, 'missing_transaction', 'x')`,
      [f.ownerId, f.creditDocId])).rejects.toThrow();
    await expect(pool.query(
      `INSERT INTO statement_reports (user_id, product, document_id, report_type, description)
       VALUES ($1, 'oxsteed', $2, 'missing_transaction', '')`,
      [f.ownerId, f.creditDocId])).rejects.toThrow();
  });

  test('(7a) helper role passes the fixed guard and reads own helper_earnings entries', async () => {
    const f = await newFixture();
    const list = await request(app).get(entriesUrl(f.helperDocId)).set(as(f.helperId, 'helper')).expect(200);
    expect(list.body.product).toBe('helper_earnings');
    expect(list.body.entries).toHaveLength(1);
    expect(list.body.entries[0].entryId).toBe(f.helperEntryId);
    expect(list.body.entries[0].caseSupport).toBe('support_tickets');
    expect(list.body.entries[0].statusAsOf).toBe('historical');

    const drill = await request(app).get(entryUrl(f.helperDocId, f.helperEntryId)).set(as(f.helperId, 'helper')).expect(200);
    expect(drill.body.statement.description).toBe('Sink fix');
    expect(drill.body.statement.creditCents).toBe(1000);
    expect(drill.body.related.status).toBe('linked');
    expect(drill.body.related.kind).toBe('source_observation');
    expect(drill.body.related.statusLiveAsOf).toBe('historical');
    expect(drill.body.related.snapshot.title).toBe('Sink fix');
  });

  test('(7b) unauthorized and cross-user reads are indistinguishable 404s', async () => {
    const f = await newFixture();
    await request(app).get(entriesUrl(f.helperDocId)).expect(401);
    await request(app).get(entriesUrl(f.helperDocId)).set(as(f.intruderId)).expect(404);
    await request(app).get(entryUrl(f.helperDocId, f.helperEntryId)).set(as(f.intruderId)).expect(404);
    // A customer cannot read a helper's earnings, and vice versa.
    await request(app).get(entriesUrl(f.helperDocId)).set(as(f.ownerId)).expect(404);
    await request(app).get(entriesUrl(f.creditDocId)).set(as(f.helperId, 'helper')).expect(404);
    // A non-allow-listed role is rejected at the router guard.
    await request(app).get(entriesUrl(f.helperDocId)).set(as(f.helperId, 'admin')).expect(403);
  });

  test('(7c) restaurant owner investigates own restaurant_settlement document', async () => {
    const f = await newFixture();
    const list = await request(app).get(entriesUrl(f.settlementDocId)).set(as(f.ownerId)).expect(200);
    expect(list.body.product).toBe('restaurant_settlement');
    expect(list.body.entries).toHaveLength(1);

    const drill = await request(app).get(entryUrl(f.settlementDocId, f.settleTxId)).set(as(f.ownerId)).expect(200);
    expect(drill.body.statement.creditCents).toBe(12000);
    expect(drill.body.statement.statusAsOf).toBe('live');
    expect(drill.body.live.status).toBe('posted');
    // Merchant-scoped order resolution: the food_order reference links
    // through the restaurant scope, not the customer id.
    expect(drill.body.related.status).toBe('linked');
    expect(drill.body.related.kind).toBe('order');
    expect(drill.body.related.id).toBe(String(f.orderId));
    expect(drill.body.related.statusLive).toBe('completed');

    // Intruders and unrelated customers cannot probe the document.
    await request(app).get(entryUrl(f.settlementDocId, f.settleTxId)).set(as(f.intruderId)).expect(404);
    await request(app).get(entryUrl(f.settlementDocId, f.settleTxId)).set(as(f.helperId, 'helper')).expect(404);
  });

  test('(7d) business owner reads business statement entries', async () => {
    const f = await newFixture();
    const list = await request(app).get(entriesUrl(f.businessDocId)).set(as(f.ownerId)).expect(200);
    expect(list.body.product).toBe('business');
    expect(list.body.entries).toHaveLength(1);
    const drill = await request(app).get(entryUrl(f.businessDocId, f.businessEntryId)).set(as(f.ownerId)).expect(200);
    expect(drill.body.statement.creditCents).toBe(50000);
    expect(drill.body.related.status).toBe('linked');
    expect(drill.body.related.kind).toBe('source_observation');
    expect(drill.body.related.snapshot.invoice_number).toBe('INV-001');
  });

  test('(7e) settlement entry cases open support tickets with idempotency', async () => {
    const f = await newFixture();
    const path = entryUrl(f.helperDocId, f.helperEntryId);
    await request(app).post(`${path}/cases`).set(as(f.intruderId, 'helper')).send({ reason: 'unrecognized' }).expect(404);
    const first = await request(app).post(`${path}/cases`).set(as(f.helperId, 'helper'))
      .send({ reason: 'incorrect_amount', description: 'Wrong payout' }).expect(201);
    expect(first.body.caseId).toBeTruthy();
    expect(first.body.replayed).toBe(false);
    expect(first.body.detailUrl).toMatch('/support/my-tickets/');
    const second = await request(app).post(`${path}/cases`).set(as(f.helperId, 'helper'))
      .send({ reason: 'incorrect_amount', description: 'Wrong payout' }).expect(200);
    expect(second.body.caseId).toBe(first.body.caseId);
    expect(second.body.replayed).toBe(true);
    const cases = await request(app).get(`${path}/cases`).set(as(f.helperId, 'helper')).expect(200);
    expect(cases.body.caseSupport).toBe('support_tickets');
    expect(cases.body.cases).toHaveLength(1);
    const { rows: [ticket] } = await pool.query('SELECT metadata FROM support_tickets WHERE id = $1', [first.body.caseId]);
    expect(ticket.metadata.statement.documentId).toBe(f.helperDocId);
    expect(ticket.metadata.product).toBe('helper_earnings');
  });

  test('(7f) legacy oxsteed entry URLs keep working after the rewrite', async () => {
    const f = await newFixture();
    // The pre-existing /statements/:documentId/entries shape is unchanged.
    const list = await request(app).get(entriesUrl(f.creditDocId)).set(as(f.ownerId)).expect(200);
    expect(list.body.product).toBe('oxsteed');
    expect(list.body.pagination.total).toBe(2);
    expect(list.body.entries[0].caseSupport).toBe('credit_disputes');
    const drill = await request(app).get(entryUrl(f.creditDocId, f.txA)).set(as(f.ownerId)).expect(200);
    expect(drill.body.statement.entryId).toBe(f.txA);
    expect(drill.body.statement.debitCents).toBe(2500);
    // No journal row exists for the synthetic entries: related is honestly
    // unsupported, not inferred.
    expect(drill.body.related.status).toBe('unsupported');
    const cases = await request(app).get(`${entryUrl(f.creditDocId, f.txA)}/cases`).set(as(f.ownerId)).expect(200);
    expect(cases.body.caseSupport).toBe('credit_disputes');
    expect(cases.body.cases).toEqual([]);
  });

  test('(8a) unknown products are rejected on the new routes', async () => {
    const f = await newFixture();
    const res = await request(app).post(reportsUrl('bogus', f.creditDocId)).set(as(f.ownerId)).send({}).expect(400);
    expect(res.body.code).toBe('statement_invalid_product');
    await request(app).get(diffUrl('bogus', f.creditDocId, crypto.randomUUID())).set(as(f.ownerId)).expect(400);
  });

  test('(8b) report creation validates input and isolates owners', async () => {
    const f = await newFixture();
    const url = reportsUrl('oxsteed', f.creditDocId);
    await request(app).post(url).set(as(f.ownerId)).send({ reportType: 'bogus_type', description: 'x' }).expect(400);
    await request(app).post(url).set(as(f.ownerId)).send({ reportType: 'missing_transaction', description: '   ' }).expect(400);
    await request(app).post(url).set(as(f.ownerId)).send({ reportType: 'missing_transaction', description: 'x'.repeat(2001) }).expect(400);
    await request(app).post(url).set(as(f.intruderId)).send({ reportType: 'missing_transaction', description: 'x' }).expect(404);
    await request(app).get(url).set(as(f.intruderId)).expect(404);

    const created = await request(app).post(url).set(as(f.ownerId))
      .send({ reportType: 'missing_transaction', description: 'A top-up is missing from this statement.' }).expect(201);
    expect(created.body.report.reportId).toBeTruthy();
    expect(created.body.report.reportType).toBe('missing_transaction');
    expect(created.body.report.status).toBe('open');
    expect(created.body.product).toBe('oxsteed');

    const listed = await request(app).get(url).set(as(f.ownerId)).expect(200);
    expect(listed.body.reports).toHaveLength(1);
    expect(listed.body.reports[0].reportId).toBe(created.body.report.reportId);
    expect(listed.body.reports[0].description).toBe('A top-up is missing from this statement.');

    // A report on a settlement document works too.
    const settlementUrl = reportsUrl('helper_earnings', f.helperDocId);
    await request(app).post(settlementUrl).set(as(f.helperId, 'helper'))
      .send({ reportType: 'incomplete_period', description: 'The period looks short.' }).expect(201);

    // The product path must match the document's own product: a settlement
    // product path over a credit document is a 404, never a cross-write.
    await request(app).post(reportsUrl('restaurant_settlement', f.creditDocId)).set(as(f.ownerId))
      .send({ reportType: 'other_statement_problem', description: 'x' }).expect(404);
  });

  test('(10a) correction diff returns structured row diffs for a credit product', async () => {
    const f = await newFixture();
    const txC = crypto.randomUUID();
    const corrected = {
      ...JSON.parse(JSON.stringify((await pool.query('SELECT document FROM credit_statement_documents WHERE id = $1', [f.creditDocId])).rows[0].document)),
    };
    // Modified: txA amount changes. Removed: txB. Added: txC.
    corrected.transactions = [
      { ...corrected.transactions[0], debitCents: 3000, balanceAfterCents: 7000 },
      { id: txC, date: '2026-09-17T12:00:00.000Z', type: 'purchase', description: 'Late posting', debitCents: 1000, creditCents: 0, balanceAfterCents: 11500 },
    ];
    corrected.closingBalanceCents = 11500;
    corrected.totalDebitsCents = 4000;
    corrected.contentHash = hashDocument(corrected);
    const proposalId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO statement_amendment_proposals
         (id, issuance_key, product, account_id, currency_code, period_from, period_to, document_id, reason, status, proposed_by, decided_by, decided_at)
       VALUES ($1, $2, 'oxsteed', $3, 'USD', $4, $5, $6, 'Synthetic correction', 'approved', $7, $7, NOW())`,
      [proposalId, `diff-fixture-${crypto.randomUUID()}`, f.creditAccountId, PERIOD.from, PERIOD.to, f.creditDocId, f.adminId]);
    const versionId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO statement_amendment_versions
         (id, original_document_id, proposal_id, revision_number, amendment_type, presentation,
          document, content_hash, prior_version_closing_minor, revised_closing_minor, continuity_status)
       VALUES ($1, $2, $3, 1, 'accounting', 'restated', $4, $5, 12500, 11500, 'continuous')`,
      [versionId, f.creditDocId, proposalId, JSON.stringify(corrected), corrected.contentHash]);

    const res = await request(app).get(diffUrl('oxsteed', f.creditDocId, versionId)).set(as(f.ownerId)).expect(200);
    expect(res.body.currencyCode).toBe('USD');
    expect(res.body.correction.revisionNumber).toBe(1);
    expect(res.body.correction.amendmentType).toBe('accounting');
    expect(res.body.diff.counts).toEqual({ added: 1, removed: 1, modified: 1 });

    const modified = res.body.diff.rows.find((row) => row.change === 'modified');
    expect(modified.entryId).toBe(f.txA);
    const debitChange = modified.changes.find((change) => change.field === 'debitCents');
    expect(debitChange).toMatchObject({ oldValue: 2500, newValue: 3000 });

    const added = res.body.diff.rows.find((row) => row.change === 'added');
    expect(added.entryId).toBe(txC);
    const removed = res.body.diff.rows.find((row) => row.change === 'removed');
    expect(removed.entryId).toBe(f.txB);

    const closingChange = res.body.diff.summaryChanges.find((change) => change.field === 'closingBalanceCents');
    expect(closingChange).toMatchObject({ oldValue: 12500, newValue: 11500 });
  });

  test('(10b) correction diff 404s for unknown corrections and other users', async () => {
    const f = await newFixture();
    await request(app).get(diffUrl('oxsteed', f.creditDocId, crypto.randomUUID())).set(as(f.ownerId)).expect(404);
    await request(app).get(diffUrl('oxsteed', f.creditDocId, 'not-a-uuid')).set(as(f.ownerId)).expect(404);
    await request(app).get(diffUrl('oxsteed', f.creditDocId, crypto.randomUUID())).set(as(f.intruderId)).expect(404);
  });

  test('(10c) correction diff works for a settlement product', async () => {
    const f = await newFixture();
    const corrected = JSON.parse(JSON.stringify((await pool.query(
      'SELECT document FROM settlement_statement_documents WHERE id = $1', [f.helperDocId])).rows[0].document));
    corrected.movements = [{ ...corrected.movements[0], postedEarningsCents: 1200, payableAfterCents: 1200 }];
    corrected.postedEarningsCents = 1200;
    corrected.closingPayableCents = 1200;
    corrected.contentHash = hashDocument(corrected);
    const proposalId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO statement_amendment_proposals
         (id, issuance_key, product, account_uuid, currency_code, period_from, period_to, settlement_document_id, reason, status, proposed_by, decided_by, decided_at)
       VALUES ($1, $2, 'helper_earnings', $3, 'USD', $4, $5, $6, 'Synthetic correction', 'approved', $7, $7, NOW())`,
      [proposalId, `diff-fixture-${crypto.randomUUID()}`, f.helperId, PERIOD.from, PERIOD.to, f.helperDocId, f.adminId]);
    const versionId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO statement_amendment_versions
         (id, settlement_original_document_id, proposal_id, revision_number, amendment_type, presentation,
          document, content_hash, prior_version_closing_minor, revised_closing_minor, continuity_status)
       VALUES ($1, $2, $3, 1, 'accounting', 'restated', $4, $5, 1000, 1200, 'continuous')`,
      [versionId, f.helperDocId, proposalId, JSON.stringify(corrected), corrected.contentHash]);

    const res = await request(app).get(diffUrl('helper_earnings', f.helperDocId, versionId))
      .set(as(f.helperId, 'helper')).expect(200);
    expect(res.body.diff.counts).toEqual({ added: 0, removed: 0, modified: 1 });
    const modified = res.body.diff.rows[0];
    expect(modified.entryId).toBe(f.helperEntryId);
    expect(modified.changes.find((change) => change.field === 'postedEarningsCents'))
      .toMatchObject({ oldValue: 1000, newValue: 1200 });
    const summary = res.body.diff.summaryChanges.find((change) => change.field === 'closingPayableCents');
    expect(summary).toMatchObject({ oldValue: 1000, newValue: 1200 });
  });
});
