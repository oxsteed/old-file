'use strict';

// R-1 (PR #804 Track C): Invest distributions bypassed maker-checker.
// A single admin with review_invest_release_proceeds could mint
// arbitrary Credit through POST /opportunities/:id/distributions.
// Now every distribution queues for a second admin (forceQueue) in the
// money-movement approval queue, and the total distributed for an
// opportunity is capped at the proceeds the close captured.
// Reproduction: before the fix, the controller called recordDistribution
// directly, so one admin call credited the investor immediately.

jest.unmock('pg');
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
  approveClosingConditions,
  recordClosingApproval,
  closeOpportunity,
  recordDistribution,
  requestDistribution,
} = require('../services/invest/settlementService');
const {
  decideMoneyMovementApproval,
  listPendingMoneyMovementApprovals,
} = require('../services/dualApprovalService');

jest.setTimeout(180000);

describe('R-1 invest distributions through dual approval', () => {
  let adminId; // maker
  let checkerId; // second admin
  let entityOwnerId;
  let reviewerId;
  let executorId;
  let businessId;
  let treasuryId;
  let investorId;
  let walletId;
  let opportunityId;
  let positionId;
  let railWasEnabled = null;
  const createdUsers = [];

  async function createUser(tag, role = 'customer') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, 'synthetic-unusable', 'Invest', $3, $4)`,
      [id, `r1-${tag}-${id.slice(0, 8)}@example.invalid`, tag, role]
    );
    createdUsers.push(id);
    return id;
  }

  async function freshInvestor(fundsCents) {
    const userId = await createUser(`inv-${crypto.randomUUID().slice(0, 8)}`);
    let wallet;
    await withTransaction(pool, async (client) => {
      wallet = await ensureAccount(client, { accountType: 'customer_wallet', customerId: userId, currencyCode: 'USD' });
    }, 'r1_setup_wallet');
    const { transaction } = await withTransaction(pool, async (client) => postJournalTransaction(client, {
      transactionType: 'funding',
      debitAccountId: treasuryId,
      creditAccountId: wallet.id,
      customerId: userId,
      amountCents: fundsCents,
      currencyCode: 'USD',
      idempotencyKey: `r1-fund-${crypto.randomUUID()}`,
      actorType: 'admin',
      actorUserId: adminId,
      reason: 'R-1 test funding',
      description: 'R-1 test funding',
      referenceType: 'test_funding',
      referenceId: crypto.randomUUID(),
      metadata: {},
    }), 'r1_fund');
    await withTransaction(pool, async (client) => createLot(client, {
      accountId: wallet.id,
      customerId: userId,
      currencyCode: 'USD',
      source: 'purchased',
      amountCents: fundsCents,
      settledAt: new Date().toISOString(),
      originatingTransactionId: transaction.id,
      referenceType: 'test_funding',
      referenceId: String(transaction.id),
    }), 'r1_lot');
    return { userId, walletId: wallet.id };
  }

  async function walletBalance() {
    const { rows } = await pool.query(
      `SELECT balance_cents FROM oxsteed_credit_accounts WHERE id = $1`, [walletId]
    );
    return Number(rows[0].balance_cents);
  }

  async function distributionCount() {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM investment_distributions WHERE opportunity_id = $1`, [opportunityId]
    );
    return Number(rows[0].n);
  }

  beforeAll(async () => {
    const { rows: [flag] } = await pool.query(
      `SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`
    );
    railWasEnabled = flag ? flag.is_enabled : null;
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', true, 'R-1 test')
       ON CONFLICT (key) DO UPDATE SET is_enabled = true`
    );
    adminId = await createUser('maker', 'admin');
    checkerId = await createUser('checker', 'admin');
    entityOwnerId = await createUser('entity-owner');
    reviewerId = await createUser('reviewer', 'admin');
    executorId = await createUser('executor', 'admin');
    const { rows: businessRows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, business_type)
       VALUES ($1, 'R-1 Test Entity', 'llc') RETURNING id`,
      [entityOwnerId]
    );
    businessId = businessRows[0].id;
    await withTransaction(pool, async (client) => {
      const treasury = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: 'USD' });
      treasuryId = treasury.id;
    }, 'r1_setup_treasury');

    // One investor, one 10000-cent commitment, closed: proceeds 10000.
    ({ userId: investorId, walletId } = await freshInvestor(20000));
    const opportunity = await createOpportunity({
      businessId,
      createdBy: entityOwnerId,
      title: 'R-1 Raise',
      purpose: 'Test raise',
      targetCents: 10000,
      minimumCents: 0,
      deadlineAt: new Date('2027-06-01T00:00:00Z').toISOString(),
      valuationRule: 'Revenue share of 5 percent of monthly revenue.',
      useOfProceeds: 'Test use of proceeds.',
    });
    opportunityId = opportunity.id;
    const version = await createAgreementVersion({
      opportunityId,
      body: 'Test investment agreement version 1. Revenue share only.',
      createdBy: entityOwnerId,
    });
    for (const status of ['submitted', 'under_review', 'approved', 'published']) {
      await setOpportunityStatus({ opportunityId, status });
    }
    const { application } = await createParticipationApplication({
      userId: investorId,
      opportunityId,
      agreementVersionId: version.id,
      idempotencyKey: `r1-app-${crypto.randomUUID()}`,
    });
    await submitParticipationApplication({ applicationId: application.id, userId: investorId });
    await reviewParticipationApplication({
      applicationId: application.id,
      reviewerUserId: reviewerId,
      decision: 'approved',
      identityVerified: true,
      authorityVerified: true,
    });
    await createCommitment({
      userId: investorId,
      opportunityId,
      applicationId: application.id,
      amountCents: 10000,
      agreementVersionId: version.id,
      idempotencyKey: `r1-commit-${crypto.randomUUID()}`,
    });
    await approveClosingConditions({ opportunityId, approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId, stage: 'review', approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId, stage: 'execution', approverUserId: executorId });
    const closed = await closeOpportunity({ opportunityId, executorUserId: executorId });
    expect(closed.status).toBe('closed');
    expect(closed.completedTotalCents).toBe(10000);
    positionId = closed.positions[0].id;
    expect(await walletBalance()).toBe(10000);
  }, 180000);

  afterAll(async () => {
    try {
      if (railWasEnabled === null) {
        await pool.query(`DELETE FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
      } else {
        await pool.query(`UPDATE feature_flags SET is_enabled = $1 WHERE key = 'oxsteed_credit_enabled'`, [railWasEnabled]);
      }
    } catch { /* best effort */ }
    await pool.end();
  });

  const KEY1 = `r1-dist-1-${crypto.randomUUID()}`;
  const KEY4 = `r1-dist-4-${crypto.randomUUID()}`;
  let approvalId1;

  test('a distribution request queues and moves no money', async () => {
    const result = await requestDistribution({
      opportunityId, positionId, userId: investorId, amountCents: 1500,
      idempotencyKey: KEY1, actorUserId: adminId,
    });
    expect(result.queued).toBe(true);
    expect(result.approval.movement_type).toBe('invest_distribution');
    expect(result.approval.status).toBe('pending');
    approvalId1 = result.approval.id;
    expect(await distributionCount()).toBe(0);
    expect(await walletBalance()).toBe(10000);
    const pending = await listPendingMoneyMovementApprovals({ limit: 50 });
    expect(pending.approvals.some((row) => String(row.id) === String(approvalId1))).toBe(true);
  });

  test('the maker cannot approve their own distribution', async () => {
    await expect(decideMoneyMovementApproval({
      approvalId: approvalId1, approverId: adminId, decision: 'approve',
    })).rejects.toMatchObject({ code: 'money_movement_self_approval' });
    expect(await distributionCount()).toBe(0);
    expect(await walletBalance()).toBe(10000);
  });

  test('a second admin approval credits the investor once', async () => {
    const outcome = await decideMoneyMovementApproval({
      approvalId: approvalId1, approverId: checkerId, decision: 'approve',
    });
    expect(outcome.executed).toBe(true);
    expect(outcome.approval.status).toBe('executed');
    expect(await distributionCount()).toBe(1);
    expect(await walletBalance()).toBe(11500);
  });

  test('replaying the maker key returns the same distribution, never a second credit', async () => {
    const replayed = await recordDistribution({
      opportunityId, positionId, userId: investorId, amountCents: 1500,
      idempotencyKey: KEY1, actorUserId: checkerId,
    });
    expect(replayed.replayed).toBe(true);
    expect(await distributionCount()).toBe(1);
    expect(await walletBalance()).toBe(11500);
    // Re-requesting the same key replays the same (executed) approval.
    const again = await requestDistribution({
      opportunityId, positionId, userId: investorId, amountCents: 1500,
      idempotencyKey: KEY1, actorUserId: adminId,
    });
    expect(again.replay).toBe(true);
    expect(String(again.approval.id)).toBe(String(approvalId1));
  });

  test('a distribution above the remaining proceeds is refused at queue time and at execution', async () => {
    // Remaining proceeds: 10000 - 1500 = 8500.
    await expect(requestDistribution({
      opportunityId, positionId, userId: investorId, amountCents: 9000,
      idempotencyKey: `r1-dist-2-${crypto.randomUUID()}`, actorUserId: adminId,
    })).rejects.toMatchObject({ code: 'invest_distribution_exceeds_proceeds' });
    await expect(recordDistribution({
      opportunityId, positionId, userId: investorId, amountCents: 9000,
      idempotencyKey: `r1-dist-3-${crypto.randomUUID()}`, actorUserId: checkerId,
    })).rejects.toMatchObject({ code: 'invest_distribution_exceeds_proceeds' });
    expect(await distributionCount()).toBe(1);
    expect(await walletBalance()).toBe(11500);
  });

  test('the exact remaining proceeds distribute, then the cap is exhausted', async () => {
    const result = await requestDistribution({
      opportunityId, positionId, userId: investorId, amountCents: 8500,
      idempotencyKey: KEY4, actorUserId: adminId,
    });
    expect(result.queued).toBe(true);
    const outcome = await decideMoneyMovementApproval({
      approvalId: result.approval.id, approverId: checkerId, decision: 'approve',
    });
    expect(outcome.executed).toBe(true);
    expect(await distributionCount()).toBe(2);
    expect(await walletBalance()).toBe(20000);
    await expect(requestDistribution({
      opportunityId, positionId, userId: investorId, amountCents: 1,
      idempotencyKey: `r1-dist-5-${crypto.randomUUID()}`, actorUserId: adminId,
    })).rejects.toMatchObject({ code: 'invest_distribution_exceeds_proceeds' });
  });
});
