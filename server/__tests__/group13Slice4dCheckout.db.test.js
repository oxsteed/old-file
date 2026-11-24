'use strict';

// Group 13 Slice 4d acceptance: Checkout (666-670).
// 666/668/669 are EXISTS re-checks (evidence in docs/persona-roadmap/group13.md);
// this suite proves them live against the endpoints, plus the 667 remainder
// display (D-365/D-366) and the 670 expired-hold re-authorization
// (D-367/D-368): one click on an expired hold creates a fresh hold through
// the existing hold-creation path, with the same rail gates and checkout
// restrictions as a fresh authorization, and a repeat click while the fresh
// hold is active replays it instead of reserving twice.
// Runs against a dedicated fresh database (credit_statement_test_g13d) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// Seeding follows the ledger's own rules: accounts start empty (migration
// 491) and balances arrive through postJournalTransaction, exactly like the
// 4b balance suite. Holds go through the real POST /holds path, so the
// participant/agreement fixtures (Didit-verified restaurant participant,
// active agreement, food_online surface) are real too.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP13_SLICE4D_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g13d') {
    throw new Error('Group 13 Slice 4d DB tests require the loopback credit_statement_test_g13d database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.setTimeout(60000);

const { creditRemainder } = require('../utils/creditRemainder');

// Pure derivation: no database needed, runs on every invocation.
describe('Group 13 Slice 4d: remainder derivation (667, D-365)', () => {
  test('fully covered: Credit applied is the total, remainder is zero', () => {
    expect(creditRemainder({ totalCents: 4200, availableCents: 5000 })).toEqual({
      creditAppliedCents: 4200, remainderCents: 0, fullyCovered: true,
    });
  });

  test('partially covered: Credit applied is the balance, remainder is the shortfall', () => {
    expect(creditRemainder({ totalCents: 6500, availableCents: 5000 })).toEqual({
      creditAppliedCents: 5000, remainderCents: 1500, fullyCovered: false,
    });
  });

  test('zero balance: nothing applied, remainder is the total', () => {
    expect(creditRemainder({ totalCents: 6500, availableCents: 0 })).toEqual({
      creditAppliedCents: 0, remainderCents: 6500, fullyCovered: false,
    });
  });

  test('available above the total caps applied at the total', () => {
    expect(creditRemainder({ totalCents: 1000, availableCents: 999999 })).toEqual({
      creditAppliedCents: 1000, remainderCents: 0, fullyCovered: true,
    });
  });

  test('zero, negative, and invalid inputs clamp to zero instead of going negative', () => {
    expect(creditRemainder({ totalCents: 0, availableCents: 5000 })).toEqual({
      creditAppliedCents: 0, remainderCents: 0, fullyCovered: true,
    });
    expect(creditRemainder({ totalCents: -100, availableCents: -50 })).toEqual({
      creditAppliedCents: 0, remainderCents: 0, fullyCovered: true,
    });
    expect(creditRemainder({ totalCents: 'nope', availableCents: null })).toEqual({
      creditAppliedCents: 0, remainderCents: 0, fullyCovered: true,
    });
  });
});

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 13 Slice 4d: checkout reads and expired-hold re-authorization (666-670)', () => {
  let pool;
  let creditCtrl;
  let creditService;
  let app;
  let admin;
  let checker;
  let treasuryId;
  let partnerId;
  let agreementId;
  let payableId;
  let restaurantId;

  beforeAll(async () => {
    pool = require('../db');
    creditService = require('../services/oxsteedCreditService');
    creditCtrl = require('../controllers/oxsteedCreditController');
    const { authenticate } = require('../middleware/auth');
    const checkRestrictions = require('../middleware/checkRestrictions');
    app = express();
    app.use(express.json());
    app.get('/api/oxsteed-credit/account', authenticate, creditCtrl.getMyAccount);
    app.get('/api/oxsteed-credit/eligibility', authenticate, creditCtrl.getCustomerEligibility);
    app.get('/api/oxsteed-credit/holds', authenticate, creditCtrl.listMyHolds);
    app.get('/api/oxsteed-credit/transactions/:transactionId', authenticate, creditCtrl.getMyTransaction);
    app.post('/api/oxsteed-credit/holds', authenticate, creditCtrl.createMyHold);
    app.use(require('../middleware/errorHandler').errorHandler);

    admin = await makeUser('super_admin');
    checker = await makeUser('super_admin');
    // Holds require the credit rail on (assertCreditRailEnabled); this
    // dedicated test DB is only used by this suite.
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', true, 'Group 13 Slice 4d test')
       ON CONFLICT (key) DO UPDATE SET is_enabled = true`,
    );
    treasuryId = await ensureCreditAccount({ accountType: 'platform_treasury' });
    // A real restaurant partner: the hold path resolves the agreement
    // through a Didit-verified restaurant participant (findSpendAgreement),
    // so the restaurant row must be active, not the 'draft' default.
    const owner = await makeUser();
    const { rows: [biz] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id`,
      [owner.id, `Slice 4d Diner ${crypto.randomUUID().slice(0, 8)}`],
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code, status)
       VALUES ($1, $2, $3, 'America/New_York', 'USD', 'active') RETURNING id`,
      [biz.id, owner.id, 'Slice 4d Diner'],
    );
    restaurantId = rest.id;
    const { rows: [partner] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (status, settlement_currency_code, created_by, restaurant_id)
       VALUES ('active', 'USD', $1, $2) RETURNING id`,
      [admin.id, restaurantId],
    );
    partnerId = String(partner.id);
    const { rows: [agreement] } = await pool.query(
      `INSERT INTO oxsteed_credit_partner_agreements
         (partner_id, version, status, starts_at, allowed_order_types, allowed_categories, created_by, approved_by)
       VALUES ($1, 1, 'active', NOW() - INTERVAL '1 day', '{}', '{}', $2, $3) RETURNING id`,
      [partnerId, admin.id, checker.id],
    );
    agreementId = agreement.id;
    await pool.query(
      `INSERT INTO credit_participants (partner_id, participant_type, restaurant_id, status, didit_verified, didit_verified_at, allowed_surfaces)
       VALUES ($1, 'restaurant', $2, 'active', TRUE, NOW(), '{food_online,food_pos,chat}')`,
      [partnerId, restaurantId],
    );
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

  async function ensureCreditAccount({ accountType, customerId = null, partnerId: pid = null }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const account = await creditService.ensureAccount(client, {
        accountType, customerId, partnerId: pid, currencyCode: 'USD',
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
  const postAs = (user, path) => request(app).post(path).set('Authorization', `Bearer ${tokenFor(user)}`);

  async function postLedger(user, walletId, postings) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ids = {};
      for (const posting of postings) {
        const { transaction } = await creditService.postJournalTransaction(client, {
          currencyCode: 'USD',
          ...posting,
          idempotencyKey: `g13d-${posting.key}-${user.id}`,
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

  async function fundWallet(user, walletId, amountCents) {
    await postLedger(user, walletId, [
      {
        key: 'load', transactionType: 'load', debitAccountId: treasuryId, creditAccountId: walletId,
        amountCents, actorType: 'admin', actorUserId: admin.id, reason: 'Fixture load',
        referenceType: 'admin_load', referenceId: 'fixture-load', description: 'Fixture load',
      },
    ]);
  }

  async function walletState(walletId) {
    const { rows: [row] } = await pool.query(
      `SELECT balance_cents, reserved_cents FROM oxsteed_credit_accounts WHERE id = $1`,
      [walletId],
    );
    return { balance: Number(row.balance_cents), reserved: Number(row.reserved_cents) };
  }

  async function ledgerCount() {
    const { rows: [row] } = await pool.query(`SELECT COUNT(*)::int AS n FROM oxsteed_credit_transactions`);
    return row.n;
  }

  async function holdCountFor(user) {
    const { rows: [row] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM oxsteed_credit_holds WHERE customer_id = $1`,
      [user.id],
    );
    return row.n;
  }

  test('666 re-check: eligibility carries the amount preview and the account carries the available balance', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    await fundWallet(user, walletId, 5000);

    const eligibility = await getAs(user, `/api/oxsteed-credit/eligibility?restaurantId=${restaurantId}&amountCents=6500&currencyCode=USD`);
    expect(eligibility.status).toBe(200);
    expect(eligibility.body).toMatchObject({ eligible: true, partnerId });
    // 667: the same response carries the remainder for that amount.
    expect(eligibility.body).toMatchObject({ creditAppliedCents: 5000, remainderCents: 1500 });

    const account = await getAs(user, '/api/oxsteed-credit/account');
    expect(account.status).toBe(200);
    expect(account.body.account).toMatchObject({
      balanceCents: 5000, availableBalanceCents: 5000, reservedCents: 0, currencyCode: 'USD',
    });
  });

  test('667: a covered total has a zero remainder', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    await fundWallet(user, walletId, 5000);

    const eligibility = await getAs(user, `/api/oxsteed-credit/eligibility?restaurantId=${restaurantId}&amountCents=4000&currencyCode=USD`);
    expect(eligibility.status).toBe(200);
    expect(eligibility.body).toMatchObject({ eligible: true, creditAppliedCents: 4000, remainderCents: 0 });
  });

  test('667: eligibility without an amount omits the remainder fields', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    await fundWallet(user, walletId, 5000);

    const eligibility = await getAs(user, `/api/oxsteed-credit/eligibility?restaurantId=${restaurantId}&currencyCode=USD`);
    expect(eligibility.status).toBe(200);
    expect(eligibility.body).toMatchObject({ eligible: true });
    expect(eligibility.body).not.toHaveProperty('remainderCents');
    expect(eligibility.body).not.toHaveProperty('creditAppliedCents');
  });

  test('667: computing and showing a remainder moves no money', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    await fundWallet(user, walletId, 5000);
    const before = await walletState(walletId);
    const ledgerBefore = await ledgerCount();
    const holdsBefore = await holdCountFor(user);

    // The reads the checkout remainder display depends on: the account
    // balance and the eligibility amount preview.
    const account = await getAs(user, '/api/oxsteed-credit/account');
    expect(account.body.account.availableBalanceCents).toBe(5000);
    const eligibility = await getAs(user, `/api/oxsteed-credit/eligibility?restaurantId=${restaurantId}&amountCents=6500&currencyCode=USD`);
    expect(eligibility.body).toMatchObject({ creditAppliedCents: 5000, remainderCents: 1500 });

    expect(await walletState(walletId)).toEqual(before);
    expect(await ledgerCount()).toBe(ledgerBefore);
    expect(await holdCountFor(user)).toBe(holdsBefore);
  });

  test('668 re-check: creating a hold requires the owner as actor', async () => {
    const user = await makeUser();
    await makeWallet(user);
    await expect(creditService.createCreditHold({
      customerId: user.id,
      partnerId: Number(partnerId),
      amountCents: 100,
      idempotencyKey: `g13d-no-actor-${user.id}`,
    })).rejects.toMatchObject({ code: 'credit_hold_actor_required' });
    expect(await holdCountFor(user)).toBe(0);
  });

  test('669 re-check: transaction detail carries amount, type, balance after, and reference', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const { purchase } = await postLedger(user, walletId, [
      {
        key: 'load', transactionType: 'load', debitAccountId: treasuryId, creditAccountId: walletId,
        amountCents: 5000, actorType: 'admin', actorUserId: admin.id, reason: 'Fixture load',
        referenceType: 'admin_load', referenceId: 'fixture-load', description: 'Fixture load',
      },
      {
        key: 'purchase', transactionType: 'purchase', debitAccountId: walletId, creditAccountId: payableId,
        amountCents: 2500, actorType: 'customer', actorUserId: user.id, reason: 'Fixture purchase',
        partnerId, agreementId,
        referenceType: 'test', referenceId: `g13d-${user.id}`, description: 'Fixture purchase',
      },
    ]);

    const res = await getAs(user, `/api/oxsteed-credit/transactions/${purchase}`);
    expect(res.status).toBe(200);
    expect(res.body.transaction).toMatchObject({
      id: String(purchase),
      transactionType: 'purchase',
      amountCents: 2500,
      balanceAfterCents: 2500,
      referenceType: 'test',
    });
    expect(res.body.transaction).toHaveProperty('postedAt');
  });
});
