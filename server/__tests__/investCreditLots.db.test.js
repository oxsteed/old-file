'use strict';

// Credit lots and eligibility (OxSteed Invest, Track 1).
// Real migrated PostgreSQL only (disposable credit_statement_test database).

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CREDIT_GUARD_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
// Shared test DB already holds far more issued Credit than the default
// total-issuance cap; raise it for this suite like the other Credit DB
// suites do. Set before any service module loads the limit rules.
process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS = String(50_000_000_000);

const describeDatabase = database ? describe : describe.skip;

const crypto = require('crypto');
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const {
  ensureAccount,
  postJournalTransaction,
} = require('../services/oxsteedCreditService');
const {
  createLot,
  getEligibleBalance,
  allocateEligibleLots,
  encumberLotForDispute,
  resolveLotDispute,
  reclassifyLot,
  summarizeLots,
} = require('../services/invest/creditLots');
const { runInvestCreditBackfill } = require('../services/invest/backfill');
const { completeCreditTopupFromWebhook } = require('../services/oxsteedCreditTopupService');

jest.setTimeout(120000);

test('invest credit lot DB tests require an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('invest credit lots', () => {
  let investorId;
  let adminId;
  let walletId;
  let treasuryId;
  const createdUsers = [];
  const createdLots = [];

  async function createUser(tag, role = 'customer') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, 'synthetic-unusable', 'Lot', $3, $4)`,
      [id, `lot-${tag}-${id}@example.invalid`, tag, role],
    );
    createdUsers.push(id);
    return id;
  }

  // Test funding uses the `funding` journal type with an admin actor:
  // migration 487 rejects system-actor `load` posts, so a plain `load`
  // cannot fund a wallet on a migrated database.
  async function fundWallet(amountCents, customerId, targetWalletId) {
    const result = await withTransaction(pool, async (client) => {
      const { transaction } = await postJournalTransaction(client, {
        transactionType: 'funding',
        debitAccountId: treasuryId,
        creditAccountId: targetWalletId,
        customerId,
        amountCents,
        currencyCode: 'USD',
        idempotencyKey: `invest-lot-fund-${crypto.randomUUID()}`,
        actorType: 'admin',
        actorUserId: adminId,
        reason: 'Invest lot test funding',
        description: 'Invest lot test funding',
        referenceType: 'test_funding',
        referenceId: crypto.randomUUID(),
        metadata: {},
      });
      return transaction;
    }, 'invest_lot_test_fund');
    return result;
  }

  async function makeLot(input) {
    const { lot } = await withTransaction(pool, async (client) => createLot(client, input), 'invest_lot_test_create');
    createdLots.push(lot.id);
    return lot;
  }

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', true, 'synthetic invest lot test')
       ON CONFLICT (key) DO UPDATE SET is_enabled = true`,
    );
    investorId = await createUser('investor');
    adminId = await createUser('admin', 'admin');
    await withTransaction(pool, async (client) => {
      const wallet = await ensureAccount(client, { accountType: 'customer_wallet', customerId: investorId, currencyCode: 'USD' });
      walletId = wallet.id;
      const treasury = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: 'USD' });
      treasuryId = treasury.id;
    }, 'invest_lot_test_setup');
  });

  afterAll(async () => {
    if (createdLots.length) {
      await pool.query(`DELETE FROM investment_commitment_lots WHERE lot_id = ANY($1::uuid[])`, [createdLots]).catch(() => {});
      await pool.query(`DELETE FROM oxsteed_credit_balance_lots WHERE id = ANY($1::uuid[])`, [createdLots]).catch(() => {});
    }
    await pool.end();
  });

  test('purchased settled lots are eligible, unknown and promo lots are not', async () => {
    await fundWallet(20000, investorId, walletId);
    const purchased = await makeLot({
      accountId: walletId, customerId: investorId, currencyCode: 'USD',
      source: 'purchased', amountCents: 12000, settledAt: new Date('2026-11-01T00:00:00Z').toISOString(),
    });
    const unknown = await makeLot({
      accountId: walletId, customerId: investorId, currencyCode: 'USD',
      source: 'unknown', amountCents: 5000,
    });
    const promo = await makeLot({
      accountId: walletId, customerId: investorId, currencyCode: 'USD',
      source: 'promotional', amountCents: 3000, settledAt: new Date().toISOString(),
    });
    expect(purchased.source).toBe('purchased');
    expect(unknown.source).toBe('unknown');
    expect(promo.source).toBe('promotional');

    const balance = await withTransaction(pool, async (client) => getEligibleBalance(client, { customerId: investorId, currencyCode: 'USD' }), 'invest_lot_test_balance');
    expect(balance.balanceCents).toBe(20000);
    // Only the purchased lot counts; unknown and promo are ineligible.
    expect(balance.eligibleAvailableCents).toBe(12000);
    const summary = await pool.query(
      `SELECT source FROM oxsteed_credit_balance_lots WHERE id = ANY($1::uuid[])`,
      [[purchased.id, unknown.id, promo.id]],
    );
    expect(summary.rows).toHaveLength(3);
    const summarized = await summarizeLots(pool, { customerId: investorId, currencyCode: 'USD' });
    expect(summarized.find((row) => row.source === 'unknown').eligible).toBe(false);
    expect(summarized.find((row) => row.source === 'purchased').eligible).toBe(true);
  });

  test('earned lots require an approval reference and unsettled purchased lots are rejected', async () => {
    await expect(withTransaction(pool, async (client) => createLot(client, {
      accountId: walletId, customerId: investorId, currencyCode: 'USD',
      source: 'earned', amountCents: 1000, settledAt: new Date().toISOString(),
    }), 'invest_lot_test_earned')).rejects.toMatchObject({ code: 'invest_lot_earned_approval_required' });
    await expect(withTransaction(pool, async (client) => createLot(client, {
      accountId: walletId, customerId: investorId, currencyCode: 'USD',
      source: 'purchased', amountCents: 1000,
    }), 'invest_lot_test_unsettled')).rejects.toMatchObject({ code: 'invest_lot_purchased_settlement_required' });
    // An earned lot WITH approval and settlement is eligible.
    const earned = await makeLot({
      accountId: walletId, customerId: investorId, currencyCode: 'USD',
      source: 'earned', amountCents: 2000, settledAt: new Date('2026-11-02T00:00:00Z').toISOString(),
      approvalRef: 'approval-test-1',
    });
    expect(earned.approvalRef).toBe('approval-test-1');
    const balance = await withTransaction(pool, async (client) => getEligibleBalance(client, { customerId: investorId, currencyCode: 'USD' }), 'invest_lot_test_balance2');
    // 12000 purchased + 2000 earned; wallet balance is 20000 so the cap does not bind.
    expect(balance.eligibleAvailableCents).toBe(14000);
  });

  test('allocation is oldest settled eligible lot first', async () => {
    const { allocations } = await withTransaction(pool, async (client) => allocateEligibleLots(client, {
      customerId: investorId, currencyCode: 'USD', amountCents: 13000,
    }), 'invest_lot_test_allocate');
    // Oldest purchased lot (2026-11-01, 12000) fills first, then the earned lot (2026-11-02).
    expect(allocations).toHaveLength(2);
    expect(allocations[0].amountCents).toBe(12000);
    expect(allocations[0].source).toBe('purchased');
    expect(allocations[1].amountCents).toBe(1000);
    expect(allocations[1].source).toBe('earned');
  });

  test('a disputed lot is encumbered out of eligibility until resolved', async () => {
    const { rows } = await pool.query(
      `SELECT id FROM oxsteed_credit_balance_lots
        WHERE customer_id = $1 AND source = 'purchased' ORDER BY settled_at ASC LIMIT 1`,
      [investorId],
    );
    const lotId = rows[0].id;
    await withTransaction(pool, async (client) => encumberLotForDispute(client, { lotId, amountCents: 12000, disputeRef: 'dispute-test-1' }), 'invest_lot_test_encumber');
    const encumbered = await withTransaction(pool, async (client) => getEligibleBalance(client, { customerId: investorId, currencyCode: 'USD' }), 'invest_lot_test_balance3');
    expect(encumbered.eligibleAvailableCents).toBe(2000);
    await withTransaction(pool, async (client) => resolveLotDispute(client, { lotId, resolved: true, approvalRef: 'dispute-resolved-1' }), 'invest_lot_test_resolve');
    const resolved = await withTransaction(pool, async (client) => getEligibleBalance(client, { customerId: investorId, currencyCode: 'USD' }), 'invest_lot_test_balance4');
    expect(resolved.eligibleAvailableCents).toBe(14000);
  });

  test('reclassification is audited and cannot silently manufacture purchased eligibility', async () => {
    const { rows } = await pool.query(
      `SELECT id FROM oxsteed_credit_balance_lots
        WHERE customer_id = $1 AND source = 'unknown' ORDER BY created_at ASC LIMIT 1`,
      [investorId],
    );
    const lotId = rows[0].id;
    await expect(withTransaction(pool, async (client) => reclassifyLot(client, {
      lotId, toSource: 'purchased', actorUserId: investorId, reason: 'no evidence',
    }), 'invest_lot_test_reclass')).rejects.toMatchObject({ code: 'invest_lot_reclassify_evidence_required' });
    const reclassified = await withTransaction(pool, async (client) => reclassifyLot(client, {
      lotId, toSource: 'promotional', actorUserId: investorId,
      reason: 'receipt verified', evidenceRef: 'receipt-test-1',
    }), 'invest_lot_test_reclass2');
    expect(reclassified.source).toBe('promotional');
    const { rows: audit } = await pool.query(
      `SELECT * FROM oxsteed_credit_lot_reclassifications WHERE lot_id = $1`, [lotId],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].from_source).toBe('unknown');
    expect(audit[0].to_source).toBe('promotional');
    expect(audit[0].evidence_ref).toBe('receipt-test-1');
  });

  // PRE-EXISTING BUG, pinned here, not fixed by Track 1: the real
  // top-up webhook completion posts a `load` as actor `system` with no
  // actor user, and migration 487 rejects exactly that. Worse, the
  // requires_attention parking UPDATE runs inside the same aborted
  // transaction, so the call throws instead of parking and the top-up
  // stays `pending` (Stripe redelivery retries the same failure). The
  // lot tagging hook is wired in completeCreditTopupFromWebhook (it
  // creates the purchased lot in the same transaction as the journal
  // post), but it cannot execute until the actor conflict is resolved
  // (either the top-up post attributes an actor or the trigger exempts
  // Stripe top-up loads). The second test below proves the tagging
  // contract the hook uses: one purchased lot per completed top-up,
  // idempotent.
  test('top-up completion currently throws instead of parking (pre-existing migration 487 conflict)', async () => {
    const topupId = crypto.randomUUID();
    const paymentIntentId = `pi_invest_lot_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await pool.query(
      `INSERT INTO oxsteed_credit_topups
         (id, customer_id, amount_cents, currency_code, status,
          stripe_payment_intent_id, idempotency_key, expires_at)
       VALUES ($1, $2, 4000, 'USD', 'pending', $3, $4, NOW() + interval '1 hour')`,
      [topupId, investorId, paymentIntentId, `invest-lot-topup-${topupId}`],
    );
    await expect(completeCreditTopupFromWebhook({ paymentIntentId }))
      .rejects.toThrow('current transaction is aborted');
    const { rows } = await pool.query(`SELECT status FROM oxsteed_credit_topups WHERE id = $1`, [topupId]);
    expect(rows[0].status).toBe('pending');
    const { rows: lots } = await pool.query(
      `SELECT * FROM oxsteed_credit_balance_lots WHERE topup_id = $1`, [topupId],
    );
    expect(lots).toHaveLength(0);
  });

  test('completed top-up tagging creates exactly one purchased lot per top-up', async () => {
    const topupId = crypto.randomUUID();
    const fundedTx = await fundWallet(4000, investorId, walletId);
    await pool.query(
      `INSERT INTO oxsteed_credit_topups
         (id, customer_id, account_id, amount_cents, currency_code, status,
          stripe_payment_intent_id, idempotency_key, journal_transaction_id, expires_at)
       VALUES ($1, $2, $3, 4000, 'USD', 'completed', $4, $5, $6, NOW() + interval '1 hour')`,
      [topupId, investorId, walletId, `pi_invest_tag_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`, `invest-lot-tag-${topupId}`, fundedTx.id],
    );
    // This is the exact call the top-up completion hook makes.
    const first = await withTransaction(pool, async (client) => createLot(client, {
      accountId: walletId,
      customerId: investorId,
      currencyCode: 'USD',
      source: 'purchased',
      amountCents: 4000,
      settledAt: new Date().toISOString(),
      originatingTransactionId: fundedTx.id,
      topupId,
      referenceType: 'stripe_topup',
      referenceId: 'pi_invest_tag',
    }), 'invest_lot_test_tag');
    expect(first.replayed).toBe(false);
    expect(first.lot.source).toBe('purchased');
    createdLots.push(first.lot.id);
    const second = await withTransaction(pool, async (client) => createLot(client, {
      accountId: walletId,
      customerId: investorId,
      currencyCode: 'USD',
      source: 'purchased',
      amountCents: 4000,
      settledAt: new Date().toISOString(),
      originatingTransactionId: fundedTx.id,
      topupId,
      referenceType: 'stripe_topup',
      referenceId: 'pi_invest_tag',
    }), 'invest_lot_test_tag2');
    expect(second.replayed).toBe(true);
    expect(second.lot.id).toBe(first.lot.id);
    const { rows: lots } = await pool.query(
      `SELECT * FROM oxsteed_credit_balance_lots WHERE topup_id = $1`, [topupId],
    );
    expect(lots).toHaveLength(1);
    expect(Number(lots[0].amount_cents)).toBe(4000);
  });

  test('backfill classifies provable top-ups as purchased and the rest as unknown', async () => {
    const backfillUser = await createUser('backfill');
    let backfillWalletId;
    await withTransaction(pool, async (client) => {
      const wallet = await ensureAccount(client, { accountType: 'customer_wallet', customerId: backfillUser, currencyCode: 'USD' });
      backfillWalletId = wallet.id;
    }, 'invest_lot_test_backfill_setup');
    // Fund 9000 through the journal, then pretend 6000 of it was a
    // completed top-up by inserting the top-up row pointing at the load.
    const { transaction } = await withTransaction(pool, async (client) => postJournalTransaction(client, {
      transactionType: 'funding',
      debitAccountId: treasuryId,
      creditAccountId: backfillWalletId,
      customerId: backfillUser,
      amountCents: 9000,
      currencyCode: 'USD',
      idempotencyKey: `invest-lot-backfill-fund-${crypto.randomUUID()}`,
      actorType: 'admin',
      actorUserId: adminId,
      reason: 'Invest backfill test funding',
      description: 'Invest backfill test funding',
      referenceType: 'test_funding',
      referenceId: crypto.randomUUID(),
      metadata: {},
    }), 'invest_lot_test_backfill_fund');
    const topupId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO oxsteed_credit_topups
         (id, customer_id, account_id, amount_cents, currency_code, status,
          stripe_payment_intent_id, idempotency_key, journal_transaction_id, expires_at)
       VALUES ($1, $2, $3, 6000, 'USD', 'completed', $4, $5, $6, NOW() + interval '1 hour')`,
      [topupId, backfillUser, backfillWalletId, `pi_backfill_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`, `invest-backfill-${topupId}`, transaction.id],
    );

    const dry = await runInvestCreditBackfill({ mode: 'dry_run' });
    expect(dry.status).toBe('complete');
    expect(dry.counts.purchasedCents).toBeGreaterThanOrEqual(6000);
    const applied = await runInvestCreditBackfill({ mode: 'apply' });
    expect(applied.status).toBe('complete');
    const { rows: lots } = await pool.query(
      `SELECT id, source, amount_cents FROM oxsteed_credit_balance_lots WHERE customer_id = $1 ORDER BY source`,
      [backfillUser],
    );
    expect(lots).toHaveLength(2);
    expect(lots.find((row) => row.source === 'purchased').amount_cents).toBe('6000');
    expect(lots.find((row) => row.source === 'unknown').amount_cents).toBe('3000');
    const eligible = await withTransaction(pool, async (client) => getEligibleBalance(client, { customerId: backfillUser, currencyCode: 'USD' }), 'invest_lot_test_backfill_balance');
    expect(eligible.eligibleAvailableCents).toBe(6000);
    // Second run is a no-op for this account.
    const again = await runInvestCreditBackfill({ mode: 'apply' });
    const { rows: lotsAgain } = await pool.query(
      `SELECT source, amount_cents FROM oxsteed_credit_balance_lots WHERE customer_id = $1`,
      [backfillUser],
    );
    expect(lotsAgain).toHaveLength(2);
    expect(again.counts.accountsSkipped).toBeGreaterThanOrEqual(1);
    for (const row of lots) createdLots.push(row.id);
  });
});
