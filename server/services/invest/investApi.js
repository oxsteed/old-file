'use strict';

/**
 * OxSteed Invest API domain operations (Track 2: authority matrix + routes).
 *
 * This module holds the non-money domain operations the invest routes call:
 * opportunity directory/detail, entity drafting and review, participation
 * application sections, Q and A, updates, amendments, documents, the
 * reviewer queue, My investments, and investment support requests. Money
 * movement stays in settlementService.js and creditLots.js; this module
 * never posts to the Credit ledger.
 *
 * Authority rules enforced here (never trust the client for these):
 * - Entity ownership alone cannot publish: publish requires status
 *   `approved` (a platform review step) and a reviewer holding
 *   review_invest_opportunity_publish who is not the entity representative.
 * - No self-approval anywhere: a reviewer cannot decide their own
 *   application, their own opportunity, or their own closing/proceeds.
 * - Document access is explicit per investor x opportunity (live
 *   application, commitment, or position), never a blanket capability.
 * - investor.reporting is never a shortcut: reporting access grants no
 *   participation, no document access, and no review authority here.
 * - Material changes to a published opportunity go through the controlled
 *   amendment process (notice + reconfirmation), never a direct edit.
 * - A suspended account keeps ownership, statements, and obligations:
 *   reads of the investor's own records stay available in restricted form
 *   and every write is refused (see investController suspension guard).
 */

const AppError = require('../../utils/appError');
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const {
  getOpportunity,
  createOpportunity,
  createAgreementVersion,
  setOpportunityStatus,
  formatOpportunity,
  reviewParticipationApplication,
} = require('./participation');
const { hasGlobalGrant } = require('../../middleware/adminAuth');
const { getEligibleBalance } = require('./creditLots');

