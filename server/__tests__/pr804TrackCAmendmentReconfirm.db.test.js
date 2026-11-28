'use strict';

// R-5 (PR #804 Track C): an amendment could go effective with investors
// unreconfirmed, and close captured their stale-version commitments.
// Now reviewAmendment refuses 'effective' while investors with a live
// stake have not reconfirmed (unless the reconfirmation deadline has
// passed), the review queue names exactly who has not reconfirmed, and
// closeOpportunity captures only commitments on the current agreement
// version, reporting the excluded ones instead of capturing them.
// Reproduction: before the fix, reviewAmendment('effective') succeeded
// with two unreconfirmed investors, and close created positions for
// both of them on the old version.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const TEST_DB_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
if (!TEST_DB_URL.includes('/credit_statement_test_pr804_c')) {
  throw new Error('Refusing to run: STATEMENT_TEST_DATABASE_URL must point at credit_statement_test_pr804_c');
}
// The shared jest setup points DATABASE_URL at a dummy; the real pool
// reads DATABASE_URL at require time, so point it at our DB first.
process.env.DATABASE_URL = TEST_DB_URL;
process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS = String(50_000_000_000);
process.env.INVEST_ENABLED = 'true';
process.env.INVEST_COMMITMENTS_ENABLED = 'true';

const crypto = require('crypto');
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const {
  ensureAccount,
  postJournalTransaction,
} = require('../services/oxsteedCreditService');
const { createLot } = require('../services/invest/creditLots');
const {
  createOpportunity,
  createAgreementVersion,
  setOpportunityStatus,
  createParticipationApplication,
  submitParticipationApplication,
  reviewParticipationApplication,
} = require('../services/invest/participation');
const {
  createCommitment,
  cancelCommitment,
  approveClosingConditions,
  recordClosingApproval,
  closeOpportunity,
} = require('../services/invest/settlementService');
const {
  createAmendment,
  proposeAmendment,
  reviewAmendment,
  reconfirmAmendment,
  listReviewQueue,
  amendmentReconfirmationState,
} = require('../services/invest/investApi');

jest.setTimeout(180000);

