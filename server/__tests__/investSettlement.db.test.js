'use strict';

// Investment settlement service (OxSteed Invest, Track 1).
// Real migrated PostgreSQL only (disposable credit_statement_test database).

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CREDIT_GUARD_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
// Shared test DB already holds far more issued Credit than the default
// total-issuance cap; raise it for this suite like the other Credit DB
// suites do. Set before any service module loads the limit rules.
process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS = String(50_000_000_000);
process.env.INVEST_ENABLED = 'true';
process.env.INVEST_COMMITMENTS_ENABLED = 'true';

const describeDatabase = database ? describe : describe.skip;

const crypto = require('crypto');
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const {
  ensureAccount,
  postJournalTransaction,
} = require('../services/oxsteedCreditService');
const { createLot, getEligibleBalance } = require('../services/invest/creditLots');
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
  failCloseOpportunity,
  sweepUnsuccessfulOpportunities,
  recordPartnerEscrowConfirmation,
  approveClosingConditions,
  recordClosingApproval,
  closeOpportunity,
  releaseProceeds,
  recordDistribution,
} = require('../services/invest/settlementService');
const { getSubledgerBalances } = require('../services/invest/investmentSubledger');
const { reconcileInvestments } = require('../services/invest/reconciliation');

jest.setTimeout(180000);