function fail(message, code, status = 400) {
  throw new AppError(message, status, code);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

function requireUuid(value, code, message) {
  if (!isUuid(value)) fail(message || 'Invalid id', code || 'invest_id_invalid', 400);
  return value;
}

/** The stored application status `rejected` is presented as `declined`. */
function apiApplicationStatus(stored) {
  return stored === 'rejected' ? 'declined' : stored;
}

function formatApplicationApi(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    opportunityId: String(row.opportunity_id),
    status: apiApplicationStatus(row.status),
    identityVerified: !!row.identity_verified,
    authorityVerified: !!row.authority_verified,
    eligibility: row.eligibility || {},
    agreementVersionId: row.agreement_version_id ? String(row.agreement_version_id) : null,
    agreementAcceptedAt: row.agreement_accepted_at || null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at || null,
    reviewNote: row.review_note || null,
    expectedVersion: Number(row.expected_version || 1),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function formatOpportunityApi(row) {
  const base = formatOpportunity(row);
  if (!base) return null;
  return base;
}

async function isEntityRepresentative(client, userId, businessId) {
  const { rows } = await client.query(
    `SELECT 1 FROM businesses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
      UNION
     SELECT 1 FROM business_members
      WHERE business_id = $1 AND member_id = $2 AND status = 'active'
        AND role IN ('manager', 'representative')`,
    [businessId, userId],
  );
  return rows.length > 0;
}

async function requireEntityRepresentative(client, userId, businessId) {
  if (!(await isEntityRepresentative(client, userId, businessId))) {
    fail('Only the entity owner or an active entity representative may do this', 'invest_entity_authority_required', 403);
  }
}

async function loadOpportunityRow(client, opportunityId) {
  const { rows } = await client.query(
    `SELECT * FROM investment_opportunities WHERE id = $1`, [opportunityId],
  );
  if (!rows[0]) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  return rows[0];
}

async function hasLiveApplication(client, userId, opportunityId) {
  const { rows } = await client.query(
    `SELECT id, status FROM investment_participation_applications
      WHERE user_id = $1 AND opportunity_id = $2
        AND status IN ('draft', 'submitted', 'under_review', 'needs_information', 'approved')`,
    [userId, opportunityId],
  );
  return rows[0] || null;
}

async function hasCommitmentOrPosition(client, userId, opportunityId) {
  const { rows } = await client.query(
    `SELECT 1 FROM investment_commitments
      WHERE user_id = $1 AND opportunity_id = $2 AND status IN ('reserved', 'completed')
      UNION
     SELECT 1 FROM investment_positions
      WHERE user_id = $1 AND opportunity_id = $2 AND status = 'active'`,
    [userId, opportunityId],
  );
  return rows.length > 0;
}

async function hasInvestorRelationship(client, userId, opportunityId) {
  return !!(await hasLiveApplication(client, userId, opportunityId))
    || (await hasCommitmentOrPosition(client, userId, opportunityId));
}

/** Explicit per investor x opportunity document access. No blanket key. */
async function canAccessDocument(client, user, doc) {
  if (!user || !doc) return false;
  if (['admin', 'super_admin'].includes(user.role)) return true;
  const opportunity = await loadOpportunityRow(client, doc.opportunity_id);
  if (await isEntityRepresentative(client, user.id, opportunity.business_id)) return true;
  if (doc.visibility === 'public') return true;
  const application = await hasLiveApplication(client, user.id, doc.opportunity_id);
  if (doc.visibility === 'applicants' && application) return true;
  if (doc.visibility === 'committed' && (await hasCommitmentOrPosition(client, user.id, doc.opportunity_id))) return true;
  return false;
}

async function fundingTotals(client, opportunityId) {
  const { rows } = await client.query(
    `SELECT status, COALESCE(SUM(amount_cents), 0)::bigint AS total_cents,
            COUNT(*)::bigint AS count
       FROM investment_commitments WHERE opportunity_id = $1 GROUP BY status`,
    [opportunityId],
  );
  const totals = { reservedCents: 0, completedCents: 0, cancelledCents: 0, investorCount: 0 };
  for (const row of rows) {
    if (row.status === 'reserved') totals.reservedCents = Number(row.total_cents);
    if (row.status === 'completed') totals.completedCents = Number(row.total_cents);
    if (row.status === 'cancelled') totals.cancelledCents = Number(row.total_cents);
  }
  const { rows: countRows } = await client.query(
    `SELECT COUNT(DISTINCT user_id)::bigint AS n FROM investment_commitments
      WHERE opportunity_id = $1 AND status IN ('reserved', 'completed')`,
    [opportunityId],
  );
  totals.investorCount = Number(countRows[0].n || 0);
  return totals;
}

// ── Directory and detail ─────────────────────────────────────────────────

/**
 * Directory/detail need the entity name, activity, and location, but the
 * opportunity row only carries business_id. One batched lookup per read
 * attaches them; a missing business row leaves the fields null rather
 * than failing the read.
 */
async function enrichOpportunities(client, opportunities) {
  const ids = [...new Set(opportunities.map((o) => o.businessId).filter((id) => Number.isSafeInteger(id)))];
  if (!ids.length) return opportunities;
  const { rows } = await client.query(
    `SELECT id, business_name, business_type, address_city, address_state
       FROM businesses WHERE id = ANY($1::int[])`,
    [ids],
  );
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  return opportunities.map((o) => {
    const business = byId.get(Number(o.businessId));
    if (!business) return o;
    const location = [business.address_city, business.address_state].filter(Boolean).join(', ') || null;
    return {
      ...o,
      entityName: business.business_name || null,
      entityActivity: business.business_type || null,
      entityLocation: location,
    };
  });
}

const DIRECTORY_SORTS = Object.freeze({
  publication_date: 'published_at DESC NULLS LAST, created_at DESC',
  closing_date: 'deadline_at ASC',
});

/**
 * Neutral directory: published opportunities only, sorted by publication
 * date or closing date. No "best investment" score, no ranking, no
 * recommendation. Pending commitments are labeled commitments, never
 * completed funding.
 */
async function listOpportunities({ scope = 'published', userId = null, sort = 'publication_date' } = {}, dbPool = pool) {
  const orderBy = DIRECTORY_SORTS[sort] || DIRECTORY_SORTS.publication_date;
  if (scope === 'mine') {
    if (!userId) fail('userId is required for the entity opportunity list', 'invest_opportunity_user_required');
    const { rows } = await dbPool.query(
      `SELECT o.* FROM investment_opportunities o
        WHERE o.business_id IN (
          SELECT b.id FROM businesses b WHERE b.user_id = $1 AND b.deleted_at IS NULL
          UNION
          SELECT bm.business_id FROM business_members bm
           WHERE bm.member_id = $1 AND bm.status = 'active'
             AND bm.role IN ('manager', 'representative'))
        ORDER BY o.updated_at DESC`,
      [userId],
    );
    return attachFundingTotals(dbPool, await enrichOpportunities(dbPool, rows.map(formatOpportunityApi)));
  }
  const { rows } = await dbPool.query(
    `SELECT * FROM investment_opportunities WHERE status = 'published' ORDER BY ${orderBy}`,
    [],
  );
  return attachFundingTotals(dbPool, await enrichOpportunities(dbPool, rows.map(formatOpportunityApi)));
}

/**
 * Directory progress must be accurate: one grouped query attaches the
 * reserved (pending, never completed funding) and completed totals plus
 * the investor count to every listed opportunity.
 */
async function attachFundingTotals(client, opportunities) {
  if (!opportunities.length) return opportunities;
  const ids = opportunities.map((o) => o.id);
  const { rows } = await client.query(
    `SELECT opportunity_id, status, COALESCE(SUM(amount_cents), 0)::bigint AS total_cents,
            COUNT(DISTINCT user_id)::bigint AS investors
       FROM investment_commitments WHERE opportunity_id = ANY($1::uuid[])
      GROUP BY opportunity_id, status`,
    [ids],
  );
  const totals = new Map();
  for (const row of rows) {
    const key = String(row.opportunity_id);
    const entry = totals.get(key) || { reservedCents: 0, completedCents: 0, investorCount: 0 };
    if (row.status === 'reserved') entry.reservedCents = Number(row.total_cents);
    if (row.status === 'completed') entry.completedCents = Number(row.total_cents);
    entry.investorCount = Math.max(entry.investorCount, Number(row.investors || 0));
    totals.set(key, entry);
  }
  return opportunities.map((o) => ({ ...o, ...(totals.get(String(o.id)) || { reservedCents: 0, completedCents: 0, investorCount: 0 }) }));
}

/**
 * Opportunity detail: answers the eight spec questions, with provenance
 * kept explicit. Entity-provided material is labeled entity_provided;
 * funding totals are computed from the commitment records (checked);
 * the verification badge describes only what a reviewer recorded at
 * approval time and never implies a guarantee; nothing here is a forecast.
 */
async function getOpportunityDetail(user, opportunityId, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  const loaded = await getOpportunity(opportunityId, dbPool);
  if (!loaded) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  const [opportunity] = await enrichOpportunities(dbPool, [loaded]);
  const isReviewer = ['admin', 'super_admin'].includes(user.role);
  const isRep = await isEntityRepresentative(dbPool, user.id, opportunity.businessId);
  const isPublic = ['published', 'paused', 'closing', 'closed', 'cancelled'].includes(opportunity.status);
  if (!isPublic && !isReviewer && !isRep) {
    fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  }
  const totals = await fundingTotals(dbPool, opportunityId);
  const summary = opportunity.verificationSummary || {};
  const verifiedItems = Array.isArray(summary.verifiedItems) ? summary.verifiedItems : [];
  const verification = {
    status: verifiedItems.length > 0 ? 'verified_items' : 'not_verified',
    verifiedItems,
    note: verifiedItems.length > 0
      ? 'OxSteed reviewed the items listed. Verification of a document is not a guarantee of any return, and it does not mean the investment is safe.'
      : 'No part of this opportunity has been verified by OxSteed yet. Entity-provided material below is the entity own statement, not an OxSteed finding.',
    verifiedAt: opportunity.verifiedAt,
    verifiedBy: opportunity.verifiedBy,
  };
  const details = opportunity.details || {};
  const answers = [
    { question: 'What is this opportunity?', answer: opportunity.purpose, provenance: 'entity_provided' },
    { question: 'Who is raising?', answer: opportunity.entityName
      ? `${opportunity.entityName}${opportunity.entityLocation ? ` (${opportunity.entityLocation})` : ''}. Legal details: ${details.legalDetails || 'not provided'}. Ownership: ${details.ownership || 'not provided'}.`
      : `Entity business ${opportunity.businessId}. Legal details: ${details.legalDetails || 'not provided'}. Ownership: ${details.ownership || 'not provided'}.`, provenance: 'entity_provided' },
    { question: 'How much is being raised?', answer: `Target ${opportunity.targetCents} cents, minimum ${opportunity.minimumCents} cents. Reserved commitments so far: ${totals.reservedCents} cents from ${totals.investorCount} investors. Reserved commitments are pending, not completed funding.`, provenance: 'checked' },
    { question: 'What return is offered?', answer: opportunity.valuationRule || 'Revenue share. The exact rule is in the controlling agreement.', provenance: 'entity_provided' },
    { question: 'What will the funds be used for?', answer: opportunity.useOfProceeds || 'Not provided.', provenance: 'entity_provided' },
    { question: 'What are the risks?', answer: details.risks || 'Risks are listed in the controlling agreement. Investing involves risk, including possible loss of the amount committed. No return is guaranteed.', provenance: 'entity_provided' },
    { question: 'When does it close?', answer: `Deadline ${opportunity.deadlineAt}. Status: ${opportunity.status}. Closing is all-or-nothing: target, deadline, and approved closing conditions must all be met.`, provenance: 'checked' },
    { question: 'What agreement governs it?', answer: opportunity.currentAgreementVersionId
      ? `Agreement version ${opportunity.currentAgreementVersionId}. The exact version accepted at commit time governs the commitment.`
      : 'No agreement version has been published yet.', provenance: 'checked' },
  ];
  const { rows: docRows } = await dbPool.query(
    `SELECT * FROM investment_documents WHERE opportunity_id = $1 ORDER BY created_at DESC`,
    [opportunityId],
  );
  const documents = [];
  for (const doc of docRows) {
    if (await canAccessDocument(dbPool, user, doc)) {
      documents.push({
        id: String(doc.id),
        title: doc.title,
        visibility: doc.visibility,
        confidential: !!doc.confidential,
        storageRef: doc.storage_ref,
        createdAt: doc.created_at || null,
      });
    }
  }
  // Reviewer and entity-representative read-only state for the closing
  // workflow (Track 4 reviewer UI). Investors never receive these fields:
  // closing approvals name the approvers, and positions name investors.
  // The reviewer UI needs them to show which closing stage is approved,
  // who may execute the close, and which positions a distribution can
  // target; the server still enforces every rule on write.
  let closingApprovals;
  let positions;
  if (isReviewer || isRep) {
    const { rows: approvalRows } = await dbPool.query(
      `SELECT stage, approver_user_id, decision, note, decided_at
         FROM investment_closing_approvals WHERE opportunity_id = $1 ORDER BY decided_at ASC NULLS LAST`,
      [opportunityId],
    );
    closingApprovals = approvalRows.map((row) => ({
      stage: row.stage,
      approverUserId: String(row.approver_user_id),
      decision: row.decision,
      note: row.note || null,
      decidedAt: row.decided_at || null,
    }));
    const { rows: positionRows } = await dbPool.query(
      `SELECT id, user_id, commitment_id, amount_cents, currency_code, status, acquired_at
         FROM investment_positions WHERE opportunity_id = $1 ORDER BY acquired_at ASC`,
      [opportunityId],
    );
    positions = positionRows.map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      commitmentId: String(row.commitment_id),
      amountCents: Number(row.amount_cents),
      currencyCode: row.currency_code,
      status: row.status,
      acquiredAt: row.acquired_at || null,
    }));
  }
  return {
    opportunity,
    answers,
    verification,
    funding: { ...totals, targetCents: opportunity.targetCents, minimumCents: opportunity.minimumCents },
    documents,
    relatedParties: details.relatedParties || null,
    financials: details.financials || null,
    ...(closingApprovals !== undefined ? { closingApprovals, positions } : {}),
  };
}

// ── Entity drafting, review, publish ─────────────────────────────────────

const DETAIL_KEYS = Object.freeze(['legalDetails', 'financials', 'ownership', 'risks', 'relatedParties']);

