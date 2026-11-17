'use strict';

/**
 * Participation lifecycle helpers: opportunities, agreement versions,
 * and participation applications.
 *
 * These are the minimal server-side lifecycle operations Track 2 builds
 * routes and UI on. They do not move money and they do not grant
 * participation by themselves: an approved application is a prerequisite
 * for a commitment, and the commitment path rechecks eligibility, flags,
 * and the exact agreement version again at commit time and at closing.
 *
 * Separation rules enforced here:
 * - Entity ownership alone cannot publish an opportunity: publish
 *   requires status `approved` (a platform review step), and only the
 *   entity representative may submit, never approve their own raise.
 * - A legacy `investor` mode or an investor.reporting grant grants
 *   nothing here; participation needs its own approved application.
 */

const crypto = require('crypto');
const AppError = require('../../utils/appError');
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { requireInvestEnabled } = require('./flags');

function fail(message, code, status = 400) {
  throw new AppError(message, status, code);
}

const OPPORTUNITY_TRANSITIONS = Object.freeze({
  draft: ['submitted', 'cancelled', 'withdrawn'],
  submitted: ['under_review', 'cancelled', 'withdrawn'],
  under_review: ['approved', 'submitted', 'cancelled', 'withdrawn'],
  approved: ['published', 'cancelled', 'withdrawn'],
  published: ['paused', 'closing', 'cancelled'],
  paused: ['published', 'cancelled'],
  closing: ['closed', 'cancelled'],
  closed: [],
  cancelled: [],
  withdrawn: [],
});

