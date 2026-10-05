'use strict';

/**
 * Behavior tests for statement transaction investigation (workstream 4).
 *
 * These tests run against the disposable `credit_statement_test` database
 * only (the same guard as statementJobService.test.js); they exercise real
 * DB behavior: record-level authorization, explicit relationship
 * resolution, dispute creation through the EXISTING oxsteed_credit_disputes
 * case system, idempotent retries, and ledger immutability. No
 * source-text assertions.
 *
 * The real JWT auth middleware cannot run here (the disposable DB carries
 * only the columns the isolated-env seed created), so `../middleware/auth`
 * is stubbed with the same contract: req.user = { id, role } from the
 * x-test-user-id / x-test-user-role headers. Record-level authorization
 * (document.customer_id = req.user.id) is implemented in the router under
 * test and is what these tests exercise.
 *
 * Run with e.g.
 *   STATEMENT_INVESTIGATION_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/statementInvestigation.test.js
 * Without it, the DB tests skip (fail closed) instead of touching a DB.
 */

jest.unmock('pg');

const RAW_URL = process.env.STATEMENT_INVESTIGATION_TEST_DATABASE_URL || '';

function isDisposableDatabase(urlText) {
  let url;
  try {
    url = new URL(urlText);
  } catch {
    return false;
  }
  const localhost = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  return ['postgres:', 'postgresql:'].includes(url.protocol) && localhost
    && url.pathname === '/credit_statement_test';
}

const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  if (!CAN_RUN_DB) {
    // eslint-disable-next-line no-console
    console.log('statementInvestigation DB tests skipped: set STATEMENT_INVESTIGATION_TEST_DATABASE_URL to the disposable credit_statement_test database to run them');
  }
  expect(isDisposableDatabase('postgresql://postgres@127.0.0.1:54329/credit_statement_test?sslmode=disable')).toBe(true);
  expect(isDisposableDatabase('postgresql://prod.example.com/credit_statement_test')).toBe(false);
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
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