function validateDetails(details) {
  if (details === undefined || details === null) return {};
  if (typeof details !== 'object' || Array.isArray(details)) {
    fail('Opportunity details must be an object', 'invest_opportunity_details_invalid');
  }
  const out = {};
  for (const key of Object.keys(details)) {
    if (!DETAIL_KEYS.includes(key)) fail(`Unknown opportunity detail: ${key}`, 'invest_opportunity_details_invalid');
    const value = details[key];
    if (typeof value !== 'string' && typeof value !== 'object') {
      fail(`Opportunity detail ${key} must be text or an object`, 'invest_opportunity_details_invalid');
    }
    if (typeof value === 'string' && value.length > 10000) {
      fail(`Opportunity detail ${key} is too long`, 'invest_opportunity_details_invalid');
    }
    out[key] = value;
  }
  return out;
}

async function createDraftOpportunity(userId, input, dbPool = pool) {
  const { businessId } = input || {};
  if (!businessId) fail('businessId is required for an opportunity', 'invest_opportunity_business_required');
  await requireEntityRepresentative(dbPool, userId, businessId);
  return createOpportunity({ ...input, createdBy: userId, details: validateDetails(input.details) }, dbPool);
}

async function updateDraftOpportunity(userId, opportunityId, input, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  const { expectedVersion = null } = input || {};
  return withTransaction(dbPool, async (client) => {
    const opportunity = await loadOpportunityRow(client, opportunityId);
    await requireEntityRepresentative(client, userId, opportunity.business_id);
    if (opportunity.status !== 'draft') {
      // Material changes to a non-draft opportunity go through the
      // controlled amendment process, never a direct edit.
      fail('Only a draft opportunity can be edited directly; use the amendment process for a published opportunity', 'invest_opportunity_amendment_required', 409);
    }
    if (expectedVersion !== null && Number(opportunity.expected_version) !== Number(expectedVersion)) {
      fail('Opportunity changed since it was read; reload and retry', 'invest_opportunity_version_conflict', 409);
    }
    const fields = {};
    if (input.title !== undefined) fields.title = String(input.title).trim();
    if (input.purpose !== undefined) fields.purpose = String(input.purpose).trim();
    if (input.targetCents !== undefined) fields.target_cents = Number(input.targetCents);
    if (input.minimumCents !== undefined) fields.minimum_cents = Number(input.minimumCents);
    if (input.deadlineAt !== undefined) fields.deadline_at = new Date(input.deadlineAt).toISOString();
    if (input.valuationRule !== undefined) fields.valuation_rule = input.valuationRule;
    if (input.useOfProceeds !== undefined) fields.use_of_proceeds = input.useOfProceeds;
    if (input.intermediaryRef !== undefined) fields.intermediary_ref = input.intermediaryRef;
    if (input.details !== undefined) fields.details = validateDetails(input.details);
    if (fields.title !== undefined && !fields.title) fail('An opportunity title is required', 'invest_opportunity_title_required');
    if (fields.purpose !== undefined && !fields.purpose) fail('An opportunity purpose is required', 'invest_opportunity_purpose_required');
    if (fields.target_cents !== undefined && (!Number.isSafeInteger(fields.target_cents) || fields.target_cents <= 0)) {
      fail('targetCents must be a positive integer number of cents', 'invest_opportunity_target_invalid');
    }
    if (fields.target_cents !== undefined || fields.minimum_cents !== undefined) {
      const target = fields.target_cents !== undefined ? fields.target_cents : Number(opportunity.target_cents);
      const minimum = fields.minimum_cents !== undefined ? fields.minimum_cents : Number(opportunity.minimum_cents);
      if (!Number.isSafeInteger(minimum) || minimum < 0 || minimum > target) {
        fail('minimumCents must be between zero and the target', 'invest_opportunity_minimum_invalid');
      }
    }
    if (fields.deadline_at !== undefined && (Number.isNaN(new Date(fields.deadline_at).getTime()) || new Date(fields.deadline_at) <= new Date())) {
      fail('deadlineAt must be a future date', 'invest_opportunity_deadline_invalid');
    }
    const sets = [];
    const params = [];
    for (const [column, value] of Object.entries(fields)) {
      params.push(value);
      sets.push(`${column} = $${params.length}${column === 'details' ? '::jsonb' : ''}`);
    }
    if (!sets.length) return formatOpportunityApi(opportunity);
    sets.push(`expected_version = expected_version + 1`, `updated_at = NOW()`);
    const { rows } = await client.query(
      `UPDATE investment_opportunities SET ${sets.join(', ')} WHERE id = $${params.length + 1} RETURNING *`,
      [...params.map((value) => (typeof value === 'object' && value !== null && !(value instanceof Date) ? JSON.stringify(value) : value)), opportunityId],
    );
    return formatOpportunityApi(rows[0]);
  }, 'invest_update_draft_opportunity');
}

async function submitOpportunityForReview(userId, opportunityId, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  const opportunity = await getOpportunity(opportunityId, dbPool);
  if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  await requireEntityRepresentative(dbPool, userId, opportunity.businessId);
  // Submission does NOT publish: draft moves to submitted for review.
  return setOpportunityStatus({ opportunityId, status: 'submitted' }, dbPool);
}

/**
 * Reviewer opportunity decision. claim moves submitted to under_review;
 * approve moves under_review to approved and records what was verified;
 * decline sends it back to submitted with a note. Publish is a separate
 * step under its own authority (investment_opportunity.publish).
 */
async function reviewOpportunity(input, dbPool = pool) {
  const { opportunityId, reviewerUserId, action, expectedVersion = null, note = null, verificationSummary = null } = input || {};
  if (!['claim', 'approve', 'decline'].includes(action)) {
    fail('Opportunity review action must be claim, approve, or decline', 'invest_opportunity_review_action_invalid');
  }
  return withTransaction(dbPool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM investment_opportunities WHERE id = $1 FOR UPDATE`, [opportunityId],
    );
    const opportunity = rows[0];
    if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
    if (String(opportunity.created_by) === String(reviewerUserId)) {
      fail('An entity representative cannot review their own opportunity', 'invest_opportunity_self_review', 403);
    }
    if (expectedVersion !== null && Number(opportunity.expected_version) !== Number(expectedVersion)) {
      fail('Opportunity changed since it was read; reload and retry', 'invest_opportunity_version_conflict', 409);
    }
    const target = action === 'claim' ? 'under_review' : action === 'approve' ? 'approved' : 'submitted';
    const allowed = { submitted: ['under_review'], under_review: ['approved', 'submitted'] };
    if (!(allowed[opportunity.status] || []).includes(target)) {
      fail(`Opportunity cannot move from ${opportunity.status} to ${target}`, 'invest_opportunity_transition_invalid', 409);
    }
    if (action === 'approve' && !opportunity.current_agreement_version_id) {
      fail('An opportunity cannot be approved without an agreement version', 'invest_opportunity_no_agreement', 409);
    }
    let verified = opportunity.verification_summary || {};
    if (action === 'approve' && verificationSummary !== null) {
      if (typeof verificationSummary !== 'object' || Array.isArray(verificationSummary)) {
        fail('verificationSummary must be an object', 'invest_opportunity_verification_invalid');
      }
      const items = Array.isArray(verificationSummary.verifiedItems) ? verificationSummary.verifiedItems : [];
      verified = { verifiedItems: items.map((item) => String(item)).slice(0, 20) };
    }
    if (action === 'decline' && note) {
      // There is no review-note column on opportunities; the decline note
      // is kept in verification_summary so the entity can read why the
      // opportunity was sent back. It is never presented as verification.
      verified = { reviewNote: String(note).slice(0, 2000) };
    }
    const { rows: updated } = await client.query(
      `UPDATE investment_opportunities
          SET status = $2::text,
              verification_summary = $3::jsonb,
              verified_at = CASE WHEN $2::text = 'approved' THEN NOW() ELSE verified_at END,
              verified_by = CASE WHEN $2::text = 'approved' THEN $4::uuid ELSE verified_by END,
              expected_version = expected_version + 1, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [opportunityId, target, JSON.stringify(verified), action === 'approve' ? reviewerUserId : null],
    );
    return formatOpportunityApi(updated[0]);
  }, 'invest_review_opportunity');
}

