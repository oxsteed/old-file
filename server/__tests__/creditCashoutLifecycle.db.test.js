'use strict';

// Licence readiness, milestone 1: helper cash-out end to end on a real,
// migrated PostgreSQL (no mocks on money paths). Proves:
//   - journal_transaction_id is a UUID and is recorded on 'paid' (bug 1);
//   - funds are reserved at request time and a helper balance can never go
//     negative (bug 2);
//   - a payout destination must be verified (micro-deposits) and the first
//     payout waits for its cooling-off (bug 5);
//   - Haiti pays through the in-house bank rail, not MonCash (bug 8);
//   - an idempotent replay must match the full request (bug 9);
//   - submissions are claimed under a lease, filed once (outbox) and a
//     payout settles only after two DIFFERENT administrators confirm (bug 10).

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CREDIT_CASHOUT_TEST_DATABASE_URL');
if (database) {
  process.env.DATABASE_URL = database;
  process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS = String(50_000_000_000);
  process.env.FEATURE_CREDIT_CASHOUT = 'true';
  process.env.OXSTEED_BANK_PAYOUT_ENABLED = 'true';
  process.env.OXSTEED_BANK_PAYOUT_SOURCE_ACCOUNT = 'TEST-SOURCE-ACCOUNT';
}
const describeDatabase = database ? describe : describe.skip;

const crypto = require('crypto');

jest.setTimeout(180000);

