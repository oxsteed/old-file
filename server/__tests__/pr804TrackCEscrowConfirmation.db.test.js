'use strict';

// R-6 (PR #804 Track C): the escrow-confirmation service existed and the
// client wrapper existed, but no UI ever called it, so the close left
// every escrow expectation pending_partner_confirmation with no way to
// confirm it. This pins the contract the new escrow form in the Invest
// review queue consumes: confirm with a partner reference, then a second
// confirm is refused.
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const TEST_DB_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
if (!TEST_DB_URL.includes('/credit_statement_test_pr804_c')) {
  throw new Error('Refusing to run: STATEMENT_TEST_DATABASE_URL must point at credit_statement_test_pr804_c');
}
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
  recordPartnerEscrowConfirmation,
} = require('../services/invest/settlementService');

jest.setTimeout(180000);

describe('R-6 partner escrow confirmation contract', () => {
  let reviewerId;
  let entityOwnerId;
  let investorId;
  let commitmentId;
  let railWasEnabled = null;

  async function createUser(tag, role = 'customer') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, 'synthetic-unusable', 'Invest', $3, $4)`,
      [id, `r6e-${tag}-${id.slice(0, 8)}@example.invalid`, tag, role]
    );
    return id;
  }

  beforeAll(async () => {
    const { rows: [flag] } = await pool.query(
      `SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`
    );
    railWasEnabled = flag ? flag.is_enabled : null;
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', true, 'R-6 escrow test')
       ON CONFLICT (key) DO UPDATE SET is_enabled = true`
    );
    reviewerId = await createUser('reviewer', 'admin');
    entityOwnerId = await createUser('entity-owner');
    investorId = await createUser('investor');
    const { rows: businessRows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, business_type)
       VALUES ($1, 'R-6 Test Entity', 'llc') RETURNING id`,
      [entityOwnerId]
    );
    const businessId = businessRows[0].id;
    let treasuryId;
    await withTransaction(pool, async (client) => {
      const treasury = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: 'USD' });
      treasuryId = treasury.id;
    }, 'r6e_setup_treasury');
    let wallet;
    await withTransaction(pool, async (client) => {
      wallet = await ensureAccount(client, { accountType: 'customer_wallet', customerId: investorId, currencyCode: 'USD' });
    }, 'r6e_setup_wallet');
    const { transaction } = await withTransaction(pool, async (client) => postJournalTransaction(client, {
      transactionType: 'funding',
      debitAccountId: treasuryId,
      creditAccountId: wallet.id,
      customerId: investorId,
      amountCents: 20000,
      currencyCode: 'USD',
      idempotencyKey: `r6e-fund-${crypto.randomUUID()}`,
      actorType: 'admin',
      actorUserId: reviewerId,
      reason: 'R-6 test funding',
      description: 'R-6 test funding',
      referenceType: 'test_funding',
      referenceId: crypto.randomUUID(),
      metadata: {},
    }), 'r6e_fund');
    await withTransaction(pool, async (client) => createLot(client, {
      accountId: wallet.id,
      customerId: investorId,
      currencyCode: 'USD',
      source: 'purchased',
      amountCents: 20000,
      settledAt: new Date().toISOString(),
      originatingTransactionId: transaction.id,
      referenceType: 'test_funding',
      referenceId: String(transaction.id),
    }), 'r6e_lot');

    const opportunity = await createOpportunity({
      businessId,
      createdBy: entityOwnerId,
      title: 'R-6 Raise',
      purpose: 'Test raise',
      targetCents: 10000,
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
    const { application } = await createParticipationApplication({
      userId: investorId,
      opportunityId: opportunity.id,
      agreementVersionId: version.id,
      idempotencyKey: `r6e-app-${crypto.randomUUID()}`,
    });
    await submitParticipationApplication({ applicationId: application.id, userId: investorId });
    await reviewParticipationApplication({
      applicationId: application.id,
      reviewerUserId: reviewerId,
      decision: 'approved',
      identityVerified: true,
      authorityVerified: true,
    });
    const { commitment } = await createCommitment({
      userId: investorId,
      opportunityId: opportunity.id,
      applicationId: application.id,
      amountCents: 10000,
      agreementVersionId: version.id,
      idempotencyKey: `r6e-commit-${crypto.randomUUID()}`,
    });
    commitmentId = commitment.id;
  });

  afterAll(async () => {
    if (railWasEnabled === false) {
      await pool.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'oxsteed_credit_enabled'`);
    }
    await pool.end();
  });

  test('confirming escrow records the partner reference and the reviewer', async () => {
    const result = await recordPartnerEscrowConfirmation({
      commitmentId,
      partnerRef: 'partner-escrow-7781',
      confirmedBy: reviewerId,
      note: 'Partner confirmed by phone.',
    });
    expect(result.status).toBe('confirmed');
    expect(result.partnerRef).toBe('partner-escrow-7781');
    expect(result.confirmedBy).toBe(reviewerId);
    expect(result.amountCents).toBe(10000);
    const { rows } = await pool.query(
      `SELECT status, partner_ref, note FROM investment_settlements WHERE commitment_id = $1 AND kind = 'escrow_expectation'`,
      [commitmentId]
    );
    expect(rows[0].status).toBe('confirmed');
    expect(rows[0].partner_ref).toBe('partner-escrow-7781');
    expect(rows[0].note).toBe('Partner confirmed by phone.');
  });

  test('a second confirmation is refused: nothing is pending', async () => {
    let caught = null;
    try {
      await recordPartnerEscrowConfirmation({
        commitmentId, partnerRef: 'partner-escrow-7782', confirmedBy: reviewerId,
      });
    } catch (err) { caught = err; }
    expect(caught).toBeTruthy();
    expect(caught.code).toBe('invest_escrow_nothing_pending');
  });

  test('a partner reference and a reviewer are both required', async () => {
    await expect(recordPartnerEscrowConfirmation({
      commitmentId, partnerRef: '   ', confirmedBy: reviewerId,
    })).rejects.toMatchObject({ code: 'invest_escrow_partner_ref_required' });
    await expect(recordPartnerEscrowConfirmation({
      commitmentId, partnerRef: 'partner-escrow-7783', confirmedBy: null,
    })).rejects.toMatchObject({ code: 'invest_escrow_actor_required' });
  });
});