async function publishOpportunity(input, dbPool = pool) {
  const { opportunityId, reviewerUserId, expectedVersion = null } = input || {};
  return withTransaction(dbPool, async (client) => {
    const opportunity = await loadOpportunityRow(client, opportunityId);
    if (String(opportunity.created_by) === String(reviewerUserId)) {
      fail('An entity representative cannot publish their own opportunity', 'invest_opportunity_self_publish', 403);
    }
    if (expectedVersion !== null && Number(opportunity.expected_version) !== Number(expectedVersion)) {
      fail('Opportunity changed since it was read; reload and retry', 'invest_opportunity_version_conflict', 409);
    }
    // setOpportunityStatus enforces the approved-only publish rule and the
    // agreement-version requirement, and stamps published_at.
    return setOpportunityStatus({ opportunityId, status: 'published', expectedVersion }, dbPool);
  }, 'invest_publish_opportunity');
}

async function createOpportunityAgreementVersion(userId, opportunityId, body, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  const opportunity = await getOpportunity(opportunityId, dbPool);
  if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  await requireEntityRepresentative(dbPool, userId, opportunity.businessId);
  return createAgreementVersion({ opportunityId, body, createdBy: userId }, dbPool);
}

async function listAgreementVersions(user, opportunityId, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  const opportunity = await getOpportunity(opportunityId, dbPool);
  if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  const isReviewer = ['admin', 'super_admin'].includes(user.role);
  const isRep = await isEntityRepresentative(dbPool, user.id, opportunity.businessId);
  const related = await hasInvestorRelationship(dbPool, user.id, opportunityId);
  if (!isReviewer && !isRep && !related) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  const { rows } = await dbPool.query(
    `SELECT id, opportunity_id, version_number, content_hash, created_by, created_at
       FROM investment_agreement_versions WHERE opportunity_id = $1 ORDER BY version_number DESC`,
    [opportunityId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    opportunityId: String(row.opportunity_id),
    versionNumber: Number(row.version_number),
    contentHash: row.content_hash,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: row.created_at || null,
  }));
}

// ── Participation applications ───────────────────────────────────────────

