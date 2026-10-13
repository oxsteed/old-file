'use strict';

/**
 * Review P2-10-F01 (open-forever half): chat_payment_requests now carry an
 * expires_at TTL. The expiry sweeper flips past-TTL open requests to
 * 'expired', and the shared close helper refuses to settle a request whose
 * TTL has passed, even if the sweeper has not run yet.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const schema = `cpr_expiry_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Expiry fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.STATEMENT_TEST_DATABASE_URL = target.toString();
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');
const db = require('../db');
const {
  paymentRequestTtlHours,
  paymentRequestExpiresAt,
  isPaymentRequestExpired,
  closePaymentRequestAsPaid,
} = require('../services/chatPaymentRequestExpiry');

const describeDb = url ? describe : describe.skip;

function applyMigration(filename) {
  return db.query(fs.readFileSync(path.join(__dirname, '../migrations', filename), 'utf8'));
}

describeDb('chat payment request expiry (P2-10-F01)', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    // Migration 535 alters chat_proof_of_payments; stub it so the fixture
    // only needs the payment-request tables.
    await db.query(`CREATE TABLE ${schema}.chat_proof_of_payments (id UUID PRIMARY KEY, status TEXT)`);
    await applyMigration('535_chat_oxsteed_credit_payments.sql');
    await applyMigration('536_chat_credit_refunds.sql');
    await applyMigration('831_chat_payment_request_expiry.sql');
  });
  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  async function insertRequest({ expiresAt }) {
    const { rows } = await db.query(
      `INSERT INTO chat_payment_requests
         (conversation_id, amount_cents, currency, requested_by, status, expires_at)
       VALUES ($1, 2500, 'USD', $2, 'open', $3)
       RETURNING *`,
      [crypto.randomUUID(), crypto.randomUUID(), expiresAt]
    );
    return rows[0];
  }

  async function statusOf(id) {
    return (await db.query('SELECT status FROM chat_payment_requests WHERE id = $1', [id])).rows[0].status;
  }

  test('migration 831 adds expires_at and the expired status', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'chat_payment_requests' AND column_name = 'expires_at'`,
      [schema]
    );
    expect(rows).toHaveLength(1);
    const check = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'chat_payment_requests_status_check'`
    );
    expect(check.rows[0].def).toContain('expired');
  });

  test('TTL helper defaults to 72 hours and honors the env override', () => {
    delete process.env.CHAT_PAYMENT_REQUEST_TTL_HOURS;
    expect(paymentRequestTtlHours()).toBe(72);
    const before = Date.now();
    const at = paymentRequestExpiresAt();
    expect(at.getTime() - before).toBeGreaterThanOrEqual(72 * 3600 * 1000 - 1000);
    process.env.CHAT_PAYMENT_REQUEST_TTL_HOURS = '48';
    expect(paymentRequestTtlHours()).toBe(48);
    delete process.env.CHAT_PAYMENT_REQUEST_TTL_HOURS;
  });

  test('isPaymentRequestExpired treats missing expires_at as not expired', () => {
    expect(isPaymentRequestExpired({})).toBe(false);
    expect(isPaymentRequestExpired({ expires_at: null })).toBe(false);
    expect(isPaymentRequestExpired({ expires_at: new Date(Date.now() + 3600e3) })).toBe(false);
    expect(isPaymentRequestExpired({ expires_at: new Date(Date.now() - 1000) })).toBe(true);
  });

  test('the sweeper flips past-TTL open requests to expired and leaves the rest', async () => {
    const { expirePaymentRequestsOnce } = require('../services/chatPaymentRequestExpirySweeper');
    const stale = await insertRequest({ expiresAt: new Date(Date.now() - 60 * 1000) });
    const fresh = await insertRequest({ expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
    const noTtl = await insertRequest({ expiresAt: null });
    const paid = await insertRequest({ expiresAt: new Date(Date.now() - 60 * 1000) });
    await db.query(`UPDATE chat_payment_requests SET status = 'paid' WHERE id = $1`, [paid.id]);

    const expired = await expirePaymentRequestsOnce();
    expect(expired).toBe(1);
    expect(await statusOf(stale.id)).toBe('expired');
    expect(await statusOf(fresh.id)).toBe('open');
    expect(await statusOf(noTtl.id)).toBe('open');
    expect(await statusOf(paid.id)).toBe('paid');
    // Idempotent: a second run finds nothing new.
    expect(await expirePaymentRequestsOnce()).toBe(0);
  });

  test('closePaymentRequestAsPaid settles an open unexpired request', async () => {
    const req = await insertRequest({ expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
    const popId = crypto.randomUUID();
    const closed = await closePaymentRequestAsPaid(db, req.id, { popId, creditTxnId: 'txn-1' });
    expect(closed).toMatchObject({ status: 'paid', paid_pop_id: popId, credit_txn_id: 'txn-1' });
    expect(closed.paid_at).toBeTruthy();
    // Second close is a no-op (no double-pay).
    expect(await closePaymentRequestAsPaid(db, req.id, { popId })).toBeNull();
  });

  test('closePaymentRequestAsPaid refuses a past-expiry request even when still open', async () => {
    const req = await insertRequest({ expiresAt: new Date(Date.now() - 60 * 1000) });
    expect(await statusOf(req.id)).toBe('open');
    const closed = await closePaymentRequestAsPaid(db, req.id, { popId: crypto.randomUUID() });
    expect(closed).toBeNull();
    expect(await statusOf(req.id)).toBe('open');
  });
});
