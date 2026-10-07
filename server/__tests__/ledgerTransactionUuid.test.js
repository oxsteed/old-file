'use strict';

/**
 * P0 #3 regression: ledger id type mismatch.
 *
 * restaurant_payouts.ledger_transaction_id / reversal_ledger_transaction_id
 * and credit_adjustments.ledger_transaction_id were BIGINT while
 * oxsteed_credit_transactions.id is UUID. Approving a payout wrote the UUID
 * into the BIGINT column, and the adjustment approve path ran
 * Number(uuid) -> NaN. Migration 702 converts the three columns to UUID with
 * FKs to oxsteed_credit_transactions(id); the approve paths now pass the
 * UUID through as a string.
 *
 * These tests run the REAL approve flows (real controller, real credit
 * service, real journal postings) and assert the ledger ids round-trip as
 * UUID strings that reference actual journal rows.
 *
 * They run ONLY against the disposable localhost credit_statement_test
 * database (same guard family as the statement suites). Without the opt-in
 * URL the DB describes skip (fail closed) instead of touching a database.
 *
 * Run with e.g.
 *   LEDGER_UUID_TEST_DATABASE_URL=postgres://localhost/credit_statement_test \
 *     npx jest __tests__/ledgerTransactionUuid.test.js
 */

jest.unmock('pg');

const crypto = require('crypto');

const { disposableDatabaseOptIn, isDisposableDatabase } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('LEDGER_UUID_TEST_DATABASE_URL');

const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  if (!CAN_RUN_DB) {
    // eslint-disable-next-line no-console
    console.log('ledgerTransactionUuid DB tests skipped: set LEDGER_UUID_TEST_DATABASE_URL to the disposable credit_statement_test database to run them');
  }
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = 'test-secret';
  process.env.PAYOUT_PROCESSOR_ENABLED = 'true';
}

const pool = require('../db');
const controller = require('../controllers/agentCreditAdjustmentController');
const payoutService = require('../services/restaurantPayoutService');
const creditService = require('../services/oxsteedCreditService');
const subBankService = require('../services/oxsteedCreditSubBankService');

jest.setTimeout(120000);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function newUser(role = 'admin') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Ledger', 'Fixture', $3, TRUE, TRUE)`,
    [id, `ledger-${id}@example.invalid`, role]);
  return id;
}

function resDouble() {
  const res = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  return res;
}
const throwingNext = (err) => { throw err; };

async function assertJournalRowExists(ledgerId) {
  expect(typeof ledgerId).toBe('string');
  expect(ledgerId).toMatch(UUID_RE);
  const { rows } = await pool.query(
    `SELECT id, transaction_type FROM oxsteed_credit_transactions WHERE id = $1`,
    [ledgerId]);
  expect(rows[0]).toBeDefined();
  return rows[0];
}