async function listMyApplications(userId, dbPool = pool) {
  const { rows } = await dbPool.query(
    `SELECT * FROM investment_participation_applications WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(formatApplicationApi);
}

async function getApplicationForUser(user, applicationId, dbPool = pool) {
  requireUuid(applicationId, 'invest_application_id_invalid', 'Invalid application id');
  const { rows } = await dbPool.query(
    `SELECT * FROM investment_participation_applications WHERE id = $1`, [applicationId],
  );
  const application = rows[0];
  if (!application) fail('Participation application not found', 'invest_application_not_found', 404);
  const isReviewer = ['admin', 'super_admin'].includes(user.role);
  if (String(application.user_id) !== String(user.id) && !isReviewer) {
    fail('Participation application not found', 'invest_application_not_found', 404);
  }
  return formatApplicationApi(application);
}

/**
 * Update the applicant-kept sections of a draft application. Identity,
 * authority, eligibility, opportunity requirements, confidential-document
 * access, and agreement acceptance stay separate sections: this endpoint
 * only writes the eligibility section; identity/authority are reviewer
 * findings and agreement acceptance has its own endpoint.
 */
async function updateApplicationSections(userId, applicationId, input, dbPool = pool) {
  requireUuid(applicationId, 'invest_application_id_invalid', 'Invalid application id');
  return withTransaction(dbPool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM investment_participation_applications WHERE id = $1 FOR UPDATE`, [applicationId],
    );
    const application = rows[0];
    if (!application) fail('Participation application not found', 'invest_application_not_found', 404);
    if (String(application.user_id) !== String(userId)) {
      fail('Only the applicant may update this application', 'invest_application_not_owner', 403);
    }
    if (application.status !== 'draft' && application.status !== 'needs_information') {
      fail('Only a draft application, or one sent back for information, can be updated', 'invest_application_update_invalid', 409);
    }
    const eligibility = input.eligibility;
    if (eligibility !== undefined && (typeof eligibility !== 'object' || Array.isArray(eligibility) || eligibility === null)) {
      fail('eligibility must be an object', 'invest_application_eligibility_invalid');
    }
    const { rows: updated } = await client.query(
      `UPDATE investment_participation_applications
          SET eligibility = $2::jsonb, expected_version = expected_version + 1, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [applicationId, JSON.stringify(eligibility !== undefined ? eligibility : (application.eligibility || {}))],
    );
    return formatApplicationApi(updated[0]);
  }, 'invest_update_application_sections');
}

/** Agreement acceptance is its own step: accept the current version. */
async function acceptApplicationAgreement(userId, applicationId, dbPool = pool) {
  requireUuid(applicationId, 'invest_application_id_invalid', 'Invalid application id');
  return withTransaction(dbPool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM investment_participation_applications WHERE id = $1 FOR UPDATE`, [applicationId],
    );
    const application = rows[0];
    if (!application) fail('Participation application not found', 'invest_application_not_found', 404);
    if (String(application.user_id) !== String(userId)) {
      fail('Only the applicant may accept the agreement', 'invest_application_not_owner', 403);
    }
    if (!['draft', 'submitted', 'under_review', 'needs_information'].includes(application.status)) {
      fail('This application can no longer accept an agreement', 'invest_application_accept_invalid', 409);
    }
    const { rows: oppRows } = await client.query(
      `SELECT current_agreement_version_id FROM investment_opportunities WHERE id = $1`,
      [application.opportunity_id],
    );
    const currentVersionId = oppRows[0] && oppRows[0].current_agreement_version_id;
    if (!currentVersionId) fail('This opportunity has no agreement version yet', 'invest_agreement_not_found', 409);
    const { rows: updated } = await client.query(
      `UPDATE investment_participation_applications
          SET agreement_version_id = $2, agreement_accepted_at = NOW(),
              expected_version = expected_version + 1, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [applicationId, currentVersionId],
    );
    return formatApplicationApi(updated[0]);
  }, 'invest_accept_application_agreement');
}

async function withdrawApplication(userId, applicationId, dbPool = pool) {
  requireUuid(applicationId, 'invest_application_id_invalid', 'Invalid application id');
  return withTransaction(dbPool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM investment_participation_applications WHERE id = $1 FOR UPDATE`, [applicationId],
    );
    const application = rows[0];
    if (!application) fail('Participation application not found', 'invest_application_not_found', 404);
    if (String(application.user_id) !== String(userId)) {
      fail('Only the applicant may withdraw this application', 'invest_application_not_owner', 403);
    }
    if (!['draft', 'submitted', 'under_review', 'needs_information', 'approved'].includes(application.status)) {
      fail('This application can no longer be withdrawn', 'invest_application_withdraw_invalid', 409);
    }
    const { rows: live } = await client.query(
      `SELECT id FROM investment_commitments
        WHERE application_id = $1 AND status IN ('reserved', 'completed') LIMIT 1`,
      [applicationId],
    );
    if (live[0]) {
      fail('An application with a live commitment cannot be withdrawn; cancel the commitment first', 'invest_application_withdraw_blocked', 409);
    }
    const { rows: updated } = await client.query(
      `UPDATE investment_participation_applications
          SET status = 'withdrawn', expected_version = expected_version + 1, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [applicationId],
    );
    return formatApplicationApi(updated[0]);
  }, 'invest_withdraw_application');
}

/** Reviewer sends an application back for more information (AC-014 locked). */
async function requestApplicationInformation(input, dbPool = pool) {
  const { applicationId, reviewerUserId, reviewNote, expectedVersion = null } = input || {};
  if (!reviewNote || !String(reviewNote).trim()) {
    fail('Tell the applicant what to add', 'invest_application_information_required');
  }
  return withTransaction(dbPool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM investment_participation_applications WHERE id = $1 FOR UPDATE`, [applicationId],
    );
    const application = rows[0];
    if (!application) fail('Participation application not found', 'invest_application_not_found', 404);
    if (String(application.user_id) === String(reviewerUserId)) {
      fail('An applicant cannot review their own participation application', 'invest_application_self_review', 403);
    }
    if (expectedVersion !== null && Number(application.expected_version) !== Number(expectedVersion)) {
      fail('Application changed since it was read; reload and retry', 'invest_application_version_conflict', 409);
    }
    if (!['submitted', 'under_review'].includes(application.status)) {
      fail('Only a submitted application can be sent back for information', 'invest_application_review_invalid', 409);
    }
    const { rows: updated } = await client.query(
      `UPDATE investment_participation_applications
          SET status = 'needs_information', reviewed_by = $2, reviewed_at = NOW(),
              review_note = $3, expected_version = expected_version + 1, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [applicationId, reviewerUserId, String(reviewNote).trim()],
    );
    return formatApplicationApi(updated[0]);
  }, 'invest_request_application_information');
}

/** Reviewer approve/decline, with the locked expected-version check. */
async function reviewApplication(input, dbPool = pool) {
  const { applicationId, reviewerUserId, decision, identityVerified, authorityVerified, reviewNote = null, expectedVersion = null } = input || {};
  const storedDecision = decision === 'declined' ? 'rejected' : decision;
  const reviewed = await reviewParticipationApplication({
    applicationId, reviewerUserId, decision: storedDecision,
    identityVerified, authorityVerified, reviewNote, expectedVersion,
  }, dbPool);
  // reviewParticipationApplication returns the service (camelCase) shape;
  // only the status vocabulary differs at the API layer.
  return { ...reviewed, status: apiApplicationStatus(reviewed.status) };
}

// ── Reviewer queue ───────────────────────────────────────────────────────

const REVIEW_PERMISSIONS = Object.freeze({
  applications: 'review_invest_participation',
  opportunities: 'review_invest_opportunity_publish',
  closing: 'review_invest_close',
  proceeds: 'review_invest_release_proceeds',
});

/**
 * Capability-scoped review queue: a reviewer only sees the queues their
 * own review permission covers. Super-admins see all four.
 */
async function listReviewQueue(user, { type = null } = {}, dbPool = pool) {
  const isSuper = user.role === 'super_admin';
  const allowed = [];
  for (const [key, permission] of Object.entries(REVIEW_PERMISSIONS)) {
    if (isSuper) allowed.push(key);
    else if (user.role === 'admin' && (await hasGlobalGrant(user.id, permission))) allowed.push(key);
  }
  if (!allowed.length) fail('You cannot review investment applications.', 'invest_review_not_permitted', 403);
  const types = type ? [type] : allowed;
  for (const requested of types) {
    if (!REVIEW_PERMISSIONS[requested]) fail(`Unknown review queue type: ${requested}`, 'invest_review_queue_invalid');
    if (!allowed.includes(requested)) fail('You cannot review that queue.', 'invest_review_not_permitted', 403);
  }
  const queue = {};
  if (types.includes('applications')) {
    const { rows } = await dbPool.query(
      `SELECT a.*, o.title AS opportunity_title
         FROM investment_participation_applications a
         JOIN investment_opportunities o ON o.id = a.opportunity_id
        WHERE a.status IN ('submitted', 'under_review', 'needs_information')
        ORDER BY a.created_at ASC`,
    );
    queue.applications = rows.map((row) => ({ ...formatApplicationApi(row), opportunityTitle: row.opportunity_title }));
  }
  if (types.includes('opportunities')) {
    const { rows } = await dbPool.query(
      `SELECT * FROM investment_opportunities
        WHERE status IN ('submitted', 'under_review') ORDER BY created_at ASC`,
    );
    queue.opportunities = rows.map(formatOpportunityApi);
  }
  if (types.includes('closing')) {
    const { rows } = await dbPool.query(
      `SELECT o.* FROM investment_opportunities o
        WHERE o.status IN ('published', 'closing')
          AND NOT EXISTS (
            SELECT 1 FROM investment_closing_approvals ca
             WHERE ca.opportunity_id = o.id AND ca.stage = 'review' AND ca.decision = 'approved')
        ORDER BY o.deadline_at ASC`,
    );
    queue.closing = rows.map(formatOpportunityApi);
  }
  if (types.includes('proceeds')) {
    const { rows } = await dbPool.query(
      `SELECT p.*, o.title AS opportunity_title
         FROM investment_proceeds p
         JOIN investment_opportunities o ON o.id = p.opportunity_id
        WHERE p.status = 'awaiting_release' ORDER BY p.created_at ASC`,
    );
    queue.proceeds = rows.map((row) => ({
      id: String(row.id),
      opportunityId: String(row.opportunity_id),
      opportunityTitle: row.opportunity_title,
      amountCents: Number(row.amount_cents),
      currencyCode: row.currency_code,
      status: row.status,
      createdAt: row.created_at || null,
    }));
  }
  return { queues: types, ...queue };
}

// ── Q and A, updates, amendments, documents ──────────────────────────────

async function askQuestion(userId, opportunityId, question, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  if (!question || !String(question).trim() || String(question).length > 4000) {
    fail('A question of up to 4000 characters is required', 'invest_question_invalid');
  }
  const opportunity = await getOpportunity(opportunityId, dbPool);
  if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  if (opportunity.status !== 'published') fail('Questions are only accepted for published opportunities', 'invest_question_opportunity_not_published', 409);
  if (!(await hasInvestorRelationship(dbPool, userId, opportunityId))) {
    fail('Only an applicant or investor in this opportunity may ask a question', 'invest_question_relationship_required', 403);
  }
  const { rows } = await dbPool.query(
    `INSERT INTO investment_opportunity_questions (opportunity_id, user_id, question)
     VALUES ($1, $2, $3) RETURNING *`,
    [opportunityId, userId, String(question).trim()],
  );
  return formatQuestion(rows[0]);
}

function formatQuestion(row) {
  return {
    id: String(row.id),
    opportunityId: String(row.opportunity_id),
    userId: String(row.user_id),
    question: row.question,
    answer: row.answer || null,
    answeredBy: row.answered_by ? String(row.answered_by) : null,
    status: row.status,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function listQuestions(user, opportunityId, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  const opportunity = await getOpportunity(opportunityId, dbPool);
  if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  const isReviewer = ['admin', 'super_admin'].includes(user.role);
  const isRep = await isEntityRepresentative(dbPool, user.id, opportunity.businessId);
  const related = await hasInvestorRelationship(dbPool, user.id, opportunityId);
  if (!isReviewer && !isRep && !related) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  const { rows } = await dbPool.query(
    `SELECT * FROM investment_opportunity_questions WHERE opportunity_id = $1 ORDER BY created_at DESC`,
    [opportunityId],
  );
  return rows.map(formatQuestion);
}

async function answerQuestion(userId, opportunityId, questionId, answer, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  requireUuid(questionId, 'invest_question_id_invalid', 'Invalid question id');
  if (!answer || !String(answer).trim() || String(answer).length > 8000) {
    fail('An answer of up to 8000 characters is required', 'invest_answer_invalid');
  }
  const opportunity = await getOpportunity(opportunityId, dbPool);
  if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  await requireEntityRepresentative(dbPool, userId, opportunity.businessId);
  const { rows } = await dbPool.query(
    `UPDATE investment_opportunity_questions
        SET answer = $3, answered_by = $4, status = 'answered', updated_at = NOW()
      WHERE id = $1 AND opportunity_id = $2 AND status = 'open'
      RETURNING *`,
    [questionId, opportunityId, String(answer).trim(), userId],
  );
  if (!rows[0]) fail('Question not found or already answered', 'invest_question_not_found', 404);
  return formatQuestion(rows[0]);
}

function effectiveUpdateStatus(row) {
  if (row.status === 'published') return 'published';
  if (row.due_at && new Date(row.due_at) < new Date()) return 'overdue';
  return row.status;
}

function formatUpdate(row) {
  return {
    id: String(row.id),
    opportunityId: String(row.opportunity_id),
    title: row.title,
    body: row.body,
    status: effectiveUpdateStatus(row),
    storedStatus: row.status,
    dueAt: row.due_at || null,
    publishedAt: row.published_at || null,
    createdBy: String(row.created_by),
    createdAt: row.created_at || null,
  };
}

async function createUpdate(userId, opportunityId, input, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  const { title, body, dueAt = null } = input || {};
  if (!title || !String(title).trim()) fail('An update title is required', 'invest_update_title_required');
  if (!body || !String(body).trim()) fail('An update body is required', 'invest_update_body_required');
  const opportunity = await getOpportunity(opportunityId, dbPool);
  if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  await requireEntityRepresentative(dbPool, userId, opportunity.businessId);
  const { rows } = await dbPool.query(
    `INSERT INTO investment_opportunity_updates (opportunity_id, title, body, due_at, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [opportunityId, String(title).trim(), String(body).trim(), dueAt ? new Date(dueAt).toISOString() : null, userId],
  );
  return formatUpdate(rows[0]);
}

async function publishUpdate(userId, opportunityId, updateId, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  requireUuid(updateId, 'invest_update_id_invalid', 'Invalid update id');
  const opportunity = await getOpportunity(opportunityId, dbPool);
  if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  await requireEntityRepresentative(dbPool, userId, opportunity.businessId);
  const { rows } = await dbPool.query(
    `UPDATE investment_opportunity_updates
        SET status = 'published', published_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND opportunity_id = $2 AND status IN ('draft', 'overdue')
      RETURNING *`,
    [updateId, opportunityId],
  );
  if (!rows[0]) fail('Update not found or already published', 'invest_update_not_found', 404);
  return formatUpdate(rows[0]);
}

async function listUpdates(user, opportunityId, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  const opportunity = await getOpportunity(opportunityId, dbPool);
  if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  const isReviewer = ['admin', 'super_admin'].includes(user.role);
  const isRep = await isEntityRepresentative(dbPool, user.id, opportunity.businessId);
  const related = await hasInvestorRelationship(dbPool, user.id, opportunityId);
  if (!isReviewer && !isRep && !related) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  const { rows } = await dbPool.query(
    `SELECT * FROM investment_opportunity_updates WHERE opportunity_id = $1 ORDER BY due_at ASC NULLS LAST, created_at DESC`,
    [opportunityId],
  );
  // Missed updates surface as overdue and never disappear: the effective
  // status is computed on read from due_at, so a draft past its due date
  // reads overdue until it is published.
  return rows
    .filter((row) => isRep || isReviewer || row.status === 'published' || effectiveUpdateStatus(row) === 'overdue')
    .map(formatUpdate);
}

/**
 * Create a material-change amendment. The change enters the controlled
 * process: it is a draft until the entity proposes it, proposal sends
 * investor notice (notice_sent_at) with a reconfirmation deadline, and
 * investors must reconfirm against the new agreement version.
 */
async function createAmendment(userId, opportunityId, input, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  const { changes, newAgreementVersionId = null } = input || {};
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    fail('Amendment changes must be an object', 'invest_amendment_changes_invalid');
  }
  const opportunity = await getOpportunity(opportunityId, dbPool);
  if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  await requireEntityRepresentative(dbPool, userId, opportunity.businessId);
  if (['closed', 'cancelled', 'withdrawn'].includes(opportunity.status)) {
    fail('A finished opportunity cannot be amended', 'invest_amendment_opportunity_finished', 409);
  }
  if (newAgreementVersionId) {
    const { rows } = await dbPool.query(
      `SELECT id FROM investment_agreement_versions WHERE id = $1 AND opportunity_id = $2`,
      [newAgreementVersionId, opportunityId],
    );
    if (!rows[0]) fail('Agreement version not found for this opportunity', 'invest_agreement_not_found', 404);
  }
  const { rows } = await dbPool.query(
    `INSERT INTO investment_amendments
       (opportunity_id, changes, previous_agreement_version_id, new_agreement_version_id, created_by)
     VALUES ($1, $2::jsonb, $3, $4, $5) RETURNING *`,
    [opportunityId, JSON.stringify(changes), opportunity.currentAgreementVersionId, newAgreementVersionId, userId],
  );
  return formatAmendment(rows[0]);
}