function formatOpportunity(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    businessId: Number(row.business_id),
    createdBy: String(row.created_by),
    title: row.title,
    purpose: row.purpose,
    targetCents: Number(row.target_cents || 0),
    minimumCents: Number(row.minimum_cents || 0),
    deadlineAt: row.deadline_at || null,
    status: row.status,
    structure: row.structure,
    countryCode: row.country_code,
    valuationRule: row.valuation_rule || null,
    useOfProceeds: row.use_of_proceeds || null,
    intermediaryRef: row.intermediary_ref || null,
    currentAgreementVersionId: row.current_agreement_version_id ? String(row.current_agreement_version_id) : null,
    closingConditions: row.closing_conditions || [],
    closingConditionsApprovedAt: row.closing_conditions_approved_at || null,
    closedAt: row.closed_at || null,
    details: row.details || {},
    verificationSummary: row.verification_summary || {},
    verifiedAt: row.verified_at || null,
    verifiedBy: row.verified_by ? String(row.verified_by) : null,
    publishedAt: row.published_at || null,
    expectedVersion: Number(row.expected_version || 1),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function formatApplication(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    opportunityId: String(row.opportunity_id),
    status: row.status,
    identityVerified: !!row.identity_verified,
    authorityVerified: !!row.authority_verified,
    eligibility: row.eligibility || {},
    agreementVersionId: row.agreement_version_id ? String(row.agreement_version_id) : null,
    agreementAcceptedAt: row.agreement_accepted_at || null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at || null,
    reviewNote: row.review_note || null,
    idempotencyKey: row.idempotency_key,
    expectedVersion: Number(row.expected_version || 1),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function createOpportunity(input, dbPool = pool) {
  const {
    businessId, createdBy, title, purpose, targetCents, minimumCents = 0,
    deadlineAt, valuationRule = null, useOfProceeds = null, intermediaryRef = null,
    details = {},
  } = input || {};
  if (!businessId) fail('businessId is required for an opportunity', 'invest_opportunity_business_required');
  if (!createdBy) fail('createdBy is required for an opportunity', 'invest_opportunity_creator_required');
  if (!title || !String(title).trim()) fail('An opportunity title is required', 'invest_opportunity_title_required');
  if (!purpose || !String(purpose).trim()) fail('An opportunity purpose is required', 'invest_opportunity_purpose_required');
  if (details !== null && (typeof details !== 'object' || Array.isArray(details))) {
    fail('Opportunity details must be an object', 'invest_opportunity_details_invalid');
  }
  const target = Number(targetCents);
  if (!Number.isSafeInteger(target) || target <= 0) fail('targetCents must be a positive integer number of cents', 'invest_opportunity_target_invalid');
  const minimum = Number(minimumCents || 0);
  if (!Number.isSafeInteger(minimum) || minimum < 0 || minimum > target) fail('minimumCents must be between zero and the target', 'invest_opportunity_minimum_invalid');
  const deadline = new Date(deadlineAt);
  if (Number.isNaN(deadline.getTime()) || deadline <= new Date()) fail('deadlineAt must be a future date', 'invest_opportunity_deadline_invalid');
  return withTransaction(dbPool, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO investment_opportunities
         (business_id, created_by, title, purpose, target_cents, minimum_cents,
          deadline_at, valuation_rule, use_of_proceeds, intermediary_ref, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING *`,
      [businessId, createdBy, String(title).trim(), String(purpose).trim(), target, minimum,
        deadline.toISOString(), valuationRule, useOfProceeds, intermediaryRef, JSON.stringify(details || {})],
    );
    return formatOpportunity(rows[0]);
  }, 'invest_create_opportunity');
}

async function getOpportunity(opportunityId, dbPool = pool) {
  const { rows } = await dbPool.query(
    `SELECT * FROM investment_opportunities WHERE id = $1`, [opportunityId],
  );
  return formatOpportunity(rows[0]);
}

async function createAgreementVersion(input, dbPool = pool) {
  const { opportunityId, body, createdBy = null } = input || {};
  if (!opportunityId) fail('opportunityId is required for an agreement version', 'invest_agreement_opportunity_required');
  if (!body || !String(body).trim()) fail('Agreement body is required', 'invest_agreement_body_required');
  const text = String(body);
  const contentHash = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  return withTransaction(dbPool, async (client) => {
    const { rows: oppRows } = await client.query(
      `SELECT * FROM investment_opportunities WHERE id = $1 FOR UPDATE`, [opportunityId],
    );
    const opportunity = oppRows[0];
    if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
    if (['closed', 'cancelled', 'withdrawn'].includes(opportunity.status)) {
      fail('Agreement versions cannot be added to a finished opportunity', 'invest_agreement_opportunity_finished', 409);
    }
    const { rows: maxRows } = await client.query(
      `SELECT COALESCE(MAX(version_number), 0)::bigint AS max_version
         FROM investment_agreement_versions WHERE opportunity_id = $1`,
      [opportunityId],
    );
    const versionNumber = Number(maxRows[0].max_version || 0) + 1;
    const { rows } = await client.query(
      `INSERT INTO investment_agreement_versions
         (opportunity_id, version_number, content_hash, body, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [opportunityId, versionNumber, contentHash, text, createdBy || null],
    );
    await client.query(
      `UPDATE investment_opportunities
          SET current_agreement_version_id = $2, updated_at = NOW()
        WHERE id = $1`,
      [opportunityId, rows[0].id],
    );
    return {
      id: String(rows[0].id),
      opportunityId: String(rows[0].opportunity_id),
      versionNumber: Number(rows[0].version_number),
      contentHash: rows[0].content_hash,
      createdAt: rows[0].created_at || null,
    };
  }, 'invest_create_agreement_version');
}

async function setOpportunityStatus(input, dbPool = pool) {
  const { opportunityId, status, actorUserId = null, expectedVersion = null, reason = null } = input || {};
  return withTransaction(dbPool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM investment_opportunities WHERE id = $1 FOR UPDATE`, [opportunityId],
    );
    const opportunity = rows[0];
    if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
    const allowed = OPPORTUNITY_TRANSITIONS[opportunity.status] || [];
    if (!allowed.includes(status)) {
      fail(`Opportunity cannot move from ${opportunity.status} to ${status}`, 'invest_opportunity_transition_invalid', 409);
    }
    if (expectedVersion !== null && Number(opportunity.expected_version) !== Number(expectedVersion)) {
      fail('Opportunity changed since it was read; reload and retry', 'invest_opportunity_version_conflict', 409);
    }
    if (status === 'published' && !opportunity.current_agreement_version_id) {
      fail('An opportunity cannot publish without an agreement version', 'invest_opportunity_no_agreement', 409);
    }
    if (status === 'published' && opportunity.status !== 'approved') {
      fail('Only an approved opportunity can publish', 'invest_opportunity_publish_requires_approval', 409);
    }
    const { rows: updated } = await client.query(
      `UPDATE investment_opportunities
          SET status = $2::text,
              published_at = CASE WHEN $2::text = 'published' THEN NOW() ELSE published_at END,
              expected_version = expected_version + 1,
              updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [opportunityId, status],
    );
    if (status === 'cancelled') {
      await client.query(
        `UPDATE investment_opportunities
            SET cancelled_at = NOW(), cancellation_reason = $2::text
          WHERE id = $1`,
        [opportunityId, reason || null],
      );
      const { rows: refreshed } = await client.query(
        `SELECT * FROM investment_opportunities WHERE id = $1`, [opportunityId],
      );
      return formatOpportunity(refreshed[0]);
    }
    return formatOpportunity(updated[0]);
  }, 'invest_set_opportunity_status');
}

