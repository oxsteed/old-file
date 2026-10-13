'use strict';

// P2-5-F05: the wallet's "last statement" fields must describe the issued
// monthly document, not a live journal computation.
jest.unmock('pg');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');
const crypto = require('crypto');
const schema = `wallet_statement_${crypto.randomBytes(6).toString('hex')}`;
const database = disposableDatabaseOptIn('WALLET_LAST_STATEMENT_TEST_DATABASE_URL');
if (database) {
  const target = new URL(database);
  target.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = target.toString();
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'wallet-last-statement-test-secret';
const describeDatabase = database ? describe : describe.skip;
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { getCustomerCreditAccountDetails } = require('../services/oxsteedCreditService');
jest.setTimeout(120000);

test('wallet last-statement tests require an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

async function applyMigration(filename) {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', filename), 'utf8');
  await pool.query(sql);
}

describeDatabase('wallet last statement prefers the issued document', () => {
  let customerId;
  let walletId;
  let counterpartyId;

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${schema}`);
    // Minimal local tables (the full 001/421 chain needs PostGIS, which the
    // local test postgres does not provide). Column sets mirror exactly the
    // columns getCustomerCreditAccountDetails reads.
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY, email TEXT)`);
    await applyMigration('682_credit_statement_documents.sql');
    await applyMigration('684_statement_artifacts.sql');
    await applyMigration('686_statement_amendment_proposals.sql');
    await applyMigration('687_statement_amendment_versions.sql');
    // The 682/687 immutability triggers would block per-test cleanup; the
    // production triggers stay in place, this is test-only.
    await pool.query('DROP TRIGGER IF EXISTS credit_statement_documents_immutable ON credit_statement_documents');
    await pool.query('DROP TRIGGER IF EXISTS statement_amendment_versions_immutable ON statement_amendment_versions');
    await pool.query(`CREATE TABLE IF NOT EXISTS oxsteed_credit_accounts (
      id BIGSERIAL PRIMARY KEY, account_type VARCHAR(32) NOT NULL,
      customer_id UUID, currency_code CHAR(3) NOT NULL DEFAULT 'USD')`);
    await pool.query(`CREATE TABLE IF NOT EXISTS oxsteed_credit_transactions (
      id UUID PRIMARY KEY, debit_account_id BIGINT NOT NULL, credit_account_id BIGINT NOT NULL,
      amount_cents BIGINT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'posted',
      currency_code CHAR(3) NOT NULL, posted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS oxsteed_credit_transaction_entries (
      id BIGSERIAL PRIMARY KEY, transaction_id UUID NOT NULL, account_id BIGINT NOT NULL,
      balance_after_cents BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS oxsteed_credit_topups (
      id BIGSERIAL PRIMARY KEY, customer_id UUID NOT NULL, currency_code CHAR(3) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending', amount_cents BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS oxsteed_credit_withdrawals (
      id BIGSERIAL PRIMARY KEY, customer_id UUID NOT NULL, currency_code CHAR(3) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'requested', amount_cents BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM statement_amendment_versions');
    await pool.query('DELETE FROM statement_amendment_proposals');
    await pool.query('DELETE FROM credit_statement_documents');
    await pool.query('DELETE FROM oxsteed_credit_transaction_entries');
    await pool.query('DELETE FROM oxsteed_credit_transactions');
    await pool.query('DELETE FROM oxsteed_credit_accounts');
    await pool.query('DELETE FROM users');
    customerId = crypto.randomUUID();
    await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)', [customerId, `${customerId}@example.invalid`]);
    walletId = (await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code)
       VALUES ('customer_wallet', $1, 'USD') RETURNING id`, [customerId])).rows[0].id;
    counterpartyId = (await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code)
       VALUES ('platform_treasury', NULL, 'USD') RETURNING id`)).rows[0].id;
  });

  afterAll(async () => {
    try { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await pool.end(); }
  });

  async function postJournalEntry({ balanceAfterCents, postedAt }) {
    const txId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO oxsteed_credit_transactions
         (id, debit_account_id, credit_account_id, amount_cents, status, currency_code, posted_at)
       VALUES ($1, $2, $3, 1000, 'posted', 'USD', $4)`,
      [txId, counterpartyId, walletId, postedAt]);
    await pool.query(
      `INSERT INTO oxsteed_credit_transaction_entries (transaction_id, account_id, balance_after_cents)
       VALUES ($1, $2, $3)`, [txId, walletId, balanceAfterCents]);
  }

  async function issueDocument({ closingBalanceCents, from = '2026-09-01', to = '2026-09-30' }) {
    const id = crypto.randomUUID();
    const document = {
      id, version: 2, kind: 'monthly', product: 'oxsteed', currencyCode: 'USD',
      period: { from, to }, generatedAt: '2026-10-04T00:00:00Z',
      openingBalanceCents: 0, totalCreditsCents: closingBalanceCents,
      totalDebitsCents: 0, closingBalanceCents, transactionCount: 1, transactions: [],
    };
    const contentHash = crypto.createHash('sha256').update(JSON.stringify(document)).digest('hex');
    await pool.query(
      `INSERT INTO credit_statement_documents
         (id, customer_id, product, account_id, currency_code, period_from, period_to,
          generated_at, document, content_hash)
       VALUES ($1,$2,'oxsteed',$3,'USD',$4,$5,NOW(),$6,$7)`,
      [id, customerId, walletId, from, to, JSON.stringify(document), contentHash]);
    return id;
  }

  async function addAmendmentRevision(documentId, revisedClosingMinor) {
    const proposalId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO statement_amendment_proposals
         (id, issuance_key, product, account_id, currency_code, period_from, period_to,
          document_id, reason, status, proposed_by, decided_by, decided_at)
       VALUES ($1,'synthetic-key','oxsteed',$2,'USD','2026-09-01','2026-09-30',$3,
               'synthetic correction','approved',$4,$4,NOW())`,
      [proposalId, walletId, documentId, customerId]);
    await pool.query(
      `INSERT INTO statement_amendment_versions
         (id, original_document_id, proposal_id, revision_number, amendment_type,
          presentation, document, content_hash, prior_version_closing_minor,
          revised_closing_minor, continuity_status)
       VALUES ($1,$2,$3,1,'accounting','restated','{}',
               'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
               12345,$4,'continuous')`,
      [crypto.randomUUID(), documentId, proposalId, revisedClosingMinor]);
  }

  test('issued document wins over the live journal balance', async () => {
    await postJournalEntry({ balanceAfterCents: 99999, postedAt: '2026-09-30T12:00:00Z' });
    const documentId = await issueDocument({ closingBalanceCents: 12345 });
    const details = await getCustomerCreditAccountDetails(customerId, { currencyCode: 'USD' });
    expect(details.lastStatement).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      balanceCents: 12345,
      documentId,
      amended: false,
    });
  });

  test('latest amendment revision balance is authoritative when amended', async () => {
    await postJournalEntry({ balanceAfterCents: 99999, postedAt: '2026-09-30T12:00:00Z' });
    const documentId = await issueDocument({ closingBalanceCents: 12345 });
    await addAmendmentRevision(documentId, 13000);
    const details = await getCustomerCreditAccountDetails(customerId, { currencyCode: 'USD' });
    expect(details.lastStatement).toMatchObject({
      balanceCents: 13000,
      documentId,
      amended: true,
    });
  });

  test('falls back to the live journal computation when nothing was issued', async () => {
    await postJournalEntry({ balanceAfterCents: 77700, postedAt: '2026-09-30T12:00:00Z' });
    const details = await getCustomerCreditAccountDetails(customerId, { currencyCode: 'USD' });
    expect(details.lastStatement.balanceCents).toBe(77700);
    expect(details.lastStatement.documentId).toBeUndefined();
  });

  test('null when there is no account activity and no issued document', async () => {
    const details = await getCustomerCreditAccountDetails(customerId, { currencyCode: 'USD' });
    expect(details.lastStatement).toBeNull();
  });
});
