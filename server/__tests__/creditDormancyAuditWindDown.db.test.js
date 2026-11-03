'use strict';

// Licence readiness M4 (§8 dormancy/escheat, §9 audit, §10 wind-down) on a
// real PostgreSQL: dormancy policies as data (two admins), the sweep and
// due-diligence notice, escheat / reclaim / remittance through the ledger,
// quarterly access reviews (no self-review, two-admin completion), hashed
// regulator report packs, external audit-chain anchors that detect
// tampering, and an orderly wind-down that freezes the rail and redeems a
// helper's wages to a verified bank account after two administrators
// confirm the bank instruction.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CREDIT_DORMANCY_TEST_DATABASE_URL');
if (database) {
  process.env.DATABASE_URL = database;
  process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS = String(50_000_000_000);
  process.env.OXSTEED_BANK_PAYOUT_ENABLED = 'true';
  process.env.OXSTEED_BANK_PAYOUT_SOURCE_ACCOUNT = 'TEST-SOURCE-ACCOUNT';
  process.env.OXSTEED_CREDIT_DORMANCY_ENABLED = 'true';
}
const describeDatabase = database ? describe : describe.skip;

jest.mock('../services/stepupChallengeService', () => ({
  ...jest.requireActual('../services/stepupChallengeService'),
  verifyStepupChallenge: jest.fn(async () => ({ verified: true })),
}));

const crypto = require('crypto');

jest.setTimeout(240000);

