'use strict';

// Background-jobs audit (Oct 30 item 10): the payout-settlement
// exception clock ran on updated_at, which any touch resets, so a
// repeatedly touched unsettled payout never raised its exception. The
// sweep now windows on completed_at, stamped once by the
// payout_transactions trigger and never moved by later touches.
// Explicit opt-in to the shared disposable synthetic database; never load .env.
jest.unmock('pg');
const databaseUrl = process.env.STATEMENT_TEST_DATABASE_URL;
const permitted = (() => {
  try {
    const u = new URL(databaseUrl);
    return ['postgres:', 'postgresql:'].includes(u.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
      && u.pathname === '/credit_statement_test';
  } catch { return false; }
})();
if (permitted) process.env.DATABASE_URL = databaseUrl;
const dbDescribe = permitted ? describe : describe.skip;
const crypto = require('crypto');
const pool = require('../db');
const { runPayoutSettlementReconciliation } = require('../jobs/payoutSettlementReconciliation');

test('payout settlement reconciliation DB suite requires explicit synthetic disposable database opt-in', () => {
  expect(permitted).toBe(Boolean(databaseUrl && permitted));
});

dbDescribe('payout settlement clock runs on completed_at, not updated_at', () => {
  let helperId;
  let programId;
  let payoutId;
  let touchedTransactionId;
  let recentTransactionId;
  let preExistingExceptionRefs = [];

  beforeAll(async () => {
    const tag = crypto.randomBytes(8).toString('hex');
    helperId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users(id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'synthetic-fixture', 'Synthetic', 'helper', 'helper', true, true)`,
      [helperId, `helper-${tag}@example.test`]
    );
    const { rows: [prog] } = await pool.query(
      `INSERT INTO affiliate_programs(helper_id, program_type, commission_rate, status)
       VALUES ($1, 'custom', 10, 'active') RETURNING id`,
      [helperId]
    );
    programId = prog.id;
    const { rows: [payout] } = await pool.query(
      `INSERT INTO affiliate_payouts(affiliate_program_id, period_start, period_end, total_commission_cents, commission_count, status)
       VALUES ($1, '2026-10-01', '2026-10-31', 10000, 1, 'completed') RETURNING id`,
      [programId]
    );
    payoutId = payout.id;

    // Completed 72h ago, then touched just now: under the old updated_at
    // clock this row would never raise. completed_at must not move.
    const { rows: [touched] } = await pool.query(
      `INSERT INTO payout_transactions(payout_id, transaction_status, external_transaction_id, completed_at, updated_at)
       VALUES ($1, 'completed', $2, NOW() - INTERVAL '72 hours', NOW() - INTERVAL '72 hours') RETURNING id`,
      [payoutId, `txn_touched_${tag}`]
    );
    touchedTransactionId = touched.id;
    await pool.query(`UPDATE payout_transactions SET updated_at = NOW() WHERE id = $1`, [touchedTransactionId]);

    // Completed 1h ago: inside the 48h grace window, no exception.
    const { rows: [recent] } = await pool.query(
      `INSERT INTO payout_transactions(payout_id, transaction_status, external_transaction_id, completed_at, updated_at)
       VALUES ($1, 'completed', $2, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour') RETURNING id`,
      [payoutId, `txn_recent_${tag}`]
    );
    recentTransactionId = recent.id;

    // The shared disposable DB already holds stale unsettled payouts from
    // other suites; the sweep will raise on those too. Snapshot the
    // pre-existing payout_settlement exceptions so afterAll can restore
    // the table exactly.
    const { rows: preExisting } = await pool.query(
      `SELECT reference_id FROM reconciliation_exceptions WHERE domain = 'payout_settlement'`
    );
    preExistingExceptionRefs = preExisting.map((r) => r.reference_id);
  }, 120000);

  afterAll(async () => {
    await pool.query(
      `DELETE FROM reconciliation_exceptions
        WHERE domain = 'payout_settlement'
          AND reference_id <> ALL($1::text[])`,
      [preExistingExceptionRefs]
    );
    await pool.query(`DELETE FROM payout_transactions WHERE payout_id = $1`, [payoutId]);
    await pool.query(`DELETE FROM affiliate_payouts WHERE id = $1`, [payoutId]);
    await pool.query(`DELETE FROM affiliate_programs WHERE id = $1`, [programId]);
    // Synthetic user left behind deliberately: deleting users rows is
    // blocked schema-wide by the food_customer_wallet_ledger append-only
    // rewrite rule. The tagged email never collides across runs.
    await pool.end();
  });

  test('a touch after completion does not move completed_at, and the sweep raises on it', async () => {
    const { rows: [touched] } = await pool.query(
      `SELECT completed_at, updated_at FROM payout_transactions WHERE id = $1`,
      [touchedTransactionId]
    );
    expect(new Date(touched.updated_at).getTime() - new Date(touched.completed_at).getTime())
      .toBeGreaterThan(70 * 60 * 60 * 1000);

    const result = await runPayoutSettlementReconciliation();
    // The shared DB holds other stale unsettled payouts, so the sweep
    // raises on those too; the assertions below are scoped to this
    // test's two rows.
    expect(result.raised).toBeGreaterThanOrEqual(1);
    expect(result.inspected).toBeGreaterThanOrEqual(1);

    const { rows: exceptions } = await pool.query(
      `SELECT reference_id, domain FROM reconciliation_exceptions
        WHERE domain = 'payout_settlement' AND reference_id IN ($1, $2)`,
      [String(touchedTransactionId), String(recentTransactionId)]
    );
    expect(exceptions.map((e) => e.reference_id)).toEqual([String(touchedTransactionId)]);
  });
});