test('invest settlement DB tests require an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('invest settlement', () => {
  let adminId;
  let entityOwnerId;
  let reviewerId;
  let executorId;
  let businessId;
  let treasuryId;
  const createdUsers = [];

  async function createUser(tag, role = 'customer') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, 'synthetic-unusable', 'Invest', $3, $4)`,
      [id, `invest-${tag}-${id}@example.invalid`, tag, role],
    );
    createdUsers.push(id);
    return id;
  }

  async function freshInvestor(fundsCents) {
    const userId = await createUser(`inv-${crypto.randomUUID().slice(0, 8)}`);
    let walletId;
    await withTransaction(pool, async (client) => {
      const wallet = await ensureAccount(client, { accountType: 'customer_wallet', customerId: userId, currencyCode: 'USD' });
      walletId = wallet.id;
    }, 'invest_settle_setup_wallet');
    const { transaction } = await withTransaction(pool, async (client) => postJournalTransaction(client, {
      transactionType: 'funding',
      debitAccountId: treasuryId,
      creditAccountId: walletId,
      customerId: userId,
      amountCents: fundsCents,
      currencyCode: 'USD',
      idempotencyKey: `invest-settle-fund-${crypto.randomUUID()}`,
      actorType: 'admin',
      actorUserId: adminId,
      reason: 'Invest settlement test funding',
      description: 'Invest settlement test funding',
      referenceType: 'test_funding',
      referenceId: crypto.randomUUID(),
      metadata: {},
    }), 'invest_settle_fund');
    await withTransaction(pool, async (client) => createLot(client, {
      accountId: walletId,
      customerId: userId,
      currencyCode: 'USD',
      source: 'purchased',
      amountCents: fundsCents,
      settledAt: new Date().toISOString(),
      originatingTransactionId: transaction.id,
      referenceType: 'test_funding',
      referenceId: String(transaction.id),
    }), 'invest_settle_lot');
    return { userId, walletId };
  }

  async function freshOpportunity(targetCents) {
    const opportunity = await createOpportunity({
      businessId,
      createdBy: entityOwnerId,
      title: `Raise ${targetCents}`,
      purpose: 'Test raise',
      targetCents,
      minimumCents: 0,
      deadlineAt: new Date('2027-06-01T00:00:00Z').toISOString(),
      valuationRule: 'Revenue share of 5 percent of monthly revenue.',
      useOfProceeds: 'Test use of proceeds.',
    });
    const version = await createAgreementVersion({
      opportunityId: opportunity.id,
      body: 'Test investment agreement version 1. Revenue share only.',
      createdBy: entityOwnerId,
    });
    for (const status of ['submitted', 'under_review', 'approved', 'published']) {
      await setOpportunityStatus({ opportunityId: opportunity.id, status });
    }
    return { opportunity, version };
  }

  async function approvedApplication(userId, opportunityId, agreementVersionId) {
    const { application } = await createParticipationApplication({
      userId,
      opportunityId,
      agreementVersionId,
      idempotencyKey: `invest-app-${crypto.randomUUID()}`,
    });
    await submitParticipationApplication({ applicationId: application.id, userId });
    const approved = await reviewParticipationApplication({
      applicationId: application.id,
      reviewerUserId: reviewerId,
      decision: 'approved',
      identityVerified: true,
      authorityVerified: true,
    });
    return approved;
  }

  async function walletBalance(walletId) {
    const { rows } = await pool.query(`SELECT balance_cents, reserved_cents FROM oxsteed_credit_accounts WHERE id = $1`, [walletId]);
    return { balanceCents: Number(rows[0].balance_cents), reservedCents: Number(rows[0].reserved_cents) };
  }

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', true, 'synthetic invest settlement test')
       ON CONFLICT (key) DO UPDATE SET is_enabled = true`,
    );
    adminId = await createUser('admin', 'admin');
    entityOwnerId = await createUser('entity-owner');
    reviewerId = await createUser('reviewer', 'admin');
    executorId = await createUser('executor', 'admin');
    const { rows: businessRows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, business_type)
       VALUES ($1, 'Invest Test Entity', 'llc') RETURNING id`,
      [entityOwnerId],
    );
    businessId = businessRows[0].id;
    await withTransaction(pool, async (client) => {
      const treasury = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: 'USD' });
      treasuryId = treasury.id;
    }, 'invest_settle_setup_treasury');
  });

  afterAll(async () => {
    await pool.end();
  });

  test('flags off blocks commitment creation', async () => {
    const { userId } = await freshInvestor(10000);
    const { opportunity, version } = await freshOpportunity(10000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    const previous = process.env.INVEST_COMMITMENTS_ENABLED;
    process.env.INVEST_COMMITMENTS_ENABLED = 'false';
    try {
      await expect(createCommitment({
        userId,
        opportunityId: opportunity.id,
        applicationId: application.id,
        amountCents: 5000,
        agreementVersionId: version.id,
        idempotencyKey: `invest-flag-${crypto.randomUUID()}`,
      })).rejects.toMatchObject({ code: 'invest_commitments_disabled' });
    } finally {
      process.env.INVEST_COMMITMENTS_ENABLED = previous;
    }
    const { rows } = await pool.query(
      `SELECT id FROM investment_commitments WHERE user_id = $1 AND opportunity_id = $2`,
      [userId, opportunity.id],
    );
    expect(rows).toHaveLength(0);
  });

  test('commitment reserves eligible lots, records the escrow expectation, and refuses overfill', async () => {
    const first = await freshInvestor(20000);
    const second = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(15000);
    const app1 = await approvedApplication(first.userId, opportunity.id, version.id);
    const app2 = await approvedApplication(second.userId, opportunity.id, version.id);

    const { commitment } = await createCommitment({
      userId: first.userId,
      opportunityId: opportunity.id,
      applicationId: app1.id,
      amountCents: 10000,
      agreementVersionId: version.id,
      idempotencyKey: `invest-commit-${crypto.randomUUID()}`,
    });
    expect(commitment.status).toBe('reserved');
    expect(commitment.agreementVersionNumber).toBe(1);

    const wallet = await walletBalance(first.walletId);
    expect(wallet.balanceCents).toBe(20000);
    expect(wallet.reservedCents).toBe(10000);
    const eligible = await withTransaction(pool, async (client) => getEligibleBalance(client, { customerId: first.userId, currencyCode: 'USD' }), 'invest_settle_eligible');
    expect(eligible.eligibleAvailableCents).toBe(10000);

    const { rows: lots } = await pool.query(
      `SELECT * FROM investment_commitment_lots WHERE commitment_id = $1`, [commitment.id],
    );
    expect(lots).toHaveLength(1);
    expect(Number(lots[0].amount_cents)).toBe(10000);
    expect(lots[0].status).toBe('active');

    const { rows: settlements } = await pool.query(
      `SELECT * FROM investment_settlements WHERE commitment_id = $1`, [commitment.id],
    );
    expect(settlements).toHaveLength(1);
    expect(settlements[0].kind).toBe('escrow_expectation');
    expect(settlements[0].status).toBe('pending_partner_confirmation');

    const balances = await getSubledgerBalances(pool, { opportunityId: opportunity.id, currencyCode: 'USD' });
    expect(balances.pendingReservationsCents).toBe(10000);

    await expect(createCommitment({
      userId: second.userId,
      opportunityId: opportunity.id,
      applicationId: app2.id,
      amountCents: 6000,
      agreementVersionId: version.id,
      idempotencyKey: `invest-commit-${crypto.randomUUID()}`,
    })).rejects.toMatchObject({ code: 'invest_commitment_overfill' });

    const { commitment: secondCommitment } = await createCommitment({
      userId: second.userId,
      opportunityId: opportunity.id,
      applicationId: app2.id,
      amountCents: 5000,
      agreementVersionId: version.id,
      idempotencyKey: `invest-commit-${crypto.randomUUID()}`,
    });
    expect(secondCommitment.status).toBe('reserved');
  });

  test('retried commitment requests cannot duplicate a commitment', async () => {
    const { userId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(10000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    const key = `invest-retry-${crypto.randomUUID()}`;
    const input = {
      userId,
      opportunityId: opportunity.id,
      applicationId: application.id,
      amountCents: 4000,
      agreementVersionId: version.id,
      idempotencyKey: key,
    };
    const first = await createCommitment(input);
    expect(first.replayed).toBe(false);
    const second = await createCommitment(input);
    expect(second.replayed).toBe(true);
    expect(second.commitment.id).toBe(first.commitment.id);
    const { rows } = await pool.query(
      `SELECT id FROM investment_commitments WHERE idempotency_key = $1`, [key],
    );
    expect(rows).toHaveLength(1);
    await expect(createCommitment({ ...input, amountCents: 5000 }))
      .rejects.toMatchObject({ code: 'invest_commitment_idempotency_conflict' });
  });

  test('concurrent commits cannot overspend one eligible balance', async () => {
    const { userId } = await freshInvestor(10000);
    const { opportunity, version } = await freshOpportunity(30000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    const attempt = (amount) => createCommitment({
      userId,
      opportunityId: opportunity.id,
      applicationId: application.id,
      amountCents: amount,
      agreementVersionId: version.id,
      idempotencyKey: `invest-concurrent-${crypto.randomUUID()}`,
    });
    const results = await Promise.allSettled([attempt(8000), attempt(8000)]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe('invest_insufficient_eligible_credit');
    const { rows } = await pool.query(
      `SELECT id FROM investment_commitments WHERE user_id = $1 AND opportunity_id = $2 AND status = 'reserved'`,
      [userId, opportunity.id],
    );
    expect(rows).toHaveLength(1);
  });

  test('cancellation restores the original lot classification', async () => {
    const { userId, walletId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(10000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    const { commitment } = await createCommitment({
      userId,
      opportunityId: opportunity.id,
      applicationId: application.id,
      amountCents: 7000,
      agreementVersionId: version.id,
      idempotencyKey: `invest-cancel-${crypto.randomUUID()}`,
    });
    const { rows: lotBefore } = await pool.query(
      `SELECT source, remaining_cents FROM oxsteed_credit_balance_lots WHERE customer_id = $1`,
      [userId],
    );
    expect(lotBefore).toHaveLength(1);
    expect(lotBefore[0].source).toBe('purchased');
    expect(Number(lotBefore[0].remaining_cents)).toBe(20000);

    const cancelled = await cancelCommitment({ commitmentId: commitment.id, userId, reason: 'investor changed mind' });
    expect(cancelled.status).toBe('cancelled');
    const wallet = await walletBalance(walletId);
    expect(wallet.reservedCents).toBe(0);
    const { rows: lotAfter } = await pool.query(
      `SELECT source, remaining_cents FROM oxsteed_credit_balance_lots WHERE customer_id = $1`,
      [userId],
    );
    expect(lotAfter).toHaveLength(1);
    expect(lotAfter[0].source).toBe('purchased');
    expect(Number(lotAfter[0].remaining_cents)).toBe(20000);
    const eligible = await withTransaction(pool, async (client) => getEligibleBalance(client, { customerId: userId, currencyCode: 'USD' }), 'invest_settle_eligible2');
    expect(eligible.eligibleAvailableCents).toBe(20000);
    const balances = await getSubledgerBalances(pool, { opportunityId: opportunity.id, currencyCode: 'USD' });
    expect(balances.pendingReservationsCents).toBe(0);
    expect(balances.cancelledReleasedCents).toBe(7000);
  });

  test('close refuses when the target is unmet and when conditions are unapproved', async () => {
    const { userId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(20000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    await createCommitment({
      userId,
      opportunityId: opportunity.id,
      applicationId: application.id,
      amountCents: 5000,
      agreementVersionId: version.id,
      idempotencyKey: `invest-close-target-${crypto.randomUUID()}`,
    });
    await approveClosingConditions({ opportunityId: opportunity.id, approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId: opportunity.id, stage: 'review', approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId: opportunity.id, stage: 'execution', approverUserId: executorId });
    await expect(closeOpportunity({ opportunityId: opportunity.id, executorUserId: executorId }))
      .rejects.toMatchObject({ code: 'invest_close_target_unmet' });

    const second = await freshInvestor(20000);
    const secondOpp = await freshOpportunity(10000);
    const secondApp = await approvedApplication(second.userId, secondOpp.opportunity.id, secondOpp.version.id);
    await createCommitment({
      userId: second.userId,
      opportunityId: secondOpp.opportunity.id,
      applicationId: secondApp.id,
      amountCents: 10000,
      agreementVersionId: secondOpp.version.id,
      idempotencyKey: `invest-close-conditions-${crypto.randomUUID()}`,
    });
    await recordClosingApproval({ opportunityId: secondOpp.opportunity.id, stage: 'review', approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId: secondOpp.opportunity.id, stage: 'execution', approverUserId: executorId });
    await expect(closeOpportunity({ opportunityId: secondOpp.opportunity.id, executorUserId: executorId }))
      .rejects.toMatchObject({ code: 'invest_close_conditions_unapproved' });
  });

  test('closing approvals require separate approvers and no self-approval', async () => {
    const { opportunity } = await freshOpportunity(10000);
    await expect(recordClosingApproval({
      opportunityId: opportunity.id, stage: 'review', approverUserId: entityOwnerId,
    })).rejects.toMatchObject({ code: 'invest_close_self_approval' });
    await recordClosingApproval({ opportunityId: opportunity.id, stage: 'review', approverUserId: reviewerId });
    await expect(recordClosingApproval({
      opportunityId: opportunity.id, stage: 'execution', approverUserId: reviewerId,
    })).rejects.toMatchObject({ code: 'invest_close_same_approver' });
  });

  test('full close, proceeds release, distribution, and reconciliation', async () => {
    const { userId, walletId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(10000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    const { commitment } = await createCommitment({
      userId,
      opportunityId: opportunity.id,
      applicationId: application.id,
      amountCents: 10000,
      agreementVersionId: version.id,
      idempotencyKey: `invest-full-${crypto.randomUUID()}`,
    });

    // Proceeds are blocked before closing.
    await expect(releaseProceeds({ opportunityId: opportunity.id, releasedBy: executorId }))
      .rejects.toMatchObject({ code: 'invest_proceeds_blocked' });

    await approveClosingConditions({ opportunityId: opportunity.id, approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId: opportunity.id, stage: 'review', approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId: opportunity.id, stage: 'execution', approverUserId: executorId });
    const closed = await closeOpportunity({ opportunityId: opportunity.id, executorUserId: executorId });
    expect(closed.status).toBe('closed');
    expect(closed.completedTotalCents).toBe(10000);
    expect(closed.positions).toHaveLength(1);
    expect(closed.positions[0].agreementVersionNumber).toBe(1);

    const walletAfterClose = await walletBalance(walletId);
    expect(walletAfterClose.balanceCents).toBe(10000);
    expect(walletAfterClose.reservedCents).toBe(0);
    const { rows: lotRows } = await pool.query(
      `SELECT remaining_cents FROM oxsteed_credit_balance_lots WHERE customer_id = $1`, [userId],
    );
    expect(Number(lotRows[0].remaining_cents)).toBe(10000);

    const { rows: commitmentRows } = await pool.query(
      `SELECT status, journal_transaction_id FROM investment_commitments WHERE id = $1`, [commitment.id],
    );
    expect(commitmentRows[0].status).toBe('completed');
    expect(commitmentRows[0].journal_transaction_id).not.toBeNull();

    const balancesAfterClose = await getSubledgerBalances(pool, { opportunityId: opportunity.id, currencyCode: 'USD' });
    expect(balancesAfterClose.pendingReservationsCents).toBe(0);
    expect(balancesAfterClose.completedContributionsCents).toBe(10000);
    expect(balancesAfterClose.proceedsAwaitingReleaseCents).toBe(10000);

    const released = await releaseProceeds({ opportunityId: opportunity.id, releasedBy: executorId });
    expect(released.status).toBe('released');
    expect(released.amountCents).toBe(10000);

    const positionId = closed.positions[0].id;
    const { distribution } = await recordDistribution({
      opportunityId: opportunity.id,
      positionId,
      userId,
      amountCents: 1500,
      idempotencyKey: `invest-dist-${crypto.randomUUID()}`,
      actorUserId: adminId,
    });
    expect(distribution.status).toBe('credited');
    expect(distribution.journal_transaction_id).not.toBeNull();
    const walletAfterDistribution = await walletBalance(walletId);
    expect(walletAfterDistribution.balanceCents).toBe(11500);
    const { rows: distributionLots } = await pool.query(
      `SELECT source, amount_cents FROM oxsteed_credit_balance_lots WHERE id = $1`, [distribution.lot_id],
    );
    expect(distributionLots[0].source).toBe('distribution');
    expect(Number(distributionLots[0].amount_cents)).toBe(1500);
    // Distribution value is not purchased value: it must not fund a new commitment.
    const eligibleAfter = await withTransaction(pool, async (client) => getEligibleBalance(client, { customerId: userId, currencyCode: 'USD' }), 'invest_settle_eligible3');
    expect(eligibleAfter.eligibleAvailableCents).toBe(10000);

    const reconciliation = await reconcileInvestments({ opportunityId: opportunity.id });
    expect(reconciliation.ok).toBe(true);
    expect(reconciliation.differences).toEqual([]);
  });

  test('fail-close releases reservations to the original lots and marks the opportunity unsuccessful', async () => {
    const first = await freshInvestor(20000);
    const second = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(30000);
    const app1 = await approvedApplication(first.userId, opportunity.id, version.id);
    const app2 = await approvedApplication(second.userId, opportunity.id, version.id);
    const { commitment: firstCommitment } = await createCommitment({
      userId: first.userId,
      opportunityId: opportunity.id,
      applicationId: app1.id,
      amountCents: 10000,
      agreementVersionId: version.id,
      idempotencyKey: `invest-failclose-1-${crypto.randomUUID()}`,
    });
    const { commitment: secondCommitment } = await createCommitment({
      userId: second.userId,
      opportunityId: opportunity.id,
      applicationId: app2.id,
      amountCents: 5000,
      agreementVersionId: version.id,
      idempotencyKey: `invest-failclose-2-${crypto.randomUUID()}`,
    });

    const result = await failCloseOpportunity({
      opportunityId: opportunity.id, actorUserId: reviewerId, reason: 'target missed',
    });
    expect(result.status).toBe('unsuccessful');
    expect(result.releasedCommitmentCount).toBe(2);
    expect(result.releasedCents).toBe(15000);
    expect(result.releasedCommitmentIds.sort()).toEqual([firstCommitment.id, secondCommitment.id].sort());

    const { rows: oppRows } = await pool.query(
      `SELECT status, cancelled_at, cancellation_reason FROM investment_opportunities WHERE id = $1`,
      [opportunity.id],
    );
    expect(oppRows[0].status).toBe('unsuccessful');
    expect(oppRows[0].cancelled_at).not.toBeNull();
    expect(oppRows[0].cancellation_reason).toBe('target missed');

    for (const { userId, walletId } of [first, second]) {
      const wallet = await walletBalance(walletId);
      expect(wallet.reservedCents).toBe(0);
      const eligible = await withTransaction(pool, async (client) => getEligibleBalance(client, { customerId: userId, currencyCode: 'USD' }), 'invest_failclose_eligible');
      expect(eligible.eligibleAvailableCents).toBe(20000);
      const { rows: lotRows } = await pool.query(
        `SELECT source, remaining_cents FROM oxsteed_credit_balance_lots WHERE customer_id = $1`,
        [userId],
      );
      expect(lotRows).toHaveLength(1);
      expect(lotRows[0].source).toBe('purchased');
      expect(Number(lotRows[0].remaining_cents)).toBe(20000);
    }
    const { rows: commitmentRows } = await pool.query(
      `SELECT status FROM investment_commitments WHERE opportunity_id = $1 ORDER BY created_at ASC`,
      [opportunity.id],
    );
    expect(commitmentRows.map((row) => row.status)).toEqual(['cancelled', 'cancelled']);
    const { rows: lotLinkRows } = await pool.query(
      `SELECT status FROM investment_commitment_lots WHERE commitment_id = $1`,
      [firstCommitment.id],
    );
    expect(lotLinkRows[0].status).toBe('released');
    const { rows: settlementRows } = await pool.query(
      `SELECT status FROM investment_settlements WHERE commitment_id = $1`,
      [firstCommitment.id],
    );
    expect(settlementRows[0].status).toBe('cancelled');
    const balances = await getSubledgerBalances(pool, { opportunityId: opportunity.id, currencyCode: 'USD' });
    expect(balances.pendingReservationsCents).toBe(0);
    expect(balances.cancelledReleasedCents).toBe(15000);
  });

  test('fail-close refuses an already-closed opportunity and a self-approving entity rep', async () => {
    const { userId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(10000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    await createCommitment({
      userId,
      opportunityId: opportunity.id,
      applicationId: application.id,
      amountCents: 10000,
      agreementVersionId: version.id,
      idempotencyKey: `invest-failclose-closed-${crypto.randomUUID()}`,
    });
    await approveClosingConditions({ opportunityId: opportunity.id, approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId: opportunity.id, stage: 'review', approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId: opportunity.id, stage: 'execution', approverUserId: executorId });
    await closeOpportunity({ opportunityId: opportunity.id, executorUserId: executorId });
    await expect(failCloseOpportunity({ opportunityId: opportunity.id, actorUserId: reviewerId }))
      .rejects.toMatchObject({ code: 'invest_fail_close_status_invalid' });

    const open = await freshOpportunity(10000);
    await expect(failCloseOpportunity({ opportunityId: open.opportunity.id, actorUserId: entityOwnerId }))
      .rejects.toMatchObject({ code: 'invest_fail_close_self_approval' });
  });

  test('closing deadline is enforced even when the target is met', async () => {
    const { userId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(10000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    await createCommitment({
      userId,
      opportunityId: opportunity.id,
      applicationId: application.id,
      amountCents: 10000,
      agreementVersionId: version.id,
      idempotencyKey: `invest-deadline-${crypto.randomUUID()}`,
    });
    await approveClosingConditions({ opportunityId: opportunity.id, approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId: opportunity.id, stage: 'review', approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId: opportunity.id, stage: 'execution', approverUserId: executorId });
    await pool.query(
      `UPDATE investment_opportunities SET deadline_at = NOW() - interval '1 hour' WHERE id = $1`,
      [opportunity.id],
    );
    await expect(closeOpportunity({ opportunityId: opportunity.id, executorUserId: executorId }))
      .rejects.toMatchObject({ code: 'invest_close_deadline_passed' });
  });

  test('sweeper fail-closes only past-deadline opportunities with the target unmet', async () => {
    async function reservedOpportunity(targetCents, amountCents) {
      const { userId } = await freshInvestor(20000);
      const { opportunity, version } = await freshOpportunity(targetCents);
      const application = await approvedApplication(userId, opportunity.id, version.id);
      await createCommitment({
        userId,
        opportunityId: opportunity.id,
        applicationId: application.id,
        amountCents,
        agreementVersionId: version.id,
        idempotencyKey: `invest-sweep-${crypto.randomUUID()}`,
      });
      return opportunity;
    }
    const pastUnmet = await reservedOpportunity(20000, 5000);
    const futureUnmet = await reservedOpportunity(20000, 5000);
    const pastMet = await reservedOpportunity(10000, 10000);
    await pool.query(
      `UPDATE investment_opportunities SET deadline_at = NOW() - interval '1 hour' WHERE id = ANY($1::uuid[])`,
      [[pastUnmet.id, pastMet.id]],
    );

    const result = await sweepUnsuccessfulOpportunities({});
    expect(result.failed).toEqual([]);
    expect(result.failClosed).toHaveLength(1);
    expect(result.failClosed[0].opportunityId).toBe(pastUnmet.id);
    expect(result.failClosed[0].releasedCents).toBe(5000);

    const { rows } = await pool.query(
      `SELECT id, status FROM investment_opportunities WHERE id = ANY($1::uuid[])`,
      [[pastUnmet.id, futureUnmet.id, pastMet.id]],
    );
    const byId = new Map(rows.map((row) => [String(row.id), row.status]));
    expect(byId.get(pastUnmet.id)).toBe('unsuccessful');
    expect(byId.get(futureUnmet.id)).toBe('published');
    expect(byId.get(pastMet.id)).toBe('published');
    const { rows: kept } = await pool.query(
      `SELECT status FROM investment_commitments WHERE opportunity_id = $1`,
      [futureUnmet.id],
    );
    expect(kept[0].status).toBe('reserved');
  });

  test('close leaves escrow expectations pending until explicit partner confirmation', async () => {
    const { userId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(10000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    const { commitment } = await createCommitment({
      userId,
      opportunityId: opportunity.id,
      applicationId: application.id,
      amountCents: 10000,
      agreementVersionId: version.id,
      idempotencyKey: `invest-escrow-${crypto.randomUUID()}`,
    });
    await approveClosingConditions({ opportunityId: opportunity.id, approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId: opportunity.id, stage: 'review', approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId: opportunity.id, stage: 'execution', approverUserId: executorId });
    await closeOpportunity({ opportunityId: opportunity.id, executorUserId: executorId });

    const { rows: pending } = await pool.query(
      `SELECT status FROM investment_settlements WHERE commitment_id = $1 AND kind = 'escrow_expectation'`,
      [commitment.id],
    );
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending_partner_confirmation');

    await expect(recordPartnerEscrowConfirmation({ commitmentId: commitment.id, confirmedBy: reviewerId }))
      .rejects.toMatchObject({ code: 'invest_escrow_partner_ref_required' });
    const confirmed = await recordPartnerEscrowConfirmation({
      commitmentId: commitment.id, partnerRef: 'partner-esc-1', confirmedBy: reviewerId,
    });
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.partnerRef).toBe('partner-esc-1');
    expect(confirmed.confirmedAt).not.toBeNull();
    await expect(recordPartnerEscrowConfirmation({
      commitmentId: commitment.id, partnerRef: 'partner-esc-2', confirmedBy: reviewerId,
    })).rejects.toMatchObject({ code: 'invest_escrow_nothing_pending' });
  });

  test('close, proceeds release, and distribution refuse when the live gate is off (service level)', async () => {
    const { userId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(10000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    await createCommitment({
      userId,
      opportunityId: opportunity.id,
      applicationId: application.id,
      amountCents: 10000,
      agreementVersionId: version.id,
      idempotencyKey: `invest-gate-${crypto.randomUUID()}`,
    });
    await approveClosingConditions({ opportunityId: opportunity.id, approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId: opportunity.id, stage: 'review', approverUserId: reviewerId });
    await recordClosingApproval({ opportunityId: opportunity.id, stage: 'execution', approverUserId: executorId });

    const previous = process.env.INVEST_COMMITMENTS_ENABLED;
    process.env.INVEST_COMMITMENTS_ENABLED = 'false';
    try {
      // A direct service call, not a route: the service itself refuses.
      await expect(closeOpportunity({ opportunityId: opportunity.id, executorUserId: executorId }))
        .rejects.toMatchObject({ code: 'invest_commitments_disabled' });
    } finally {
      process.env.INVEST_COMMITMENTS_ENABLED = previous;
    }
    const closed = await closeOpportunity({ opportunityId: opportunity.id, executorUserId: executorId });
    expect(closed.status).toBe('closed');

    process.env.INVEST_COMMITMENTS_ENABLED = 'false';
    try {
      await expect(releaseProceeds({ opportunityId: opportunity.id, releasedBy: executorId }))
        .rejects.toMatchObject({ code: 'invest_commitments_disabled' });
      await expect(recordDistribution({
        opportunityId: opportunity.id,
        positionId: closed.positions[0].id,
        userId,
        amountCents: 500,
        idempotencyKey: `invest-gate-dist-${crypto.randomUUID()}`,
        actorUserId: adminId,
      })).rejects.toMatchObject({ code: 'invest_commitments_disabled' });
    } finally {
      process.env.INVEST_COMMITMENTS_ENABLED = previous;
    }
    const released = await releaseProceeds({ opportunityId: opportunity.id, releasedBy: executorId });
    expect(released.status).toBe('released');
  });

  test('reconciliation catches a planted subledger difference', async () => {
    const { opportunity } = await freshOpportunity(10000);
    const before = await reconcileInvestments({ opportunityId: opportunity.id });
    expect(before.ok).toBe(true);
    await pool.query(
      `INSERT INTO investment_ledger_entries
         (entry_type, category, opportunity_id, amount_cents, currency_code,
          reference_type, reference_id, idempotency_key)
       VALUES ('reservation', 'pending_reservations', $1, 9999, 'USD',
               'test_plant', 'planted-1', $2)`,
      [opportunity.id, `invest-plant-${crypto.randomUUID()}`],
    );
    const after = await reconcileInvestments({ opportunityId: opportunity.id });
    expect(after.ok).toBe(false);
    expect(after.differences.map((difference) => difference.code))
      .toContain('subledger_pending_mismatch');
  });
});