ddescribe('statement investigation (disposable DB)', () => {
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
  let entrySequence = 1000000;

  async function ensureSchema() {
    await pool.query(`CREATE TABLE IF NOT EXISTS oxsteed_credit_partners (id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT)`);
    await pool.query(`ALTER TABLE oxsteed_credit_partners ADD COLUMN IF NOT EXISTS restaurant_id BIGINT`);
    await pool.query(`CREATE TABLE IF NOT EXISTS food_restaurants (id BIGSERIAL PRIMARY KEY, display_name VARCHAR(255))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS food_orders (
      id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT, customer_id UUID,
      status VARCHAR(24) NOT NULL DEFAULT 'received', payment_status VARCHAR(24) NOT NULL DEFAULT 'unpaid',
      total_cents INTEGER NOT NULL DEFAULT 0, currency_code CHAR(3) NOT NULL DEFAULT 'USD',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS oxsteed_credit_accounts (
      id BIGSERIAL PRIMARY KEY, account_type VARCHAR(32) NOT NULL,
      customer_id UUID REFERENCES users(id) ON DELETE RESTRICT,
      partner_id BIGINT REFERENCES oxsteed_credit_partners(id) ON DELETE RESTRICT,
      currency_code CHAR(3) NOT NULL DEFAULT 'USD', balance_cents BIGINT NOT NULL DEFAULT 0,
      reserved_cents BIGINT NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL DEFAULT 'active',
      ledger_version BIGINT NOT NULL DEFAULT 0, last_entry_hash TEXT, last_posted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS oxsteed_credit_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transaction_type VARCHAR(32) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'posted',
      debit_account_id BIGINT NOT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
      credit_account_id BIGINT NOT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
      amount_cents BIGINT NOT NULL, currency_code CHAR(3) NOT NULL,
      partner_id BIGINT REFERENCES oxsteed_credit_partners(id) ON DELETE RESTRICT,
      idempotency_key VARCHAR(160) NOT NULL UNIQUE,
      reference_type VARCHAR(80), reference_id VARCHAR(160), description VARCHAR(255),
      actor_type VARCHAR(32) NOT NULL DEFAULT 'system',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb, posted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS oxsteed_credit_transaction_entries (
      id BIGSERIAL PRIMARY KEY,
      transaction_id UUID NOT NULL REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
      account_id BIGINT NOT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
      entry_side VARCHAR(8) NOT NULL, amount_cents BIGINT NOT NULL, balance_after_cents BIGINT NOT NULL,
      sequence BIGINT NOT NULL, entry_hash TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS food_customer_wallet_accounts (
      id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
      customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      currency_code VARCHAR(3) NOT NULL DEFAULT 'USD', balance_cents BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS food_customer_wallet_ledger (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES food_customer_wallet_accounts(id) ON DELETE CASCADE,
      restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
      customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entry_type VARCHAR(20) NOT NULL, amount_cents BIGINT NOT NULL,
      balance_after_cents BIGINT NOT NULL, currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
      description VARCHAR(255), reference_type VARCHAR(60), reference_id VARCHAR(120),
      idempotency_key VARCHAR(120), metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS credit_statement_documents (
      id UUID PRIMARY KEY, customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      product VARCHAR(20) NOT NULL, account_id BIGINT NOT NULL, currency_code CHAR(3) NOT NULL,
      period_from DATE NOT NULL, period_to DATE NOT NULL, generated_at TIMESTAMPTZ NOT NULL,
      document JSONB NOT NULL, content_hash CHAR(64) NOT NULL,
      UNIQUE (customer_id, product, account_id, currency_code, period_from, period_to))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS oxsteed_credit_disputes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id UUID NOT NULL REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
      customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      partner_id BIGINT REFERENCES oxsteed_credit_partners(id) ON DELETE SET NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open', reason_code VARCHAR(60) NOT NULL,
      description TEXT NOT NULL, resolution TEXT,
      opened_by UUID REFERENCES users(id) ON DELETE SET NULL,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      idempotency_key VARCHAR(160), dispute_type VARCHAR(40), sla_due_at TIMESTAMPTZ,
      provisional_credit_cents BIGINT NOT NULL DEFAULT 0)`);
    // Migration 685 columns (idempotent for re-runs against older shapes).
    await pool.query(`ALTER TABLE oxsteed_credit_disputes
      ADD COLUMN IF NOT EXISTS statement_document_id UUID REFERENCES credit_statement_documents(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS statement_revision INTEGER,
      ADD COLUMN IF NOT EXISTS statement_entry_id VARCHAR(120),
      ADD COLUMN IF NOT EXISTS statement_product VARCHAR(20),
      ADD COLUMN IF NOT EXISTS statement_account_id BIGINT,
      ADD COLUMN IF NOT EXISTS statement_period_from DATE,
      ADD COLUMN IF NOT EXISTS statement_period_to DATE`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_active_dispute
      ON oxsteed_credit_disputes(transaction_id) WHERE status IN ('open', 'in_review')`);
    await pool.query(`CREATE TABLE IF NOT EXISTS oxsteed_credit_audit_events (
      id BIGSERIAL PRIMARY KEY, action_type VARCHAR(80) NOT NULL,
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
      partner_id BIGINT REFERENCES oxsteed_credit_partners(id) ON DELETE SET NULL,
      resource_type VARCHAR(80) NOT NULL, resource_id VARCHAR(160) NOT NULL,
      reason TEXT, request_ip INET, before_state JSONB, after_state JSONB,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  }

  // Fresh, mutually-unlinked fixtures per test: unique users, accounts,
  // transactions and statement document, so no cleanup is required.
  async function newFixture() {
    const ownerId = crypto.randomUUID();
    const intruderId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'synthetic', 'Stmt', 'Fixture', 'customer', TRUE, TRUE),
              ($3, $4, 'synthetic', 'Intr', 'Uder', 'customer', TRUE, TRUE)`,
      [ownerId, `${ownerId}@example.invalid`, intruderId, `${intruderId}@example.invalid`]
    );
    const { rows: [treasury] } = await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, currency_code, balance_cents)
       VALUES ('platform_treasury', 'USD', 1000000) RETURNING id`);
    const { rows: [account] } = await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code, balance_cents)
       VALUES ('customer_wallet', $1, 'USD', 10000) RETURNING id`, [ownerId]);
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants (display_name) VALUES ('Testaurant') RETURNING id`);
    const { rows: [order] } = await pool.query(
      `INSERT INTO food_orders (restaurant_id, customer_id, status, payment_status, total_cents, currency_code)
       VALUES ($1, $2, 'completed', 'paid', 2500, 'USD') RETURNING id`, [restaurant.id, ownerId]);

    async function addTransaction({ type, amount, referenceType, referenceId, description, balanceAfter }) {
      const txId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO oxsteed_credit_transactions
           (id, transaction_type, status, debit_account_id, credit_account_id, amount_cents,
            currency_code, idempotency_key, reference_type, reference_id, description, posted_at)
         VALUES ($1, $2, 'posted', $3, $4, $5, 'USD', $6, $7, $8, $9, NOW())`,
        [txId, type, account.id, treasury.id, amount, `tx-${txId}`, referenceType, referenceId, description]);
      await pool.query(
        `INSERT INTO oxsteed_credit_transaction_entries
           (transaction_id, account_id, entry_side, amount_cents, balance_after_cents, sequence, entry_hash)
         VALUES ($1, $2, 'debit', $3, $4, $5, $6)`,
        [txId, account.id, amount, balanceAfter, entrySequence += 1, `h-${txId}`]);
      return txId;
    }

    const txId = await addTransaction({
      type: 'purchase', amount: 2500, referenceType: 'food_order', referenceId: String(order.id),
      description: 'Test purchase', balanceAfter: 7500,
    });
    // Decoy: same amount, no explicit reference. The drilldown must NOT link it.
    const decoyId = await addTransaction({
      type: 'purchase', amount: 2500, referenceType: null, referenceId: null,
      description: 'Decoy purchase', balanceAfter: 5000,
    });
    // External payment reference: must be masked in every response.
    const topupId = await addTransaction({
      type: 'load', amount: 10000, referenceType: 'stripe_topup', referenceId: 'pi_SECRET1234',
      description: 'Card top-up', balanceAfter: 15000,
    });

    const docId = crypto.randomUUID();
    const entryFor = (id, type, description, debitCents, creditCents, balanceAfterCents) => ({
      id: String(id), date: '2026-09-15T12:00:00.000Z', type, description,
      debitCents, creditCents, balanceAfterCents,
    });
    const document = {
      id: docId, version: 1, kind: 'monthly', product: 'oxsteed',
      ownerName: 'Statement Fixture', accountLabel: 'OxSteed Credit',
      accountReference: `OC-••••${String(account.id).slice(-4).padStart(4, '0')}`,
      currencyCode: 'USD', period: { from: PERIOD.from, to: PERIOD.to },
      generatedAt: '2026-10-01T00:00:00.000Z', openingBalanceCents: 10000,
      transactions: [
        entryFor(txId, 'purchase', 'Test purchase', 2500, 0, 7500),
        entryFor(decoyId, 'purchase', 'Decoy purchase', 2500, 0, 5000),
        entryFor(topupId, 'load', 'Card top-up', 0, 10000, 15000),
      ],
      closingBalanceCents: 15000, totalCreditsCents: 10000, totalDebitsCents: 5000,
      transactionCount: 3, holds: [], holdsAsOf: null, totalHeldCents: 0,
    };
    document.contentHash = hashDocument(document);
    await pool.query(
      `INSERT INTO credit_statement_documents
         (id, customer_id, product, account_id, currency_code, period_from, period_to, generated_at, document, content_hash)
       VALUES ($1, $2, 'oxsteed', $3, 'USD', $4, $5, NOW(), $6, $7)`,
      [docId, ownerId, account.id, PERIOD.from, PERIOD.to, JSON.stringify(document), document.contentHash]);
    return { ownerId, intruderId, accountId: account.id, docId, txId, decoyId, topupId, orderId: order.id };
  }

  const as = (userId) => ({ 'x-test-user-id': userId });
  const entriesUrl = (f) => `/api/statements/${f.docId}/entries`;
  const entryUrl = (f, entryId) => `/api/statements/${f.docId}/entries/${entryId}`;

  beforeAll(async () => { await ensureSchema(); }, 60000);
  afterAll(async () => { await pool.end(); });

  test('(a) unauthorized users cannot read entries or drilldowns', async () => {
    const f = await newFixture();
    await request(app).get(entriesUrl(f)).expect(401);
    await request(app).get(entryUrl(f, f.txId)).expect(401);
    await request(app).get(entriesUrl(f)).set(as(f.intruderId)).expect(404);
    await request(app).get(entryUrl(f, f.txId)).set(as(f.intruderId)).expect(404);
    await request(app).post(`${entryUrl(f, f.txId)}/cases`).set(as(f.intruderId)).send({ reason: 'unrecognized' }).expect(404);
    // The owner can read their own entries.
    await request(app).get(entriesUrl(f)).set(as(f.ownerId)).expect(200);
  });

  test('(b) drilldown links only explicit relationships; the same-amount decoy is not linked', async () => {
    const f = await newFixture();
    const linked = await request(app).get(entryUrl(f, f.txId)).set(as(f.ownerId)).expect(200);
    expect(linked.body.statement.entryId).toBe(f.txId);
    expect(linked.body.related.status).toBe('linked');
    expect(linked.body.related.kind).toBe('order');
    expect(linked.body.related.id).toBe(String(f.orderId));
    expect(linked.body.related.statusLive).toBe('completed');

    const decoy = await request(app).get(entryUrl(f, f.decoyId)).set(as(f.ownerId)).expect(200);
    expect(decoy.body.related.status).toBe('unsupported');
    // Nothing in the decoy drilldown may point at the order: no inference
    // from the matching amount.
    const decoyJson = JSON.stringify(decoy.body);
    expect(decoyJson).not.toContain(`"id":"${f.orderId}"`);
    expect(decoyJson).not.toContain(`/food/orders/${f.orderId}`);
  });

  test('(c) deleted related record reports unavailable without crashing', async () => {
    const f = await newFixture();
    await pool.query('DELETE FROM food_orders WHERE id = $1', [f.orderId]);
    const res = await request(app).get(entryUrl(f, f.txId)).set(as(f.ownerId)).expect(200);
    expect(res.body.related).toEqual({ status: 'unavailable' });
    // The historical statement facts are still intact.
    expect(res.body.statement.entryId).toBe(f.txId);
    expect(res.body.statement.debitCents).toBe(2500);
  });

  test('(d) double POST opens exactly one case (idempotent retry)', async () => {
    const f = await newFixture();
    const first = await request(app).post(`${entryUrl(f, f.txId)}/cases`)
      .set(as(f.ownerId)).send({ reason: 'unrecognized', description: 'Not mine' }).expect(201);
    expect(first.body.caseId).toBeTruthy();
    expect(first.body.replayed).toBe(false);
    expect(first.body.status).toBe('open');

    const second = await request(app).post(`${entryUrl(f, f.txId)}/cases`)
      .set(as(f.ownerId)).send({ reason: 'unrecognized', description: 'Not mine' }).expect(200);
    expect(second.body.caseId).toBe(first.body.caseId);
    expect(second.body.replayed).toBe(true);

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM oxsteed_credit_disputes WHERE transaction_id = $1', [f.txId]);
    expect(rows[0].n).toBe(1);
    const { rows: [dispute] } = await pool.query(
      'SELECT statement_document_id, statement_entry_id, statement_revision FROM oxsteed_credit_disputes WHERE id = $1',
      [first.body.caseId]);
    expect(String(dispute.statement_document_id)).toBe(f.docId);
    expect(dispute.statement_entry_id).toBe(f.txId);
    expect(dispute.statement_revision).toBe(1);
  });

  test('(e) filing a case moves no money: ledger, balances and journals untouched', async () => {
    const f = await newFixture();
    const snapshot = async () => ({
      transactions: (await pool.query('SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_cents),0)::text AS s FROM oxsteed_credit_transactions')).rows[0],
      entries: (await pool.query('SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_cents),0)::text AS s FROM oxsteed_credit_transaction_entries')).rows[0],
      balance: (await pool.query('SELECT balance_cents::text AS b FROM oxsteed_credit_accounts WHERE id = $1', [f.accountId])).rows[0].b,
      disputes: (await pool.query('SELECT COUNT(*)::int AS n FROM oxsteed_credit_disputes')).rows[0].n,
    });
    const before = await snapshot();
    await request(app).post(`${entryUrl(f, f.txId)}/cases`)
      .set(as(f.ownerId)).send({ reason: 'duplicate' }).expect(201);
    const after = await snapshot();
    expect(after.transactions).toEqual(before.transactions);
    expect(after.entries).toEqual(before.entries);
    expect(after.balance).toBe(before.balance);
    // Exactly one dispute row was added and nothing else.
    expect(after.disputes).toBe(before.disputes + 1);
  });

  test('(f) statement document bytes are unchanged while a linked live case status changes', async () => {
    const f = await newFixture();
    const created = await request(app).post(`${entryUrl(f, f.txId)}/cases`)
      .set(as(f.ownerId)).send({ reason: 'incorrect_amount' }).expect(201);
    const before = (await pool.query(
      'SELECT document::text AS doc_text, content_hash FROM credit_statement_documents WHERE id = $1', [f.docId])).rows[0];
    // Simulate the review workflow moving the case forward.
    await pool.query(`UPDATE oxsteed_credit_disputes SET status = 'in_review' WHERE id = $1`, [created.body.caseId]);
    const { rows: [dispute] } = await pool.query('SELECT status FROM oxsteed_credit_disputes WHERE id = $1', [created.body.caseId]);
    expect(dispute.status).toBe('in_review');
    const after = (await pool.query(
      'SELECT document::text AS doc_text, content_hash FROM credit_statement_documents WHERE id = $1', [f.docId])).rows[0];
    expect(after.doc_text).toBe(before.doc_text);
    expect(after.content_hash).toBe(before.content_hash);
    // And the drilldown still serves the same historical facts with the
    // current live status labeled separately.
    const drill = await request(app).get(entryUrl(f, f.txId)).set(as(f.ownerId)).expect(200);
    expect(drill.body.statement.debitCents).toBe(2500);
    expect(drill.body.cases).toHaveLength(1);
    expect(drill.body.cases[0].status).toBe('in_review');
  });

  test('(g) responses carry masked references only, never raw reference values', async () => {
    const f = await newFixture();
    const raw = 'pi_SECRET1234';
    const list = await request(app).get(entriesUrl(f)).set(as(f.ownerId)).expect(200);
    const topupEntry = list.body.entries.find((e) => e.entryId === f.topupId);
    expect(topupEntry.maskedReference).toBe('••••1234');
    const drill = await request(app).get(entryUrl(f, f.topupId)).set(as(f.ownerId)).expect(200);
    expect(drill.body.related.status).toBe('external');
    expect(drill.body.related.maskedReference).toBe('••••1234');
    expect(JSON.stringify(list.body)).not.toContain(raw);
    expect(JSON.stringify(drill.body)).not.toContain(raw);
    // The stored case evidence summary is masked too.
    await request(app).post(`${entryUrl(f, f.topupId)}/cases`)
      .set(as(f.ownerId)).send({ reason: 'unrecognized' }).expect(201);
    const { rows: [dispute] } = await pool.query(
      'SELECT description FROM oxsteed_credit_disputes WHERE transaction_id = $1', [f.topupId]);
    expect(dispute.description).toContain('••••1234');
    expect(dispute.description).not.toContain(raw);
  });

  test('restaurant product entries are read-only: drilldown works, case filing is honestly refused', async () => {
    const f = await newFixture();
    // A restaurant-product document is out of scope for the credit dispute
    // system; the router must refuse case creation instead of inventing one.
    const docId = crypto.randomUUID();
    const document = {
      id: docId, version: 1, kind: 'monthly', product: 'restaurant',
      ownerName: 'Statement Fixture', accountLabel: 'Testaurant',
      accountReference: 'RC-••••0000', currencyCode: 'USD',
      period: { from: PERIOD.from, to: PERIOD.to }, generatedAt: '2026-10-01T00:00:00.000Z',
      openingBalanceCents: 0,
      transactions: [{ id: '42', date: '2026-09-15T12:00:00.000Z', type: 'purchase', description: 'Lunch', debitCents: 1200, creditCents: 0, balanceAfterCents: 8800 }],
      closingBalanceCents: 8800, totalCreditsCents: 0, totalDebitsCents: 1200,
      transactionCount: 1, holds: [], holdsAsOf: null, totalHeldCents: 0,
    };
    document.contentHash = hashDocument(document);
    await pool.query(
      `INSERT INTO credit_statement_documents
         (id, customer_id, product, account_id, currency_code, period_from, period_to, generated_at, document, content_hash)
       VALUES ($1, $2, 'restaurant', 424242, 'USD', $3, $4, NOW(), $5, $6)`,
      [docId, f.ownerId, PERIOD.from, PERIOD.to, JSON.stringify(document), document.contentHash]);
    const drill = await request(app).get(`/api/statements/${docId}/entries/42`).set(as(f.ownerId)).expect(200);
    expect(drill.body.statement.caseSupport).toBe('unsupported');
    const refused = await request(app).post(`/api/statements/${docId}/entries/42/cases`)
      .set(as(f.ownerId)).send({ reason: 'unrecognized' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('statement_case_unsupported');
    const cases = await request(app).get(`/api/statements/${docId}/entries/42/cases`).set(as(f.ownerId)).expect(200);
    expect(cases.body.cases).toEqual([]);
  });
});
