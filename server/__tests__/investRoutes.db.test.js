'use strict';

// OxSteed Invest Track 2: routes + controllers against the real migrated
// PostgreSQL (disposable credit_statement_test database). The router is
// mounted with its real middleware chain; only the external authentication
// boundaries are stubbed (authenticate and requireAdmin are replaced by
// reference with a header-driven fixture, exactly like
// investorRouteAccess.test.js). requirePermission runs for real against
// admin_permission_grants, so reviewer grants are exercised, not mocked.
// Credit lots are created directly (backfill-created lots): live top-up lot
// creation is blocked by the known top-up completion defect (Track 1
// carry-forward blocker), so no test depends on it.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CREDIT_GUARD_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS = String(50_000_000_000);
process.env.INVEST_ENABLED = 'true';
process.env.INVEST_COMMITMENTS_ENABLED = 'true';

const describeDatabase = database ? describe : describe.skip;

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const investRoutes = require('../routes/invest');
const { ensureAccount, postJournalTransaction } = require('../services/oxsteedCreditService');
const { createLot } = require('../services/invest/creditLots');
const {
  createOpportunity,
  createAgreementVersion,
  setOpportunityStatus,
} = require('../services/invest/participation');
const accessService = require('../services/access/accessService');

jest.setTimeout(180000);