describe('R-5 amendment reconfirmation fail-closed', () => {
  let superAdminId;
  let reviewerId;
  let executorId;
  let entityOwnerId;
  let businessId;
  let treasuryId;
  let investorAId;
  let investorBId;
  let investorCId;
  let walletAId;
  let walletBId;
  let walletCId;
  let opportunityId;
  let version1Id;
  let version2Id;
  let amendmentId;
  let commitmentBId;
  let railWasEnabled = null;
  const createdUsers = [];

  async function createUser(tag, role = 'customer') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, 'synthetic-unusable', 'Invest', $3, $4)`,
      [id, `r5-${tag}-${id.slice(0, 8)}@example.invalid`, tag, role]
    );
    createdUsers.push(id);
    return id;
  }

  async function freshInvestor(tag) {
    const userId = await createUser(tag);
    let wallet;
    await withTransaction(pool, async (client) => {
      wallet = await ensureAccount(client, { accountType: 'customer_wallet', customerId: userId, currencyCode: 'USD' });
    }, 'r5_setup_wallet');
    const { transaction } = await withTransaction(pool, async (client) => postJournalTransaction(client, {
      transactionType: 'funding',
      debitAccountId: treasuryId,
      creditAccountId: wallet.id,
      customerId: userId,
      amountCents: 20000,
      currencyCode: 'USD',
      idempotencyKey: `r5-fund-${crypto.randomUUID()}`,
      actorType: 'admin',
      actorUserId: reviewerId,
      reason: 'R-5 test funding',
      description: 'R-5 test funding',
      referenceType: 'test_funding',
      referenceId: crypto.randomUUID(),
      metadata: {},
    }), 'r5_fund');
    await withTransaction(pool, async (client) => createLot(client, {
      accountId: wallet.id,
      customerId: userId,
      currencyCode: 'USD',
      source: 'purchased',
      amountCents: 20000,
      settledAt: new Date().toISOString(),
      originatingTransactionId: transaction.id,
      referenceType: 'test_funding',
      referenceId: String(transaction.id),
    }), 'r5_lot');
    return { userId, walletId: wallet.id };
  }

  async function invest(userId, amountCents) {
    const { application } = await createParticipationApplication({
      userId,
      opportunityId,
      agreementVersionId: version1Id,
      idempotencyKey: `r5-app-${crypto.randomUUID()}`,
    });
    await submitParticipationApplication({ applicationId: application.id, userId });
    await reviewParticipationApplication({
      applicationId: application.id,
      reviewerUserId: reviewerId,
      decision: 'approved',
      identityVerified: true,
      authorityVerified: true,
    });
    await createCommitment({
      userId,
      opportunityId,
      applicationId: application.id,
      amountCents,
      agreementVersionId: version1Id,
      idempotencyKey: `r5-commit-${crypto.randomUUID()}`,
    });
  }

  // Investor C arrives after the amendment is effective and commits
  // on the new version: the only way the raise can still close.
  async function investOnVersion2(userId, amountCents) {
    const { application } = await createParticipationApplication({
      userId,
      opportunityId,
      agreementVersionId: version2Id,
      idempotencyKey: `r5-app-${crypto.randomUUID()}`,
    });
    await submitParticipationApplication({ applicationId: application.id, userId });
    await reviewParticipationApplication({
      applicationId: application.id,
      reviewerUserId: reviewerId,
      decision: 'approved',
      identityVerified: true,
      authorityVerified: true,
    });
    await createCommitment({
      userId,
      opportunityId,
      applicationId: application.id,
      amountCents,
      agreementVersionId: version2Id,
      idempotencyKey: `r5-commit-${crypto.randomUUID()}`,
    });
  }

  async function walletBalance(walletId) {
    const { rows } = await pool.query(
      `SELECT balance_cents FROM oxsteed_credit_accounts WHERE id = $1`, [walletId]
    );
    return Number(rows[0].balance_cents);
  }

  async function currentVersionId() {
    const { rows } = await pool.query(
      `SELECT current_agreement_version_id FROM investment_opportunities WHERE id = $1`, [opportunityId]
    );
    return rows[0].current_agreement_version_id ? String(rows[0].current_agreement_version_id) : null;
  }

  beforeAll(async () => {
    const { rows: [flag] } = await pool.query(
      `SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`
    );
    railWasEnabled = flag ? flag.is_enabled : null;
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', true, 'R-5 test')
       ON CONFLICT (key) DO UPDATE SET is_enabled = true`
    );
    superAdminId = await createUser('super', 'super_admin');
    reviewerId = await createUser('reviewer', 'admin');
    executorId = await createUser('executor', 'admin');
    entityOwnerId = await createUser('entity-owner');
    const { rows: businessRows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, business_type)
       VALUES ($1, 'R-5 Test Entity', 'llc') RETURNING id`,
      [entityOwnerId]
    );
    businessId = businessRows[0].id;
    await withTransaction(pool, async (client) => {
      const treasury = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: 'USD' });
      treasuryId = treasury.id;
    }, 'r5_setup_treasury');

    ({ userId: investorAId, walletId: walletAId } = await freshInvestor('inv-a'));
    ({ userId: investorBId, walletId: walletBId } = await freshInvestor('inv-b'));
    ({ userId: investorCId, walletId: walletCId } = await freshInvestor('inv-c'));
    const opportunity = await createOpportunity({
      businessId,
      createdBy: entityOwnerId,
      title: 'R-5 Raise',
      purpose: 'Test raise',
      targetCents: 10000,
      minimumCents: 0,
      deadlineAt: new Date('2027-06-01T00:00:00Z').toISOString(),
      valuationRule: 'Revenue share of 5 percent of monthly revenue.',
      useOfProceeds: 'Test use of proceeds.',
    });
    opportunityId = opportunity.id;
    const version1 = await createAgreementVersion({
      opportunityId,
      body: 'Test investment agreement version 1. Revenue share only.',
      createdBy: entityOwnerId,
    });
    version1Id = version1.id;
    for (const status of ['submitted', 'under_review', 'approved', 'published']) {
      await setOpportunityStatus({ opportunityId, status });
    }
    await invest(investorAId, 6000);
    await invest(investorBId, 4000);
    const { rows: commitmentRows } = await pool.query(
      `SELECT id FROM investment_commitments WHERE user_id = $1 AND opportunity_id = $2`,
      [investorBId, opportunityId]
    );
    commitmentBId = String(commitmentRows[0].id);

    const version2 = await createAgreementVersion({
      opportunityId,
      body: 'Test investment agreement version 2. Amended revenue share.',
      createdBy: entityOwnerId,
    });
    version2Id = version2.id;
    const amendment = await createAmendment(entityOwnerId, opportunityId, {
      changes: { description: 'Amended revenue share terms.' },
      newAgreementVersionId: version2Id,
    });
    amendmentId = amendment.id;
    await proposeAmendment(entityOwnerId, opportunityId, amendmentId, '2027-01-01T00:00:00Z');
  });

  afterAll(async () => {
    if (railWasEnabled === false) {
      await pool.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'oxsteed_credit_enabled'`);
    }
    await pool.end();
  });

  // N15 (D-744): proposing the amendment in beforeAll notified every
  // investor with a live stake — the reconfirmation request. The review
  // queue below confirms the same two investors (A and B) hold the live
  // stake; investor C has no application or commitment yet at proposal
  // time, so C gets no request.
  test('proposing the amendment notifies every investor with a live stake', async () => {
    const { rows } = await pool.query(
      `SELECT user_id, title, body, action_url FROM notifications
        WHERE type = 'invest_amendment_reconfirmation_requested' AND data->>'opportunityId' = $1
        ORDER BY user_id`,
      [opportunityId],
    );
    expect(rows.map((row) => row.user_id).sort()).toEqual([investorAId, investorBId].sort());
    for (const row of rows) {
      expect(row.title).toBe('Reconfirmation requested');
      expect(row.body).toContain('2027-01-01');
      expect(row.action_url).toBe('/invest/my-investments');
    }
  });

  test('the review queue names exactly who has not reconfirmed', async () => {
    const state = await amendmentReconfirmationState(pool, {
      opportunity_id: opportunityId,
      new_agreement_version_id: version2Id,
    });
    expect(state.total).toBe(2);
    expect(state.reconfirmed).toBe(0);
    expect(state.pending).toBe(2);
    expect([...state.pendingUserIds].sort()).toEqual([investorAId, investorBId].sort());

    const queue = await listReviewQueue({ id: superAdminId, role: 'super_admin' }, { type: 'amendments' });
    const entry = queue.amendments.find((row) => String(row.id) === String(amendmentId));
    expect(entry).toBeTruthy();
    expect(entry.reconfirmation.pending).toBe(2);
    expect([...entry.reconfirmation.pendingUserIds].sort()).toEqual([investorAId, investorBId].sort());
  });

  test('effective is refused while investors have not reconfirmed', async () => {
    let caught = null;
    try {
      await reviewAmendment({
        amendmentId, reviewerUserId: reviewerId, decision: 'effective', expectedVersion: null,
      });
    } catch (err) { caught = err; }
    expect(caught).toBeTruthy();
    expect(caught.code).toBe('invest_amendment_reconfirmation_pending');
    const { rows } = await pool.query(`SELECT status FROM investment_amendments WHERE id = $1`, [amendmentId]);
    expect(rows[0].status).toBe('proposed');
  });

  test('one reconfirmation is not enough: effective is still refused', async () => {
    const reconfirmed = await reconfirmAmendment(investorAId, opportunityId, amendmentId);
    expect(reconfirmed.reconfirmedCommitments).toHaveLength(1);
    const state = await amendmentReconfirmationState(pool, {
      opportunity_id: opportunityId,
      new_agreement_version_id: version2Id,
    });
    expect(state).toMatchObject({ total: 2, reconfirmed: 1, pending: 1 });
    expect(state.pendingUserIds).toEqual([investorBId]);

    let caught = null;
    try {
      await reviewAmendment({
        amendmentId, reviewerUserId: reviewerId, decision: 'effective', expectedVersion: null,
      });
    } catch (err) { caught = err; }
    expect(caught).toBeTruthy();
    expect(caught.code).toBe('invest_amendment_reconfirmation_pending');
  });

  test('rejection is never blocked by pending reconfirmations', async () => {
    const version3 = await createAgreementVersion({
      opportunityId,
      body: 'Test investment agreement version 3. Never effective.',
      createdBy: entityOwnerId,
    });
    const second = await createAmendment(entityOwnerId, opportunityId, {
      changes: { description: 'A second amendment that will be rejected.' },
      newAgreementVersionId: version3.id,
    });
    await proposeAmendment(entityOwnerId, opportunityId, second.id, '2027-01-01T00:00:00Z');
    const decided = await reviewAmendment({
      amendmentId: second.id, reviewerUserId: reviewerId, decision: 'rejected', expectedVersion: null,
    });
    expect(decided.amendment.status).toBe('rejected');
    // The rejection changed nothing about versions.
    expect(await currentVersionId()).toBe(version1Id);
  });

  test('once the deadline passes, effective succeeds (deadlock escape)', async () => {
    await pool.query(
      `UPDATE investment_amendments SET reconfirmation_deadline_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [amendmentId]
    );
    const decided = await reviewAmendment({
      amendmentId, reviewerUserId: reviewerId, decision: 'effective', expectedVersion: null,
    });
    expect(decided.amendment.status).toBe('effective');
    expect(await currentVersionId()).toBe(version2Id);
  });

  test('close refuses to count stale-version commitments toward the target, then closes once new money makes it up', async () => {
    await approveClosingConditions({ opportunityId, approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId, stage: 'review', approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId, stage: 'execution', approverUserId: executorId });
    // A reconfirmed 6000 on v2; B's 4000 is still on v1. The captured
    // total (6000) is below the 10000 target, so the close must refuse
    // rather than count B's stale commitment toward the target.
    let caught = null;
    try {
      await closeOpportunity({ opportunityId, executorUserId: executorId });
    } catch (err) { caught = err; }
    expect(caught).toBeTruthy();
    expect(caught.code).toBe('invest_close_target_unmet');
    expect(caught.message).toMatch(/4000 excluded on older versions/);
    // The failed close touched nothing: B's commitment is still
    // reserved and both wallets are untouched.
    let { rows } = await pool.query(
      `SELECT status FROM investment_commitments WHERE id = $1`, [commitmentBId]
    );
    expect(rows[0].status).toBe('reserved');
    expect(await walletBalance(walletBId)).toBe(20000);

    // D-764 (N15): B's stale reservation no longer blocks new money —
    // the overfill guard counts only current-version reserved
    // commitments — so C fills the 4000 headroom without B cancelling
    // first. The close then captures A + C (10000) and excludes B's
    // stale 4000, which stays reserved for admin cancel/release and is
    // reported to the excluded investor by the notice leg.
    await investOnVersion2(investorCId, 4000);
    const closed = await closeOpportunity({ opportunityId, executorUserId: executorId });
    expect(closed.status).toBe('closed');
    expect(closed.completedTotalCents).toBe(10000);
    expect(closed.positions).toHaveLength(2);
    expect(closed.positions.map((p) => String(p.userId)).sort()).toEqual([investorAId, investorCId].sort());
    expect(closed.excludedCommitmentIds).toEqual([String(commitmentBId)]);
    expect(closed.excludedCents).toBe(4000);
    ({ rows } = await pool.query(
      `SELECT status FROM investment_commitments WHERE id = $1`, [commitmentBId]
    ));
    expect(rows[0].status).toBe('reserved');
    expect(await walletBalance(walletAId)).toBe(14000);
    expect(await walletBalance(walletBId)).toBe(20000);
    expect(await walletBalance(walletCId)).toBe(16000);
    const { rows: notes } = await pool.query(
      `SELECT data FROM notifications WHERE user_id = $1 AND type = 'invest_commitment_excluded'`,
      [investorBId],
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].data.commitmentId).toBe(String(commitmentBId));
    expect(notes[0].data.amountCents).toBe(4000);
  });
});