function formatAmendment(row) {
  return {
    id: String(row.id),
    opportunityId: String(row.opportunity_id),
    status: row.status,
    changes: row.changes || {},
    previousAgreementVersionId: row.previous_agreement_version_id ? String(row.previous_agreement_version_id) : null,
    newAgreementVersionId: row.new_agreement_version_id ? String(row.new_agreement_version_id) : null,
    noticeSentAt: row.notice_sent_at || null,
    reconfirmationDeadlineAt: row.reconfirmation_deadline_at || null,
    createdBy: String(row.created_by),
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    expectedVersion: Number(row.expected_version || 1),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function proposeAmendment(userId, opportunityId, amendmentId, reconfirmationDeadlineAt, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  requireUuid(amendmentId, 'invest_amendment_id_invalid', 'Invalid amendment id');
  const deadline = new Date(reconfirmationDeadlineAt);
  if (Number.isNaN(deadline.getTime()) || deadline <= new Date()) {
    fail('reconfirmationDeadlineAt must be a future date', 'invest_amendment_deadline_invalid');
  }
  const opportunity = await getOpportunity(opportunityId, dbPool);
  if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  await requireEntityRepresentative(dbPool, userId, opportunity.businessId);
  const { rows } = await dbPool.query(
    `UPDATE investment_amendments
        SET status = 'proposed', notice_sent_at = NOW(),
            reconfirmation_deadline_at = $3, expected_version = expected_version + 1, updated_at = NOW()
      WHERE id = $1 AND opportunity_id = $2 AND status = 'draft'
      RETURNING *`,
    [amendmentId, opportunityId, deadline.toISOString()],
  );
  if (!rows[0]) fail('Amendment not found or not a draft', 'invest_amendment_not_found', 404);
  return formatAmendment(rows[0]);
}

async function listAmendments(user, opportunityId, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  const opportunity = await getOpportunity(opportunityId, dbPool);
  if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  const isReviewer = ['admin', 'super_admin'].includes(user.role);
  const isRep = await isEntityRepresentative(dbPool, user.id, opportunity.businessId);
  const related = await hasInvestorRelationship(dbPool, user.id, opportunityId);
  if (!isReviewer && !isRep && !related) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  const { rows } = await dbPool.query(
    `SELECT * FROM investment_amendments WHERE opportunity_id = $1 ORDER BY created_at DESC`,
    [opportunityId],
  );
  return rows.map(formatAmendment);
}

/**
 * Investor reconfirmation after a material change: the live application
 * accepts the amendment's new agreement version, and any still-reserved
 * commitment for that investor moves to the new version. Completed
 * commitments never move: their version is fixed at closing.
 */
async function reconfirmAmendment(userId, opportunityId, amendmentId, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  requireUuid(amendmentId, 'invest_amendment_id_invalid', 'Invalid amendment id');
  return withTransaction(dbPool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM investment_amendments WHERE id = $1 AND opportunity_id = $2 FOR UPDATE`,
      [amendmentId, opportunityId],
    );
    const amendment = rows[0];
    if (!amendment) fail('Amendment not found', 'invest_amendment_not_found', 404);
    if (!['proposed', 'effective'].includes(amendment.status)) {
      fail('This amendment is not open for reconfirmation', 'invest_amendment_reconfirm_invalid', 409);
    }
    if (amendment.reconfirmation_deadline_at && new Date(amendment.reconfirmation_deadline_at) < new Date()) {
      fail('The reconfirmation deadline has passed', 'invest_amendment_deadline_passed', 409);
    }
    if (!amendment.new_agreement_version_id) {
      fail('This amendment carries no new agreement version to reconfirm', 'invest_amendment_no_new_version', 409);
    }
    const { rows: appRows } = await client.query(
      `SELECT * FROM investment_participation_applications
        WHERE user_id = $1 AND opportunity_id = $2
          AND status IN ('draft', 'submitted', 'under_review', 'needs_information', 'approved')
        FOR UPDATE`,
      [userId, opportunityId],
    );
    const application = appRows[0];
    if (!application) fail('No live participation application for this opportunity', 'invest_application_not_found', 404);
    const { rows: versionRows } = await client.query(
      `SELECT version_number FROM investment_agreement_versions WHERE id = $1`,
      [amendment.new_agreement_version_id],
    );
    const { rows: updatedApps } = await client.query(
      `UPDATE investment_participation_applications
          SET agreement_version_id = $2, agreement_accepted_at = NOW(),
              expected_version = expected_version + 1, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [application.id, amendment.new_agreement_version_id],
    );
    const { rows: updatedCommitments } = await client.query(
      `UPDATE investment_commitments
          SET agreement_version_id = $3, agreement_version_number = $4,
              expected_version = expected_version + 1, updated_at = NOW()
        WHERE user_id = $1 AND opportunity_id = $2 AND status = 'reserved'
        RETURNING *`,
      [userId, opportunityId, amendment.new_agreement_version_id, Number(versionRows[0].version_number)],
    );
    return {
      amendment: formatAmendment(amendment),
      application: formatApplicationApi(updatedApps[0]),
      reconfirmedCommitments: updatedCommitments.map((row) => String(row.id)),
    };
  }, 'invest_reconfirm_amendment');
}