test('dormancy/audit/wind-down test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('dormancy, audit and wind-down (licence readiness §8-§10)', () => {
  let pool;
  let pending;
  let credit;
  let notices;
  let admin1;
  let admin2;
  let railWasEnabled;
  const COUNTRY = 'ZY'; // synthetic country so real policies are untouched
  const CUR = 'HTG';

  async function createUser(role, extra = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, country, preferred_language, didit_status)
       VALUES ($1, $2, 'synthetic-unusable', $3, $4, $5, $6, $7, $8)`,
      [id, `m4dw-${role}-${id}@example.invalid`, extra.first || 'Rose', extra.last || 'Test', role, extra.country || COUNTRY, extra.lang || 'fr', extra.didit || null]
    );
    return id;
  }

  async function oversight(actionType, payload) {
    const r = await pending.requestPendingAction({ actionType, payload, requestedBy: admin1, idempotencyKey: `m4dw-${crypto.randomUUID()}` });
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

  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
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

  async function fundedWallet(amount, backdateDays) {
    const customerId = await createUser('customer');
    const walletId = await tx(async (client) => {
      const wallet = await credit.ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode: CUR });
      const treasury = await credit.ensureAccount(client, { accountType: 'platform_treasury', currencyCode: CUR });
      await credit.postJournalTransaction(client, {
        transactionType: 'load', debitAccountId: treasury.id, creditAccountId: wallet.id, amountCents: amount, currencyCode: CUR,
        idempotencyKey: `m4dw-load-${customerId}`, actorType: 'admin', actorUserId: admin1, reason: 'test funding', description: 'test funding',
        referenceType: 'test', referenceId: customerId,
      });
      return wallet.id;
    });
    await asReplica((c) => c.query(
      `UPDATE oxsteed_credit_accounts SET created_at = NOW() - make_interval(days => $2), last_posted_at = NOW() - make_interval(days => $2) WHERE id = $1`,
      [walletId, backdateDays]
    ));
    await pool.query(`UPDATE users SET last_login_at = NOW() - make_interval(days => $2) WHERE id = $1`, [customerId, backdateDays]);
    return { customerId, walletId };
  }

  async function balance(accountId) {
    const { rows } = await pool.query('SELECT balance_cents, reserved_cents FROM oxsteed_credit_accounts WHERE id = $1', [accountId]);
    return { balance: Number(rows[0].balance_cents), reserved: Number(rows[0].reserved_cents) };
  }

  beforeAll(async () => {
    pool = require('../db');
    pending = require('../services/oxsteedCreditPendingActionService');
    credit = require('../services/oxsteedCreditService');
    notices = require('../services/creditCompliance/notices');
    jest.spyOn(notices, 'sendUserNotice').mockImplementation(async () => ({ sent: true }));
    const { rows: flag } = await pool.query(`SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
    railWasEnabled = flag[0]?.is_enabled === true;
    await pool.query(`UPDATE feature_flags SET is_enabled = TRUE WHERE key = 'oxsteed_credit_enabled'`);
    admin1 = await createUser('super_admin', { first: 'Admin', last: 'Maker', country: 'US', lang: 'en' });
    admin2 = await createUser('super_admin', { first: 'Admin', last: 'Checker', country: 'US', lang: 'en' });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM credit_dormancy_policies WHERE country_code = $1`, [COUNTRY]);
    await pool.query(`UPDATE feature_flags SET is_enabled = $1 WHERE key = 'oxsteed_credit_enabled'`, [railWasEnabled]);
    await pool.end();
  });

  describe('dormancy and unclaimed property (§8)', () => {
    let dormant;
    let active;
    let caseId;

    test('a policy is data, needs two administrators and is range-checked', async () => {
      const r = await pending.requestPendingAction({
        actionType: 'credit_dormancy_policy_set',
        payload: { countryCode: COUNTRY, enabled: true, dormantAfterDays: 30, noticePeriodDays: 60, authorityName: 'Test Authority', legalReference: 'Test Act s.1' },
        requestedBy: admin1, idempotencyKey: `m4dw-${crypto.randomUUID()}`,
      }).catch((e) => e);
      expect(r).toMatchObject({ code: 'validation_failed' });
      const policy = await oversight('credit_dormancy_policy_set', {
        countryCode: COUNTRY, enabled: true, dormantAfterDays: 365, noticePeriodDays: 30, authorityName: 'Test Unclaimed Property Office', legalReference: 'Test Act s.1',
      });
      expect(policy).toMatchObject({ country_code: COUNTRY, enabled: true, dormant_after_days: 365 });
    });

    test('the sweep notifies dormant holders only, and escheat waits for the deadline', async () => {
      dormant = await fundedWallet(12345, 400);
      active = await fundedWallet(5000, 10);
      const dormancy = require('../services/creditCompliance/dormancyService');
      await dormancy.runDormancySweep();
      const cases = await dormancy.listCases({ limit: 1000 });
      const mine = cases.find((c) => c.account_id === String(dormant.walletId));
      expect(mine).toMatchObject({ status: 'notified', balance_minor: 12345, notice_sent: true });
      expect(cases.find((c) => c.account_id === String(active.walletId))).toBeUndefined();
      caseId = mine.id;
      expect(notices.sendUserNotice).toHaveBeenCalledWith(expect.objectContaining({ userId: dormant.customerId, key: 'dormancy_notice' }));
      await expect(oversight('credit_escheat_execute', { caseIds: [caseId] })).rejects.toMatchObject({ code: 'credit_dormancy_case_not_due' });
      // After the notice period the case is due.
      await dormancy.runDormancySweep({ now: new Date(Date.now() + 31 * 86400000) });
      const due = (await dormancy.listCases({ status: 'escheat_due', limit: 1000 })).find((c) => c.id === caseId);
      expect(due).toBeTruthy();
    });

    test('escheat moves the balance to unclaimed property; reclaim returns it; nothing is lost', async () => {
      const before = await balance(dormant.walletId);
      const escheated = await oversight('credit_escheat_execute', { caseIds: [caseId] });
      expect(escheated.results[0]).toMatchObject({ status: 'escheated', amountMinor: before.balance });
      expect((await balance(dormant.walletId)).balance).toBe(0);
      await expect(oversight('credit_escheat_reclaim', { caseId, verificationNote: 'short' })).rejects.toMatchObject({ code: 'validation_failed' });
      const reclaimed = await oversight('credit_escheat_reclaim', { caseId, verificationNote: 'Didit ID check + email confirmation on file' });
      expect(reclaimed).toMatchObject({ status: 'reclaimed', amount_minor: before.balance });
      expect((await balance(dormant.walletId)).balance).toBe(before.balance);
    });

    test('remittance to the authority is a ledger posting with a two-person record', async () => {
      const dormancy = require('../services/creditCompliance/dormancyService');
      const other = await fundedWallet(777, 500);
      await dormancy.runDormancySweep();
      await dormancy.runDormancySweep({ now: new Date(Date.now() + 31 * 86400000) });
      const c = (await dormancy.listCases({ status: 'escheat_due', limit: 1000 })).find((x) => x.account_id === String(other.walletId));
      await oversight('credit_escheat_execute', { caseIds: [c.id] });
      const remit = await oversight('credit_escheat_remit', { caseIds: [c.id], countryCode: COUNTRY, currencyCode: CUR, authorityReference: 'TEST-REMIT-001' });
      expect(remit).toMatchObject({ total_minor: 777, case_count: 1 });
      const { rows } = await pool.query('SELECT requested_by, approved_by FROM credit_escheat_remittances WHERE id = $1', [remit.id]);
      expect(rows[0].requested_by).not.toBe(rows[0].approved_by);
      expect((await dormancy.listCases({ status: 'remitted', limit: 1000 })).some((x) => x.id === c.id)).toBe(true);
    });

    test('a holder can choose unclaimed property instead of losing the balance at erasure', async () => {
      const dormancy = require('../services/creditCompliance/dormancyService');
      const holder = await fundedWallet(4200, 1);
      const cases = await dormancy.consentErasureDisposition({ user: { id: holder.customerId } });
      expect(cases[0]).toMatchObject({ status: 'escheat_due', source: 'erasure', balance_minor: 4200 });
      await expect(dormancy.consentErasureDisposition({ user: { id: holder.customerId }, isImpersonated: true }))
        .rejects.toMatchObject({ code: 'impersonation_blocked' });
    });
  });

  describe('access reviews, report packs and audit anchors (§9)', () => {
    test('a quarterly review snapshots privileged access; no one reviews themselves; completion needs two admins', async () => {
      const access = require('../services/creditCompliance/accessReviewService');
      const now = new Date(Date.UTC(2090 + crypto.randomInt(0, 900), 1, 1));
      const { created } = await access.ensureCurrentReview({ now });
      expect(created.items).toBeGreaterThanOrEqual(2);
      const review = await access.getReview(created.id);
      const own = review.items.find((i) => i.user_id === admin1);
      await expect(access.decideItem({ reviewId: created.id, itemId: own.id, decision: 'keep', actorUserId: admin1 }))
        .rejects.toMatchObject({ code: 'credit_access_review_self' });
      await expect(access.decideItem({ reviewId: created.id, itemId: own.id, decision: 'revoke', actorUserId: admin2 }))
        .rejects.toMatchObject({ code: 'validation_failed' });
      await access.decideItem({ reviewId: created.id, itemId: own.id, decision: 'keep', actorUserId: admin2 });
      await expect(oversight('credit_access_review_complete', { reviewId: created.id })).rejects.toMatchObject({ code: 'credit_access_review_incomplete' });
      await pool.query(
        `UPDATE credit_access_review_items SET decision = 'keep', decided_at = NOW(),
                decided_by = CASE WHEN user_id = $2 THEN $3::uuid ELSE $2::uuid END
          WHERE review_id = $1 AND decision IS NULL`,
        [created.id, admin2, admin1]
      );
      const done = await oversight('credit_access_review_complete', { reviewId: created.id });
      expect(done).toMatchObject({ status: 'completed' });
    });

    test('report packs are hashed extracts with an audited download', async () => {
      const reports = require('../services/creditCompliance/reportPackService');
      const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      for (const packType of reports.PACK_TYPES) {
        const pack = await reports.generatePack({ packType, from, to, actorUserId: admin1 });
        expect(pack.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(pack.files.length).toBeGreaterThan(0);
        const file = await reports.getPackFile({ packId: pack.id, fileName: pack.files[0], actorUserId: admin2 });
        expect(file.sha256).toBe(pack.sha256);
        expect(typeof file.content).toBe('string');
      }
      await expect(reports.generatePack({ packType: 'nope', from, to, actorUserId: admin1 })).rejects.toMatchObject({ code: 'validation_failed' });
      const csv = reports.toCsv(['a'], [{ a: '=HYPERLINK("x")' }]);
      expect(csv).not.toMatch(/^a\r?\n=/m);
    });

    test('a daily anchor records the chain heads and detects a rewritten audit row', async () => {
      const anchors = require('../services/creditCompliance/auditAnchorService');
      const run = await anchors.anchorAuditChains();
      expect(run.sha256).toMatch(/^[0-9a-f]{64}$/);
      const today = await anchors.getAnchor(run.anchorDate);
      const headId = today.payload.creditAudit?.headId;
      expect(headId).toBeTruthy();
      const ok = await anchors.verifyAnchors({ limit: 1 });
      expect(ok[0]).toMatchObject({ ok: true });
      // Rewrite the anchored head row as a superuser could (triggers off),
      // then restore it.
      const { rows: [orig] } = await pool.query('SELECT event_hash FROM oxsteed_credit_audit_events WHERE id = $1', [headId]);
      await asReplica((c) => c.query(`UPDATE oxsteed_credit_audit_events SET event_hash = $2 WHERE id = $1`, [headId, 'f'.repeat(64)]));
      try {
        const bad = await anchors.verifyAnchors({ limit: 1 });
        expect(bad[0].ok).toBe(false);
        expect(bad[0].problems).toContain('credit_audit_head');
      } finally {
        await asReplica((c) => c.query(`UPDATE oxsteed_credit_audit_events SET event_hash = $2 WHERE id = $1`, [headId, orig.event_hash]));
      }
      const { rows: cases } = await pool.query(`SELECT 1 FROM oxsteed_credit_compliance_cases WHERE case_type = 'audit_anchor_mismatch' LIMIT 1`);
      expect(cases.length).toBe(1);
      await expect(pool.query(`DELETE FROM credit_audit_anchors WHERE anchor_date = $1`, [run.anchorDate])).rejects.toThrow();
    });
  });

  describe('wind-down and redemption (§10)', () => {
    let helperId;
    let partnerId;
    let payableId;
    let planId;
    let freezeExisted;

    beforeAll(async () => {
      const { rows } = await pool.query('SELECT id FROM oxsteed_credit_rail_freezes WHERE cleared_at IS NULL');
      freezeExisted = rows.length > 0;
      helperId = await createUser('helper', { country: 'HT', lang: 'ht', didit: 'verified' });
      const customerId = await createUser('customer', { country: 'HT' });
      const { rows: [partner] } = await pool.query(
        `INSERT INTO oxsteed_credit_partners (status, settlement_currency_code, created_by) VALUES ('active', 'HTG', $1) RETURNING id`, [admin1]
      );
      partnerId = String(partner.id);
      const { rows: [agreement] } = await pool.query(
        `INSERT INTO oxsteed_credit_partner_agreements (partner_id, version, status, starts_at, allowed_order_types, allowed_categories, created_by, approved_by)
         VALUES ($1, 1, 'active', NOW() - INTERVAL '1 day', '{}', '{}', $2, $3) RETURNING id`, [partnerId, admin1, admin2]
      );
      await pool.query(
        `INSERT INTO credit_participants (partner_id, participant_type, user_id, status, didit_verified, didit_verified_at, allowed_surfaces)
         VALUES ($1, 'helper', $2, 'active', TRUE, NOW(), '{jobs}')`, [partnerId, helperId]
      );
      await tx(async (client) => {
        const wallet = await credit.ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode: CUR });
        const treasury = await credit.ensureAccount(client, { accountType: 'platform_treasury', currencyCode: CUR });
        const pay = await credit.ensureAccount(client, { accountType: 'partner_payable', partnerId, currencyCode: CUR });
        payableId = pay.id;
        await credit.postJournalTransaction(client, {
          transactionType: 'load', debitAccountId: treasury.id, creditAccountId: wallet.id, amountCents: 300000, currencyCode: CUR,
          idempotencyKey: `m4dw-wd-load-${helperId}`, actorType: 'admin', actorUserId: admin1, reason: 'test funding', description: 'test funding', referenceType: 'test', referenceId: helperId,
        });
        await credit.postJournalTransaction(client, {
          transactionType: 'purchase', debitAccountId: wallet.id, creditAccountId: pay.id, amountCents: 250000, currencyCode: CUR, partnerId, agreementId: agreement.id,
          idempotencyKey: `m4dw-wd-purchase-${helperId}`, actorType: 'customer', actorUserId: customerId, reason: 'test wages', referenceType: 'test', referenceId: helperId,
        });
      });
      // Verified bank account for the helper.
      const destinations = require('../services/creditPayoutDestinationService');
      const dest = await destinations.addDestination({
        user: { id: helperId },
        input: { countryCode: 'HT', currencyCode: 'HTG', holderName: 'Rose Test', bankName: 'Banque Test', bankCode: 'BT01', accountNumber: `HT${crypto.randomInt(1e9, 9.99e9)}`, verificationMethod: 'micro_deposit' },
      });
      const { rows: amounts } = await pool.query(
        `SELECT amount_minor FROM credit_bank_payout_instructions WHERE destination_id = $1 AND purpose = 'micro_deposit' ORDER BY id`, [dest.id]
      );
      await destinations.verifyDestination({ user: { id: helperId }, destinationId: dest.id, amounts: amounts.map((r) => Number(r.amount_minor)) });
    });

    afterAll(async () => {
      if (!freezeExisted) {
        await pool.query(`UPDATE oxsteed_credit_rail_freezes SET cleared_at = NOW(), cleared_by = $1, clear_reason = 'test cleanup' WHERE cleared_at IS NULL`, [admin1]);
      }
    });

    test('redeemable balances include helper wages', async () => {
      const wd = require('../services/creditCompliance/windDownService');
      const b = await wd.computeRedeemableBalances();
      expect(b.totals.some((t) => t.account_type === 'partner_payable' && t.currency === CUR)).toBe(true);
      expect(b.negativeAccounts).toBe(0);
    });

    test('start needs 30+ days notice and two admins, snapshots holders and freezes the rail', async () => {
      const wd = require('../services/creditCompliance/windDownService');
      await expect(pending.requestPendingAction({
        actionType: 'credit_wind_down_start', payload: { reason: 'Licence surrendered', redemptionDeadline: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) },
        requestedBy: admin1, idempotencyKey: `m4dw-${crypto.randomUUID()}`,
      })).rejects.toMatchObject({ code: 'validation_failed' });
      const deadline = new Date(Date.now() + (wd.MIN_NOTICE_DAYS + 2) * 86400000).toISOString().slice(0, 10);
      const started = await oversight('credit_wind_down_start', { reason: 'Test: licence surrendered, orderly exit', redemptionDeadline: deadline });
      planId = started.id;
      expect(started.holders).toBeGreaterThan(0);
      const { rows } = await pool.query('SELECT id FROM oxsteed_credit_rail_freezes WHERE cleared_at IS NULL');
      expect(rows.length).toBe(1);
      const { rows: mine } = await pool.query(
        'SELECT 1 FROM credit_wind_down_holders WHERE plan_id = $1 AND account_id = $2', [planId, payableId]
      );
      expect(mine).toHaveLength(1);
      const listed = await wd.listHolders({ planId, limit: 5 });
      expect(listed.length).toBeGreaterThan(0);
      const notified = await wd.notifyHolders({ planId, actorUserId: admin1, limit: 1000 });
      expect(notified.sent).toBeGreaterThan(0);
    });

    test('redemption: reserve, bank instruction, two admins confirm paid, cash_out posted, balance zero', async () => {
      const wd = require('../services/creditCompliance/windDownService');
      const bank = require('../services/creditBankPayoutService');
      const before = await balance(payableId);
      const issued = await oversight('credit_wind_down_issue_redemptions', { planId });
      expect(issued.instructed).toBeGreaterThan(0);
      expect((await balance(payableId)).reserved).toBe(before.balance);
      const { rows: [holder] } = await pool.query(
        `SELECT * FROM credit_wind_down_holders WHERE plan_id = $1 AND account_id = $2`, [planId, payableId]
      );
      expect(holder.status).toBe('instructed');
      await bank.exportBatch({ actorUserId: admin1, countryCode: 'HT', currencyCode: 'HTG' });
      await bank.confirmInstruction({ actorUserId: admin1, instructionId: holder.instruction_id, outcome: 'paid', bankReference: 'WD-REF-1' });
      await expect(bank.confirmInstruction({ actorUserId: admin1, instructionId: holder.instruction_id, outcome: 'paid' }))
        .rejects.toMatchObject({ code: 'bank_payout_second_admin_required' });
      await bank.confirmInstruction({ actorUserId: admin2, instructionId: holder.instruction_id, outcome: 'paid' });
      const after = await balance(payableId);
      expect(after).toEqual({ balance: 0, reserved: 0 });
      const { rows: [paid] } = await pool.query('SELECT status, journal_transaction_id FROM credit_wind_down_holders WHERE id = $1', [holder.id]);
      expect(paid.status).toBe('paid');
      expect(paid.journal_transaction_id).toMatch(/^[0-9a-f-]{36}$/);
      await expect(oversight('credit_wind_down_mark_unclaimed', { planId })).rejects.toMatchObject({ code: 'credit_wind_down_deadline_not_reached' });
      const status = await wd.getStatus();
      expect(status.plan.id).toBe(planId);
    });

    test('two administrators can cancel the plan; the freeze it created is lifted', async () => {
      const bank = require('../services/creditBankPayoutService');
      await expect(oversight('credit_wind_down_cancel', { planId, reason: 'short' })).rejects.toMatchObject({ code: 'validation_failed' });
      const { rows: inFlight } = await pool.query(
        `SELECT i.id, i.status, i.country_code, i.currency_code FROM credit_wind_down_holders h
           JOIN credit_bank_payout_instructions i ON i.id = h.instruction_id
          WHERE h.plan_id = $1 AND h.status = 'instructed'`, [planId]
      );
      if (inFlight.length) {
        await expect(oversight('credit_wind_down_cancel', { planId, reason: 'Test finished: licence retained, wind-down withdrawn' }))
          .rejects.toMatchObject({ code: 'credit_wind_down_redemptions_in_flight' });
        const corridors = new Set(inFlight.filter((r) => r.status === 'pending').map((r) => `${r.country_code}|${r.currency_code}`));
        for (const c of corridors) {
          const [countryCode, currencyCode] = c.split('|');
          await bank.exportBatch({ actorUserId: admin1, countryCode, currencyCode });
        }
        for (const r of inFlight) {
          await bank.confirmInstruction({ actorUserId: admin1, instructionId: r.id, outcome: 'returned', failureCode: 'test_cleanup' });
          await bank.confirmInstruction({ actorUserId: admin2, instructionId: r.id, outcome: 'returned', failureCode: 'test_cleanup' });
        }
      }
      const cancelled = await oversight('credit_wind_down_cancel', { planId, reason: 'Test finished: licence retained, wind-down withdrawn' });
      expect(cancelled).toMatchObject({ status: 'cancelled', freezeLifted: !freezeExisted });
    });
  });
});