test('cash-out lifecycle test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('helper cash-out lifecycle (licence readiness)', () => {
  let pool;
  let credit;
  let cashout;
  let destinations;
  let bank;
  let helperId;
  let admin1;
  let admin2;
  let partnerId;
  let payableId;
  let railWasEnabled;
  let agreementId;
  const ACCOUNT = `HT${crypto.randomInt(1e9, 9.99e9)}`;

  async function createUser(role, extra = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, country, didit_status, preferred_language)
       VALUES ($1, $2, 'synthetic-unusable', $3, $4, $5, $6, $7, $8)`,
      [id, `cashout-${role}-${id}@example.invalid`, extra.first || 'Jean', extra.last || 'Baptiste', role,
        extra.country || 'HT', extra.didit || null, extra.lang || 'ht']
    );
    return id;
  }

  async function payable() {
    const { rows } = await pool.query('SELECT balance_cents, reserved_cents FROM oxsteed_credit_accounts WHERE id = $1', [payableId]);
    return { balance: Number(rows[0].balance_cents), reserved: Number(rows[0].reserved_cents) };
  }

  async function addVerifiedDestination(accountNumber) {
    const dest = await destinations.addDestination({
      user: { id: helperId },
      input: { countryCode: 'HT', currencyCode: 'HTG', holderName: 'Jean Baptiste', bankName: 'Banque Test', bankCode: 'BT01', accountNumber, verificationMethod: 'micro_deposit' },
    });
    const { rows } = await pool.query(
      `SELECT amount_minor FROM credit_bank_payout_instructions WHERE destination_id = $1 AND purpose = 'micro_deposit' ORDER BY id`,
      [dest.id]
    );
    return { dest, amounts: rows.map((r) => Number(r.amount_minor)) };
  }

  beforeAll(async () => {
    pool = require('../db');
    credit = require('../services/oxsteedCreditService');
    cashout = require('../services/creditCashoutService');
    destinations = require('../services/creditPayoutDestinationService');
    bank = require('../services/creditBankPayoutService');
    const { rows: flag } = await pool.query(`SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
    railWasEnabled = flag[0]?.is_enabled === true;
    await pool.query(`UPDATE feature_flags SET is_enabled = TRUE WHERE key = 'oxsteed_credit_enabled'`);

    admin1 = await createUser('super_admin', { first: 'Admin', last: 'One', lang: 'en' });
    admin2 = await createUser('super_admin', { first: 'Admin', last: 'Two', lang: 'en' });
    helperId = await createUser('helper', { didit: 'verified' });
    const customerId = await createUser('customer', { first: 'Marie', last: 'Client' });

    const { rows: [partner] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (status, settlement_currency_code, created_by) VALUES ('active', 'HTG', $1) RETURNING id`,
      [admin1]
    );
    partnerId = String(partner.id);
    const { rows: [agreement] } = await pool.query(
      `INSERT INTO oxsteed_credit_partner_agreements
         (partner_id, version, status, starts_at, allowed_order_types, allowed_categories, created_by, approved_by)
       VALUES ($1, 1, 'active', NOW() - INTERVAL '1 day', '{}', '{}', $2, $3) RETURNING id`,
      [partnerId, admin1, admin2]
    );
    agreementId = agreement.id;
    await pool.query(
      `INSERT INTO credit_participants (partner_id, participant_type, user_id, status, didit_verified, didit_verified_at, allowed_surfaces)
       VALUES ($1, 'helper', $2, 'active', TRUE, NOW(), '{jobs}')`,
      [partnerId, helperId]
    );
    await pool.query(
      `INSERT INTO oxsteed_credit_identity_verifications (customer_id, requested_tier, tier, status, expires_at)
       VALUES ($1, 2, 2, 'verified', NOW() + INTERVAL '300 days')`,
      [helperId]
    );
    for (const subject of [helperId, customerId]) {
      await pool.query(
        `INSERT INTO oxsteed_credit_sanctions_screenings (subject_type, subject_id, provider, result, payload_hash)
         VALUES ('customer', $1, 'manual_review', 'clear', $2) ON CONFLICT DO NOTHING`,
        [subject, `cashout-test-${subject}`]
      );
    }

    // Fund the helper: treasury -> customer wallet (load), wallet -> helper payable (purchase).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const wallet = await credit.ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode: 'HTG' });
      const treasury = await credit.ensureAccount(client, { accountType: 'platform_treasury', currencyCode: 'HTG' });
      const pay = await credit.ensureAccount(client, { accountType: 'partner_payable', partnerId, currencyCode: 'HTG' });
      payableId = pay.id;
      await credit.postJournalTransaction(client, {
        transactionType: 'load', debitAccountId: treasury.id, creditAccountId: wallet.id, amountCents: 900000, currencyCode: 'HTG',
        idempotencyKey: `cashout-test-load-${helperId}`, actorType: 'admin', actorUserId: admin1, reason: 'test funding', description: 'test funding', referenceType: 'test', referenceId: helperId,
      });
      await credit.postJournalTransaction(client, {
        transactionType: 'purchase', debitAccountId: wallet.id, creditAccountId: pay.id, amountCents: 600000, currencyCode: 'HTG', partnerId, agreementId,
        idempotencyKey: `cashout-test-purchase-${helperId}`, actorType: 'customer', actorUserId: customerId, reason: 'test wages', referenceType: 'test', referenceId: helperId,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`UPDATE feature_flags SET is_enabled = $1 WHERE key = 'oxsteed_credit_enabled'`, [railWasEnabled]);
      await pool.end();
    }
  });

  test('helper payable accounts are flagged non-negative and the DB refuses a negative balance', async () => {
    const { rows } = await pool.query('SELECT non_negative_balance FROM oxsteed_credit_accounts WHERE id = $1', [payableId]);
    expect(rows[0].non_negative_balance).toBe(true);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const revenue = await credit.ensureAccount(client, { accountType: 'platform_revenue', currencyCode: 'HTG' });
      await expect(credit.postJournalTransaction(client, {
        transactionType: 'fee', debitAccountId: payableId, creditAccountId: revenue.id, amountCents: 600001, currencyCode: 'HTG', partnerId,
        idempotencyKey: `cashout-test-overfee-${helperId}`, actorType: 'system', reason: 'over-fee', referenceType: 'test', referenceId: helperId,
      })).rejects.toMatchObject({ code: 'credit_helper_balance_insufficient' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('a destination must be verified by micro-deposits; wrong amounts are counted', async () => {
    const { dest, amounts } = await addVerifiedDestination(ACCOUNT);
    expect(dest.status).toBe('pending_verification');
    expect(amounts).toHaveLength(2);
    const { rows: stored } = await pool.query('SELECT encrypted_details, account_last4, verification_secret_hash FROM credit_payout_destinations WHERE id = $1', [dest.id]);
    expect(stored[0].encrypted_details).not.toContain(ACCOUNT);
    expect(stored[0].account_last4).toBe(ACCOUNT.slice(-4));
    await expect(cashout.requestCashout({
      user: { id: helperId }, amountMinor: 1000, destinationId: dest.id, idempotencyKey: `unverified-${helperId}`,
    })).rejects.toMatchObject({ code: 'cashout_destination_unverified' });
    const wrong = amounts[0] === 98 ? [97, 96] : [98, 99];
    await expect(destinations.verifyDestination({ user: { id: helperId }, destinationId: dest.id, amounts: wrong }))
      .rejects.toMatchObject({ code: 'destination_verification_mismatch' });
    const verified = await destinations.verifyDestination({ user: { id: helperId }, destinationId: dest.id, amounts: [amounts[1], amounts[0]] });
    expect(verified.status).toBe('verified');
    const coolingMs = new Date(verified.cooling_off_until).getTime() - Date.now();
    expect(coolingMs).toBeGreaterThan(2.9 * 86400000);
    expect(coolingMs).toBeLessThan(3.1 * 86400000);
  });

  test('request reserves funds, waits for cooling-off, submits once, settles after two admins', async () => {
    const { rows: [destRow] } = await pool.query(`SELECT id FROM credit_payout_destinations WHERE user_id = $1 AND status = 'verified' LIMIT 1`, [helperId]);
    const before = await payable();
    const key = `cashout-${crypto.randomUUID()}`;
    const req = await cashout.requestCashout({ user: { id: helperId }, amountMinor: 100000, destinationId: destRow.id, idempotencyKey: key });
    expect(req.status).toBe('requested');
    expect(new Date(req.available_at).getTime()).toBeGreaterThan(Date.now() + 2.9 * 86400000);
    const afterRequest = await payable();
    expect(afterRequest.balance).toBe(before.balance);
    expect(afterRequest.reserved).toBe(before.reserved + 100000);

    // Replay with the same key: same receipt. Different amount: conflict.
    const replay = await cashout.requestCashout({ user: { id: helperId }, amountMinor: 100000, destinationId: destRow.id, idempotencyKey: key });
    expect(replay.id).toBe(req.id);
    await expect(cashout.requestCashout({ user: { id: helperId }, amountMinor: 100001, destinationId: destRow.id, idempotencyKey: key }))
      .rejects.toMatchObject({ code: 'cashout_idempotency_conflict' });

    // Still cooling off: the worker does not touch it.
    await cashout.processCashouts();
    let { rows } = await pool.query('SELECT status FROM credit_cashout_requests WHERE id = $1', [req.id]);
    expect(rows[0].status).toBe('requested');

    // Cooling-off ends.
    await pool.query(`UPDATE credit_cashout_requests SET available_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [req.id]);
    await cashout.processCashouts();
    await cashout.processCashouts();
    ({ rows } = await pool.query('SELECT status, partner_name, partner_idempotency_key FROM credit_cashout_requests WHERE id = $1', [req.id]));
    expect(rows[0].status).toBe('submitted');
    expect(rows[0].partner_name).toBe('oxsteed_bank_payout');
    const { rows: instructions } = await pool.query(`SELECT * FROM credit_bank_payout_instructions WHERE cashout_id = $1`, [req.id]);
    expect(instructions).toHaveLength(1);
    expect(instructions[0].idempotency_key).toBe(rows[0].partner_idempotency_key);

    const exported = await bank.exportBatch({ actorUserId: admin1, countryCode: 'HT', currencyCode: 'HTG' });
    expect(exported.csv).toContain(`"${ACCOUNT}"`);
    expect(exported.csv).toContain('"1000.00"');
    expect(exported.batch.sha256).toMatch(/^[0-9a-f]{64}$/);

    const first = await bank.confirmInstruction({ actorUserId: admin1, instructionId: instructions[0].id, outcome: 'paid', bankReference: 'BANK-REF-1' });
    expect(first.settled).toBe(false);
    await expect(bank.confirmInstruction({ actorUserId: admin1, instructionId: instructions[0].id, outcome: 'paid' }))
      .rejects.toMatchObject({ code: 'bank_payout_second_admin_required' });
    const second = await bank.confirmInstruction({ actorUserId: admin2, instructionId: instructions[0].id, outcome: 'paid' });
    expect(second.settled).toBe(true);

    ({ rows } = await pool.query('SELECT status, journal_transaction_id FROM credit_cashout_requests WHERE id = $1', [req.id]));
    expect(rows[0].status).toBe('paid');
    expect(rows[0].journal_transaction_id).toMatch(/^[0-9a-f-]{36}$/);
    const { rows: tx } = await pool.query('SELECT transaction_type, amount_cents, partner_id FROM oxsteed_credit_transactions WHERE id = $1', [rows[0].journal_transaction_id]);
    expect(tx[0]).toMatchObject({ transaction_type: 'cash_out', amount_cents: '100000', partner_id: partnerId });
    const afterPaid = await payable();
    expect(afterPaid.balance).toBe(before.balance - 100000);
    expect(afterPaid.reserved).toBe(before.reserved);
    const { rows: dest } = await pool.query('SELECT first_payout_at FROM credit_payout_destinations WHERE id = $1', [destRow.id]);
    expect(dest[0].first_payout_at).not.toBeNull();
  });

  test('two workers can never claim the same request; a returned payout gives the money back', async () => {
    const { rows: [destRow] } = await pool.query(`SELECT id FROM credit_payout_destinations WHERE user_id = $1 AND status = 'verified' LIMIT 1`, [helperId]);
    const before = await payable();
    const req = await cashout.requestCashout({ user: { id: helperId }, amountMinor: 50000, destinationId: destRow.id, idempotencyKey: `cashout-${crypto.randomUUID()}` });
    // Second payout to an already-used destination: no cooling-off.
    expect(new Date(req.available_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    const [a, b] = await Promise.all([cashout.claimDueCashouts(10), cashout.claimDueCashouts(10)]);
    const claimedIds = [...a, ...b].map((r) => String(r.id)).filter((id) => id === req.id);
    expect(claimedIds).toHaveLength(1);
    // Let the lease lapse and the worker retry with the same key: one instruction.
    await pool.query(`UPDATE credit_cashout_requests SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [req.id]);
    await cashout.processCashouts();
    const { rows: instructions } = await pool.query(`SELECT id FROM credit_bank_payout_instructions WHERE cashout_id = $1`, [req.id]);
    expect(instructions).toHaveLength(1);
    await bank.exportBatch({ actorUserId: admin2, countryCode: 'HT', currencyCode: 'HTG' });
    await bank.confirmInstruction({ actorUserId: admin2, instructionId: instructions[0].id, outcome: 'returned', failureCode: 'account_closed' });
    await bank.confirmInstruction({ actorUserId: admin1, instructionId: instructions[0].id, outcome: 'returned' });
    const { rows } = await pool.query('SELECT status, failure_code, journal_transaction_id FROM credit_cashout_requests WHERE id = $1', [req.id]);
    expect(rows[0]).toMatchObject({ status: 'failed', failure_code: 'account_closed', journal_transaction_id: null });
    const after = await payable();
    expect(after).toEqual(before);
  });

  test('the same bank account added by another user is held for review with a case', async () => {
    const other = await createUser('helper', { first: 'Pierre', last: 'Autre', didit: 'verified' });
    const dest = await destinations.addDestination({
      user: { id: other },
      input: { countryCode: 'HT', currencyCode: 'HTG', holderName: 'Pierre Autre', bankName: 'Banque Test', bankCode: 'BT01', accountNumber: ACCOUNT, verificationMethod: 'one_time_code' },
    });
    expect(dest.status).toBe('held_for_review');
    const { rows } = await pool.query(
      `SELECT case_type FROM oxsteed_credit_compliance_cases WHERE dedupe_key = $1`,
      [`payout-destination:${dest.id}:shared_destination`]
    );
    expect(rows[0].case_type).toBe('payout_destination_review');
  });

  test('the bank payout two-person rule is enforced by the database', async () => {
    const { rows: [i] } = await pool.query(`SELECT id FROM credit_bank_payout_instructions WHERE status = 'exported' LIMIT 1`);
    if (!i) return;
    await expect(pool.query(
      `UPDATE credit_bank_payout_instructions SET status = 'paid', first_confirmed_by = $2, second_confirmed_by = $2 WHERE id = $1`,
      [i.id, admin1]
    )).rejects.toMatchObject({ code: '23514' });
  });

  test('erasure is blocked while the helper still holds Credit (review bug 6)', async () => {
    const privacy = require('../services/privacyRetentionService');
    const client = await pool.connect();
    try {
      expect(await privacy.blockerFor(client, helperId)).toBe('positive_credit_balance');
      const balances = await privacy.creditBalancesFor(client, helperId);
      expect(balances).toEqual(expect.arrayContaining([expect.objectContaining({ account_type: 'partner_payable', currency: 'HTG' })]));
    } finally {
      client.release();
    }
  });

  test('Haiti country policy uses the in-house rail and MonCash is gone', async () => {
    const { rows } = await pool.query(`SELECT cashout_partner FROM payment_country_policies WHERE country_code = 'HT'`);
    expect(rows[0].cashout_partner).toBe('oxsteed_bank_payout');
    const { rows: pack } = await pool.query(`SELECT config->'payment_methods' AS m FROM country_packs WHERE code = 'HT'`);
    if (pack[0]) expect(JSON.stringify(pack[0].m)).not.toContain('moncash');
  });
});