async function createDocument(userId, opportunityId, input, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  const { title, storageRef, visibility = 'committed', confidential = true } = input || {};
  if (!title || !String(title).trim()) fail('A document title is required', 'invest_document_title_required');
  if (!storageRef || !String(storageRef).trim() || String(storageRef).length > 512) {
    fail('A document storage reference of up to 512 characters is required', 'invest_document_storage_ref_required');
  }
  if (!['public', 'applicants', 'committed', 'reviewers'].includes(visibility)) {
    fail('Unknown document visibility', 'invest_document_visibility_invalid');
  }
  const opportunity = await getOpportunity(opportunityId, dbPool);
  if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  await requireEntityRepresentative(dbPool, userId, opportunity.businessId);
  const { rows } = await dbPool.query(
    `INSERT INTO investment_documents (opportunity_id, uploaded_by, title, storage_ref, visibility, confidential)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [opportunityId, userId, String(title).trim(), String(storageRef).trim(), visibility, !!confidential],
  );
  return formatDocument(rows[0]);
}

function formatDocument(row) {
  return {
    id: String(row.id),
    opportunityId: String(row.opportunity_id),
    title: row.title,
    visibility: row.visibility,
    confidential: !!row.confidential,
    storageRef: row.storage_ref,
    uploadedBy: String(row.uploaded_by),
    createdAt: row.created_at || null,
  };
}

async function listDocuments(user, opportunityId, dbPool = pool) {
  requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  const opportunity = await getOpportunity(opportunityId, dbPool);
  if (!opportunity) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  const { rows } = await dbPool.query(
    `SELECT * FROM investment_documents WHERE opportunity_id = $1 ORDER BY created_at DESC`,
    [opportunityId],
  );
  const out = [];
  for (const doc of rows) {
    if (await canAccessDocument(dbPool, user, doc)) out.push(formatDocument(doc));
  }
  return out;
}

async function getDocument(user, documentId, dbPool = pool) {
  requireUuid(documentId, 'invest_document_id_invalid', 'Invalid document id');
  const { rows } = await dbPool.query(`SELECT * FROM investment_documents WHERE id = $1`, [documentId]);
  const doc = rows[0];
  if (!doc) fail('Document not found', 'invest_document_not_found', 404);
  if (!(await canAccessDocument(dbPool, user, doc))) {
    fail('Document not found', 'invest_document_not_found', 404);
  }
  return formatDocument(doc);
}

// ── My investments ───────────────────────────────────────────────────────

async function myInvestments(userId, { suspended = false } = {}, dbPool = pool) {
  const { rows: commitmentRows } = await dbPool.query(
    `SELECT c.*, o.title AS opportunity_title
       FROM investment_commitments c
       JOIN investment_opportunities o ON o.id = c.opportunity_id
      WHERE c.user_id = $1 ORDER BY c.created_at DESC`,
    [userId],
  );
  const { rows: positionRows } = await dbPool.query(
    `SELECT p.*, o.title AS opportunity_title
       FROM investment_positions p
       JOIN investment_opportunities o ON o.id = p.opportunity_id
      WHERE p.user_id = $1 ORDER BY p.acquired_at DESC`,
    [userId],
  );
  const { rows: applicationRows } = await dbPool.query(
    `SELECT a.*, o.title AS opportunity_title
       FROM investment_participation_applications a
       JOIN investment_opportunities o ON o.id = a.opportunity_id
      WHERE a.user_id = $1 ORDER BY a.created_at DESC`,
    [userId],
  );
  const { rows: distributionRows } = await dbPool.query(
    `SELECT d.*, o.title AS opportunity_title
       FROM investment_distributions d
       JOIN investment_opportunities o ON o.id = d.opportunity_id
      WHERE d.user_id = $1 ORDER BY d.created_at DESC`,
    [userId],
  );
  const opportunityIds = [...new Set([
    ...commitmentRows.map((row) => String(row.opportunity_id)),
    ...positionRows.map((row) => String(row.opportunity_id)),
    ...applicationRows.map((row) => String(row.opportunity_id)),
  ])];
  let updates = [];
  let amendments = [];
  if (opportunityIds.length) {
    const { rows: updateRows } = await dbPool.query(
      `SELECT * FROM investment_opportunity_updates WHERE opportunity_id = ANY($1::uuid[]) ORDER BY due_at ASC NULLS LAST`,
      [opportunityIds],
    );
    updates = updateRows
      .filter((row) => row.status === 'published' || effectiveUpdateStatus(row) === 'overdue')
      .map(formatUpdate);
    const { rows: amendmentRows } = await dbPool.query(
      `SELECT * FROM investment_amendments WHERE opportunity_id = ANY($1::uuid[]) AND status IN ('proposed', 'effective') ORDER BY created_at DESC`,
      [opportunityIds],
    );
    amendments = amendmentRows.map(formatAmendment);
  }
  const agreementVersionIds = [...new Set([
    ...applicationRows.map((row) => row.agreement_version_id).filter(Boolean),
    ...commitmentRows.map((row) => row.agreement_version_id).filter(Boolean),
  ])];
  let agreements = [];
  if (agreementVersionIds.length) {
    const { rows: versionRows } = await dbPool.query(
      `SELECT id, opportunity_id, version_number, content_hash, created_at
         FROM investment_agreement_versions WHERE id = ANY($1::uuid[]) ORDER BY version_number`,
      [agreementVersionIds],
    );
    agreements = versionRows.map((row) => ({
      id: String(row.id),
      opportunityId: String(row.opportunity_id),
      versionNumber: Number(row.version_number),
      contentHash: row.content_hash,
      createdAt: row.created_at || null,
    }));
  }
  const { rows: ticketRows } = await dbPool.query(
    `SELECT id, ticket_number, subject, category, priority, status, metadata, created_at
       FROM support_tickets
      WHERE user_id = $1 AND metadata ->> 'invest_support' = 'true'
      ORDER BY created_at DESC`,
    [userId],
  );
  const formatCommitment = (row) => ({
    id: String(row.id),
    opportunityId: String(row.opportunity_id),
    opportunityTitle: row.opportunity_title,
    applicationId: row.application_id ? String(row.application_id) : null,
    amountCents: Number(row.amount_cents),
    currencyCode: row.currency_code,
    status: row.status,
    agreementVersionId: String(row.agreement_version_id),
    agreementVersionNumber: Number(row.agreement_version_number),
    cancelledAt: row.cancelled_at || null,
    cancellationReason: row.cancellation_reason || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
  });
  const pending = commitmentRows.filter((row) => row.status === 'reserved').map(formatCommitment);
  const completed = commitmentRows.filter((row) => row.status === 'completed').map(formatCommitment);
  const cancelled = commitmentRows.filter((row) => row.status === 'cancelled').map(formatCommitment);
  const reconfirmationRequired = [];
  for (const amendment of amendments) {
    if (!amendment.newAgreementVersionId) continue;
    for (const commitment of pending) {
      if (String(commitment.opportunityId) === String(amendment.opportunityId)
        && String(commitment.agreementVersionId) !== String(amendment.newAgreementVersionId)) {
        reconfirmationRequired.push({ amendmentId: amendment.id, commitmentId: commitment.id, opportunityId: commitment.opportunityId });
      }
    }
  }
  const result = {
    pending,
    completed,
    cancelled,
    positions: positionRows.map((row) => ({
      id: String(row.id),
      opportunityId: String(row.opportunity_id),
      opportunityTitle: row.opportunity_title,
      commitmentId: String(row.commitment_id),
      amountCents: Number(row.amount_cents),
      currencyCode: row.currency_code,
      status: row.status,
      agreementVersionId: String(row.agreement_version_id),
      agreementVersionNumber: Number(row.agreement_version_number),
      acquiredAt: row.acquired_at || null,
    })),
    applications: applicationRows.map((row) => ({ ...formatApplicationApi(row), opportunityTitle: row.opportunity_title })),
    updates,
    distributions: distributionRows.map((row) => ({
      id: String(row.id),
      opportunityId: String(row.opportunity_id),
      opportunityTitle: row.opportunity_title,
      positionId: row.position_id ? String(row.position_id) : null,
      amountCents: Number(row.amount_cents),
      currencyCode: row.currency_code,
      status: row.status,
      createdAt: row.created_at || null,
    })),
    agreements,
    amendments,
    reconfirmationRequired,
    support: ticketRows.map((row) => ({
      id: String(row.id),
      ticketNumber: Number(row.ticket_number),
      subject: row.subject,
      category: row.category,
      priority: row.priority,
      status: row.status,
      opportunityId: row.metadata && row.metadata.invest_opportunity_id ? String(row.metadata.invest_opportunity_id) : null,
      createdAt: row.created_at || null,
    })),
    // Never a live portfolio market value: there is no defensible
    // methodology for one, so only committed and distributed cents are shown.
    suspended: !!suspended,
    restrictedRead: !!suspended,
  };
  if (!suspended) {
    const balance = await getEligibleBalance(dbPool, { customerId: userId, currencyCode: 'USD' });
    result.eligibleCreditCents = balance.eligibleAvailableCents;
    result.walletAvailableCents = balance.availableBalanceCents;
  }
  return result;
}

// ── Investment support requests ──────────────────────────────────────────

/**
 * Support request tied to an investment or opportunity. It creates a row
 * in the existing support surface (support_tickets + support_messages,
 * the same tables POST /api/support-reports writes), linked by metadata,
 * so investment complaints land in the same queue support already works.
 * Idempotent on the Idempotency-Key header (stored as client_request_id).
 */
async function createSupportRequest(userId, input, dbPool = pool) {
  const { opportunityId = null, commitmentId = null, category = 'investment', subject = null, details, clientRequestId = null } = input || {};
  if (!details || !String(details).trim()) fail('Support request details are required', 'invest_support_details_required');
  if (opportunityId) requireUuid(opportunityId, 'invest_opportunity_id_invalid', 'Invalid opportunity id');
  if (commitmentId) requireUuid(commitmentId, 'invest_commitment_id_invalid', 'Invalid commitment id');
  const categoryValue = String(category).trim().toLowerCase().replace(/\s+/g, '_').slice(0, 100) || 'investment';
  return withTransaction(dbPool, async (client) => {
    if (clientRequestId) {
      const { rows: existing } = await client.query(
        `SELECT id, user_id, ticket_number, subject, category, priority, status, metadata, created_at
           FROM support_tickets WHERE client_request_id = $1`,
        [clientRequestId],
      );
      if (existing[0]) {
        if (String(existing[0].user_id) !== String(userId)) {
          fail('Idempotency key was already used for a different support request', 'invest_support_idempotency_conflict', 409);
        }
        return { ticket: formatSupportTicket(existing[0]), replayed: true };
      }
    }
    if (commitmentId) {
      const { rows } = await client.query(`SELECT user_id, opportunity_id FROM investment_commitments WHERE id = $1`, [commitmentId]);
      if (!rows[0] || String(rows[0].user_id) !== String(userId)) {
        fail('Commitment not found', 'invest_commitment_not_found', 404);
      }
      if (opportunityId && String(rows[0].opportunity_id) !== String(opportunityId)) {
        fail('Commitment does not belong to this opportunity', 'invest_support_commitment_mismatch', 409);
      }
    }
    if (opportunityId) {
      const opportunity = await loadOpportunityRow(client, opportunityId);
      const { rows: roleRows } = await client.query(`SELECT role FROM users WHERE id = $1`, [userId]);
      const isStaff = ['admin', 'super_admin'].includes(roleRows[0]?.role);
      const isRep = await isEntityRepresentative(client, userId, opportunity.business_id);
      const related = isRep || isStaff || (await hasInvestorRelationship(client, userId, opportunityId));
      if (!related) {
        fail('Opportunity not found', 'invest_opportunity_not_found', 404);
      }
    }
    const { rows: userRows } = await client.query(
      `SELECT first_name, last_name, email FROM users WHERE id = $1 LIMIT 1`, [userId],
    );
    const profile = userRows[0] || {};
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'OxSteed user';
    const email = profile.email || 'support@oxsteed.com';
    const isComplaint = /complaint/i.test(categoryValue);
    const { rows: ticketRows } = await client.query(
      `INSERT INTO support_tickets
         (user_id, name, email, subject, category, priority, source, metadata, client_request_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'direct', $7, $8)
       RETURNING id, ticket_number, subject, category, priority, status, metadata, created_at`,
      [
        userId, name, email,
        subject ? String(subject).slice(0, 500) : `OxSteed Invest report: ${categoryValue}`,
        categoryValue, isComplaint ? 'high' : 'normal',
        JSON.stringify({
          invest_support: 'true',
          invest_opportunity_id: opportunityId || null,
          invest_commitment_id: commitmentId || null,
        }),
        clientRequestId || null,
      ],
    );
    const ticket = ticketRows[0];
    await client.query(
      `INSERT INTO support_messages
         (ticket_id, sender_id, sender_name, sender_email, content, is_internal, is_from_admin, client_message_id)
       VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, $6)`,
      [ticket.id, userId, name, email, String(details).trim(), clientRequestId || null],
    );
    return { ticket: formatSupportTicket(ticket), replayed: false };
  }, 'invest_create_support_request');
}

function formatSupportTicket(row) {
  return {
    id: String(row.id),
    ticketNumber: Number(row.ticket_number),
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    status: row.status,
    opportunityId: row.metadata && row.metadata.invest_opportunity_id ? String(row.metadata.invest_opportunity_id) : null,
    commitmentId: row.metadata && row.metadata.invest_commitment_id ? String(row.metadata.invest_commitment_id) : null,
    createdAt: row.created_at || null,
  };
}

async function listSupportRequests(userId, dbPool = pool) {
  const { rows } = await dbPool.query(
    `SELECT id, ticket_number, subject, category, priority, status, metadata, created_at
       FROM support_tickets
      WHERE user_id = $1 AND metadata ->> 'invest_support' = 'true'
      ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(formatSupportTicket);
}