test('invest route DB tests require an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('invest routes', () => {
  let adminId;
  let superAdminId;
  let reviewerId;
  let executorId;
  let entityOwnerId;
  let secondEntityOwnerId;
  let businessId;
  let secondBusinessId;
  let treasuryId;
  const createdUsers = [];

  function mountedApp() {
    // Replace only the external auth boundaries, by reference.
    for (const layer of investRoutes.stack) {
      if (!layer.route) continue;
      for (const stackLayer of layer.route.stack) {
        if (stackLayer.handle === authenticate) {
          stackLayer.handle = (_req, _res, next) => next();
        }
        if (stackLayer.handle === requireAdmin) {
          stackLayer.handle = (req, _res, next) => {
            req.isSuper = req.user && req.user.role === 'super_admin';
            return next();
          };
        }
      }
    }
    const app = express();
    app.use(express.json());
    app.use('/api/invest', (req, _res, next) => {
      req.user = {
        id: req.get('x-test-user') || 'missing-user',
        role: req.get('x-test-role') || 'customer',
        is_suspended: req.get('x-test-suspended') === '1',
      };
      next();
    });
    app.use('/api/invest', investRoutes);
    return app;
  }

  let app;
  const as = (userId, role = 'customer', extra = {}) => {
    const headers = { 'x-test-user': userId, 'x-test-role': role, ...extra };
    const call = (method, path) => {
      let req = request(app)[method](path);
      for (const [key, value] of Object.entries(headers)) req = req.set(key, value);
      return req;
    };
    return {
      get: (path) => call('get', path),
      post: (path, body = {}) => call('post', path).send(body),
      put: (path, body = {}) => call('put', path).send(body),
      patch: (path, body = {}) => call('patch', path).send(body),
      postKey: (path, key, body = {}) => call('post', path).set('Idempotency-Key', key).send(body),
    };
  };

  async function createUser(tag, role = 'customer') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, 'synthetic-unusable', 'Invest', $3, $4)`,
      [id, `invest-route-${tag}-${id}@example.invalid`, tag, role],
    );
    createdUsers.push(id);
    return id;
  }

  async function grantPermission(granteeId, permission) {
    await pool.query(
      `INSERT INTO admin_permission_grants (grantor_id, grantee_id, permissions, region_id, expires_at)
       VALUES ($1, $2, $3::jsonb, NULL, NOW() + INTERVAL '1 year')`,
      [superAdminId, granteeId, JSON.stringify([permission])],
    );
  }

  async function freshInvestor(fundsCents) {
    const userId = await createUser(`inv-${crypto.randomUUID().slice(0, 8)}`);
    let walletId;
    await withTransaction(pool, async (client) => {
      const wallet = await ensureAccount(client, { accountType: 'customer_wallet', customerId: userId, currencyCode: 'USD' });
      walletId = wallet.id;
    }, 'invest_route_setup_wallet');
    const { transaction } = await withTransaction(pool, async (client) => postJournalTransaction(client, {
      transactionType: 'funding',
      debitAccountId: treasuryId,
      creditAccountId: walletId,
      customerId: userId,
      amountCents: fundsCents,
      currencyCode: 'USD',
      idempotencyKey: `invest-route-fund-${crypto.randomUUID()}`,
      actorType: 'admin',
      actorUserId: adminId,
      reason: 'Invest route test funding',
      description: 'Invest route test funding',
      referenceType: 'test_funding',
      referenceId: crypto.randomUUID(),
      metadata: {},
    }), 'invest_route_fund');
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
    }), 'invest_route_lot');
    return { userId, walletId };
  }

  async function freshOpportunity(targetCents, ownerId = entityOwnerId, bizId = businessId) {
    const opportunity = await createOpportunity({
      businessId: bizId,
      createdBy: ownerId,
      title: `Raise ${targetCents}`,
      purpose: 'Test raise',
      targetCents,
      minimumCents: 0,
      deadlineAt: new Date('2027-06-01T00:00:00Z').toISOString(),
      valuationRule: 'Revenue share of 5 percent of monthly revenue.',
      useOfProceeds: 'Test use of proceeds.',
      details: { legalDetails: 'Delaware LLC.', risks: 'Loss of capital is possible.' },
    });
    const version = await createAgreementVersion({
      opportunityId: opportunity.id,
      body: 'Test investment agreement version 1. Revenue share only.',
      createdBy: ownerId,
    });
    for (const status of ['submitted', 'under_review', 'approved', 'published']) {
      await setOpportunityStatus({ opportunityId: opportunity.id, status });
    }
    return { opportunity, version };
  }

  async function freshDraftOpportunity(ownerId = entityOwnerId, bizId = businessId) {
    const opportunity = await createOpportunity({
      businessId: bizId,
      createdBy: ownerId,
      title: 'Draft raise',
      purpose: 'Draft purpose',
      targetCents: 10000,
      minimumCents: 0,
      deadlineAt: new Date('2027-06-01T00:00:00Z').toISOString(),
      details: { legalDetails: 'Delaware LLC.' },
    });
    const version = await createAgreementVersion({
      opportunityId: opportunity.id,
      body: 'Draft agreement version 1.',
      createdBy: ownerId,
    });
    return { opportunity, version };
  }

  async function approvedApplication(userId, opportunityId, agreementVersionId) {
    const create = await as(userId).postKey('/api/invest/applications', `invest-app-${crypto.randomUUID()}`, {
      opportunityId, agreementVersionId,
    });
    expect(create.status).toBe(201);
    const applicationId = create.body.application.id;
    const submit = await as(userId).post(`/api/invest/applications/${applicationId}/submit`);
    expect(submit.status).toBe(200);
    const review = await as(reviewerId, 'super_admin').post(`/api/invest/applications/${applicationId}/review`, {
      decision: 'approved', identityVerified: true, authorityVerified: true, expectedVersion: 2,
    });
    expect(review.status).toBe(200);
    expect(review.body.application.status).toBe('approved');
    return review.body.application;
  }

  beforeAll(async () => {
    app = mountedApp();
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', true, 'synthetic invest route test')
       ON CONFLICT (key) DO UPDATE SET is_enabled = true`,
    );
    adminId = await createUser('admin', 'admin');
    superAdminId = await createUser('superadmin', 'super_admin');
    reviewerId = await createUser('reviewer', 'super_admin');
    executorId = await createUser('executor', 'super_admin');
    entityOwnerId = await createUser('entity-owner');
    secondEntityOwnerId = await createUser('entity-owner-2');
    const { rows: businessRows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, business_type)
       VALUES ($1, 'Invest Test Entity', 'llc') RETURNING id`,
      [entityOwnerId],
    );
    businessId = businessRows[0].id;
    const { rows: secondRows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, business_type)
       VALUES ($1, 'Second Invest Entity', 'llc') RETURNING id`,
      [secondEntityOwnerId],
    );
    secondBusinessId = secondRows[0].id;
    await withTransaction(pool, async (client) => {
      const treasury = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: 'USD' });
      treasuryId = treasury.id;
    }, 'invest_route_setup_treasury');
  });

  afterAll(async () => {
    await pool.end();
  });

  test('flags off blocks mutating routes and the directory', async () => {
    const { userId } = await freshInvestor(10000);
    const { opportunity, version } = await freshOpportunity(10000);
    const previous = process.env.INVEST_ENABLED;
    process.env.INVEST_ENABLED = 'false';
    try {
      const directory = await as(userId).get('/api/invest/opportunities');
      expect(directory.status).toBe(503);
      expect(directory.body.code).toBe('invest_disabled');
      const application = await as(userId).postKey('/api/invest/applications', `invest-flag-${crypto.randomUUID()}`, {
        opportunityId: opportunity.id, agreementVersionId: version.id,
      });
      expect(application.status).toBe(503);
      expect(application.body.code).toBe('invest_disabled');
    } finally {
      process.env.INVEST_ENABLED = previous;
    }
    const { rows } = await pool.query(
      `SELECT id FROM investment_participation_applications WHERE user_id = $1 AND opportunity_id = $2`,
      [userId, opportunity.id],
    );
    expect(rows).toHaveLength(0);
  });

  test('flags off blocks commitments specifically', async () => {
    const { userId } = await freshInvestor(10000);
    const { opportunity, version } = await freshOpportunity(10000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    const previous = process.env.INVEST_COMMITMENTS_ENABLED;
    process.env.INVEST_COMMITMENTS_ENABLED = 'false';
    try {
      const commit = await as(userId).postKey(`/api/invest/opportunities/${opportunity.id}/commitments`, `invest-flag-${crypto.randomUUID()}`, {
        applicationId: application.id, amountCents: 5000, agreementVersionId: version.id, riskAcknowledged: true,
      });
      expect(commit.status).toBe(503);
      expect(commit.body.code).toBe('invest_commitments_disabled');
    } finally {
      process.env.INVEST_COMMITMENTS_ENABLED = previous;
    }
  });

  test('spec 1: applying does not block ordinary customer functionality', async () => {
    const { userId } = await freshInvestor(10000);
    const { opportunity, version } = await freshOpportunity(10000);
    const created = await as(userId).postKey('/api/invest/applications', `invest-apply-${crypto.randomUUID()}`, {
      opportunityId: opportunity.id, agreementVersionId: version.id,
    });
    expect(created.status).toBe(201);
    const customer = await accessService.can(userId, 'customer');
    expect(customer.allowed).toBe(true);
    const projection = await accessService.getProjection(userId);
    expect(projection.personal).toContain('customer');
    expect(projection.personal).not.toContain('investor.participate');
    expect(projection.invest.investEnabled).toBe(true);
    const mine = await as(userId).get('/api/invest/me');
    expect(mine.status).toBe(200);
    expect(mine.body.applications).toHaveLength(1);
  });

  test('spec 1b: a granted investor.participate appears in the access projection', async () => {
    const { userId } = await freshInvestor(10000);
    await pool.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version, granted_by)
       VALUES ($1, 'investor.participate', 'self', 'self', 'active', 'admin', 'invest-participate-policy-1', $2)`,
      [userId, superAdminId],
    );
    const projection = await accessService.getProjection(userId);
    expect(projection.personal).toContain('investor.participate');
    expect(projection.invest).toEqual(expect.objectContaining({ investEnabled: true, investCommitmentsEnabled: true }));
  });

  test('directory lists published opportunities only, neutral sort, no score', async () => {
    const { opportunity } = await freshOpportunity(12000);
    const { opportunity: draft } = await freshDraftOpportunity();
    const response = await as(entityOwnerId).get('/api/invest/opportunities?sort=closing_date');
    expect(response.status).toBe(200);
    expect(response.body.sort).toBe('closing_date');
    const ids = response.body.opportunities.map((row) => row.id);
    expect(ids).toContain(opportunity.id);
    expect(ids).not.toContain(draft.id);
    expect(response.body.opportunities.every((row) => row.score === undefined && row.rank === undefined)).toBe(true);
    // Track 3: the directory card needs the entity identity, which the
    // opportunity row alone does not carry.
    const listed = response.body.opportunities.find((row) => row.id === opportunity.id);
    expect(listed.entityName).toBe('Invest Test Entity');
    expect(listed.entityActivity).toBe('llc');
    expect(listed.entityLocation).toBe(null);
    expect(listed.reservedCents).toBe(0);
    expect(listed.completedCents).toBe(0);
    expect(listed.investorCount).toBe(0);
  });

  test('detail answers the eight questions and never implies a guarantee', async () => {
    const { userId } = await freshInvestor(10000);
    const { opportunity } = await freshOpportunity(10000);
    const response = await as(userId).get(`/api/invest/opportunities/${opportunity.id}`);
    expect(response.status).toBe(200);
    expect(response.body.answers).toHaveLength(8);
    expect(response.body.answers.every((a) => a.question && a.answer && a.provenance)).toBe(true);
    expect(response.body.verification.status).toBe('not_verified');
    expect(JSON.stringify(response.body)).not.toMatch(/guarantee.*return|guaranteed return/i);
    expect(response.body.funding.reservedCents).toBe(0);
  });

  test('spec 2: entity ownership alone cannot publish', async () => {
    const { opportunity } = await freshDraftOpportunity();
    await setOpportunityStatus({ opportunityId: opportunity.id, status: 'submitted' });
    await setOpportunityStatus({ opportunityId: opportunity.id, status: 'under_review' });
    await setOpportunityStatus({ opportunityId: opportunity.id, status: 'approved' });
    // The owner has no review permission: requirePermission refuses first.
    const ownerPublish = await as(entityOwnerId).post(`/api/invest/opportunities/${opportunity.id}/publish`, {});
    expect(ownerPublish.status).toBe(403);
    // A reviewer may publish only an approved opportunity: unapproved fails.
    const { opportunity: draft2 } = await freshDraftOpportunity();
    const earlyPublish = await as(reviewerId, 'super_admin').post(`/api/invest/opportunities/${draft2.id}/publish`, {});
    expect(earlyPublish.status).toBe(409);
    // Approved opportunity publishes.
    const published = await as(reviewerId, 'super_admin').post(`/api/invest/opportunities/${opportunity.id}/publish`, {});
    expect(published.status).toBe(200);
    expect(published.body.opportunity.status).toBe('published');
    expect(published.body.opportunity.publishedAt).not.toBeNull();
  });

  test('opportunity review records what was verified; decline sends it back', async () => {
    const { opportunity } = await freshDraftOpportunity();
    await as(entityOwnerId).post(`/api/invest/opportunities/${opportunity.id}/submit-for-review`, {});
    const claimed = await as(reviewerId, 'super_admin').post(`/api/invest/opportunities/${opportunity.id}/review`, {
      action: 'claim', expectedVersion: 2,
    });
    expect(claimed.status).toBe(200);
    expect(claimed.body.opportunity.status).toBe('under_review');
    const approved = await as(reviewerId, 'super_admin').post(`/api/invest/opportunities/${opportunity.id}/review`, {
      action: 'approve', expectedVersion: 3,
      verificationSummary: { verifiedItems: ['formation documents', 'revenue share terms'] },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.opportunity.status).toBe('approved');
    const detail = await as(entityOwnerId).get(`/api/invest/opportunities/${opportunity.id}`);
    expect(detail.body.verification.status).toBe('verified_items');
    expect(detail.body.verification.verifiedItems).toEqual(['formation documents', 'revenue share terms']);
    expect(detail.body.verification.note).toMatch(/not a guarantee/i);
  });

  test('entity draft edit, submit does not publish, and published edits need an amendment', async () => {
    const { opportunity } = await freshDraftOpportunity();
    const edited = await as(entityOwnerId).put(`/api/invest/opportunities/${opportunity.id}`, {
      title: 'Draft raise, edited', expectedVersion: 1,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.opportunity.title).toBe('Draft raise, edited');
    const submitted = await as(entityOwnerId).post(`/api/invest/opportunities/${opportunity.id}/submit-for-review`, {});
    expect(submitted.status).toBe(200);
    expect(submitted.body.opportunity.status).toBe('submitted');
    expect(submitted.body.published).toBe(false);
    const { opportunity: published } = await freshOpportunity(10000);
    const blocked = await as(entityOwnerId).put(`/api/invest/opportunities/${published.id}`, {
      title: 'Changed after publish', expectedVersion: 5,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('invest_opportunity_amendment_required');
  });

  test('application lifecycle: sections, needs information, resubmit, withdraw', async () => {
    const { userId } = await freshInvestor(10000);
    const { opportunity, version } = await freshOpportunity(10000);
    const created = await as(userId).postKey('/api/invest/applications', `invest-life-${crypto.randomUUID()}`, {
      opportunityId: opportunity.id, agreementVersionId: version.id,
    });
    expect(created.status).toBe(201);
    const applicationId = created.body.application.id;
    const patched = await as(userId).patch(`/api/invest/applications/${applicationId}`, {
      eligibility: { usResident: true, accredited: false },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.application.eligibility).toEqual({ usResident: true, accredited: false });
    const accepted = await as(userId).post(`/api/invest/applications/${applicationId}/accept-agreement`, {});
    expect(accepted.status).toBe(200);
    expect(accepted.body.application.agreementVersionId).toBe(version.id);
    const submitted = await as(userId).post(`/api/invest/applications/${applicationId}/submit`, {});
    expect(submitted.status).toBe(200);
    const needsInfo = await as(reviewerId, 'super_admin').post(`/api/invest/applications/${applicationId}/review`, {
      decision: 'needs_information', reviewNote: 'Please confirm your mailing address.', expectedVersion: 4,
    });
    expect(needsInfo.status).toBe(200);
    expect(needsInfo.body.application.status).toBe('needs_information');
    const updated = await as(userId).patch(`/api/invest/applications/${applicationId}`, {
      eligibility: { usResident: true, accredited: false, addressConfirmed: true },
    });
    expect(updated.status).toBe(200);
    const resubmitted = await as(userId).post(`/api/invest/applications/${applicationId}/submit`, {});
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.application.status).toBe('submitted');
    const withdrawn = await as(userId).post(`/api/invest/applications/${applicationId}/withdraw`, {});
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.application.status).toBe('withdrawn');
  });

  test('reviewer cannot review their own application, and approval needs verification', async () => {
    const reviewerApplicantId = await createUser('reviewer-applicant', 'super_admin');
    const { opportunity, version } = await freshOpportunity(10000);
    const created = await as(reviewerApplicantId, 'super_admin').postKey('/api/invest/applications', `invest-self-${crypto.randomUUID()}`, {
      opportunityId: opportunity.id, agreementVersionId: version.id,
    });
    expect(created.status).toBe(201);
    const applicationId = created.body.application.id;
    await as(reviewerApplicantId, 'super_admin').post(`/api/invest/applications/${applicationId}/submit`, {});
    const selfReview = await as(reviewerApplicantId, 'super_admin').post(`/api/invest/applications/${applicationId}/review`, {
      decision: 'approved', identityVerified: true, authorityVerified: true,
    });
    expect(selfReview.status).toBe(403);
    expect(selfReview.body.code).toBe('invest_application_self_review');
    const unverified = await as(reviewerId, 'super_admin').post(`/api/invest/applications/${applicationId}/review`, {
      decision: 'approved', identityVerified: false, authorityVerified: true, expectedVersion: 2,
    });
    expect(unverified.status).toBe(409);
    expect(unverified.body.code).toBe('invest_application_approval_verification_required');
    const stale = await as(reviewerId, 'super_admin').post(`/api/invest/applications/${applicationId}/review`, {
      decision: 'approved', identityVerified: true, authorityVerified: true, expectedVersion: 99,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('invest_application_version_conflict');
  });

  test('spec 6 and 5: commit records the exact agreement version and is idempotent', async () => {
    const { userId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(15000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    const key = `invest-commit-${crypto.randomUUID()}`;
    const first = await as(userId).postKey(`/api/invest/opportunities/${opportunity.id}/commitments`, key, {
      applicationId: application.id, amountCents: 8000, agreementVersionId: version.id, riskAcknowledged: true,
    });
    expect(first.status).toBe(201);
    expect(first.body.commitment.status).toBe('reserved');
    expect(first.body.commitment.agreementVersionId).toBe(version.id);
    expect(first.body.commitment.agreementVersionNumber).toBe(1);
    expect(first.body.review.amountCents).toBe(8000);
    expect(first.body.review.valuationRule).toMatch(/Revenue share/);
    expect(first.body.review.fees).toEqual([]);
    expect(first.body.review.agreementVersion.versionNumber).toBe(1);
    expect(first.body.review.agreementVersion.contentHash).toBeTruthy();
    expect(first.body.review.status).toBe('pending');
    expect(first.body.review.cancellationTerms).toMatch(/cancelled/i);
    const replay = await as(userId).postKey(`/api/invest/opportunities/${opportunity.id}/commitments`, key, {
      applicationId: application.id, amountCents: 8000, agreementVersionId: version.id, riskAcknowledged: true,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.commitment.id).toBe(first.body.commitment.id);
    const { rows } = await pool.query(
      `SELECT id FROM investment_commitments WHERE user_id = $1 AND opportunity_id = $2`,
      [userId, opportunity.id],
    );
    expect(rows).toHaveLength(1);
    const noKey = await as(userId).post(`/api/invest/opportunities/${opportunity.id}/commitments`, {
      applicationId: application.id, amountCents: 1000, agreementVersionId: version.id, riskAcknowledged: true,
    });
    expect(noKey.status).toBe(400);
    expect(noKey.body.code).toBe('invest_idempotency_required');
    const noRisk = await as(userId).postKey(`/api/invest/opportunities/${opportunity.id}/commitments`, `invest-risk-${crypto.randomUUID()}`, {
      applicationId: application.id, amountCents: 1000, agreementVersionId: version.id,
    });
    expect(noRisk.status).toBe(400);
    expect(noRisk.body.code).toBe('invest_commitment_risk_acknowledgement_required');
  });

  test('spec 6b: a stale agreement version cannot commit', async () => {
    const { userId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(15000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    const version2 = await createAgreementVersion({
      opportunityId: opportunity.id, body: 'Test investment agreement version 2.', createdBy: entityOwnerId,
    });
    const stale = await as(userId).postKey(`/api/invest/opportunities/${opportunity.id}/commitments`, `invest-stale-${crypto.randomUUID()}`, {
      applicationId: application.id, amountCents: 5000, agreementVersionId: version.id, riskAcknowledged: true,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('invest_commitment_agreement_stale');
    expect(version2.versionNumber).toBe(2);
  });

  test('commit then cancel restores the reservation and lands in My investments', async () => {
    const { userId, walletId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(15000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    const committed = await as(userId).postKey(`/api/invest/opportunities/${opportunity.id}/commitments`, `invest-cancel-${crypto.randomUUID()}`, {
      applicationId: application.id, amountCents: 6000, agreementVersionId: version.id, riskAcknowledged: true,
    });
    expect(committed.status).toBe(201);
    const commitmentId = committed.body.commitment.id;
    const { rows: reservedRows } = await pool.query(
      `SELECT reserved_cents FROM oxsteed_credit_accounts WHERE id = $1`, [walletId],
    );
    expect(Number(reservedRows[0].reserved_cents)).toBe(6000);
    const cancelled = await as(userId).post(`/api/invest/commitments/${commitmentId}/cancel`, { reason: 'changed my mind' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.commitment.status).toBe('cancelled');
    const { rows: afterRows } = await pool.query(
      `SELECT reserved_cents FROM oxsteed_credit_accounts WHERE id = $1`, [walletId],
    );
    expect(Number(afterRows[0].reserved_cents)).toBe(0);
    const mine = await as(userId).get('/api/invest/me');
    expect(mine.body.cancelled).toHaveLength(1);
    expect(mine.body.pending).toHaveLength(0);
    expect(mine.body.distributions).toEqual([]);
  });

  test('spec 8: material change triggers amendment and reconfirmation', async () => {
    const { userId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(15000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    const committed = await as(userId).postKey(`/api/invest/opportunities/${opportunity.id}/commitments`, `invest-amend-${crypto.randomUUID()}`, {
      applicationId: application.id, amountCents: 5000, agreementVersionId: version.id, riskAcknowledged: true,
    });
    expect(committed.status).toBe(201);
    const version2 = await createAgreementVersion({
      opportunityId: opportunity.id, body: 'Test investment agreement version 2, amended terms.', createdBy: entityOwnerId,
    });
    const amendment = await as(entityOwnerId).post(`/api/invest/opportunities/${opportunity.id}/amendments`, {
      changes: { valuationRule: 'Revenue share of 7 percent of monthly revenue.' },
      newAgreementVersionId: version2.id,
    });
    expect(amendment.status).toBe(201);
    const proposed = await as(entityOwnerId).post(`/api/invest/opportunities/${opportunity.id}/amendments/${amendment.body.amendment.id}/propose`, {
      reconfirmationDeadlineAt: new Date('2027-01-01T00:00:00Z').toISOString(),
    });
    expect(proposed.status).toBe(200);
    expect(proposed.body.amendment.status).toBe('proposed');
    expect(proposed.body.amendment.noticeSentAt).not.toBeNull();
    const mine = await as(userId).get('/api/invest/me');
    expect(mine.body.reconfirmationRequired).toHaveLength(1);
    expect(mine.body.reconfirmationRequired[0].amendmentId).toBe(amendment.body.amendment.id);
    const reconfirmed = await as(userId).post(`/api/invest/opportunities/${opportunity.id}/amendments/${amendment.body.amendment.id}/reconfirm`, {});
    expect(reconfirmed.status).toBe(200);
    expect(reconfirmed.body.application.agreementVersionId).toBe(version2.id);
    expect(reconfirmed.body.reconfirmedCommitments).toHaveLength(1);
    const mineAfter = await as(userId).get('/api/invest/me');
    expect(mineAfter.body.reconfirmationRequired).toHaveLength(0);
    expect(mineAfter.body.pending[0].agreementVersionNumber).toBe(2);
  });

  test('spec 9 and 10: proceeds blocked pre-closing; cross-investor isolation', async () => {
    const { userId } = await freshInvestor(20000);
    const other = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(15000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    const committed = await as(userId).postKey(`/api/invest/opportunities/${opportunity.id}/commitments`, `invest-iso-${crypto.randomUUID()}`, {
      applicationId: application.id, amountCents: 5000, agreementVersionId: version.id, riskAcknowledged: true,
    });
    expect(committed.status).toBe(201);
    const commitmentId = committed.body.commitment.id;
    const blocked = await as(executorId, 'super_admin').post(`/api/invest/opportunities/${opportunity.id}/release-proceeds`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('invest_proceeds_blocked');
    const otherRead = await as(other.userId).get(`/api/invest/commitments/${commitmentId}`);
    expect(otherRead.status).toBe(404);
    const otherCancel = await as(other.userId).post(`/api/invest/commitments/${commitmentId}/cancel`, {});
    expect(otherCancel.status).toBe(403);
  });

  test('spec 10b: cross-entity isolation on drafts and documents', async () => {
    const { opportunity } = await freshDraftOpportunity(secondEntityOwnerId, secondBusinessId);
    const otherDraft = await as(entityOwnerId).get(`/api/invest/opportunities/${opportunity.id}`);
    expect(otherDraft.status).toBe(404);
    const { opportunity: published, version } = await freshOpportunity(10000);
    const { userId } = await freshInvestor(20000);
    const application = await approvedApplication(userId, published.id, version.id);
    const doc = await as(entityOwnerId).post(`/api/invest/opportunities/${published.id}/documents`, {
      title: 'Confidential financials', storageRef: 'invest/docs/financials-1', visibility: 'committed',
    });
    expect(doc.status).toBe(201);
    const documentId = doc.body.document.id;
    // Applicant without a commitment cannot read a committed document.
    const denied = await as(userId).get(`/api/invest/documents/${documentId}`);
    expect(denied.status).toBe(404);
    const stranger = await freshInvestor(10000);
    const strangerList = await as(stranger.userId).get(`/api/invest/opportunities/${published.id}/documents`);
    expect(strangerList.status).toBe(200);
    expect(strangerList.body.documents).toHaveLength(0);
    // After committing, the same investor can read it.
    await as(userId).postKey(`/api/invest/opportunities/${published.id}/commitments`, `invest-doc-${crypto.randomUUID()}`, {
      applicationId: application.id, amountCents: 5000, agreementVersionId: version.id, riskAcknowledged: true,
    });
    const allowed = await as(userId).get(`/api/invest/documents/${documentId}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.document.title).toBe('Confidential financials');
  });

  test('review queue is capability-scoped', async () => {
    const { userId } = await freshInvestor(10000);
    const { opportunity, version } = await freshOpportunity(10000);
    const created = await as(userId).postKey('/api/invest/applications', `invest-queue-${crypto.randomUUID()}`, {
      opportunityId: opportunity.id, agreementVersionId: version.id,
    });
    await as(userId).post(`/api/invest/applications/${created.body.application.id}/submit`, {});
    const queue = await as(reviewerId, 'super_admin').get('/api/invest/review-queue?type=applications');
    expect(queue.status).toBe(200);
    expect(queue.body.applications.some((row) => row.id === created.body.application.id)).toBe(true);
    const limitedReviewerId = await createUser('limited-reviewer', 'admin');
    await grantPermission(limitedReviewerId, 'review_invest_participation');
    const limited = await as(limitedReviewerId, 'admin').get('/api/invest/review-queue?type=applications');
    expect(limited.status).toBe(200);
    const forbidden = await as(limitedReviewerId, 'admin').get('/api/invest/review-queue?type=opportunities');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('invest_review_not_permitted');
    const noGrantsId = await createUser('no-grants', 'admin');
    const none = await as(noGrantsId, 'admin').get('/api/invest/review-queue');
    expect(none.status).toBe(403);
  });

  test('closing needs separate review and execution approvers, neither the entity rep', async () => {
    const { userId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(10000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    await as(userId).postKey(`/api/invest/opportunities/${opportunity.id}/commitments`, `invest-close-${crypto.randomUUID()}`, {
      applicationId: application.id, amountCents: 10000, agreementVersionId: version.id, riskAcknowledged: true,
    });
    // The entity representative cannot approve closing conditions, even as
    // a super-admin: the service refuses self-approval.
    const entityOwnerSuperId = await createUser('entity-super', 'super_admin');
    const { rows: thirdRows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, business_type)
       VALUES ($1, 'Third Invest Entity', 'llc') RETURNING id`,
      [entityOwnerSuperId],
    );
    const thirdOpportunity = await freshOpportunity(10000, entityOwnerSuperId, thirdRows[0].id);
    const selfConditions = await as(entityOwnerSuperId, 'super_admin')
      .post(`/api/invest/opportunities/${thirdOpportunity.opportunity.id}/closing-conditions/approve`, {});
    expect(selfConditions.status).toBe(403);
    expect(selfConditions.body.code).toBe('invest_close_self_approval');
    // Same approver for review and execution is refused.
    const conditions = await as(reviewerId, 'super_admin')
      .post(`/api/invest/opportunities/${opportunity.id}/closing-conditions/approve`, {});
    expect(conditions.status).toBe(200);
    const reviewApproval = await as(reviewerId, 'super_admin')
      .post(`/api/invest/opportunities/${opportunity.id}/closing-approvals`, { stage: 'review', decision: 'approved' });
    expect(reviewApproval.status).toBe(200);
    const sameApprover = await as(reviewerId, 'super_admin')
      .post(`/api/invest/opportunities/${opportunity.id}/closing-approvals`, { stage: 'execution', decision: 'approved' });
    expect(sameApprover.status).toBe(403);
    expect(sameApprover.body.code).toBe('invest_close_same_approver');
    const executionApproval = await as(executorId, 'super_admin')
      .post(`/api/invest/opportunities/${opportunity.id}/closing-approvals`, { stage: 'execution', decision: 'approved' });
    expect(executionApproval.status).toBe(200);
    const wrongExecutor = await as(reviewerId, 'super_admin')
      .post(`/api/invest/opportunities/${opportunity.id}/close`, {});
    expect(wrongExecutor.status).toBe(403);
    expect(wrongExecutor.body.code).toBe('invest_close_executor_mismatch');
    const closed = await as(executorId, 'super_admin')
      .post(`/api/invest/opportunities/${opportunity.id}/close`, {});
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('closed');
    expect(closed.body.positions).toHaveLength(1);
    const released = await as(executorId, 'super_admin')
      .post(`/api/invest/opportunities/${opportunity.id}/release-proceeds`, {});
    expect(released.status).toBe(200);
    expect(released.body.status).toBe('released');
    const positionId = closed.body.positions[0].id;
    const distributed = await as(executorId, 'super_admin')
      .postKey(`/api/invest/opportunities/${opportunity.id}/distributions`, `invest-dist-${crypto.randomUUID()}`, {
        positionId, userId, amountCents: 500,
      });
    expect(distributed.status).toBe(201);
    expect(distributed.body.distribution.status).toBe('credited');
    const mine = await as(userId).get('/api/invest/me');
    expect(mine.body.completed).toHaveLength(1);
    expect(mine.body.distributions).toHaveLength(1);
    expect(mine.body.positions).toHaveLength(1);
  });

  test('Q and A and overdue updates', async () => {
    const { userId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(10000);
    await approvedApplication(userId, opportunity.id, version.id);
    const asked = await as(userId).post(`/api/invest/opportunities/${opportunity.id}/questions`, {
      question: 'What is the revenue share period?',
    });
    expect(asked.status).toBe(201);
    const answered = await as(entityOwnerId).post(`/api/invest/opportunities/${opportunity.id}/questions/${asked.body.question.id}/answer`, {
      answer: 'Five years from closing.',
    });
    expect(answered.status).toBe(200);
    expect(answered.body.question.status).toBe('answered');
    const created = await as(entityOwnerId).post(`/api/invest/opportunities/${opportunity.id}/updates`, {
      title: 'Q1 report', body: 'Report body.', dueAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    });
    expect(created.status).toBe(201);
    const listed = await as(userId).get(`/api/invest/opportunities/${opportunity.id}/updates`);
    expect(listed.status).toBe(200);
    expect(listed.body.updates).toHaveLength(1);
    expect(listed.body.updates[0].status).toBe('overdue');
    const published = await as(entityOwnerId).post(`/api/invest/opportunities/${opportunity.id}/updates/${created.body.update.id}/publish`, {});
    expect(published.status).toBe(200);
    expect(published.body.update.status).toBe('published');
  });

  test('support requests land on the existing support surface and are idempotent', async () => {
    const { userId } = await freshInvestor(10000);
    const { opportunity, version } = await freshOpportunity(10000);
    await approvedApplication(userId, opportunity.id, version.id);
    const key = crypto.randomUUID();
    const first = await as(userId).postKey('/api/invest/support-requests', key, {
      opportunityId: opportunity.id, category: 'complaint', details: 'I have a complaint about the offering documents.',
    });
    expect(first.status).toBe(201);
    expect(first.body.ticket.priority).toBe('high');
    expect(first.body.ticket.opportunityId).toBe(opportunity.id);
    const replay = await as(userId).postKey('/api/invest/support-requests', key, {
      opportunityId: opportunity.id, category: 'complaint', details: 'I have a complaint about the offering documents.',
    });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.ticket.ticketNumber).toBe(first.body.ticket.ticketNumber);
    const { rows } = await pool.query(
      `SELECT id FROM support_tickets WHERE user_id = $1 AND metadata ->> 'invest_support' = 'true'`,
      [userId],
    );
    expect(rows).toHaveLength(1);
    const mine = await as(userId).get('/api/invest/support-requests');
    expect(mine.body.tickets).toHaveLength(1);
    const me = await as(userId).get('/api/invest/me');
    expect(me.body.support).toHaveLength(1);
  });

  test('suspended account keeps a restricted read and cannot write', async () => {
    const { userId } = await freshInvestor(20000);
    const { opportunity, version } = await freshOpportunity(15000);
    const application = await approvedApplication(userId, opportunity.id, version.id);
    const committed = await as(userId).postKey(`/api/invest/opportunities/${opportunity.id}/commitments`, `invest-susp-${crypto.randomUUID()}`, {
      applicationId: application.id, amountCents: 5000, agreementVersionId: version.id, riskAcknowledged: true,
    });
    expect(committed.status).toBe(201);
    const suspended = { 'x-test-suspended': '1' };
    const write = await as(userId, 'customer', suspended)
      .post(`/api/invest/commitments/${committed.body.commitment.id}/cancel`, {});
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('invest_account_suspended');
    const read = await as(userId, 'customer', suspended).get('/api/invest/me');
    expect(read.status).toBe(200);
    expect(read.body.suspended).toBe(true);
    expect(read.body.restrictedRead).toBe(true);
    expect(read.body.pending).toHaveLength(1);
    expect(read.body.eligibleCreditCents).toBeUndefined();
  });
});
