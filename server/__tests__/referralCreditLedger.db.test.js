'use strict';

// Review P2-570 / P2-571 / P3-789 / P3-889 against a real migrated database:
// referral rewards and credit applications post exactly once, and a failed
// payment returns its reserved credit exactly once.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('REFERRAL_LEDGER_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;

const crypto = require('crypto');
const pool = require('../db');
const ledger = require('../services/referralCreditLedger');

describeDatabase('referral credit ledger (real database)', () => {
  afterAll(async () => { await pool.end?.(); });

  test('legacy `type`-only inserts now work and mirror source_type', async () => {
    const user = crypto.randomUUID();
    await pool.query(
      `INSERT INTO platform_ledger (user_id, type, amount_cents, description, metadata)
       VALUES ($1, 'dispute_escrow_hold', 0, 'x', '{}')`, [user]);
    const { rows } = await pool.query('SELECT type, source_type FROM platform_ledger WHERE user_id = $1', [user]);
    expect(rows[0]).toEqual({ type: 'dispute_escrow_hold', source_type: 'dispute_escrow_hold' });
  });

  test('the same key posts once, even concurrently', async () => {
    const user = crypto.randomUUID();
    const key = `referral:referrer:${crypto.randomUUID()}`;
    const results = await Promise.all([1, 2, 3].map(() => ledger.postOnce(pool, {
      userId: user, type: 'referral_credit', amountCents: 500, description: 'r', idempotencyKey: key,
    })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await ledger.getBalanceCents(pool, user)).toBe(500);
  });

  test('apply then release nets to zero; retries do nothing', async () => {
    const user = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    await ledger.postOnce(pool, { userId: user, type: 'promo_credit', amountCents: 300, description: 'p', idempotencyKey: `t:${paymentId}` });
    await ledger.applyCreditToPayment(pool, { userId: user, paymentId, amountCents: 200, jobId: null, paymentIntentId: 'pi_x' });
    await ledger.applyCreditToPayment(pool, { userId: user, paymentId, amountCents: 200, jobId: null, paymentIntentId: 'pi_x' });
    expect(await ledger.getBalanceCents(pool, user)).toBe(100);
    expect(await ledger.releaseCreditForPayment(pool, { paymentId, reason: 't' })).toBe(true);
    expect(await ledger.releaseCreditForPayment(pool, { paymentId, reason: 't' })).toBe(false);
    expect(await ledger.getBalanceCents(pool, user)).toBe(300);
  });

  test('release without a reservation is a no-op', async () => {
    expect(await ledger.releaseCreditForPayment(pool, { paymentId: crypto.randomUUID(), reason: 't' })).toBe(false);
  });
});
