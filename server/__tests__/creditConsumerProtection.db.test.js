'use strict';

// Licence readiness M4 (§7 consumer protection) on a real PostgreSQL:
// business-day calendar, dispute clocks set by the DB trigger, the SLA
// sweep (flagged by default, automatic provisional credit and reversal only
// behind flags), results notices, helper "cash-out not received" disputes
// resolved by two administrators (including a reissue), disclosures with
// two-person publishing and hashed acceptance, and wage-payment consent.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CREDIT_CONSUMER_TEST_DATABASE_URL');
if (database) {
  process.env.DATABASE_URL = database;
  process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS = String(50_000_000_000);
  process.env.OXSTEED_BANK_PAYOUT_ENABLED = 'true';
  process.env.OXSTEED_BANK_PAYOUT_SOURCE_ACCOUNT = 'TEST-SOURCE-ACCOUNT';
}
const describeDatabase = database ? describe : describe.skip;

jest.mock('../services/stepupChallengeService', () => ({
  ...jest.requireActual('../services/stepupChallengeService'),
  verifyStepupChallenge: jest.fn(async () => ({ verified: true })),
}));

const crypto = require('crypto');

jest.setTimeout(180000);

test('consumer protection test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('consumer protection (licence readiness §7)', () => {
  let pool;
  let pending;
  let credit;
  let sla;
  let notices;
  let noticeSpy;
  let admin1;
  let admin2;
  let railWasEnabled;
  const CUR = 'HTG';
  const createdUsers = [];

  async function createUser(role, extra = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, country, preferred_language)
       VALUES ($1, $2, 'synthetic-unusable', $3, $4, $5, $6, $7)`,
      [id, `m4cp-${role}-${id}@example.invalid`, extra.first || 'Marie', extra.last || 'Test', role, extra.country || 'US', extra.lang || 'en']
    );
    createdUsers.push(id);
    return id;
  }

  async function oversight(actionType, payload) {
    const r = await pending.requestPendingAction({ actionType, payload, requestedBy: admin1, idempotencyKey: `m4cp-${crypto.randomUUID()}` });
    await expect(pending.decideOversightAction({ actionId: r.pendingAction.id, decision: 'approve', decidedBy: admin1, reason: 'self' }))
      .rejects.toMatchObject({ code: 'credit_self_approval_forbidden' });
    const decided = await pending.decideOversightAction({ actionId: r.pendingAction.id, decision: 'approve', decidedBy: admin2, reason: 'checked' });
    return decided.result;
  }

  async function asReplica(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role = replica');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** A funded customer wallet and one posted load the customer can dispute. */
  async function fundedCustomer({ backdateDays = 0, amount = 50000 } = {}) {
    const customerId = await createUser('customer');
    await pool.query(
      `INSERT INTO oxsteed_credit_sanctions_screenings (subject_type, subject_id, provider, result, payload_hash)
       VALUES ('customer', $1, 'manual_review', 'clear', $2) ON CONFLICT DO NOTHING`,
      [customerId, `m4cp-${customerId}`]
    );
    const client = await pool.connect();
    let tx;
    let walletId;
    try {
      await client.query('BEGIN');
      const wallet = await credit.ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode: CUR });
      walletId = wallet.id;
      const treasury = await credit.ensureAccount(client, { accountType: 'platform_treasury', currencyCode: CUR });
      tx = await credit.postJournalTransaction(client, {
        transactionType: 'load', debitAccountId: treasury.id, creditAccountId: wallet.id, amountCents: amount, currencyCode: CUR,
        idempotencyKey: `m4cp-load-${customerId}`, actorType: 'admin', actorUserId: admin1, reason: 'test funding', description: 'test funding',
        referenceType: 'test', referenceId: customerId,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (backdateDays) {
      await asReplica((c) => c.query(`UPDATE oxsteed_credit_accounts SET created_at = NOW() - make_interval(days => $2) WHERE id = $1`, [walletId, backdateDays]));
    }
    const transactionId = tx.transaction?.id || tx.id;
    return { customerId, walletId, transactionId };
  }

  async function openDispute(customerId, transactionId, extra = {}) {
    const { rows } = await pool.query(
      `INSERT INTO oxsteed_credit_disputes (transaction_id, customer_id, reason_code, description, opened_by, dispute_type, idempotency_key)
       VALUES ($1, $2, 'unauthorized', 'I did not make this', $2, $3, $4) RETURNING *`,
      [transactionId, customerId, extra.type || 'unauthorized_topup', `m4cp-dispute-${crypto.randomUUID()}`]
    );
    return rows[0];
  }

  async function walletBalance(walletId) {
    const { rows } = await pool.query('SELECT balance_cents FROM oxsteed_credit_accounts WHERE id = $1', [walletId]);
    return Number(rows[0].balance_cents);
  }

  beforeAll(async () => {
    pool = require('../db');
    pending = require('../services/oxsteedCreditPendingActionService');
    credit = require('../services/oxsteedCreditService');
    sla = require('../services/creditCompliance/disputeSlaService');
    notices = require('../services/creditCompliance/notices');
    noticeSpy = jest.spyOn(notices, 'sendUserNotice').mockImplementation(async () => ({ sent: true }));
    const { rows: flag } = await pool.query(`SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
    railWasEnabled = flag[0]?.is_enabled === true;
    // Domain 8 #4 follow-up: a bare UPDATE is a no-op when the row is
    // absent, and several suites (affiliatePayoutCore, statementSelfService,
    // ledgerTransactionUuid) delete this row in teardown, so the shared
    // test database often has no row at all. Ensure it exists first, the
    // same pattern ledgerTransactionUuid's beforeEach uses; without it the
    // rail reads as disabled and the auto-provisional test fails with the
    // balance unmoved. afterAll restores the seeded off state (FALSE).
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled) SELECT 'oxsteed_credit_enabled', TRUE WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'oxsteed_credit_enabled')`
    );
    await pool.query(`UPDATE feature_flags SET is_enabled = TRUE WHERE key = 'oxsteed_credit_enabled'`);
    admin1 = await createUser('super_admin', { first: 'Admin', last: 'Maker' });
    admin2 = await createUser('super_admin', { first: 'Admin', last: 'Checker' });
  });

  afterAll(async () => {
    delete process.env.OXSTEED_CREDIT_DISPUTE_AUTO_PROVISIONAL;
    delete process.env.OXSTEED_CREDIT_DISPUTE_AUTO_REVERSAL;
    delete process.env.OXSTEED_CREDIT_REQUIRE_DISCLOSURE_ACCEPTANCE;
    delete process.env.OXSTEED_CREDIT_WAGE_CONSENT_REQUIRED;
    await pool.query(`DELETE FROM credit_disclosure_acceptances WHERE user_id = ANY($1::uuid[])`, [createdUsers]);
    await pool.query(`DELETE FROM credit_disclosure_versions WHERE approved_reference LIKE 'M4CP-%'`);
    await pool.query(`DELETE FROM credit_business_holidays WHERE country_code = 'ZZ'`);
    await pool.query(`UPDATE feature_flags SET is_enabled = $1 WHERE key = 'oxsteed_credit_enabled'`, [railWasEnabled]);
    await pool.end();
  });

  describe('business-day calendar', () => {
    test('weekends and holidays are skipped, in SQL and JS alike', async () => {
      // Friday 2026-11-20 + 10 US business days skips Thanksgiving (26th).
      const { rows } = await pool.query(`SELECT credit_add_business_days('2026-11-20T15:00:00Z', 10, 'US') AS d`);
      expect(new Date(rows[0].d).toISOString()).toBe('2026-12-07T15:00:00.000Z');
      const js = sla.addBusinessDays('2026-11-20T15:00:00Z', 10, new Set(['2026-11-26']));
      expect(js.toISOString()).toBe('2026-12-07T15:00:00.000Z');
      // A country without its own holidays uses weekends only.
      const { rows: zz } = await pool.query(`SELECT credit_add_business_days('2026-11-20T15:00:00Z', 10, 'ZZ') AS d`);
      expect(new Date(zz[0].d).toISOString()).toBe('2026-12-04T15:00:00.000Z');
    });

    test('a holiday is added by two administrators and moves the clock', async () => {
      await oversight('credit_business_holiday_set', { countryCode: 'ZZ', date: '2026-11-23', name: 'Test holiday' });
      const { rows } = await pool.query(`SELECT credit_add_business_days('2026-11-20T15:00:00Z', 10, 'ZZ') AS d`);
      expect(new Date(rows[0].d).toISOString()).toBe('2026-12-07T15:00:00.000Z');
      expect((await sla.listHolidays({ countryCode: 'ZZ' })).map((h) => h.date)).toEqual(['2026-11-23']);
      await oversight('credit_business_holiday_set', { countryCode: 'ZZ', date: '2026-11-23', remove: true });
      expect(await sla.listHolidays({ countryCode: 'ZZ' })).toEqual([]);
    });
  });

  describe('dispute clocks and the SLA sweep', () => {
    test('the trigger sets 20 business / 90 calendar days for a new account and 10 / 45 otherwise', async () => {
      const fresh = await fundedCustomer();
      const d1 = await openDispute(fresh.customerId, fresh.transactionId);
      expect(d1.extended_window).toBe(true);
      expect(d1.business_calendar).toBe('US');
      const { rows: [e1] } = await pool.query(`SELECT credit_add_business_days($1, 20, 'US') AS p`, [d1.notified_at]);
      expect(new Date(d1.provisional_due_at).getTime()).toBe(new Date(e1.p).getTime());
      const { rows: [r1] } = await pool.query(`SELECT resolution_due_at = notified_at + INTERVAL '90 days' AS ok FROM oxsteed_credit_disputes WHERE id = $1`, [d1.id]);
      expect(r1.ok).toBe(true);

      const old = await fundedCustomer({ backdateDays: 60 });
      const d2 = await openDispute(old.customerId, old.transactionId, { type: 'unauthorized_transfer' });
      expect(d2.extended_window).toBe(false);
      const { rows: [e2] } = await pool.query(`SELECT credit_add_business_days($1, 10, 'US') AS p`, [d2.notified_at]);
      expect(new Date(d2.provisional_due_at).getTime()).toBe(new Date(e2.p).getTime());
      const { rows: [r2] } = await pool.query(`SELECT resolution_due_at = notified_at + INTERVAL '45 days' AS ok FROM oxsteed_credit_disputes WHERE id = $1`, [d2.id]);
      expect(r2.ok).toBe(true);
      const clocks = await sla.listDisputeClocks({ limit: 1000 });
      expect(clocks.find((c) => c.id === d2.id)).toMatchObject({ dispute_type: 'unauthorized_transfer', extended_window: false });
    });

    test('by default an overdue provisional credit raises an incident and moves no money', async () => {
      delete process.env.OXSTEED_CREDIT_DISPUTE_AUTO_PROVISIONAL;
      const c = await fundedCustomer({ backdateDays: 60 });
      const d = await openDispute(c.customerId, c.transactionId);
      await pool.query(`UPDATE oxsteed_credit_disputes SET provisional_due_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [d.id]);
      const before = await walletBalance(c.walletId);
      const out = await sla.sweepProvisionalDue(new Date());
      expect(out.flagged).toBeGreaterThanOrEqual(1);
      expect(await walletBalance(c.walletId)).toBe(before);
      const { rows } = await pool.query(`SELECT severity FROM incident_log WHERE dedupe_key = $1`, [`credit-dispute-provisional-due:${d.id}`]);
      expect(rows[0].severity).toBe('critical');
      const { rows: after } = await pool.query('SELECT provisional_overdue_flagged_at, provisional_credit_cents FROM oxsteed_credit_disputes WHERE id = $1', [d.id]);
      expect(after[0].provisional_overdue_flagged_at).not.toBeNull();
      expect(Number(after[0].provisional_credit_cents)).toBe(0);
    });

    test('with the flag on, provisional credit is issued once; a rejection is reversed only after notice + 5 business days', async () => {
      // Without a policy administrator the flag alone moves no money.
      process.env.OXSTEED_CREDIT_DISPUTE_AUTO_PROVISIONAL = 'true';
      process.env.OXSTEED_CREDIT_DISPUTE_AUTO_REVERSAL = 'true';
      delete process.env.OXSTEED_CREDIT_DISPUTE_POLICY_ADMIN_ID;
      try {
        const n = await fundedCustomer({ backdateDays: 60 });
        const nd = await openDispute(n.customerId, n.transactionId);
        await pool.query(`UPDATE oxsteed_credit_disputes SET provisional_due_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [nd.id]);
        const nb = await walletBalance(n.walletId);
        await sla.sweepProvisionalDue(new Date());
        expect(await walletBalance(n.walletId)).toBe(nb);
        const { rows: inc } = await pool.query(`SELECT 1 FROM incident_log WHERE dedupe_key = $1`, [`credit-dispute-provisional-due:${nd.id}`]);
        expect(inc).toHaveLength(1);

        process.env.OXSTEED_CREDIT_DISPUTE_POLICY_ADMIN_ID = admin2;
        const c = await fundedCustomer({ backdateDays: 60, amount: 30000 });
        const d = await openDispute(c.customerId, c.transactionId);
        await pool.query(`UPDATE oxsteed_credit_disputes SET provisional_due_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [d.id]);
        const before = await walletBalance(c.walletId);
        await sla.sweepProvisionalDue(new Date());
        await sla.sweepProvisionalDue(new Date());
        expect(await walletBalance(c.walletId)).toBe(before + 30000);
        let { rows } = await pool.query('SELECT status, provisional_credit_cents, provisional_auto_issued_at FROM oxsteed_credit_disputes WHERE id = $1', [d.id]);
        expect(rows[0]).toMatchObject({ status: 'in_review', provisional_credit_cents: '30000' });
        expect(noticeSpy).toHaveBeenCalledWith(expect.objectContaining({ userId: c.customerId, key: 'dispute_provisional_credit' }));

        // Decided against the customer: results notice, then reversal notice.
        await pool.query(
          `UPDATE oxsteed_credit_disputes SET status = 'rejected', resolution = 'The load was authorised from your device', resolved_by = $2, resolved_at = NOW() WHERE id = $1`,
          [d.id, admin1]
        );
        await sla.sweepResultsNotices();
        expect(noticeSpy).toHaveBeenCalledWith(expect.objectContaining({
          userId: c.customerId, key: 'dispute_results', params: expect.objectContaining({ outcome_key: 'rejected' }),
        }));
        await sla.sweepProvisionalReversals(new Date());
        ({ rows } = await pool.query('SELECT provisional_reversal_notice_at, provisional_reversal_effective_at, provisional_reversed_at, business_calendar FROM oxsteed_credit_disputes WHERE id = $1', [d.id]));
        expect(rows[0].provisional_reversal_notice_at).not.toBeNull();
        expect(rows[0].provisional_reversed_at).toBeNull();
        // 5 business days from the notice is 5 calendar days when the
        // notice lands on a Sunday, 7 from a Friday, and exactly 6 from
        // a Saturday, so a fixed "now + 6 days" bound fails by
        // milliseconds on Saturdays (and by a day on Sundays). Compare
        // against the same DB function the sweep uses, allowing 1s for
        // the NOW() skew between the sweep's SELECT and UPDATE.
        const { rows: [expected] } = await pool.query(
          `SELECT credit_add_business_days($1, 5, $2) AS p`,
          [rows[0].provisional_reversal_notice_at, rows[0].business_calendar || 'US']
        );
        expect(new Date(rows[0].provisional_reversal_effective_at).getTime())
          .toBeGreaterThanOrEqual(new Date(expected.p).getTime() - 1000);
        expect(await walletBalance(c.walletId)).toBe(before + 30000);
        // Not yet effective: nothing happens.
        await sla.sweepProvisionalReversals(new Date());
        expect(await walletBalance(c.walletId)).toBe(before + 30000);
        // Effective date reached.
        await sla.sweepProvisionalReversals(new Date(Date.now() + 10 * 86400000));
        expect(await walletBalance(c.walletId)).toBe(before);
        ({ rows } = await pool.query('SELECT provisional_reversed_at FROM oxsteed_credit_disputes WHERE id = $1', [d.id]));
        expect(rows[0].provisional_reversed_at).not.toBeNull();
      } finally {
        delete process.env.OXSTEED_CREDIT_DISPUTE_AUTO_PROVISIONAL;
        delete process.env.OXSTEED_CREDIT_DISPUTE_AUTO_REVERSAL;
        delete process.env.OXSTEED_CREDIT_DISPUTE_POLICY_ADMIN_ID;
      }
    });

    test('a failed provisional-credit notice is recorded instead of discarded (audit item 45)', async () => {
      process.env.OXSTEED_CREDIT_DISPUTE_AUTO_PROVISIONAL = 'true';
      process.env.OXSTEED_CREDIT_DISPUTE_POLICY_ADMIN_ID = admin2;
      const logger = require('../utils/logger');
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const defaultSend = async () => ({ sent: true });
      try {
        const c = await fundedCustomer({ backdateDays: 60, amount: 30000 });
        const d = await openDispute(c.customerId, c.transactionId);
        await pool.query(`UPDATE oxsteed_credit_disputes SET provisional_due_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [d.id]);
        noticeSpy.mockImplementation(async (args) => (
          String(args.idempotencyKey || '').includes(`:${d.id}:provisional-auto`)
            ? { sent: false, error: 'resend down' }
            : { sent: true }
        ));
        const out = await sla.sweepProvisionalDue(new Date());
        expect(out.autoIssued).toBe(1);
        expect(out.noticeFailed).toBe(1);
        expect(warnSpy).toHaveBeenCalledWith(
          'credit_dispute.provisional_notice_failed',
          expect.objectContaining({ disputeId: String(d.id) })
        );
      } finally {
        noticeSpy.mockImplementation(defaultSend);
        warnSpy.mockRestore();
        delete process.env.OXSTEED_CREDIT_DISPUTE_AUTO_PROVISIONAL;
        delete process.env.OXSTEED_CREDIT_DISPUTE_POLICY_ADMIN_ID;
      }
    });

    test('a failed results notice is not stamped sent and retries on the next sweep (Domain 8 #4)', async () => {
      const { customerId, transactionId } = await fundedCustomer();
      const dispute = await openDispute(customerId, transactionId);
      await pool.query(
        `UPDATE oxsteed_credit_disputes SET status = 'resolved_customer', resolution = 'Credited in full', resolved_by = $2, resolved_at = NOW(), resolution_due_at = NOW() - INTERVAL '31 days' WHERE id = $1`,
        [dispute.id, admin1]
      );
      noticeSpy.mockResolvedValueOnce({ sent: false, error: 'smtp down' });
      const first = await sla.sweepResultsNotices();
      expect(first.attempted).toBe(1);
      expect(first.sent).toBe(0);
      const { rows: [afterFail] } = await pool.query(
        `SELECT results_notice_sent_at, results_notice_result FROM oxsteed_credit_disputes WHERE id = $1`,
        [dispute.id]
      );
      expect(afterFail.results_notice_sent_at).toBeNull();
      expect(afterFail.results_notice_result.sent).toBe(false);
      // The next sweep retries the same dispute, and the resend path
      // stamps only when the send actually succeeds.
      const second = await sla.sweepResultsNotices();
      expect(second.attempted).toBe(1);
      expect(second.sent).toBe(1);
      const { rows: [afterOk] } = await pool.query(`SELECT results_notice_sent_at FROM oxsteed_credit_disputes WHERE id = $1`, [dispute.id]);
      expect(afterOk.results_notice_sent_at).not.toBeNull();
      expect((await sla.sweepResultsNotices()).attempted).toBe(0);
      // Resending an already-notified dispute is a no-op (no second send).
      const callsBefore = noticeSpy.mock.calls.length;
      expect(await sla.resendResultsNotice({ disputeId: dispute.id, actorUserId: admin1 })).toEqual({ sent: true, alreadySent: true });
      expect(noticeSpy.mock.calls.length).toBe(callsBefore);
    });

    test('a dispute past its final deadline opens a dispute_deadline case', async () => {
      const c = await fundedCustomer({ backdateDays: 60 });
      const d = await openDispute(c.customerId, c.transactionId);
      await pool.query(`UPDATE oxsteed_credit_disputes SET resolution_due_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [d.id]);
      await sla.sweepFinalDeadline(new Date());
      const { rows } = await pool.query(`SELECT case_type, subject_type FROM oxsteed_credit_compliance_cases WHERE dedupe_key = $1`, [`credit-dispute-deadline:${d.id}`]);
      expect(rows[0]).toEqual({ case_type: 'dispute_deadline', subject_type: 'customer' });
      const again = await sla.sweepFinalDeadline(new Date());
      expect(again.breached).toBe(0);
    });
  });

  describe('helper cash-out not received', () => {
    let helperId;
    let cashoutId;
    let destinationId;

    beforeAll(async () => {
      helperId = await createUser('helper', { country: 'HT', lang: 'ht' });
      const destinations = require('../services/creditPayoutDestinationService');
      const dest = await destinations.addDestination({
        user: { id: helperId },
        input: { countryCode: 'HT', currencyCode: CUR, holderName: 'Marie Test', bankName: 'Banque Test', bankCode: 'BT01', accountNumber: `HT${crypto.randomInt(1e9, 9.99e9)}`, verificationMethod: 'one_time_code' },
      });
      destinationId = dest.id;
      await pool.query(`UPDATE credit_payout_destinations SET status = 'verified', verified_at = NOW(), cooling_off_until = NOW() - INTERVAL '1 day' WHERE id = $1`, [destinationId]);
      const { rows: [tx] } = await pool.query(`SELECT id FROM oxsteed_credit_transactions WHERE status = 'posted' ORDER BY created_at DESC LIMIT 1`);
      cashoutId = await asReplica(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO credit_cashout_requests
             (user_id, credit_partner_id, country_code, partner_name, amount_minor, currency, destination_ref, status, available_at,
              journal_transaction_id, idempotency_key, partner_idempotency_key, destination_id)
           VALUES ($1, 1, 'HT', 'oxsteed_bank_payout', 25000, $2, 'dest', 'paid', NOW(), $3, $4, $4, $5) RETURNING id`,
          [helperId, CUR, tx.id, `m4cp-cashout-${helperId}`, destinationId]
        );
        return String(rows[0].id);
      });
    });

    test('only the owner can report a paid cash-out; the report is idempotent and unique while open', async () => {
      const other = await createUser('helper', { country: 'HT' });
      await expect(sla.openCashoutDispute({ user: { id: other }, cashoutId, description: 'never arrived', idempotencyKey: `k-${other}` }))
        .rejects.toMatchObject({ code: 'cashout_not_found' });
      await expect(sla.openCashoutDispute({ user: { id: helperId }, cashoutId, description: 'x', idempotencyKey: 'k', isImpersonated: true }))
        .rejects.toMatchObject({ code: 'impersonation_blocked' });
      const key = `m4cp-cd-${crypto.randomUUID()}`;
      const opened = await sla.openCashoutDispute({ user: { id: helperId }, cashoutId, description: 'The money never reached my bank', idempotencyKey: key });
      expect(opened).toMatchObject({ cashout_id: cashoutId, status: 'open', amount_minor: 25000, currency: CUR });
      expect(new Date(opened.resolution_due_at).getTime()).toBeGreaterThan(Date.now() + 44 * 86400000);
      const replay = await sla.openCashoutDispute({ user: { id: helperId }, cashoutId, description: 'The money never reached my bank', idempotencyKey: key });
      expect(replay.id).toBe(opened.id);
      await expect(sla.openCashoutDispute({ user: { id: helperId }, cashoutId, description: 'again', idempotencyKey: `${key}-2` }))
        .rejects.toMatchObject({ code: 'cashout_dispute_already_open' });
      expect(noticeSpy).toHaveBeenCalledWith(expect.objectContaining({ userId: helperId, key: 'cashout_dispute_received' }));
      expect((await sla.listCashoutDisputesForUser({ id: helperId })).map((d) => d.id)).toEqual([opened.id]);
    });

    test('two administrators reissue it as a new bank instruction; the results notice follows', async () => {
      const [open] = await sla.listCashoutDisputesForUser({ id: helperId });
      await expect(pending.requestPendingAction({
        actionType: 'credit_cashout_dispute_resolve', payload: { disputeId: open.id, outcome: 'resolved_reissued', resolution: 'short' },
        requestedBy: admin1, idempotencyKey: `m4cp-${crypto.randomUUID()}`,
      })).rejects.toMatchObject({ statusCode: 400 });
      const resolved = await oversight('credit_cashout_dispute_resolve', {
        disputeId: open.id, outcome: 'resolved_reissued', resolution: 'The bank returned the first transfer; we sent it again.',
      });
      expect(resolved.status).toBe('resolved_reissued');
      const { rows } = await pool.query(
        `SELECT purpose, amount_minor, cashout_id, status FROM credit_bank_payout_instructions WHERE idempotency_key = $1`,
        [`credit-cashout-dispute-reissue:${open.id}`]
      );
      expect(rows[0]).toMatchObject({ purpose: 'cashout_reissue', amount_minor: '25000', cashout_id: cashoutId });
      await sla.sweepCashoutDisputes(new Date());
      expect(noticeSpy).toHaveBeenCalledWith(expect.objectContaining({
        userId: helperId, key: 'dispute_results', params: expect.objectContaining({ outcome_key: 'resolved_reissued' }),
      }));
      const { rows: d } = await pool.query('SELECT results_notice_sent_at FROM credit_cashout_disputes WHERE id = $1', [open.id]);
      expect(d[0].results_notice_sent_at).not.toBeNull();
    });

    test('a failed cash-out results notice is not stamped sent and retries on the next sweep (Domain 8 #4)', async () => {
      const key = `m4cp-cd2-${crypto.randomUUID()}`;
      const opened = await sla.openCashoutDispute({ user: { id: helperId }, cashoutId, description: 'Still nothing', idempotencyKey: key });
      const resolved = await oversight('credit_cashout_dispute_resolve', {
        disputeId: opened.id, outcome: 'resolved_paid_confirmed', resolution: 'The bank confirmed the first transfer arrived.',
      });
      expect(resolved.status).toBe('resolved_paid_confirmed');
      noticeSpy.mockResolvedValueOnce({ sent: false, error: 'smtp down' });
      const first = await sla.sweepCashoutDisputes(new Date());
      expect(first.noticed).toBe(0);
      const { rows: [afterFail] } = await pool.query(
        `SELECT results_notice_sent_at, results_notice_result FROM credit_cashout_disputes WHERE id = $1`,
        [opened.id]
      );
      expect(afterFail.results_notice_sent_at).toBeNull();
      expect(afterFail.results_notice_result.sent).toBe(false);
      const second = await sla.sweepCashoutDisputes(new Date());
      expect(second.noticed).toBe(1);
      const { rows: [afterOk] } = await pool.query('SELECT results_notice_sent_at FROM credit_cashout_disputes WHERE id = $1', [opened.id]);
      expect(afterOk.results_notice_sent_at).not.toBeNull();
      const callsBefore = noticeSpy.mock.calls.length;
      expect(await sla.resendResultsNotice({ cashoutDisputeId: opened.id, actorUserId: admin1 })).toEqual({ sent: true, alreadySent: true });
      expect(noticeSpy.mock.calls.length).toBe(callsBefore);
    });

    test('a failed cash-out-dispute receipt notice is recorded instead of discarded (audit item 45)', async () => {
      const logger = require('../utils/logger');
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      try {
        const key = `m4cp-cd3-${crypto.randomUUID()}`;
        noticeSpy.mockResolvedValueOnce({ sent: false, error: 'resend down' });
        const opened = await sla.openCashoutDispute({ user: { id: helperId }, cashoutId, description: 'Still nothing again', idempotencyKey: key });
        expect(opened.status).toBe('open');
        expect(warnSpy).toHaveBeenCalledWith(
          'credit_cashout_dispute.receipt_notice_failed',
          expect.objectContaining({ disputeId: String(opened.id) })
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('disclosures and wage consent', () => {
    const disclosures = () => require('../services/creditCompliance/disclosureService');
    const wage = () => require('../services/creditCompliance/wageConsentService');

    test('every kind exists in all five languages, with the live fee table', async () => {
      for (const lang of disclosures().LANGS) {
        const set = await disclosures().getDisclosureSet(lang, { currency: 'USD' });
        expect(set.map((d) => d.kind)).toEqual(disclosures().KINDS);
        for (const d of set) {
          expect(d.title.trim().length).toBeGreaterThan(0);
          expect(d.body).not.toMatch(/\{fee_table\}|\{fx_spread\}/);
          expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
        }
      }
      const fee = await disclosures().getDisclosure('fee_schedule', 'fr', { currency: 'USD' });
      expect(Array.isArray(fee.fees)).toBe(true);
    });

    test('acceptance is recorded per hash; a changed text must be read again; the gate is off by default', async () => {
      const userId = await createUser('customer');
      const user = { id: userId };
      delete process.env.OXSTEED_CREDIT_REQUIRE_DISCLOSURE_ACCEPTANCE;
      expect(await disclosures().assertPreAcquisitionAccepted(pool, userId)).toEqual({ required: false });
      process.env.OXSTEED_CREDIT_REQUIRE_DISCLOSURE_ACCEPTANCE = 'true';
      try {
        await expect(disclosures().assertPreAcquisitionAccepted(pool, userId)).rejects.toMatchObject({ code: 'credit_disclosure_acceptance_required' });
        const set = await disclosures().getDisclosureSet('ht', { kinds: disclosures().PRE_ACQUISITION });
        await expect(disclosures().acceptDisclosures({ user, language: 'ht', items: set.map((d) => ({ kind: d.kind, sha256: 'f'.repeat(64) })) }))
          .rejects.toMatchObject({ code: 'credit_disclosure_changed', statusCode: 409 });
        await disclosures().acceptDisclosures({ user, language: 'ht', items: set.map((d) => ({ kind: d.kind, sha256: d.sha256 })) });
        expect(await disclosures().assertPreAcquisitionAccepted(pool, userId)).toEqual({ required: true, accepted: true });

        // Counsel-approved text published by two administrators: must be accepted again.
        const pub = await oversight('credit_disclosure_publish', {
          kind: 'not_insured', language: 'ht', title: 'Pa asire pa FDIC', body: 'OxSteed Credit pa yon depo labank.', approvedReference: `M4CP-${crypto.randomUUID().slice(0, 8)}`,
        });
        expect(pub.version).toBeGreaterThanOrEqual(1);
        await expect(disclosures().assertPreAcquisitionAccepted(pool, userId)).rejects.toMatchObject({ code: 'credit_disclosure_acceptance_required' });
        const fresh = await disclosures().getDisclosure('not_insured', 'ht');
        expect(fresh).toMatchObject({ placeholder: false, title: 'Pa asire pa FDIC' });
        await disclosures().acceptDisclosures({ user, language: 'ht', items: [{ kind: 'not_insured', sha256: fresh.sha256 }], context: 'update' });
        expect(await disclosures().assertPreAcquisitionAccepted(pool, userId)).toEqual({ required: true, accepted: true });
      } finally {
        delete process.env.OXSTEED_CREDIT_REQUIRE_DISCLOSURE_ACCEPTANCE;
      }
    });

    test('publishing needs a counsel reference and two different administrators (DB check too)', async () => {
      await expect(pending.requestPendingAction({
        actionType: 'credit_disclosure_publish', payload: { kind: 'fee_schedule', language: 'en', title: 'Fees', body: 'No table', approvedReference: 'REF-1' },
        requestedBy: admin1, idempotencyKey: `m4cp-${crypto.randomUUID()}`,
      })).rejects.toMatchObject({ statusCode: 400 });
      await expect(pool.query(
        `INSERT INTO credit_disclosure_versions (disclosure_kind, language, version, title, body, approved_reference, requested_by, published_by, status)
         VALUES ('long_form', 'es', 999, 't', 'b', 'M4CP-self', $1, $1, 'retired')`, [admin1]
      )).rejects.toMatchObject({ code: '23514' });
    });

    test('wage consent: hashed terms, append-only history, withdrawal, and the payment gate behind its flag', async () => {
      const helperId = await createUser('helper', { lang: 'es' });
      const user = { id: helperId, preferred_language: 'es' };
      expect((await wage().getWageConsent({ user })).status).toBe('none');
      process.env.OXSTEED_CREDIT_WAGE_CONSENT_REQUIRED = 'true';
      try {
        await expect(wage().assertHelperAcceptsCreditWages(pool, helperId)).rejects.toMatchObject({ code: 'credit_wage_consent_required' });
        await expect(wage().grantConsent({ user, termsSha256: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'credit_disclosure_changed' });
        const { terms } = await wage().getWageConsent({ user, language: 'es' });
        await wage().grantConsent({ user, language: 'es', termsSha256: terms.sha256 });
        expect(await wage().helperAcceptsCreditWages(pool, helperId)).toBe(true);
        await expect(wage().withdrawConsent({ user, alternativeMethod: 'crypto' })).rejects.toMatchObject({ statusCode: 400 });
        await wage().withdrawConsent({ user, alternativeMethod: 'bank_transfer' });
        expect(await wage().helperAcceptsCreditWages(pool, helperId)).toBe(false);
        expect((await wage().getWageConsent({ user })).alternative_method).toBe('bank_transfer');
      } finally {
        delete process.env.OXSTEED_CREDIT_WAGE_CONSENT_REQUIRED;
      }
      expect(await wage().helperAcceptsCreditWages(pool, helperId)).toBe(true);
      await expect(pool.query(`UPDATE credit_wage_payment_consents SET decision = 'granted' WHERE user_id = $1`, [helperId])).rejects.toThrow();
      await expect(pool.query(`DELETE FROM credit_wage_payment_consents WHERE user_id = $1`, [helperId])).rejects.toThrow(/append-only/);
      const s = await wage().summary();
      expect(s.counts.withdrawn).toBeGreaterThanOrEqual(1);
    });

    test('gap fill 2: the wage choice is offered to every worker on its own, regardless of cash-out', async () => {
      const previous = process.env.FEATURE_CREDIT_CASHOUT;
      delete process.env.FEATURE_CREDIT_CASHOUT;
      try {
        const helperId = await createUser('helper', { lang: 'fr' });
        const helper = await wage().getWageConsent({ user: { id: helperId, role: 'helper' }, language: 'fr' });
        expect(helper).toMatchObject({ status: 'none', relevant: true, required: false });
        const customerId = await createUser('customer');
        const customer = await wage().getWageConsent({ user: { id: customerId, role: 'customer' } });
        expect(customer).toMatchObject({ status: 'none', relevant: false });
        process.env.OXSTEED_CREDIT_WAGE_CONSENT_REQUIRED = 'true';
        try {
          const required = await wage().getWageConsent({ user: { id: helperId, role: 'helper' }, language: 'fr' });
          expect(required).toMatchObject({ relevant: true, required: true });
          await wage().grantConsent({ user: { id: helperId, role: 'helper' }, language: 'fr', termsSha256: required.terms.sha256 });
          expect(await wage().helperAcceptsCreditWages(pool, helperId)).toBe(true);
        } finally {
          delete process.env.OXSTEED_CREDIT_WAGE_CONSENT_REQUIRED;
        }
        // Someone whose role changed keeps seeing the choice they made.
        await pool.query(`UPDATE users SET role = 'customer' WHERE id = $1`, [helperId]);
        expect((await wage().getWageConsent({ user: { id: helperId, role: 'customer' } })).relevant).toBe(true);
      } finally {
        if (previous === undefined) delete process.env.FEATURE_CREDIT_CASHOUT; else process.env.FEATURE_CREDIT_CASHOUT = previous;
      }
    });
  });
});