async function createParticipationApplication(input, dbPool = pool) {
  const { userId, opportunityId, agreementVersionId, idempotencyKey } = input || {};
  if (!userId) fail('userId is required for a participation application', 'invest_application_user_required');
  if (!opportunityId) fail('opportunityId is required for a participation application', 'invest_application_opportunity_required');
  if (!idempotencyKey) fail('idempotencyKey is required for a participation application', 'invest_application_idempotency_required');
  requireInvestEnabled(userId);
  return withTransaction(dbPool, async (client) => {
    const { rows: existing } = await client.query(
      `SELECT * FROM investment_participation_applications WHERE idempotency_key = $1`,
      [String(idempotencyKey).slice(0, 160)],
    );
    if (existing[0]) {
      if (String(existing[0].user_id) !== String(userId) || String(existing[0].opportunity_id) !== String(opportunityId)) {
        fail('Idempotency key was already used for a different application', 'invest_application_idempotency_conflict', 409);
      }
      return { application: formatApplication(existing[0]), replayed: true };
    }
    const { rows: oppRows } = await client.query(
      `SELECT * FROM investment_opportunities WHERE id = $1 FOR UPDATE`, [opportunityId],
    );
    const opportunity = oppRows[0];
    if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
    if (opportunity.status !== 'published') {
      fail('Applications are only accepted for published opportunities', 'invest_application_opportunity_not_published', 409);
    }
    if (agreementVersionId && String(opportunity.current_agreement_version_id) !== String(agreementVersionId)) {
      fail('The application must accept the opportunity current agreement version', 'invest_application_agreement_stale', 409);
    }
    const { rows } = await client.query(
      `INSERT INTO investment_participation_applications
         (user_id, opportunity_id, agreement_version_id, idempotency_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [userId, opportunityId, agreementVersionId || opportunity.current_agreement_version_id, String(idempotencyKey).slice(0, 160)],
    );
    if (!rows[0]) fail('Participation application could not be confirmed after an idempotent retry', 'invest_application_retry_required', 409);
    return { application: formatApplication(rows[0]), replayed: false };
  }, 'invest_create_application');
}

async function submitParticipationApplication({ applicationId, userId }, dbPool = pool) {
  return withTransaction(dbPool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM investment_participation_applications WHERE id = $1 FOR UPDATE`, [applicationId],
    );
    const application = rows[0];
    if (!application) fail('Participation application not found', 'invest_application_not_found', 404);
    if (String(application.user_id) !== String(userId)) fail('Only the applicant may submit this application', 'invest_application_not_owner', 403);
    // An application sent back for more information returns to submitted
    // the same way a draft does; otherwise needs_information would be a
    // dead end with no way to update or resubmit.
    if (!['draft', 'needs_information'].includes(application.status)) fail('Only a draft application, or one sent back for information, can be submitted', 'invest_application_submit_invalid', 409);
    const { rows: updated } = await client.query(
      `UPDATE investment_participation_applications
          SET status = 'submitted', expected_version = expected_version + 1, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [applicationId],
    );
    return formatApplication(updated[0]);
  }, 'invest_submit_application');
}

async function reviewParticipationApplication(input, dbPool = pool) {
  const { applicationId, reviewerUserId, decision, identityVerified, authorityVerified, reviewNote = null, expectedVersion = null } = input || {};
  if (!['approved', 'rejected'].includes(decision)) fail('Review decision must be approved or rejected', 'invest_application_decision_invalid');
  return withTransaction(dbPool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM investment_participation_applications WHERE id = $1 FOR UPDATE`, [applicationId],
    );
    const application = rows[0];
    if (!application) fail('Participation application not found', 'invest_application_not_found', 404);
    // AC-014 pattern: the expected-version check runs inside the same lock
    // as the decision, so a reviewer acting on a stale read cannot overwrite
    // a newer decision.
    if (expectedVersion !== null && Number(application.expected_version) !== Number(expectedVersion)) {
      fail('Application changed since it was read; reload and retry', 'invest_application_version_conflict', 409);
    }
    if (String(application.user_id) === String(reviewerUserId)) {
      fail('An applicant cannot review their own participation application', 'invest_application_self_review', 403);
    }
    if (!['submitted', 'under_review'].includes(application.status)) {
      fail('Only a submitted application can be reviewed', 'invest_application_review_invalid', 409);
    }
    if (decision === 'approved' && !(identityVerified && authorityVerified)) {
      fail('Approval requires identity and authority verification', 'invest_application_approval_verification_required', 409);
    }
    const { rows: updated } = await client.query(
      `UPDATE investment_participation_applications
          SET status = $2, identity_verified = $3, authority_verified = $4,
              reviewed_by = $5, reviewed_at = NOW(), review_note = $6,
              expected_version = expected_version + 1, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [applicationId, decision, !!identityVerified, !!authorityVerified, reviewerUserId, reviewNote],
    );
    return formatApplication(updated[0]);
  }, 'invest_review_application');
}

module.exports = {
  OPPORTUNITY_TRANSITIONS,
  formatOpportunity,
  formatApplication,
  createOpportunity,
  getOpportunity,
  createAgreementVersion,
  setOpportunityStatus,
  createParticipationApplication,
  submitParticipationApplication,
  reviewParticipationApplication,
};
