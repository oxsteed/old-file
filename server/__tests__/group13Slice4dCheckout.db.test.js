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
    // The reauthorize route carries checkRestrictions('checkout') exactly
    // like POST /holds (D-367); in NODE_ENV=test the middleware is a
    // no-op, and the restriction test below flips NODE_ENV to prove it.
    app.post('/api/oxsteed-credit/holds/:holdId/reauthorize', authenticate, checkRestrictions('checkout'), creditCtrl.reauthorizeMyHold);
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

  // A real expired hold: created through POST /holds with a two-second
  // expiry, then expired through the real expiry sweeper once the time
  // passes, so the row carries the stored scope, purpose, and metadata
  // the re-authorization replays. The hold table is append-only
  // (migration 469): expires_at and metadata cannot be moved by hand.
  async function createExpiredHold(user, amountCents) {
    const walletId = await makeWallet(user);
    await fundWallet(user, walletId, 5000);
    const created = await postAs(user, '/api/oxsteed-credit/holds')
      .set('Idempotency-Key', `g13d-hold-${user.id}`)
      .send({
        partnerId, amountCents, currencyCode: 'USD', purpose: 'Fixture hold', orderType: 'pickup',
        expiresAt: new Date(Date.now() + 2000).toISOString(),
      });
    expect(created.status).toBe(201);
    const hold = created.body.hold;
    expect(hold).toMatchObject({ status: 'active', amountCents, partnerId });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const expired = await creditService.expireCreditHolds({ limit: 10 });
    expect(expired.count).toBeGreaterThanOrEqual(1);
    const { rows: [row] } = await pool.query(
      `SELECT status FROM oxsteed_credit_holds WHERE id = $1`,
      [hold.id],
    );
    expect(row.status).toBe('expired');
    expect(await walletState(walletId)).toEqual({ balance: 5000, reserved: 0 });
    return { hold, walletId };
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

  test('670: re-authorizing an expired hold creates a fresh hold for the same amount and restaurant', async () => {
    const user = await makeUser();
    const { hold: expired, walletId } = await createExpiredHold(user, 2500);

    const res = await postAs(user, `/api/oxsteed-credit/holds/${expired.id}/reauthorize`).send({});
    expect(res.status).toBe(201);
    expect(res.body.replayed).toBe(false);
    expect(res.body.reauthorizedFrom).toBe(String(expired.id));
    const fresh = res.body.hold;
    expect(fresh).toMatchObject({ status: 'active', amountCents: 2500, partnerId });
    expect(fresh.id).not.toBe(String(expired.id));
    expect(await walletState(walletId)).toEqual({ balance: 5000, reserved: 2500 });

    // The expired hold stays expired with its released date; both rows list.
    const list = await getAs(user, '/api/oxsteed-credit/holds?status=all');
    expect(list.status).toBe(200);
    const byId = Object.fromEntries(list.body.holds.map((h) => [h.id, h]));
    expect(byId[String(expired.id)]).toMatchObject({ status: 'expired' });
    expect(byId[String(expired.id)].releasedAt).toBeTruthy();
    expect(byId[fresh.id]).toMatchObject({ status: 'active', amountCents: 2500 });

    // The link is recorded on the fresh hold (D-368); the expired hold
    // itself is never mutated — migration 469 forbids it.
    const { rows: [freshRow] } = await pool.query(
      `SELECT metadata FROM oxsteed_credit_holds WHERE id = $1`,
      [fresh.id],
    );
    expect(freshRow.metadata.reauthorizedFrom).toBe(String(expired.id));
    const { rows: [expiredRow] } = await pool.query(
      `SELECT metadata FROM oxsteed_credit_holds WHERE id = $1`,
      [expired.id],
    );
    expect(expiredRow.metadata.reauthorizedHoldId).toBeUndefined();

    const { rows: events } = await pool.query(
      `SELECT action_type, resource_id FROM oxsteed_credit_audit_events
        WHERE action_type = 'credit.hold.reauthorized' AND customer_id = $1`,
      [user.id],
    );
    expect(events).toHaveLength(1);
    expect(events[0].resource_id).toBe(String(fresh.id));
  });

  test('670: a repeat re-authorization while the fresh hold is active replays it instead of reserving twice', async () => {
    const user = await makeUser();
    const { hold: expired, walletId } = await createExpiredHold(user, 2500);

    const first = await postAs(user, `/api/oxsteed-credit/holds/${expired.id}/reauthorize`).send({});
    expect(first.status).toBe(201);
    const second = await postAs(user, `/api/oxsteed-credit/holds/${expired.id}/reauthorize`).send({});
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ replayed: true, reauthorizedFrom: String(expired.id) });
    expect(second.body.hold.id).toBe(first.body.hold.id);
    expect(await walletState(walletId)).toEqual({ balance: 5000, reserved: 2500 });
    expect(await holdCountFor(user)).toBe(2); // expired + the one fresh hold
  });

  test('670: an active hold cannot be re-authorized', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    await fundWallet(user, walletId, 5000);
    const created = await postAs(user, '/api/oxsteed-credit/holds')
      .set('Idempotency-Key', `g13d-active-${user.id}`)
      .send({ partnerId, amountCents: 2500, currencyCode: 'USD', purpose: 'Fixture hold', orderType: 'pickup' });
    expect(created.status).toBe(201);

    const res = await postAs(user, `/api/oxsteed-credit/holds/${created.body.hold.id}/reauthorize`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('credit_hold_state_invalid');
    expect(await holdCountFor(user)).toBe(1);
    expect(await walletState(walletId)).toEqual({ balance: 5000, reserved: 2500 });
  });

  test('670: another customer cannot re-authorize the hold', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const { hold: expired, walletId } = await createExpiredHold(owner, 2500);

    const res = await postAs(other, `/api/oxsteed-credit/holds/${expired.id}/reauthorize`).send({});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('credit_hold_not_found');
    expect(await holdCountFor(owner)).toBe(1);
    expect(await holdCountFor(other)).toBe(0);
    expect(await walletState(walletId)).toEqual({ balance: 5000, reserved: 0 });
  });

  test('670: re-authorization fails closed when the rail is off', async () => {
    const user = await makeUser();
    const { hold: expired, walletId } = await createExpiredHold(user, 2500);
    try {
      await pool.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'oxsteed_credit_enabled'`);
      const res = await postAs(user, `/api/oxsteed-credit/holds/${expired.id}/reauthorize`).send({});
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('credit_rail_suspended');
      expect(await holdCountFor(user)).toBe(1);
      expect(await walletState(walletId)).toEqual({ balance: 5000, reserved: 0 });
    } finally {
      await pool.query(`UPDATE feature_flags SET is_enabled = true WHERE key = 'oxsteed_credit_enabled'`);
    }
  });

  test('670: re-authorization fails closed when the balance no longer covers the amount', async () => {
    const user = await makeUser();
    const { hold: expired, walletId } = await createExpiredHold(user, 2500);
    // Spend the whole balance after the hold expired: the fresh check must
    // refuse instead of reserving money that is not there.
    await postLedger(user, walletId, [
      {
        key: 'spend', transactionType: 'purchase', debitAccountId: walletId, creditAccountId: payableId,
        amountCents: 5000, actorType: 'customer', actorUserId: user.id, reason: 'Fixture spend',
        partnerId, agreementId,
        referenceType: 'test', referenceId: `g13d-spend-${user.id}`, description: 'Fixture spend',
      },
    ]);
    expect(await walletState(walletId)).toEqual({ balance: 0, reserved: 0 });

    const res = await postAs(user, `/api/oxsteed-credit/holds/${expired.id}/reauthorize`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('credit_insufficient_funds');
    expect(await holdCountFor(user)).toBe(1);
  });

  test('670: a checkout restriction blocks re-authorization', async () => {
    const user = await makeUser();
    const { hold: expired } = await createExpiredHold(user, 2500);
    // checkRestrictions is a no-op in NODE_ENV=test; flip it on for this
    // request so the middleware runs exactly as in production.
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      await pool.query(`UPDATE users SET is_suspended = true, suspended_until = NULL WHERE id = $1`, [user.id]);
      const res = await postAs(user, `/api/oxsteed-credit/holds/${expired.id}/reauthorize`).send({});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
      expect(await holdCountFor(user)).toBe(1);
    } finally {
      await pool.query(`UPDATE users SET is_suspended = false, suspended_until = NULL WHERE id = $1`, [user.id]);
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  test('670: the same expired hold can be re-authorized again after the fresh hold expires', async () => {
    const user = await makeUser();
    const { hold: expired, walletId } = await createExpiredHold(user, 2500);

    const first = await postAs(user, `/api/oxsteed-credit/holds/${expired.id}/reauthorize`).send({});
    expect(first.status).toBe(201);
    // End the fresh hold through the real release path (the hold table is
    // append-only, migration 469: expires_at cannot be moved by hand), so
    // the next re-authorization starts a new episode (D-368).
    const released = await creditService.releaseCreditHold({
      customerId: user.id, holdId: first.body.hold.id, actorUserId: user.id,
    });
    expect(released.hold.status).toBe('released');
    expect(await walletState(walletId)).toEqual({ balance: 5000, reserved: 0 });

    const second = await postAs(user, `/api/oxsteed-credit/holds/${expired.id}/reauthorize`).send({});
    expect(second.status).toBe(201);
    expect(second.body.replayed).toBe(false);
    expect(second.body.hold.id).not.toBe(first.body.hold.id);
    expect(second.body.hold).toMatchObject({ status: 'active', amountCents: 2500 });
    expect(await walletState(walletId)).toEqual({ balance: 5000, reserved: 2500 });
    expect(await holdCountFor(user)).toBe(3);
  });

  test('670: re-authorization re-checks the agreement — a suspended agreement refuses', async () => {
    const user = await makeUser();
    const { hold: expired, walletId } = await createExpiredHold(user, 2500);
    try {
      // Agreement status stays mutable under migration 450 (only the
      // terms freeze); suspending it must fail the fresh agreement check.
      await pool.query(
        `UPDATE oxsteed_credit_partner_agreements SET status = 'suspended' WHERE id = $1`,
        [agreementId],
      );
      const res = await postAs(user, `/api/oxsteed-credit/holds/${expired.id}/reauthorize`).send({});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('credit_partner_not_eligible');
      expect(await holdCountFor(user)).toBe(1);
      expect(await walletState(walletId)).toEqual({ balance: 5000, reserved: 0 });
    } finally {
      await pool.query(
        `UPDATE oxsteed_credit_partner_agreements SET status = 'active' WHERE id = $1`,
        [agreementId],
      );
    }
  });

  // G13-A2: the wallet's held money is holds AND reservations, but the
  // holds list read only oxsteed_credit_holds — a funded planned need was
  // invisible while its money was unspendable.
  test('G13-A2: a funded planned need shows as a reservation line item, and the active rows sum to the reserved balance', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    await fundWallet(user, walletId, 100000);
    const { rows: [need] } = await pool.query(
      `INSERT INTO planned_needs (user_id, title, category, status, due_date, estimated_cost, reserved_amount)
       VALUES ($1, 'Boiler service', 'other', 'planned', '2027-06-01', 100, 0) RETURNING id`,
      [user.id],
    );
    const { withTransaction } = require('../utils/transaction');
    const { placePlannedNeedCreditHold, releasePlannedNeedCreditHolds } = require('../services/plannedNeedCreditHoldService');
    await withTransaction(pool, async (client) => {
      await placePlannedNeedCreditHold(client, {
        needId: need.id, customerId: user.id, amountCents: 2500, currencyCode: 'USD',
        idempotencyKey: `g13-a2-${need.id}`, actorUserId: user.id,
      });
    }, 'g13-a2-fixture-hold');
    expect((await walletState(walletId)).reserved).toBe(2500);

    const all = await getAs(user, '/api/oxsteed-credit/holds?status=all&limit=50');
    expect(all.status).toBe(200);
    const row = all.body.holds.find((hold) => hold.kind === 'reservation');
    expect(row).toMatchObject({
      kind: 'reservation', amountCents: 2500, currencyCode: 'USD', status: 'active',
      plannedNeedId: Number(need.id), plannedNeedTitle: 'Boiler service',
      reservationType: 'planned_need_fund',
    });
    expect(row.partnerId).toBeNull();
    expect(row.idempotencyKey).toBeUndefined();

    // The active line items sum to the wallet's reserved balance: the list
    // now accounts for every held cent (migration-755 guard, read side).
    const active = await getAs(user, '/api/oxsteed-credit/holds?status=active&limit=50');
    expect(active.status).toBe(200);
    const activeSum = active.body.holds
      .filter((hold) => hold.status === 'active')
      .reduce((sum, hold) => sum + hold.amountCents, 0);
    expect(activeSum).toBe((await walletState(walletId)).reserved);

    // A released reservation reads back under status=released with its reason.
    await withTransaction(pool, async (client) => {
      await releasePlannedNeedCreditHolds(client, { needId: need.id, reason: 'need_cancelled', actorUserId: user.id });
    }, 'g13-a2-fixture-release');
    const released = await getAs(user, '/api/oxsteed-credit/holds?status=released&limit=50');
    const releasedRow = released.body.holds.find((hold) => hold.kind === 'reservation');
    expect(releasedRow).toMatchObject({ status: 'released', releaseReason: 'need_cancelled' });
    expect((await walletState(walletId)).reserved).toBe(0);
  });
});