ddescribe('ledger_transaction_id UUID round-trip (P0 #3)', () => {
  beforeAll(async () => {
    // The disposable DB must carry the full migrated schema including 702.
    const { rows: applied } = await pool.query(
      `SELECT status FROM _migrations WHERE filename = '702_ledger_transaction_uuid.sql'`);
    if (!applied[0] || applied[0].status !== 'applied') {
      throw new Error('Migration 702 must be applied before running the ledger UUID tests');
    }
    const { rows: cols } = await pool.query(
      `SELECT table_name, column_name, udt_name
         FROM information_schema.columns
        WHERE table_name IN ('restaurant_payouts', 'credit_adjustments')
          AND column_name IN ('ledger_transaction_id', 'reversal_ledger_transaction_id')`);
    const types = {};
    for (const c of cols) types[`${c.table_name}.${c.column_name}`] = c.udt_name;
    expect(types['restaurant_payouts.ledger_transaction_id']).toBe('uuid');
    expect(types['restaurant_payouts.reversal_ledger_transaction_id']).toBe('uuid');
    expect(types['credit_adjustments.ledger_transaction_id']).toBe('uuid');

    const { rows: fks } = await pool.query(
      `SELECT conname FROM pg_constraint
        WHERE contype = 'f'
          AND conname IN ('fk_restaurant_payouts_ledger_transaction', 'fk_credit_adjustments_ledger_transaction')`);
    expect(fks.map((r) => r.conname).sort()).toEqual([
      'fk_credit_adjustments_ledger_transaction',
      'fk_restaurant_payouts_ledger_transaction',
    ]);
  });

  beforeEach(async () => {
    // The credit rail is disabled by default (migration 422); money cannot
    // move in the fixtures below unless the test enables it explicitly.
    await pool.query(
      `UPDATE feature_flags SET is_enabled = TRUE WHERE key = 'oxsteed_credit_enabled'`);
  });

  test('approving a credit adjustment stores the journal UUID verbatim', async () => {
    const customer = await newUser('customer');
    const proposer = await newUser('admin');
    const approver = await newUser('admin');
    const adjustmentId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO credit_adjustments
         (id, customer_id, amount_cents, currency_code, reason, proposed_by, status, idempotency_key)
       VALUES ($1, $2, 5000, 'USD', 'UUID round-trip fixture', $3, 'pending', $4)`,
      [adjustmentId, customer, proposer, `ledger-uuid-${adjustmentId}`]);

    const res = resDouble();
    await controller.approveAdjustment(
      {
        params: { id: adjustmentId },
        body: {},
        query: {},
        user: { id: approver },
        ip: '127.0.0.1',
        correlationId: `ledger-uuid-${adjustmentId}`,
      },
      res,
      throwingNext,
    );

    expect(res.statusCode).toBe(200);
    expect(res.payload.adjustment.status).toBe('applied');

    // The controller response carries the UUID string (never NaN, never a number).
    const responseId = res.payload.adjustment.ledgerTransactionId;
    const journal = await assertJournalRowExists(responseId);
    expect(journal.transaction_type).toBe('adjustment');

    // And the same UUID string is what actually landed in the database row,
    // satisfying the FK to the journal.
    const { rows: [row] } = await pool.query(
      `SELECT p.ledger_transaction_id, t.id AS journal_id
         FROM credit_adjustments p
         JOIN oxsteed_credit_transactions t ON t.id = p.ledger_transaction_id
        WHERE p.id = $1`,
      [adjustmentId]);
    expect(row).toBeDefined();
    expect(String(row.ledger_transaction_id)).toBe(responseId);
    expect(String(row.journal_id)).toBe(responseId);
  });

  test('approving a restaurant payout stores the journal UUID verbatim', async () => {
    const owner = await newUser('admin');
    const requester = await newUser('admin');
    const approver = await newUser('admin');

    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name)
       VALUES ($1, $2) RETURNING id`,
      [owner, `Ledger UUID ${crypto.randomUUID()}`]);
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status, currency_code)
       VALUES ($1, $2, 'Ledger UUID Kitchen', 'active', 'USD') RETURNING id`,
      [business.id, owner]);

    // Fund the restaurant sub-bank so the payout is covered at execution.
    await pool.query('BEGIN');
    const client = await pool.connect();
    try {
      const subBank = await subBankService.ensureRestaurantSubBankAccount(client, {
        restaurantId: restaurant.id,
        currencyCode: 'USD',
      });
      const treasury = await creditService.ensureAccount(client, {
        accountType: 'platform_treasury',
        currencyCode: 'USD',
      });
      await creditService.postJournalTransaction(client, {
        transactionType: 'sub_bank_opening_balance',
        debitAccountId: treasury.id,
        creditAccountId: subBank.id,
        amountCents: 10000,
        currencyCode: 'USD',
        idempotencyKey: `ledger-uuid-fund-${restaurant.id}`,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const { rows: [payout] } = await pool.query(
      `INSERT INTO restaurant_payouts
         (restaurant_id, currency_code, amount_cents, stripe_account_id, idempotency_key, requested_by)
       VALUES ($1, 'USD', 2000, 'acct_test_ledger_uuid', $2, $3)
       RETURNING *`,
      [restaurant.id, `ledger-uuid-payout-${restaurant.id}`, requester]);

    const done = await payoutService.approvePayout({
      payoutId: payout.id,
      adminUserId: approver,
      reviewNote: 'UUID round-trip fixture',
    });
    expect(done.status).toBe('approved');

    const ledgerId = done.ledger_transaction_id;
    const journal = await assertJournalRowExists(String(ledgerId));
    expect(journal.transaction_type).toBe('sub_bank_payout');

    const { rows: [row] } = await pool.query(
      `SELECT p.ledger_transaction_id, t.id AS journal_id
         FROM restaurant_payouts p
         JOIN oxsteed_credit_transactions t ON t.id = p.ledger_transaction_id
        WHERE p.id = $1`,
      [payout.id]);
    expect(row).toBeDefined();
    expect(String(row.ledger_transaction_id)).toBe(String(ledgerId));
    expect(String(row.journal_id)).toBe(String(ledgerId));

    // The reversal leg gets the same UUID treatment on the compensating entry.
    const transfer = {
      id: 'tr_test_ledger_uuid',
      amount: 2000,
      currency: 'usd',
      destination: 'acct_test_ledger_uuid',
      reversed: true,
      metadata: { restaurant_payout_id: String(payout.id) },
    };
    const result = await payoutService.applyTransferWebhookEvent({
      eventType: 'transfer.reversed',
      transfer,
    });
    expect(result.status).toBe('reversed');

    const { rows: [reversed] } = await pool.query(
      `SELECT p.reversal_ledger_transaction_id, t.id AS journal_id, t.transaction_type
         FROM restaurant_payouts p
         JOIN oxsteed_credit_transactions t ON t.id = p.reversal_ledger_transaction_id
        WHERE p.id = $1`,
      [payout.id]);
    expect(reversed).toBeDefined();
    const reversalId = String(reversed.reversal_ledger_transaction_id);
    expect(reversalId).toMatch(UUID_RE);
    expect(String(reversed.journal_id)).toBe(reversalId);
    expect(reversed.transaction_type).toBe('sub_bank_payout_reversal');
    expect(reversalId).not.toBe(String(ledgerId));
  });

  afterAll(async () => {
    await pool.end();
  });
});
