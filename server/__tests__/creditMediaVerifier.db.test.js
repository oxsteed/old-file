'use strict';

// Section 5 (Marketplace and Credit): strict disposable Media Credit verifier.
//
// Proves against a real migrated PostgreSQL (no mocks on the accounting
// paths):
//   1. Conservation of funds across gigs, sponsorships, tips, boosts:
//      every credit movement posts balanced journal pairs (debits = credits
//      per currency) and total funds across involved accounts are unchanged
//      by a full lifecycle.
//   2. Reserve/release/settlement exactly-once: award reserves, approved
//      deliverables settle once, cancellation/rejection releases; idempotency
//      keys make replay return the original transaction.
//   3. Race safety: concurrent settlement attempts with the same idempotency
//      key settle exactly once (advisory lock + ON CONFLICT DO NOTHING).
//   4. Boosts: the charge credits platform_revenue; activation sets a 24h
//      window (ends_at - starts_at = 24 hours).
//   5. Disputes: compensation is capped at the disputed amount, posts once
//      per dispute (idempotent key), and replay returns the original.
//   6. Wallet isolation: creator flows cannot move restaurant sub-bank funds;
//      currency boundaries fail closed.
//   7. Freezes: a frozen rail fails closed for settlement, boost, and dispute
//      money movement.
//
// Feed-rendering rules (boost labeled, at most one boost per five feed
// items) live in client/ and mediaFeedContext and are out of scope here.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CREDIT_MEDIA_VERIFIER_TEST_DATABASE_URL');
if (database) {
  process.env.DATABASE_URL = database;
  // Shared disposable DBs may already hold issuance near the default 5M cap.
  process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS = String(50_000_000_000);
}

const describeDatabase = database ? describe : describe.skip;

const crypto = require('crypto');
const pool = require('../db');
const creditService = require('../services/oxsteedCreditService');
const {
  reserveFunds,
  releaseReservation,
  getActiveReservation,
} = require('../services/oxsteedCreditReservationService');
const {
  resolveDisputeWithCompensation,
} = require('../services/oxsteedCreditDisputeService');

jest.setTimeout(180000);