async function getCommitmentForUser(user, commitmentId, dbPool = pool) {
  requireUuid(commitmentId, 'invest_commitment_id_invalid', 'Invalid commitment id');
  const { rows } = await dbPool.query(
    `SELECT c.*, o.title AS opportunity_title, o.business_id AS business_id
       FROM investment_commitments c
       JOIN investment_opportunities o ON o.id = c.opportunity_id
      WHERE c.id = $1`,
    [commitmentId],
  );
  const row = rows[0];
  if (!row) fail('Commitment not found', 'invest_commitment_not_found', 404);
  const isReviewer = ['admin', 'super_admin'].includes(user.role);
  const isRep = await isEntityRepresentative(dbPool, user.id, row.business_id);
  if (String(row.user_id) !== String(user.id) && !isReviewer && !isRep) {
    fail('Commitment not found', 'invest_commitment_not_found', 404);
  }
  return {
    id: String(row.id),
    userId: String(row.user_id),
    opportunityId: String(row.opportunity_id),
    opportunityTitle: row.opportunity_title,
    applicationId: row.application_id ? String(row.application_id) : null,
    amountCents: Number(row.amount_cents),
    currencyCode: row.currency_code,
    status: row.status,
    agreementVersionId: String(row.agreement_version_id),
    agreementVersionNumber: Number(row.agreement_version_number),
    creditReferenceRate: row.credit_reference_rate === null ? null : Number(row.credit_reference_rate),
    cancelledAt: row.cancelled_at || null,
    cancellationReason: row.cancellation_reason || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
  };
}

module.exports = {
  apiApplicationStatus,
  formatApplicationApi,
  formatOpportunityApi,
  isEntityRepresentative,
  requireEntityRepresentative,
  hasLiveApplication,
  hasCommitmentOrPosition,
  hasInvestorRelationship,
  canAccessDocument,
  listOpportunities,
  getOpportunityDetail,
  validateDetails,
  createDraftOpportunity,
  updateDraftOpportunity,
  submitOpportunityForReview,
  reviewOpportunity,
  publishOpportunity,
  createOpportunityAgreementVersion,
  listAgreementVersions,
  listMyApplications,
  getApplicationForUser,
  updateApplicationSections,
  acceptApplicationAgreement,
  withdrawApplication,
  requestApplicationInformation,
  reviewApplication,
  listReviewQueue,
  askQuestion,
  listQuestions,
  answerQuestion,
  createUpdate,
  publishUpdate,
  listUpdates,
  createAmendment,
  proposeAmendment,
  listAmendments,
  reconfirmAmendment,
  createDocument,
  listDocuments,
  getDocument,
  myInvestments,
  createSupportRequest,
  listSupportRequests,
  getCommitmentForUser,
};
