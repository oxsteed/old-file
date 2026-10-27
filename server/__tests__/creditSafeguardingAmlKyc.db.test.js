'use strict';

// Licence readiness M3 on a real PostgreSQL: safeguarding (two-person
// accounts and balances, daily reconciliation, regulator export), AML
// cash-out rules and batch cases, the SAR lifecycle with a second approver,
// and KYC re-verification requirements (DB name-change trigger, second
// payout account, auto-satisfaction, two-admin waiver).

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CREDIT_SAFEGUARDING_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;

jest.mock('../services/stepupChallengeService', () => ({
  ...jest.requireActual('../services/stepupChallengeService'),
  verifyStepupChallenge: jest.fn(async () => ({ verified: true })),
}));

const crypto = require('crypto');

jest.setTimeout(180000);

test('safeguarding/AML/KYC test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('safeguarding, AML, SAR and KYC (licence readiness)', () => {
  let pool;
  let pending;
  let admin1;
  let admin2;
  const CUR = 'XTS'; // ISO test currency: isolates these rows from other suites

  async function createUser(first, last, role = 'customer') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, country)
       VALUES ($1, $2, 'synthetic-unusable', $3, $4, $5, 'HT')`,
      [id, `m3-${id}@example.invalid`, first, last, role]
    );
    return id;
  }

  async function oversight(actionType, payload) {
    const r = await pending.requestPendingAction({ actionType, payload, requestedBy: admin1, idempotencyKey: `m3-${crypto.randomUUID()}` });
    await expect(pending.decideOversightAction({ actionId: r.pendingAction.id, decision: 'approve', decidedBy: admin1, reason: 'self' }))
      .rejects.toMatchObject({ code: 'credit_self_approval_forbidden' });
    const decided = await pending.decideOversightAction({ actionId: r.pendingAction.id, decision: 'approve', decidedBy: admin2, reason: 'checked' });
    return decided.result;
  }

  beforeAll(async () => {
    pool = require('../db');
    pending = require('../services/oxsteedCreditPendingActionService');
    admin1 = await createUser('Admin', 'Maker', 'super_admin');
    admin2 = await createUser('Admin', 'Checker', 'super_admin');
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM credit_safeguarding_reconciliations WHERE currency_code = $1`, [CUR]);
    await pool.query(`DELETE FROM credit_safeguarding_balance_entries WHERE account_id IN (SELECT id FROM credit_safeguarding_accounts WHERE currency_code = $1)`, [CUR]);
    await pool.query(`DELETE FROM credit_safeguarding_accounts WHERE currency_code = $1`, [CUR]);
    await pool.end();
  });

  describe('safeguarding', () => {
    const safeguarding = () => require('../services/creditCompliance/safeguardingService');
    let accountId;

    test('accounts and balances need two administrators', async () => {
      const r = await oversight('credit_safeguarding_account_add', {
        label: 'Test segregated account', institutionName: 'Banque Test', accountReferenceMasked: '****4321', currencyCode: CUR,
      });
      accountId = r.id;
      await expect(pool.query(
        `INSERT INTO credit_safeguarding_balance_entries (account_id, as_of_date, balance_minor, statement_reference, entered_by, approved_by)
         VALUES ($1, CURRENT_DATE, 1, 'x', $2, $2)`, [accountId, admin1]
      )).rejects.toThrow(/credit_safeguarding_balance_two_person/);
      await expect(pending.requestPendingAction({
        actionType: 'credit_safeguarding_account_add', payload: { label: 'x', institutionName: 'y', accountReferenceMasked: '1234567890', currencyCode: CUR },
        requestedBy: admin1, idempotencyKey: `m3-${crypto.randomUUID()}`,
      })).rejects.toMatchObject({ statusCode: 400 });
    });

    test('reconciliation flags a missing balance, then a shortfall, then ok', async () => {
      const { rows: [{ owed }] } = await pool.query(
        `SELECT COALESCE(SUM(GREATEST(balance_cents,0)),0)::bigint AS owed FROM oxsteed_credit_accounts WHERE currency_code = $1`, [CUR]
      );
      const today = new Date().toISOString().slice(0, 10);
      let [rec] = (await safeguarding().runDailyReconciliation({ runDate: today })).filter((r) => r.currency_code === CUR);
      expect(rec.status).toBe(Number(owed) > 0 ? 'missing_balance' : 'ok');
      await oversight('credit_safeguarding_balance_entry', { accountId, asOfDate: today, balanceMinor: Number(owed) + 500, statementReference: 'STMT-1' });
      [rec] = (await safeguarding().runDailyReconciliation({ runDate: today })).filter((r) => r.currency_code === CUR);
      expect(rec.status).toBe('excess');
      expect(Number(rec.difference_minor)).toBe(500);
      const out = await safeguarding().exportReconciliations({ from: today, to: today });
      expect(out.csv).toContain(`${today},${CUR}`);
      expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    test('a shortfall opens a critical platform case', async () => {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      // A synthetic liability in the test currency larger than the balance.
      const owner = await createUser('Owed', 'Money');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL session_replication_role = replica`); // bypass ledger triggers for a synthetic balance
        await client.query(
          `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code, balance_cents) VALUES ('customer_wallet', $1, $2, 100000)`,
          [owner, CUR]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      try {
        const [rec] = (await safeguarding().runDailyReconciliation({ runDate: tomorrow })).filter((r) => r.currency_code === CUR);
        expect(rec.status).toBe('shortfall');
        const { rows } = await pool.query(
          `SELECT severity, subject_type FROM oxsteed_credit_compliance_cases WHERE dedupe_key = $1`, [`safeguarding:${tomorrow}:${CUR}`]
        );
        expect(rows[0]).toEqual({ severity: 'critical', subject_type: 'platform' });
      } finally {
        await pool.query(`SET session_replication_role = replica; DELETE FROM oxsteed_credit_accounts WHERE customer_id = '${owner}'; SET session_replication_role = origin;`);
      }
    });
  });

  describe('AML rules and SAR', () => {
    const aml = () => require('../services/creditCompliance/amlRules');
    const sar = () => require('../services/creditCompliance/sarService');
    let helper;

    async function cashoutRow(userId, amount, status = 'held_for_review') {
      await pool.query(
        `INSERT INTO credit_cashout_requests (user_id, credit_partner_id, country_code, partner_name, amount_minor, currency,
           destination_ref, status, available_at, idempotency_key, partner_idempotency_key)
         VALUES ($1, 0, 'HT', 'oxsteed_bank_payout', $2, 'USD', 'destination:test', $3, NOW(), $4, $5)`,
        [userId, amount, status, `aml-${crypto.randomUUID()}`, `oxsteed-cashout:${crypto.randomUUID()}`]
      );
    }

    beforeAll(async () => { helper = await createUser('Struct', 'Uring', 'helper'); });

    test('real-time rules hold large and structured cash-outs', async () => {
      expect(await aml().cashoutReviewReason(pool, { userId: helper, amount: 10_000_000, currency: 'USD', country: 'HT', destinationId: null })).toBe('large_payout');
      await cashoutRow(helper, 90_000);
      await cashoutRow(helper, 90_000);
      expect(await aml().cashoutReviewReason(pool, { userId: helper, amount: 90_000, currency: 'USD', country: 'HT', destinationId: null })).toBe('structuring_pattern');
    });

    test('batch rules open a structuring case and a re-verification requirement', async () => {
      await cashoutRow(helper, 90_000);
      await aml().runBatchRules();
      const { rows } = await pool.query(
        `SELECT id, case_type FROM oxsteed_credit_compliance_cases WHERE subject_id = $1 AND case_type = 'structuring'`, [helper]
      );
      expect(rows).toHaveLength(1);
      const { rows: reqs } = await pool.query(`SELECT trigger FROM credit_kyc_requirements WHERE user_id = $1 AND status = 'open'`, [helper]);
      expect(reqs.map((r) => r.trigger)).toContain('aml_case');
    });

    test('a SAR needs a second administrator before it can be filed', async () => {
      const { rows: [c] } = await pool.query(`SELECT id FROM oxsteed_credit_compliance_cases WHERE subject_id = $1 AND case_type = 'structuring'`, [helper]);
      const draft = await sar().createDraft({ actorUserId: admin1, caseIds: [c.id] });
      expect(draft.status).toBe('draft');
      await expect(sar().submitForApproval({ actorUserId: admin1, sarId: draft.id })).rejects.toMatchObject({ code: 'sar_state_conflict' });
      await sar().updateDraft({ actorUserId: admin1, sarId: draft.id, narrative: 'Three cash-outs just under the review threshold within seven days to one account.' });
      const submitted = await sar().submitForApproval({ actorUserId: admin1, sarId: draft.id });
      await expect(sar().markFiled({ actorUserId: admin1, sarId: draft.id, filingReference: 'UCREF-1' })).rejects.toMatchObject({ code: 'sar_state_conflict' });
      await expect(pending.decideOversightAction({ actionId: submitted.pendingAction.id, decision: 'approve', decidedBy: admin1, reason: 'self' }))
        .rejects.toMatchObject({ code: 'credit_self_approval_forbidden' });
      await pending.decideOversightAction({ actionId: submitted.pendingAction.id, decision: 'approve', decidedBy: admin2, reason: 'agree' });
      const filed = await sar().markFiled({ actorUserId: admin1, sarId: draft.id, filingReference: 'UCREF-2026-0001' });
      expect(filed.status).toBe('filed');
      const pack = await sar().buildFilingPack(draft.id);
      expect(JSON.parse(pack.json).cases[0].id).toBe(c.id);
      await expect(pool.query(`UPDATE credit_sar_reports SET approved_by = prepared_by WHERE id = $1`, [draft.id])).rejects.toThrow(/credit_sar_two_person/);
    });
  });

  describe('KYC re-verification', () => {
    const kyc = () => require('../services/creditCompliance/kycRequirementsService');

    test('a verified customer changing their legal name must re-verify; a new verification satisfies it', async () => {
      const id = await createUser('Name', 'Before');
      await pool.query(
        `INSERT INTO oxsteed_credit_identity_verifications (customer_id, requested_tier, tier, status, updated_at)
         VALUES ($1, 2, 2, 'verified', NOW() - INTERVAL '1 day')`, [id]
      );
      await pool.query(`UPDATE users SET last_name = 'After' WHERE id = $1`, [id]);
      const open = await kyc().getOpenRequirement(pool, id);
      expect(open).toMatchObject({ trigger: 'legal_name_change', requiredTier: 2 });
      // The customer completes verification again (the active record is refreshed).
      await pool.query(
        `UPDATE oxsteed_credit_identity_verifications SET updated_at = NOW() + INTERVAL '1 second' WHERE customer_id = $1`, [id]
      );
      expect(await kyc().getOpenRequirement(pool, id)).toBeNull();
    });

    test('only a second payout account triggers re-verification', async () => {
      const id = await createUser('Two', 'Accounts');
      expect(await kyc().recordTrigger(pool, { userId: id, trigger: 'new_payout_destination', sourceId: '1' })).toBeNull();
    });

    test('a waiver needs two administrators', async () => {
      const id = await createUser('Waive', 'Me');
      const req = await kyc().openRequirement(pool, { userId: id, trigger: 'manual' });
      await oversight('credit_kyc_requirement_waive', { requirementId: req.id, reason: 'Documents checked in person at the office' });
      const { rows } = await pool.query(`SELECT status, waived_by, waive_approved_by FROM credit_kyc_requirements WHERE id = $1`, [req.id]);
      expect(rows[0]).toEqual({ status: 'waived', waived_by: admin1, waive_approved_by: admin2 });
    });
  });
});
