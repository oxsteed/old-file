'use strict';

// Group 13 Slice 4b acceptance: Understand balance (656-660).
// 656/658/660 are EXISTS re-checks (evidence in docs/persona-roadmap/group13.md);
// this suite proves them live against the endpoints, plus the 657 pending
// top-up list (D-360) and the 659 reversal explanation (D-361). A customer
// sees only their own account activity throughout.
// Runs against a dedicated fresh database (credit_statement_test_g13b) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// Seeding follows the ledger's own rules: accounts start empty (migration
// 491) and balances arrive through postJournalTransaction / refundCredit,
// exactly like the cashout lifecycle tests. Purchases go wallet -> partner
// payable under an active agreement (migrations 449/877); refunds go back
// through refundCredit, so their reference names the purchase transaction
// (migration 476).

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP13_SLICE4B_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g13b') {
    throw new Error('Group 13 Slice 4b DB tests require the loopback credit_statement_test_g13b database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.setTimeout(60000);

const creditService = require('../services/oxsteedCreditService');
const { storedReversalReason, derivedReversalReasonCode } = creditService;

// Pure derivation: no database needed, runs on every invocation.
describe('Group 13 Slice 4b: reversal derivation (659, D-361)', () => {
  test('a stored reason is returned verbatim', () => {
    expect(storedReversalReason({ reason: 'Duplicate payout recovered from the provider' }))
      .toBe('Duplicate payout recovered from the provider');
  });

  test('a missing, blank, or legacy-sentinel reason counts as no stored reason', () => {
    expect(storedReversalReason({ reason: null })).toBeNull();
    expect(storedReversalReason({ reason: '   ' })).toBeNull();
    expect(storedReversalReason({ reason: 'Legacy transaction: reason unavailable' })).toBeNull();
  });

  test('derived codes cover every reversal kind the detail read can return', () => {
    expect(derivedReversalReasonCode({ transaction_type: 'refund' })).toBe('purchase_refund');
    expect(derivedReversalReasonCode({
      transaction_type: 'sub_bank_load_reversal',
      metadata: { foodWalletReferenceType: 'credit_refund' },
    })).toBe('refund');
    expect(derivedReversalReasonCode({
      transaction_type: 'sub_bank_load_reversal',
      metadata: { foodWalletReferenceType: 'credit_derisk' },
    })).toBe('derisk');
    expect(derivedReversalReasonCode({ transaction_type: 'sub_bank_load_reversal', metadata: {} }))
      .toBe('load_reversal');
    expect(derivedReversalReasonCode({ transaction_type: 'sub_bank_payout_reversal' }))
      .toBe('payout_reversed');
    expect(derivedReversalReasonCode({ transaction_type: 'settlement_reversal' })).toBe('settlement');
  });

  test('a non-reversal has no derived code', () => {
    expect(derivedReversalReasonCode({ transaction_type: 'purchase' })).toBeNull();
    expect(derivedReversalReasonCode({ transaction_type: 'load' })).toBeNull();
  });
});

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 13 Slice 4b: balance reads on the customer endpoints (656-660)', () => {
  let pool;
  let creditCtrl;
  let topupCtrl;
  let app;
  let admin;
  let treasuryId;
  let partnerId;
  let agreementId;
  let payableId;

  beforeAll(async () => {
    pool = require('../db');
    creditCtrl = require('../controllers/oxsteedCreditController');
    topupCtrl = require('../controllers/oxsteedCreditTopupController');
    const { authenticate } = require('../middleware/auth');
    app = express();
    app.use(express.json());
    app.get('/api/oxsteed-credit/account', authenticate, creditCtrl.getMyAccount);
    app.get('/api/oxsteed-credit/transactions', authenticate, creditCtrl.getMyTransactions);
    app.get('/api/oxsteed-credit/transactions/:transactionId', authenticate, creditCtrl.getMyTransaction);
    app.get('/api/oxsteed-credit/statement', authenticate, creditCtrl.getMyStatement);
    app.get('/api/oxsteed-credit/topups', authenticate, topupCtrl.listMyTopups);
    app.get('/api/oxsteed-credit/topups/:id', authenticate, topupCtrl.getTopup);
    app.use(require('../middleware/errorHandler').errorHandler);

    admin = await makeUser('super_admin');
    const checker = await makeUser('super_admin');
    // Holds require the credit rail on (assertCreditRailEnabled); this
    // dedicated test DB is only used by this suite.
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', true, 'Group 13 Slice 4b test')
       ON CONFLICT (key) DO UPDATE SET is_enabled = true`,
    );
    treasuryId = await ensureCreditAccount({ accountType: 'platform_treasury' });
    // Purchases require an active partner agreement (migrations 449/877,
    // same shape as the cashout lifecycle tests).
    const { rows: [partner] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (status, settlement_currency_code, created_by)
       VALUES ('active', 'USD', $1) RETURNING id`,
      [admin.id],
    );
    partnerId = String(partner.id);
    const { rows: [agreement] } = await pool.query(
      `INSERT INTO oxsteed_credit_partner_agreements
         (partner_id, version, status, starts_at, allowed_order_types, allowed_categories, created_by, approved_by)
       VALUES ($1, 1, 'active', NOW() - INTERVAL '1 day', '{}', '{}', $2, $3) RETURNING id`,
      [partnerId, admin.id, checker.id],
    );
    agreementId = agreement.id;
    payableId = await ensureCreditAccount({ accountType: 'partner_payable', partnerId: partner.id });
  });
  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
      await pool.end();
    }
  });

  async function makeUser(role = 'customer') {
    const id = crypto.randomUUID();
    const email = `t${id}@example.invalid`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, totp_enabled)
       VALUES ($1, $2, 'x', 'Test', 'Fixture', $3, TRUE, TRUE, TRUE)`,
      [id, email, role],
    );
    return { id, email, role };
  }

  // Accounts start empty (migration 491); balances arrive via the journal.
  async function ensureCreditAccount({ accountType, customerId = null, partnerId = null }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const account = await creditService.ensureAccount(client, {
        accountType, customerId, partnerId, currencyCode: 'USD',
      });
      await client.query('COMMIT');
      return account.id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function makeWallet(user) {
    return ensureCreditAccount({ accountType: 'customer_wallet', customerId: user.id });
  }

  const tokenFor = (user) => require('../middleware/auth').generateTokens(user).accessToken;
  const getAs = (user, path) => request(app).get(path).set('Authorization', `Bearer ${tokenFor(user)}`);

  async function postLedger(user, walletId, postings) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ids = {};
      for (const posting of postings) {
        const { transaction } = await creditService.postJournalTransaction(client, {
          currencyCode: 'USD',
          ...posting,
          idempotencyKey: `g13b-${posting.key}-${user.id}`,
        });
        ids[posting.key] = transaction.id;
      }
      await client.query('COMMIT');
      return ids;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // A coherent three-entry wallet ledger: load 5000, purchase 2500,
  // refund 2500. Running balance: 5000 -> 2500 -> 5000. The purchase goes
  // wallet -> partner payable under the active agreement (migrations
  // 449/877); the refund goes back through the real refundCredit path, so
  // its reference names the purchase transaction (migration 476).
  async function seedLedger(user, walletId) {
    const { load, purchase } = await postLedger(user, walletId, [
      {
        key: 'load', transactionType: 'load', debitAccountId: treasuryId, creditAccountId: walletId,
        amountCents: 5000, actorType: 'admin', actorUserId: admin.id, reason: 'Fixture load',
        referenceType: 'admin_load', referenceId: 'fixture-load', description: 'Fixture load',
      },
      {
        key: 'purchase', transactionType: 'purchase', debitAccountId: walletId, creditAccountId: payableId,
        amountCents: 2500, actorType: 'customer', actorUserId: user.id, reason: 'Fixture purchase',
        partnerId, agreementId,
        referenceType: 'test', referenceId: `g13b-${user.id}`, description: 'Fixture purchase',
      },
    ]);
    const { transaction: refund } = await creditService.refundCredit({
      purchaseTransactionId: purchase,
      amountCents: 2500,
      idempotencyKey: `g13b-refund-${user.id}`,
      actorUserId: admin.id,
      actorType: 'admin',
      reason: 'Fixture refund',
    });
    return { load, purchase, refund: refund.id };
  }

  async function seedTopup({ customerId, amountCents, status, createdAt }) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO oxsteed_credit_topups (customer_id, amount_cents, currency_code, status, idempotency_key, expires_at, created_at)
       VALUES ($1, $2, 'USD', $3, $4, NOW() + INTERVAL '30 minutes', $5) RETURNING *`,
      [customerId, amountCents, status, crypto.randomUUID(), createdAt],
    );
    return row;
  }

  test('656 re-check: account returns live balance, available, reserved, currency', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    await postLedger(user, walletId, [
      {
        key: 'load', transactionType: 'load', debitAccountId: treasuryId, creditAccountId: walletId,
        amountCents: 5000, actorType: 'admin', actorUserId: admin.id, reason: 'Fixture load',
        referenceType: 'admin_load', referenceId: 'fixture-load', description: 'Fixture load',
      },
    ]);
    // reserved_cents is guarded by the reservation total (migration 755:
    // it must equal active holds plus active reservations), so it is
    // produced by a real active hold row, inserted together with the
    // reserved bump in one transaction — the guard is a deferred
    // constraint trigger, so it fires at COMMIT when both agree.
    // (createCreditHold would need a Didit-verified restaurant participant
    // for the partner; that fixture weight belongs to the participant
    // slice, not to this balance re-check.)
    const holdClient = await pool.connect();
    try {
      await holdClient.query('BEGIN');
      await holdClient.query(
        `INSERT INTO oxsteed_credit_holds
           (account_id, customer_id, partner_id, agreement_id, amount_cents, currency_code,
            idempotency_key, expires_at, created_by)
         VALUES ($1, $2, $3, $4, 1000, 'USD', $5, NOW() + INTERVAL '1 hour', $2)`,
        [walletId, user.id, partnerId, agreementId, `g13b-hold-${user.id}`],
      );
      await holdClient.query(
        'UPDATE oxsteed_credit_accounts SET reserved_cents = 1000 WHERE id = $1',
        [walletId],
      );
      await holdClient.query('COMMIT');
    } catch (error) {
      await holdClient.query('ROLLBACK');
      throw error;
    } finally {
      holdClient.release();
    }

    const res = await getAs(user, '/api/oxsteed-credit/account');
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({
      balanceCents: 5000,
      availableBalanceCents: 4000,
      reservedCents: 1000,
      currencyCode: 'USD',
    });
  });

  test('657: pending top-ups listed for the owner only, newest first', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    await seedTopup({ customerId: owner.id, amountCents: 2500, status: 'pending', createdAt: '2026-11-24T10:00:00Z' });
    const newest = await seedTopup({ customerId: owner.id, amountCents: 5000, status: 'pending', createdAt: '2026-11-24T11:00:00Z' });
    await seedTopup({ customerId: owner.id, amountCents: 1000, status: 'completed', createdAt: '2026-11-24T09:00:00Z' });
    await seedTopup({ customerId: other.id, amountCents: 9900, status: 'pending', createdAt: '2026-11-24T12:00:00Z' });

    const res = await getAs(owner, '/api/oxsteed-credit/topups?status=pending');
    expect(res.status).toBe(200);
    expect(res.body.topups).toHaveLength(2);
    expect(res.body.topups[0]).toMatchObject({ id: String(newest.id), amountCents: 5000, status: 'pending', currencyCode: 'USD' });
    expect(res.body.topups[1]).toMatchObject({ amountCents: 2500, status: 'pending' });
    expect(res.body.topups[0]).toHaveProperty('createdAt');
    expect(res.body.topups[0]).toHaveProperty('expiresAt');
  });

  test('657: unfiltered list shows the owner’s completed top-up too, never another customer’s', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    await seedTopup({ customerId: owner.id, amountCents: 2500, status: 'pending', createdAt: '2026-11-24T10:00:00Z' });
    await seedTopup({ customerId: owner.id, amountCents: 1000, status: 'completed', createdAt: '2026-11-24T09:00:00Z' });
    await seedTopup({ customerId: other.id, amountCents: 9900, status: 'pending', createdAt: '2026-11-24T12:00:00Z' });

    const mine = await getAs(owner, '/api/oxsteed-credit/topups');
    expect(mine.status).toBe(200);
    expect(mine.body.topups).toHaveLength(2);
    expect(mine.body.topups.map((t) => t.status).sort()).toEqual(['completed', 'pending']);

    const theirs = await getAs(other, '/api/oxsteed-credit/topups');
    expect(theirs.status).toBe(200);
    expect(theirs.body.topups).toHaveLength(1);
    expect(theirs.body.topups[0]).toMatchObject({ amountCents: 9900 });
  });

  test('657: an unknown status falls back to the unfiltered list', async () => {
    const owner = await makeUser();
    await seedTopup({ customerId: owner.id, amountCents: 2500, status: 'pending', createdAt: '2026-11-24T10:00:00Z' });
    await seedTopup({ customerId: owner.id, amountCents: 1000, status: 'completed', createdAt: '2026-11-24T09:00:00Z' });

    const res = await getAs(owner, '/api/oxsteed-credit/topups?status=bogus');
    expect(res.status).toBe(200);
    expect(res.body.topups).toHaveLength(2);
  });

  test('657: a top-up is readable by id for its owner and not for anyone else', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const mine = await seedTopup({ customerId: owner.id, amountCents: 2500, status: 'pending', createdAt: '2026-11-24T10:00:00Z' });
    const notMine = await seedTopup({ customerId: other.id, amountCents: 9900, status: 'pending', createdAt: '2026-11-24T12:00:00Z' });

    const ok = await getAs(owner, `/api/oxsteed-credit/topups/${mine.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.topup).toMatchObject({ id: String(mine.id), amountCents: 2500, status: 'pending' });

    const denied = await getAs(owner, `/api/oxsteed-credit/topups/${notMine.id}`);
    expect(denied.status).toBe(404);
  });

  test('658 re-check: posted history lists the wallet’s transactions', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const { load, purchase, refund } = await seedLedger(user, walletId);

    const res = await getAs(user, '/api/oxsteed-credit/transactions');
    expect(res.status).toBe(200);
    const ids = res.body.transactions.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([String(load), String(purchase), String(refund)]));
    expect(res.body.transactions.every((t) => t.status === 'posted')).toBe(true);
  });

  test('658 re-check: detail carries the running balance after the entry', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const { purchase } = await seedLedger(user, walletId);

    const res = await getAs(user, `/api/oxsteed-credit/transactions/${purchase}`);
    expect(res.status).toBe(200);
    expect(res.body.transaction).toMatchObject({ id: String(purchase), transactionType: 'purchase' });
    expect(res.body.transaction.balanceAfterCents).toBe(2500);
  });

  test('659: refund detail explains the reversal and links the original purchase', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const { purchase, refund } = await seedLedger(user, walletId);

    const res = await getAs(user, `/api/oxsteed-credit/transactions/${refund}`);
    expect(res.status).toBe(200);
    expect(res.body.transaction).toMatchObject({
      id: String(refund),
      isReversal: true,
      reversalReason: 'Fixture refund',
      reversalReasonCode: 'purchase_refund',
      originalTransactionId: String(purchase),
    });
  });

  test('659: a plain purchase is not a reversal', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const { purchase } = await seedLedger(user, walletId);

    const res = await getAs(user, `/api/oxsteed-credit/transactions/${purchase}`);
    expect(res.status).toBe(200);
    expect(res.body.transaction).toMatchObject({
      isReversal: false,
      reversalReason: null,
      reversalReasonCode: null,
      originalTransactionId: null,
    });
  });

  test('659: detail of another customer’s transaction is not found', async () => {
    // The reversal link is only ever exposed for a transaction the caller
    // can open; the same ownership rule guards the detail read itself.
    // (Settlement and sub-bank reversals need no separate link test here:
    // the DB itself forbids a wallet-visible row for those types —
    // migrations 516/632 pin their direction to treasury/partner legs —
    // so the link can only ever resolve to null for a customer, which the
    // pure derivation tests and D-361 already pin down.)
    const owner = await makeUser();
    const other = await makeUser();
    const walletId = await makeWallet(owner);
    const { purchase } = await seedLedger(owner, walletId);

    const res = await getAs(other, `/api/oxsteed-credit/transactions/${purchase}`);
    expect(res.status).toBe(404);
  });

  test('660 re-check: statement reconciles opening, credits, debits, closing', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    await seedLedger(user, walletId);

    const res = await getAs(user, '/api/oxsteed-credit/statement');
    expect(res.status).toBe(200);
    expect(res.body.statement).toMatchObject({
      openingBalanceCents: 0,
      totalCreditsCents: 7500,
      totalDebitsCents: 2500,
      closingBalanceCents: 5000,
      transactionCount: 3,
    });
  });
});