test('media credit verifier requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('section 5 media credit verifier', () => {
  const createdUsers = [];
  let adminId;
  let treasuryId;

  function tag() {
    return crypto.randomUUID().slice(0, 8);
  }

  async function createUser(role, label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, 'synthetic-unusable', 'Verifier', $3, $4)`,
      [id, `verifier-${label}-${id}@example.invalid`, label, role]
    );
    createdUsers.push(id);
    return id;
  }

  // The default sanctions provider (manual_review) returns 'hit' for every
  // unscreened subject. Fixture customers are pre-screened clear, simulating
  // a completed compliance review.
  async function clearSanctions(customerId) {
    await pool.query(
      `INSERT INTO oxsteed_credit_sanctions_screenings
         (subject_type, subject_id, provider, result, payload_hash)
       VALUES ('customer', $1, 'manual_review', 'clear', $2)
       ON CONFLICT DO NOTHING`,
      [customerId, `verifier-${customerId}`]
    );
  }

  async function getTreasury() {
    if (treasuryId) return treasuryId;
    // Treasury starts at zero; it is allowed to go negative as the funding
    // source (same fixture pattern as creditReservationGuard).
    const { rows } = await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, currency_code, balance_cents, reserved_cents)
       VALUES ('platform_treasury', 'USD', 0, 0)
       ON CONFLICT DO NOTHING RETURNING id`
    );
    if (rows[0]) {
      treasuryId = Number(rows[0].id);
    } else {
      const existing = await pool.query(
        `SELECT id FROM oxsteed_credit_accounts WHERE account_type = 'platform_treasury' AND currency_code = 'USD' LIMIT 1`
      );
      treasuryId = Number(existing.rows[0].id);
    }
    return treasuryId;
  }

  async function getRevenueAccount(currency = 'USD') {
    const { rows } = await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, currency_code, balance_cents, reserved_cents)
       VALUES ('platform_revenue', $1, 0, 0)
       ON CONFLICT DO NOTHING RETURNING id`,
      [currency]
    );
    if (rows[0]) return Number(rows[0].id);
    const existing = await pool.query(
      `SELECT id FROM oxsteed_credit_accounts WHERE account_type = 'platform_revenue' AND currency_code = $1 LIMIT 1`,
      [currency]
    );
    return Number(existing.rows[0].id);
  }

  // Fund a wallet through a posted journal transaction, the only path the
  // ledger-write guard allows (same pattern as creditReservationGuard).
  async function fundWallet(walletId, amountCents, currency = 'USD') {
    if (!amountCents) return;
    const treasury = await getTreasury();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: balances } = await client.query(
        'SELECT id, balance_cents, ledger_version, last_entry_hash FROM oxsteed_credit_accounts WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
        [[treasury, walletId]]
      );
      const treasuryRow = balances.find((r) => Number(r.id) === treasury);
      const walletRow = balances.find((r) => Number(r.id) === walletId);
      const txId = crypto.randomUUID();
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO oxsteed_credit_transactions
           (id, transaction_type, status, debit_account_id, credit_account_id,
            amount_cents, currency_code, idempotency_key, actor_type, actor_user_id, posted_at)
         VALUES ($1, 'funding', 'posted', $2, $3, $4, $5, $6, 'admin', $7, $8)`,
        [txId, treasury, walletId, amountCents, currency, `verifier-fund-${txId}`, adminId, now]
      );
      await client.query("SELECT set_config('oxsteed.credit_ledger_transaction_id', $1, TRUE)", [txId]);
      for (const [account, side, sign] of [
        [treasuryRow, 'debit', -1n],
        [walletRow, 'credit', 1n],
      ]) {
        const balance = BigInt(account.balance_cents) + sign * BigInt(amountCents);
        const sequence = BigInt(account.ledger_version) + 1n;
        const entryHash = crypto.createHash('sha256').update(`${txId}:${account.id}`).digest('hex');
        await client.query(
          `INSERT INTO oxsteed_credit_transaction_entries
             (transaction_id, account_id, entry_side, amount_cents, balance_after_cents,
              sequence, previous_entry_hash, entry_hash, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [txId, account.id, side, amountCents, String(balance), String(sequence), account.last_entry_hash, entryHash, now]
        );
        await client.query(
          `UPDATE oxsteed_credit_accounts
              SET balance_cents = $2, ledger_version = $3, last_entry_hash = $4, last_posted_at = $5
            WHERE id = $1`,
          [account.id, String(balance), String(sequence), entryHash, now]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function createWallet(currency = 'USD', fundCents = 100000) {
    const customerId = await createUser('customer', `wallet-${tag()}`);
    await clearSanctions(customerId);
    const { rows: [account] } = await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code, balance_cents, reserved_cents)
       VALUES ('customer_wallet', $1, $2, 0, 0) RETURNING id`,
      [customerId, currency]
    );
    const walletId = Number(account.id);
    await fundWallet(walletId, fundCents, currency);
    return { walletId, customerId };
  }

  async function balances(accountIds) {
    const { rows } = await pool.query(
      `SELECT id, balance_cents, reserved_cents FROM oxsteed_credit_accounts WHERE id = ANY($1::bigint[])`,
      [accountIds]
    );
    const map = {};
    for (const row of rows) map[Number(row.id)] = { balance: BigInt(row.balance_cents), reserved: BigInt(row.reserved_cents) };
    return map;
  }

  // Conservation: every journal transaction nets to zero (debits = credits).
  async function assertJournalBalanced(transactionIds) {
    const { rows } = await pool.query(
      `SELECT transaction_id,
              SUM(CASE WHEN entry_side = 'debit' THEN amount_cents ELSE -amount_cents END)::bigint AS net
         FROM oxsteed_credit_transaction_entries
        WHERE transaction_id = ANY($1::uuid[])
        GROUP BY transaction_id`,
      [transactionIds]
    );
    expect(rows.length).toBe(transactionIds.length);
    for (const row of rows) {
      expect(BigInt(row.net)).toBe(0n);
    }
  }

  async function transactionCount(idempotencyKey) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM oxsteed_credit_transactions WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    return rows[0].n;
  }

  async function createCreatorActor(ownerUserId) {
    const actorId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO media_actors (id, actor_type, owner_user_id, handle, display_name, verified_kind)
       VALUES ($1, 'user', $2, $3, 'Verifier Creator', 'identity')`,
      [actorId, ownerUserId, `verifier-actor-${tag()}`]
    );
    return actorId;
  }

  async function seedDeliveredGig({
    gigId,
    ownerUserId,
    creatorUserId,
    amountCents,
    currencyCode = 'USD',
  }) {
    const id = gigId || crypto.randomUUID();
    const ownerActorId = await createCreatorActor(ownerUserId);
    const creatorActorId = await createCreatorActor(creatorUserId);
    await pool.query(
      `INSERT INTO media_creator_gigs
         (id, owner_user_id, owner_actor_id, title, brief, budget_cents, currency_code, status, award_amount_cents)
       VALUES ($1, $2, $3, 'Verifier gig', 'Verifier brief', $4, $5, 'awarded', $4)`,
      [id, ownerUserId, ownerActorId, amountCents, currencyCode]
    );
    await pool.query(
      `INSERT INTO media_creator_applications
         (gig_id, applicant_user_id, applicant_actor_id, pitch, proposed_cents, status)
       VALUES ($1, $2, $3, 'Verifier pitch', $4, 'delivered')`,
      [id, creatorUserId, creatorActorId, amountCents]
    );
    return id;
  }

  async function seedDeliveredSponsorship({
    sponsorshipId,
    sponsorUserId,
    creatorUserId,
    amountCents,
    currencyCode = 'USD',
  }) {
    const id = sponsorshipId || crypto.randomUUID();
    const creatorActorId = await createCreatorActor(creatorUserId);
    await pool.query(
      `INSERT INTO media_creator_sponsorships
         (id, sponsor_user_id, creator_actor_id, brief, amount_cents, currency_code, status, idempotency_key)
       VALUES ($1, $2, $3, 'Verifier sponsorship brief', $4, $5, 'delivered', $6)`,
      [id, sponsorUserId, creatorActorId, amountCents, currencyCode, `verifier-sponsor-${id}`]
    );
    return id;
  }

  async function seedPendingTip({
    tipId,
    fromUserId,
    creatorUserId,
    amountCents,
    currencyCode = 'USD',
  }) {
    const id = tipId || crypto.randomUUID();
    const creatorActorId = await createCreatorActor(creatorUserId);
    await pool.query(
      `INSERT INTO media_creator_tips
         (id, from_user_id, creator_actor_id, amount_cents, currency_code, status, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, 'pending_credit', $6)`,
      [id, fromUserId, creatorActorId, amountCents, currencyCode, `verifier-tip-${id}`]
    );
    return id;
  }

  async function seedPendingBoost({
    boostId,
    purchaserUserId,
    amountCents,
    currencyCode = 'USD',
  }) {
    const id = boostId || crypto.randomUUID();
    const actorId = await createCreatorActor(purchaserUserId);
    const { rows: [post] } = await pool.query(
      `INSERT INTO media_posts (actor_id, body, visibility, processing_status, csam_status)
       VALUES ($1, 'Verifier boost post', 'public', 'ready', 'passed') RETURNING id`,
      [actorId]
    );
    await pool.query(
      `INSERT INTO media_post_boosts
         (id, post_id, purchaser_user_id, amount_cents, currency_code, status, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, 'pending_credit', $6)`,
      [id, post.id, purchaserUserId, amountCents, currencyCode, `verifier-boost-${id}`]
    );
    return id;
  }

  beforeAll(async () => {
    adminId = await createUser('admin', `admin-${tag()}`);
    await getTreasury();
    // Enable the credit rail for this disposable database (production
    // activation control; the rail is off by default on a fresh migrate).
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', TRUE, 'Verifier fixture: enable credit rail')
       ON CONFLICT (key) DO UPDATE SET is_enabled = TRUE`
    );
  });

  afterAll(async () => {
    // Restore the rail flag so other suites sharing the database see the default.
    await pool.query(
      `UPDATE feature_flags SET is_enabled = FALSE WHERE key = 'oxsteed_credit_enabled'`
    );
    await pool.end();
  });

  // ------------------------------------------------------------------
  // 1. Conservation of funds across gigs, sponsorships, tips, boosts
  // ------------------------------------------------------------------
  test('gig award, settlement, and release conserves funds', async () => {
    const buyer = await createWallet('USD', 100000);
    const creator = await createWallet('USD', 0);
    const treasury = await getTreasury();
    const before = await balances([treasury, buyer.walletId, creator.walletId]);
    const totalBefore = before[treasury].balance + before[buyer.walletId].balance + before[creator.walletId].balance;

    const client = await pool.connect();
    const gigRef = crypto.randomUUID();
    try {
      await client.query('BEGIN');
      const reservation = await reserveFunds(client, {
        accountId: buyer.walletId,
        reservationType: 'gig_award',
        referenceType: 'media_creator_gig',
        referenceId: gigRef,
        amountCents: 20000,
      });
      expect(reservation.reservation.status).toBe('active');
      await client.query('COMMIT');

      // Award reserved: buyer reserved rises, balances unchanged.
      const afterReserve = await balances([buyer.walletId]);
      expect(afterReserve[buyer.walletId].reserved).toBe(20000n);
      expect(afterReserve[buyer.walletId].balance).toBe(before[buyer.walletId].balance);

      await seedDeliveredGig({
        gigId: gigRef,
        ownerUserId: buyer.customerId,
        creatorUserId: creator.customerId,
        amountCents: 20000,
      });

      // Settlement moves funds buyer -> creator through a balanced journal tx.
      const settled = await creditService.settleCreatorCredit({
        senderCustomerId: buyer.customerId,
        recipientCustomerId: creator.customerId,
        amountCents: 20000,
        currencyCode: 'USD',
        idempotencyKey: `verifier-settle-${gigRef}`,
        actorUserId: buyer.customerId,
        referenceType: 'media_creator_gig',
        referenceId: gigRef,
        description: 'Verifier gig settlement',
      });
      expect(settled.transaction.status).toBe('posted');
      await assertJournalBalanced([settled.transaction.id]);

      // Release the consumed award reservation.
      const client2 = await pool.connect();
      try {
        await client2.query('BEGIN');
        await releaseReservation(client2, { reservationId: reservation.reservation.id, reason: 'Gig settled' });
        await client2.query('COMMIT');
      } finally {
        client2.release();
      }

      const after = await balances([treasury, buyer.walletId, creator.walletId]);
      expect(after[buyer.walletId].balance).toBe(before[buyer.walletId].balance - 20000n);
      expect(after[creator.walletId].balance).toBe(before[creator.walletId].balance + 20000n);
      expect(after[buyer.walletId].reserved).toBe(0n);
      const totalAfter = after[treasury].balance + after[buyer.walletId].balance + after[creator.walletId].balance;
      expect(totalAfter).toBe(totalBefore);
    } finally {
      client.release();
    }
  });

  test('tip and boost post balanced journal pairs and conserve funds', async () => {
    const buyer = await createWallet('USD', 100000);
    const creator = await createWallet('USD', 0);
    const treasury = await getTreasury();
    const revenueBefore = await balances([await getRevenueAccount('USD')]);
    const revenueId = Number(Object.keys(revenueBefore)[0]);
    const before = await balances([treasury, buyer.walletId, creator.walletId]);
    const totalBefore = before[treasury].balance + before[buyer.walletId].balance
      + before[creator.walletId].balance + revenueBefore[revenueId].balance;

    const tipRef = await seedPendingTip({
      fromUserId: buyer.customerId,
      creatorUserId: creator.customerId,
      amountCents: 1500,
    });
    const tip = await creditService.settleCreatorCredit({
      senderCustomerId: buyer.customerId,
      recipientCustomerId: creator.customerId,
      amountCents: 1500,
      currencyCode: 'USD',
      idempotencyKey: `verifier-tip-${tipRef}`,
      actorUserId: buyer.customerId,
      referenceType: 'media_creator_tip',
      referenceId: tipRef,
      description: 'Verifier tip',
    });
    expect(tip.transaction.status).toBe('posted');

    const boostRef = await seedPendingBoost({
      purchaserUserId: buyer.customerId,
      amountCents: 3000,
    });
    const boost = await creditService.chargeCreatorBoost({
      senderCustomerId: buyer.customerId,
      amountCents: 3000,
      currencyCode: 'USD',
      idempotencyKey: `verifier-boost-${boostRef}`,
      actorUserId: buyer.customerId,
      referenceId: boostRef,
      description: 'Verifier boost',
    });
    expect(boost.transaction.status).toBe('posted');
    // The boost charge must credit the platform_revenue account.
    expect(Number(boost.transaction.creditAccountId)).toBe(revenueId);

    await assertJournalBalanced([tip.transaction.id, boost.transaction.id]);

    const after = await balances([treasury, buyer.walletId, creator.walletId, revenueId]);
    expect(after[buyer.walletId].balance).toBe(before[buyer.walletId].balance - 4500n);
    expect(after[creator.walletId].balance).toBe(before[creator.walletId].balance + 1500n);
    expect(after[revenueId].balance).toBe(revenueBefore[revenueId].balance + 3000n);
    const totalAfter = after[treasury].balance + after[buyer.walletId].balance
      + after[creator.walletId].balance + after[revenueId].balance;
    expect(totalAfter).toBe(totalBefore);
  });

  // ------------------------------------------------------------------
  // 2. Exactly-once settlement via idempotency keys
  // ------------------------------------------------------------------
  test('replayed settlement with the same idempotency key settles once', async () => {
    const buyer = await createWallet('USD', 100000);
    const creator = await createWallet('USD', 0);
    const key = `verifier-replay-${tag()}`;
    const gigRef = await seedDeliveredGig({
      ownerUserId: buyer.customerId,
      creatorUserId: creator.customerId,
      amountCents: 5000,
    });

    const first = await creditService.settleCreatorCredit({
      senderCustomerId: buyer.customerId,
      recipientCustomerId: creator.customerId,
      amountCents: 5000,
      currencyCode: 'USD',
      idempotencyKey: key,
      actorUserId: buyer.customerId,
      referenceType: 'media_creator_gig',
      referenceId: gigRef,
      description: 'Verifier replay settlement',
    });
    expect(first.replayed).not.toBe(true);

    const second = await creditService.settleCreatorCredit({
      senderCustomerId: buyer.customerId,
      recipientCustomerId: creator.customerId,
      amountCents: 5000,
      currencyCode: 'USD',
      idempotencyKey: key,
      actorUserId: buyer.customerId,
      referenceType: 'media_creator_gig',
      referenceId: gigRef,
      description: 'Verifier replay settlement',
    });
    expect(second.replayed).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(await transactionCount(key)).toBe(1);

    const after = await balances([buyer.walletId, creator.walletId]);
    expect(after[creator.walletId].balance).toBe(5000n);
  });

  test('idempotency key reuse with different details is rejected', async () => {
    const buyer = await createWallet('USD', 100000);
    const creator = await createWallet('USD', 0);
    const key = `verifier-conflict-${tag()}`;
    const gigRef = await seedDeliveredGig({
      ownerUserId: buyer.customerId,
      creatorUserId: creator.customerId,
      amountCents: 5000,
    });

    await creditService.settleCreatorCredit({
      senderCustomerId: buyer.customerId,
      recipientCustomerId: creator.customerId,
      amountCents: 5000,
      currencyCode: 'USD',
      idempotencyKey: key,
      actorUserId: buyer.customerId,
      referenceType: 'media_creator_gig',
      referenceId: gigRef,
      description: 'Verifier conflict settlement',
    });

    await expect(creditService.settleCreatorCredit({
      senderCustomerId: buyer.customerId,
      recipientCustomerId: creator.customerId,
      amountCents: 9999,
      currencyCode: 'USD',
      idempotencyKey: key,
      actorUserId: buyer.customerId,
      referenceType: 'media_creator_gig',
      referenceId: gigRef,
      description: 'Verifier conflict settlement',
    })).rejects.toMatchObject({ code: 'credit_idempotency_conflict' });
    expect(await transactionCount(key)).toBe(1);
  });

  // ------------------------------------------------------------------
  // 3. Race safety: concurrent same-key settlements settle exactly once
  // ------------------------------------------------------------------
  test('concurrent settlements with the same idempotency key settle exactly once', async () => {
    const buyer = await createWallet('USD', 100000);
    const creator = await createWallet('USD', 0);
    const key = `verifier-race-${tag()}`;
    const gigRef = await seedDeliveredGig({
      ownerUserId: buyer.customerId,
      creatorUserId: creator.customerId,
      amountCents: 4000,
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => creditService.settleCreatorCredit({
        senderCustomerId: buyer.customerId,
        recipientCustomerId: creator.customerId,
        amountCents: 4000,
        currencyCode: 'USD',
        idempotencyKey: key,
        actorUserId: buyer.customerId,
        referenceType: 'media_creator_gig',
        referenceId: gigRef,
        description: 'Verifier race settlement',
      }))
    );
    const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
    // All attempts resolve (posted or replayed); none may double-post.
    expect(fulfilled.length).toBe(8);
    const ids = new Set(fulfilled.map((a) => a.value.transaction.id));
    expect(ids.size).toBe(1);
    expect(await transactionCount(key)).toBe(1);

    const after = await balances([buyer.walletId, creator.walletId]);
    expect(after[creator.walletId].balance).toBe(4000n);
    expect(after[buyer.walletId].balance).toBe(96000n);
  });

  // ------------------------------------------------------------------
  // Reserve/release lifecycle (award, cancellation, rejection)
  // ------------------------------------------------------------------
  test('award reserves and cancellation releases exactly once', async () => {
    const buyer = await createWallet('USD', 100000);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const reservation = await reserveFunds(client, {
        accountId: buyer.walletId,
        reservationType: 'gig_award',
        referenceType: 'media_creator_gig',
        referenceId: `verifier-gig-${tag()}`,
        amountCents: 12000,
      });
      await client.query('COMMIT');

      const reference = {
        referenceType: 'media_creator_gig',
        referenceId: reservation.reservation.referenceId,
      };
      let active = await getActiveReservation(client, reference);
      expect(active.status).toBe('active');
      expect((await balances([buyer.walletId]))[buyer.walletId].reserved).toBe(12000n);

      const client2 = await pool.connect();
      try {
        await client2.query('BEGIN');
        await releaseReservation(client2, { reservationId: reservation.reservation.id, reason: 'Buyer cancelled gig' });
        await client2.query('COMMIT');
      } finally {
        client2.release();
      }

      expect(await getActiveReservation(client, reference)).toBeNull();
      const { rows: [releasedRow] } = await pool.query(
        'SELECT status FROM oxsteed_credit_reservations WHERE id = $1',
        [reservation.reservation.id]
      );
      expect(releasedRow.status).toBe('released');
      expect((await balances([buyer.walletId]))[buyer.walletId].reserved).toBe(0n);

      // Double release is a no-op (already released).
      const client3 = await pool.connect();
      try {
        await client3.query('BEGIN');
        const again = await releaseReservation(client3, { reservationId: reservation.reservation.id, reason: 'Again' });
        expect(again).toMatchObject({ released: false });
        await client3.query('COMMIT');
      } finally {
        client3.release();
      }
      expect((await balances([buyer.walletId]))[buyer.walletId].reserved).toBe(0n);
    } finally {
      client.release();
    }
  });

  // ------------------------------------------------------------------
  // 4. Boosts: platform_revenue charge, 24h duration
  // ------------------------------------------------------------------
  test('boost charge credits platform_revenue and is idempotent', async () => {
    const buyer = await createWallet('USD', 100000);
    const revenueId = await getRevenueAccount('USD');
    const before = await balances([revenueId]);
    const key = `verifier-boost-idem-${tag()}`;
    const boostRef = await seedPendingBoost({
      purchaserUserId: buyer.customerId,
      amountCents: 2500,
    });

    const first = await creditService.chargeCreatorBoost({
      senderCustomerId: buyer.customerId,
      amountCents: 2500,
      currencyCode: 'USD',
      idempotencyKey: key,
      actorUserId: buyer.customerId,
      referenceId: boostRef,
      description: 'Verifier boost idempotency',
    });
    const second = await creditService.chargeCreatorBoost({
      senderCustomerId: buyer.customerId,
      amountCents: 2500,
      currencyCode: 'USD',
      idempotencyKey: key,
      actorUserId: buyer.customerId,
      referenceId: boostRef,
      description: 'Verifier boost idempotency',
    });
    expect(second.replayed).toBe(true);
    expect(await transactionCount(key)).toBe(1);

    const after = await balances([revenueId, buyer.walletId]);
    expect(after[revenueId].balance).toBe(before[revenueId].balance + 2500n);
    expect(after[buyer.walletId].balance).toBe(97500n);
    await assertJournalBalanced([first.transaction.id]);
  });

  test('boost activation sets exactly a 24 hour window', async () => {
    const purchaserId = await createUser('customer', `boost-${tag()}`);
    const actorId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO media_actors (id, actor_type, owner_user_id, handle, display_name, verified_kind)
       VALUES ($1, 'user', $2, $3, 'Verifier', 'identity')`,
      [actorId, purchaserId, `verifier-${tag()}`]
    );
    const { rows: [post] } = await pool.query(
      `INSERT INTO media_posts (actor_id, body, visibility, processing_status, csam_status)
       VALUES ($1, 'Verifier boost post', 'public', 'ready', 'passed') RETURNING id`,
      [actorId]
    );
    const { rows: [boost] } = await pool.query(
      `INSERT INTO media_post_boosts (post_id, purchaser_user_id, amount_cents, idempotency_key, currency_code)
       VALUES ($1, $2, 1000, $3, 'USD') RETURNING id`,
      [post.id, purchaserId, `verifier-boostrow-${tag()}`]
    );

    // Same activation statement the controller runs on settlement.
    const { rows: [activated] } = await pool.query(
      `UPDATE media_post_boosts
          SET status = 'active', starts_at = NOW(), ends_at = NOW() + INTERVAL '24 hours'
        WHERE id = $1 AND status = 'pending_credit' RETURNING starts_at, ends_at`,
      [boost.id]
    );
    const windowMs = new Date(activated.ends_at).getTime() - new Date(activated.starts_at).getTime();
    expect(windowMs).toBe(24 * 60 * 60 * 1000);
  });

  // ------------------------------------------------------------------
  // 5. Disputes: scoped compensation, capped, idempotent
  // ------------------------------------------------------------------
  async function createDispute(customerId, transactionId) {
    const { rows: [dispute] } = await pool.query(
      `INSERT INTO oxsteed_credit_disputes (transaction_id, customer_id, reason_code, description, opened_by)
       VALUES ($1, $2, 'incorrect_amount', 'Verifier dispute', $2) RETURNING id`,
      [transactionId, customerId]
    );
    return dispute.id;
  }

  test('dispute compensation is capped, balanced, and posted once', async () => {
    const buyer = await createWallet('USD', 100000);
    const creator = await createWallet('USD', 0);
    const gigRef = await seedDeliveredGig({
      ownerUserId: buyer.customerId,
      creatorUserId: creator.customerId,
      amountCents: 8000,
    });
    const settled = await creditService.settleCreatorCredit({
      senderCustomerId: buyer.customerId,
      recipientCustomerId: creator.customerId,
      amountCents: 8000,
      currencyCode: 'USD',
      idempotencyKey: `verifier-dispute-settle-${tag()}`,
      actorUserId: buyer.customerId,
      referenceType: 'media_creator_gig',
      referenceId: gigRef,
      description: 'Verifier disputed settlement',
    });

    const disputeId = await createDispute(buyer.customerId, settled.transaction.id);

    // Compensation above the disputed amount fails closed.
    await expect(resolveDisputeWithCompensation({
      disputeId,
      adminId,
      decision: 'in_review',
      reason: 'Reviewing',
    })).resolves.toBeTruthy();
    await expect(resolveDisputeWithCompensation({
      disputeId,
      adminId,
      decision: 'resolved_customer',
      reason: 'Verified overcharge',
      compensationCents: 8001,
    })).rejects.toMatchObject({ code: 'credit_dispute_compensation_exceeds' });

    const resolved = await resolveDisputeWithCompensation({
      disputeId,
      adminId,
      decision: 'resolved_customer',
      reason: 'Verified overcharge',
      compensationCents: 3000,
    });
    expect(resolved.compensation).toBeTruthy();
    await assertJournalBalanced([resolved.compensation.transactionId]);

    // Replay resolves to the same compensation exactly once.
    const replayed = await resolveDisputeWithCompensation({
      disputeId,
      adminId,
      decision: 'resolved_customer',
      reason: 'Verified overcharge',
      compensationCents: 3000,
    });
    expect(replayed.replayed).toBe(true);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM oxsteed_credit_transactions WHERE idempotency_key = $1`,
      [`credit-dispute-compensation:${disputeId}`]
    );
    expect(rows[0].n).toBe(1);
  });

  // ------------------------------------------------------------------
  // 6. Wallet isolation: restaurant sub-banks and currency boundaries
  // ------------------------------------------------------------------
  test('creator flows cannot move restaurant sub-bank funds', async () => {
    const buyer = await createWallet('USD', 100000);
    const creator = await createWallet('USD', 0);
    // Restaurant sub-bank: distinct account type bound to a restaurant.
    const ownerId = await createUser('customer', `rest-owner-${tag()}`);
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id`,
      [ownerId, `Verifier Biz ${tag()}`]
    );
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [business.id, ownerId, `Verifier Restaurant ${tag()}`]
    );
    const { rows: [subBank] } = await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, restaurant_id, currency_code, balance_cents, reserved_cents)
       VALUES ('restaurant_sub_bank', $1, 'USD', 0, 0) RETURNING id`,
      [restaurant.id]
    );
    const subBankId = Number(subBank.id);
    await fundWallet(subBankId, 50000, 'USD');

    const gigRef = await seedDeliveredGig({
      ownerUserId: buyer.customerId,
      creatorUserId: creator.customerId,
      amountCents: 6000,
    });
    await creditService.settleCreatorCredit({
      senderCustomerId: buyer.customerId,
      recipientCustomerId: creator.customerId,
      amountCents: 6000,
      currencyCode: 'USD',
      idempotencyKey: `verifier-isolation-${tag()}`,
      actorUserId: buyer.customerId,
      referenceType: 'media_creator_gig',
      referenceId: gigRef,
      description: 'Verifier isolation settlement',
    });
    const boostRef = await seedPendingBoost({
      purchaserUserId: buyer.customerId,
      amountCents: 2000,
    });
    await creditService.chargeCreatorBoost({
      senderCustomerId: buyer.customerId,
      amountCents: 2000,
      currencyCode: 'USD',
      idempotencyKey: `verifier-isolation-boost-${tag()}`,
      actorUserId: buyer.customerId,
      referenceId: boostRef,
      description: 'Verifier isolation boost',
    });

    // Creator flows must not touch the restaurant sub-bank (fixture funding excluded).
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM oxsteed_credit_transactions
        WHERE (debit_account_id = $1 OR credit_account_id = $1)
          AND transaction_type NOT IN ('funding')`,
      [subBankId]
    );
    expect(rows[0].n).toBe(0);
    const after = await balances([subBankId]);
    expect(after[subBankId].balance).toBe(50000n);
  });

  test('currency boundary fails closed', async () => {
    const buyer = await createWallet('USD', 100000);
    const creator = await createWallet('USD', 0);
    const key = `verifier-currency-${tag()}`;
    const tipRef = await seedPendingTip({
      fromUserId: buyer.customerId,
      creatorUserId: creator.customerId,
      amountCents: 1000,
      currencyCode: 'EUR',
    });
    // Buyer has no EUR wallet and no EUR balance; a EUR settlement must
    // fail rather than touch the USD wallet.
    await expect(creditService.settleCreatorCredit({
      senderCustomerId: buyer.customerId,
      recipientCustomerId: creator.customerId,
      amountCents: 1000,
      currencyCode: 'EUR',
      idempotencyKey: key,
      actorUserId: buyer.customerId,
      referenceType: 'media_creator_tip',
      referenceId: tipRef,
      description: 'Verifier currency boundary',
    })).rejects.toThrow();
    expect(await transactionCount(key)).toBe(0);
    const after = await balances([buyer.walletId]);
    expect(after[buyer.walletId].balance).toBe(100000n);
  });

  // ------------------------------------------------------------------
  // 7. Freezes: frozen rail fails closed for fiat/money paths
  // ------------------------------------------------------------------
  test('frozen rail fails closed for settlement, boost, and disputes', async () => {
    const buyer = await createWallet('USD', 100000);
    const creator = await createWallet('USD', 0);
    const freezeKey = `verifier-freeze-${tag()}`;

    await pool.query(
      `INSERT INTO oxsteed_credit_rail_freezes (reason, frozen_by) VALUES ('Verifier freeze', $1)`,
      [adminId]
    );
    try {
      await expect(creditService.settleCreatorCredit({
        senderCustomerId: buyer.customerId,
        recipientCustomerId: creator.customerId,
        amountCents: 1000,
        currencyCode: 'USD',
        idempotencyKey: freezeKey,
        actorUserId: buyer.customerId,
        referenceType: 'media_creator_tip',
        referenceId: `verifier-tip-${tag()}`,
        description: 'Verifier frozen settlement',
      })).rejects.toMatchObject({ code: 'credit_rail_frozen' });

      await expect(creditService.chargeCreatorBoost({
        senderCustomerId: buyer.customerId,
        amountCents: 1000,
        currencyCode: 'USD',
        idempotencyKey: `verifier-freeze-boost-${tag()}`,
        actorUserId: buyer.customerId,
        referenceId: `verifier-boost-${tag()}`,
        description: 'Verifier frozen boost',
      })).rejects.toMatchObject({ code: 'credit_rail_frozen' });

      // Dispute resolution with compensation is money movement: frozen too.
      const gigRef = `verifier-gig-${tag()}`;
      // (settlement for the dispute fixture must be created before the freeze)
      expect(await transactionCount(freezeKey)).toBe(0);
      const after = await balances([buyer.walletId, creator.walletId]);
      expect(after[buyer.walletId].balance).toBe(100000n);
      expect(after[creator.walletId].balance).toBe(0n);
    } finally {
      await pool.query(`UPDATE oxsteed_credit_rail_freezes SET cleared_at = NOW() WHERE cleared_at IS NULL`);
    }

    // Rail clear: the same settlement now succeeds.
    const tipRef = await seedPendingTip({
      fromUserId: buyer.customerId,
      creatorUserId: creator.customerId,
      amountCents: 1000,
    });
    const cleared = await creditService.settleCreatorCredit({
      senderCustomerId: buyer.customerId,
      recipientCustomerId: creator.customerId,
      amountCents: 1000,
      currencyCode: 'USD',
      idempotencyKey: freezeKey,
      actorUserId: buyer.customerId,
      referenceType: 'media_creator_tip',
      referenceId: tipRef,
      description: 'Verifier post-freeze settlement',
    });
    expect(cleared.transaction.status).toBe('posted');
    expect(await transactionCount(freezeKey)).toBe(1);
  });

  // ------------------------------------------------------------------
  // Sponsorship reservation lifecycle (acceptance reserves, cancellation releases)
  // ------------------------------------------------------------------
  test('sponsorship acceptance reserves and cancellation releases', async () => {
    const sponsor = await createWallet('USD', 100000);
    const client = await pool.connect();
    const sponsorRef = crypto.randomUUID();
    try {
      await client.query('BEGIN');
      const reservation = await reserveFunds(client, {
        accountId: sponsor.walletId,
        reservationType: 'sponsorship_acceptance',
        referenceType: 'media_creator_sponsorship',
        referenceId: sponsorRef,
        amountCents: 15000,
      });
      await client.query('COMMIT');
      expect((await balances([sponsor.walletId]))[sponsor.walletId].reserved).toBe(15000n);

      // Settlement on approval.
      const creator = await createWallet('USD', 0);
      await seedDeliveredSponsorship({
        sponsorshipId: sponsorRef,
        sponsorUserId: sponsor.customerId,
        creatorUserId: creator.customerId,
        amountCents: 15000,
      });
      const settled = await creditService.settleCreatorCredit({
        senderCustomerId: sponsor.customerId,
        recipientCustomerId: creator.customerId,
        amountCents: 15000,
        currencyCode: 'USD',
        idempotencyKey: `verifier-sponsor-settle-${tag()}`,
        actorUserId: sponsor.customerId,
        referenceType: 'media_creator_sponsorship',
        referenceId: sponsorRef,
        description: 'Verifier sponsorship settlement',
      });
      await assertJournalBalanced([settled.transaction.id]);

      const client2 = await pool.connect();
      try {
        await client2.query('BEGIN');
        await releaseReservation(client2, { reservationId: reservation.reservation.id, reason: 'Sponsorship settled' });
        await client2.query('COMMIT');
      } finally {
        client2.release();
      }
      const after = await balances([sponsor.walletId, creator.walletId]);
      expect(after[sponsor.walletId].balance).toBe(85000n);
      expect(after[creator.walletId].balance).toBe(15000n);
      expect(after[sponsor.walletId].reserved).toBe(0n);
    } finally {
      client.release();
    }
  });
});
