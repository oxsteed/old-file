'use strict';

// Migration 750: the reserved-balance guard counts active non-hold
// reservations as well as active holds.
//
// Migration 464 asserted reserved_cents = SUM(active holds) at commit time,
// which broke marketplace flows that create a reservation and increment
// reserved_cents in the same transaction (the commit raised
// 'OxSteed Credit reserved balance must equal active hold total').
// Migration 750 replaces the guard function so the expected total is
// SUM(active holds) + SUM(active reservations), and attaches the same
// deferred guard to oxsteed_credit_reservations.
//
// Real migrated PostgreSQL only (disposable credit_statement_test database).

jest.unmock('pg');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CREDIT_GUARD_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;

const describeDatabase = database ? describe : describe.skip;

const crypto = require('crypto');
const pool = require('../db');

jest.setTimeout(120000);

test('credit reservation guard DB tests require an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('migration 750 reserved-balance guard', () => {
  let adminId;
  let partnerId;
  let agreementId;
  let treasuryId;
  const createdUsers = [];
  const createdAccounts = [];

  async function createUser(role, tag) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, 'synthetic-unusable', 'Guard', $3, $4)`,
      [id, `guard-${tag}-${id}@example.invalid`, tag, role]
    );
    createdUsers.push(id);
    return id;
  }

  // Fund a wallet to `amountCents` through a posted journal transaction,
  // the only path the ledger-write guard (migration 491) allows. The
  // treasury source account is allowed to go negative; it is a fixture.
  async function fundWallet(walletId, amountCents) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: balances } = await client.query(
        'SELECT id, balance_cents, ledger_version, last_entry_hash FROM oxsteed_credit_accounts WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
        [[treasuryId, walletId]]
      );
      const treasury = balances.find((r) => Number(r.id) === treasuryId);
      const wallet = balances.find((r) => Number(r.id) === walletId);
      const txId = crypto.randomUUID();
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO oxsteed_credit_transactions
           (id, transaction_type, status, debit_account_id, credit_account_id,
            amount_cents, currency_code, idempotency_key, actor_type, actor_user_id, posted_at)
         VALUES ($1, 'funding', 'posted', $2, $3, $4, 'USD', $5, 'admin', $6, $7)`,
        [txId, treasuryId, walletId, amountCents, `guard-fund-${txId}`, adminId, now]
      );
      await client.query("SELECT set_config('oxsteed.credit_ledger_transaction_id', $1, TRUE)", [txId]);
      for (const [account, side, sign] of [
        [treasury, 'debit', -1n],
        [wallet, 'credit', 1n],
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

  async function createWallet() {
    const customerId = await createUser('customer', 'customer');
    const { rows: [account] } = await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code, balance_cents, reserved_cents)
       VALUES ('customer_wallet', $1, 'USD', 0, 0) RETURNING id`,
      [customerId]
    );
    createdAccounts.push(Number(account.id));
    await fundWallet(Number(account.id), 100000);
    return { walletId: Number(account.id), customerId };
  }

  async function insertHold(client, walletId, customerId, amountCents, tag) {
    await client.query(
      `INSERT INTO oxsteed_credit_holds
         (account_id, customer_id, partner_id, agreement_id, amount_cents, currency_code,
          idempotency_key, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,'USD',$6, NOW() + interval '1 hour', $2)`,
      [walletId, customerId, partnerId, agreementId, amountCents, `guard-hold-${tag}-${crypto.randomUUID()}`]
    );
  }

  async function insertReservation(client, walletId, amountCents, tag, referenceType = 'withdrawal') {
    const { rows: [row] } = await client.query(
      `INSERT INTO oxsteed_credit_reservations
         (account_id, reservation_type, reference_type, reference_id, amount_cents)
       VALUES ($1, $2, $2, $3, $4) RETURNING id`,
      [walletId, referenceType, `guard-res-${tag}-${crypto.randomUUID()}`, amountCents]
    );
    return row.id;
  }

  beforeAll(async () => {
    const { rows: applied } = await pool.query(
      "SELECT 1 FROM _migrations WHERE filename = '750_oxsteed_credit_reservation_guard.sql' AND status = 'applied'"
    );
    if (applied.length !== 1) {
      throw new Error('Apply all repository migrations (including 750) before running the guard tests');
    }
    adminId = await createUser('admin', 'admin');
    const { rows: [partner] } = await pool.query(
      'INSERT INTO oxsteed_credit_partners (created_by) VALUES ($1) RETURNING id',
      [adminId]
    );
    partnerId = Number(partner.id);
    const { rows: [agreement] } = await pool.query(
      `INSERT INTO oxsteed_credit_partner_agreements
         (partner_id, version, status, starts_at, created_by)
       VALUES ($1, 1, 'draft', NOW(), $2) RETURNING id`,
      [partnerId, adminId]
    );
    agreementId = agreement.id;
    const { rows: [treasury] } = await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, currency_code, balance_cents, reserved_cents)
       VALUES ('platform_treasury', 'USD', 0, 0)
       ON CONFLICT DO NOTHING RETURNING id`
    );
    if (treasury) {
      treasuryId = Number(treasury.id);
      createdAccounts.push(treasuryId);
    } else {
      const { rows: [existing] } = await pool.query(
        `SELECT id FROM oxsteed_credit_accounts
          WHERE account_type = 'platform_treasury' AND currency_code = 'USD' LIMIT 1`
      );
      treasuryId = Number(existing.id);
    }
  });

  afterAll(async () => {
    // Best-effort cleanup on the disposable database. Holds are append-only
    // (a delete raises) and their RESTRICT foreign keys pin the related
    // accounts, agreements, partners, and customer users, so fixture rows are
    // left behind. Every fixture uses random ids and the shared treasury is
    // fetched with ON CONFLICT DO NOTHING, so re-runs do not collide.
    const statements = [
      ['DELETE FROM oxsteed_credit_reservations WHERE account_id = ANY($1::bigint[])', [createdAccounts]],
      ['DELETE FROM oxsteed_credit_transaction_entries WHERE account_id = ANY($1::bigint[])', [createdAccounts]],
      [`DELETE FROM oxsteed_credit_transactions
          WHERE debit_account_id = ANY($1::bigint[]) OR credit_account_id = ANY($1::bigint[])`, [createdAccounts]],
      ['DELETE FROM oxsteed_credit_accounts WHERE id = ANY($1::bigint[])', [createdAccounts]],
      ['DELETE FROM oxsteed_credit_partner_agreements WHERE partner_id = $1', [partnerId]],
      ['DELETE FROM oxsteed_credit_partners WHERE id = $1', [partnerId]],
      ['DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUsers]],
    ];
    for (const [sql, params] of statements) {
      try {
        await pool.query(sql, params);
      } catch {
        // Disposable database; fixture rows may be pinned by append-only holds.
      }
    }
    await pool.end();
  });

  async function runInTransaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // already rolled back
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function reservedCents(walletId) {
    const { rows: [account] } = await pool.query(
      'SELECT reserved_cents FROM oxsteed_credit_accounts WHERE id = $1',
      [walletId]
    );
    return Number(account.reserved_cents);
  }

  const GUARD_MESSAGE = /OxSteed Credit reserved balance must equal active hold plus active reservation total/;

  test('hold plus reservation with matching reserved_cents commits cleanly', async () => {
    const { walletId, customerId } = await createWallet();
    await runInTransaction(async (client) => {
      await insertHold(client, walletId, customerId, 3000, 't1');
      await insertReservation(client, walletId, 2000, 't1');
      await client.query('UPDATE oxsteed_credit_accounts SET reserved_cents = 5000 WHERE id = $1', [walletId]);
    });
    expect(await reservedCents(walletId)).toBe(5000);
  });

  test('reserved_cents differing from holds plus reservations raises at commit', async () => {
    const { walletId, customerId } = await createWallet();
    await runInTransaction(async (client) => {
      await insertHold(client, walletId, customerId, 3000, 't2');
      await insertReservation(client, walletId, 2000, 't2');
      await client.query('UPDATE oxsteed_credit_accounts SET reserved_cents = 5000 WHERE id = $1', [walletId]);
    });
    // Correct total is 5000; recording 4999 must fail at commit.
    await expect(
      runInTransaction(async (client) => {
        await client.query('UPDATE oxsteed_credit_accounts SET reserved_cents = 4999 WHERE id = $1', [walletId]);
      })
    ).rejects.toThrow(GUARD_MESSAGE);
    expect(await reservedCents(walletId)).toBe(5000);
  });

  test('releasing a reservation decrements the expected total', async () => {
    const { walletId, customerId } = await createWallet();
    const reservationId = await runInTransaction(async (client) => {
      const id = await insertReservation(client, walletId, 2000, 't3');
      await client.query('UPDATE oxsteed_credit_accounts SET reserved_cents = 2000 WHERE id = $1', [walletId]);
      return id;
    });
    expect(customerId).toBeTruthy();
    // Releasing the only active reservation drops the expected total to 0;
    // the same transaction must decrement reserved_cents to commit.
    await runInTransaction(async (client) => {
      await client.query(
        `UPDATE oxsteed_credit_reservations
            SET status = 'released', released_at = NOW(), released_reason = 'test release'
          WHERE id = $1`,
        [reservationId]
      );
      await client.query('UPDATE oxsteed_credit_accounts SET reserved_cents = 0 WHERE id = $1', [walletId]);
    });
    expect(await reservedCents(walletId)).toBe(0);
    // A release that forgets to decrement reserved_cents fails at commit.
    const reservationId2 = await runInTransaction(async (client) => {
      const id = await insertReservation(client, walletId, 1500, 't3b');
      await client.query('UPDATE oxsteed_credit_accounts SET reserved_cents = 1500 WHERE id = $1', [walletId]);
      return id;
    });
    await expect(
      runInTransaction(async (client) => {
        await client.query(
          'UPDATE oxsteed_credit_reservations SET status = \'released\', released_at = NOW() WHERE id = $1',
          [reservationId2]
        );
      })
    ).rejects.toThrow(GUARD_MESSAGE);
    expect(await reservedCents(walletId)).toBe(1500);
  });

  test('direct SQL on reservations with a mismatched reserved_cents fails at commit', async () => {
    const { walletId } = await createWallet();
    // The guard is attached to the reservations table itself: this insert
    // fires the trigger even though reserved_cents is untouched.
    await expect(
      runInTransaction(async (client) => {
        await insertReservation(client, walletId, 2000, 't4');
        await client.query('UPDATE oxsteed_credit_accounts SET reserved_cents = 1000 WHERE id = $1', [walletId]);
      })
    ).rejects.toThrow(GUARD_MESSAGE);
    expect(await reservedCents(walletId)).toBe(0);
    // A matching total on the reservations table commits.
    await runInTransaction(async (client) => {
      await insertReservation(client, walletId, 2000, 't4b');
      await client.query('UPDATE oxsteed_credit_accounts SET reserved_cents = 2000 WHERE id = $1', [walletId]);
    });
    expect(await reservedCents(walletId)).toBe(2000);
  });

  test('non-customer_wallet accounts are not checked', async () => {
    // Reuse the platform_treasury fixture: active reservation with a
    // deliberately wrong reserved_cents commits because the guard
    // early-returns for non-customer_wallet accounts.
    await runInTransaction(async (client) => {
      await insertReservation(client, treasuryId, 2000, 't5', 'settlement_payout');
      await client.query('UPDATE oxsteed_credit_accounts SET reserved_cents = 777 WHERE id = $1', [treasuryId]);
    });
    expect(await reservedCents(treasuryId)).toBe(777);
    // Restore the treasury fixture state.
    await pool.query('UPDATE oxsteed_credit_accounts SET reserved_cents = 0 WHERE id = $1', [treasuryId]);
  });
});
