'use strict';

/**
 * OxSteed Invest HTTP controllers (Track 2).
 *
 * Every route is authenticated (middleware/auth `authenticate`) and gated
 * server-side on the INVEST_* flags on every request, never only in UI
 * gating. INVEST_ENABLED defaults on: every Invest surface, flow, and
 * capability ships default-on. Mutating commitment/close/proceeds/
 * distribute routes additionally require INVEST_COMMITMENTS_ENABLED
 * (default off, the live commitment gate). ACCESS_INVESTOR_ENFORCEMENT
 * is never read here: it governs investor.reporting only.
 *
 * Suspension: a suspended account keeps ownership, statements, and
 * obligations. The platform `authenticate` middleware already refuses
 * suspended accounts on /api/invest paths with 403 ACCOUNT_SUSPENDED, which
 * is the defined error for writes in production. The suspension guard in
 * this file additionally enforces the rule at the controller layer (reads
 * of the investor's own records stay available in restricted form, writes
 * are refused with invest_account_suspended), so the behavior holds for
 * service-layer callers and for any future auth exemption that lets a
 * suspended investor read their own records. See docs/oxsteed-invest/api.md.
 *
 * Errors are AppError instances passed to next(err); the router mounts the
 * shared errorHandler so responses carry { error, code, status }.
 */

const AppError = require('../utils/appError');
const pool = require('../db');
const api = require('../services/invest/investApi');
const {
  createParticipationApplication,
  submitParticipationApplication,
  getOpportunity,
} = require('../services/invest/participation');
const {
  createCommitment: createCommitmentService,
  cancelCommitment: cancelCommitmentService,
  failCloseOpportunity: failCloseOpportunityService,
  recordPartnerEscrowConfirmation: recordPartnerEscrowConfirmationService,
  approveClosingConditions: approveClosingConditionsService,
  recordClosingApproval: recordClosingApprovalService,
  closeOpportunity: closeOpportunityService,
  releaseProceeds: releaseProceedsService,
  recordDistribution: recordDistributionService,
} = require('../services/invest/settlementService');
const {
  requireInvestEnabled,
  requireInvestCommitmentsEnabled,
} = require('../services/invest/flags');

function fail(message, code, status = 400) {
  throw new AppError(message, status, code);
}

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

const requireInvestEnabledMw = (req, _res, next) => {
  try {
    requireInvestEnabled(req.user && req.user.id);
    return next();
  } catch (err) {
    return next(err);
  }
};

const requireInvestCommitmentsEnabledMw = (req, _res, next) => {
  try {
    requireInvestCommitmentsEnabled(req.user && req.user.id);
    return next();
  } catch (err) {
    return next(err);
  }
};

/**
 * Suspension guard (see header). Reads proceed with
 * req.investRestrictedRead set; writes are refused. The guard runs after
 * authenticate, which is the production enforcement point for suspended
 * accounts; this layer keeps the rule true for direct service callers.
 */
const investSuspensionGuard = (req, res, next) => {
  if (req.user && req.user.is_suspended) {
    if (req.method === 'GET') {
      req.investRestrictedRead = true;
      return next();
    }
    return res.status(403).json({
      error: 'Your account is suspended. Investment writes are unavailable, but your ownership, statements, and obligations remain.',
      code: 'invest_account_suspended',
    });
  }
  return next();
};

const idemKey = (req) => {
  const key = req.get('Idempotency-Key');
  return key && String(key).trim() ? String(key).trim().slice(0, 160) : null;
};

const requireIdemKey = (req) => {
  const key = idemKey(req);
  if (!key) fail('An Idempotency-Key header is required for this request', 'invest_idempotency_required', 400);
  return key;
};

const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

const expectedVersion = (req) => {
  const value = body(req).expectedVersion;
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail('expectedVersion must be a positive integer', 'invest_expected_version_invalid');
  return parsed;
};

// ── Opportunities ────────────────────────────────────────────────────────

const listOpportunities = wrap(async (req, res) => {
  const opportunities = await api.listOpportunities({
    scope: req.query.scope === 'mine' ? 'mine' : 'published',
    userId: req.user.id,
    sort: req.query.sort === 'closing_date' ? 'closing_date' : 'publication_date',
  });
  return res.json({ opportunities, sort: req.query.sort === 'closing_date' ? 'closing_date' : 'publication_date' });
});

const createOpportunity = wrap(async (req, res) => {
  const b = body(req);
  const opportunity = await api.createDraftOpportunity(req.user.id, {
    businessId: b.businessId,
    title: b.title,
    purpose: b.purpose,
    targetCents: b.targetCents,
    minimumCents: b.minimumCents,
    deadlineAt: b.deadlineAt,
    valuationRule: b.valuationRule,
    useOfProceeds: b.useOfProceeds,
    intermediaryRef: b.intermediaryRef,
    details: b.details,
  });
  return res.status(201).json({ opportunity });
});

const getOpportunityDetail = wrap(async (req, res) => {
  const detail = await api.getOpportunityDetail(req.user, req.params.id);
  return res.json(detail);
});

const getOpportunityPreview = wrap(async (req, res) => {
  // Preview is the investor-facing view of a draft: same detail shape,
  // only reachable by the entity representative or a reviewer.
  const detail = await api.getOpportunityDetail(req.user, req.params.id);
  return res.json({ ...detail, preview: true });
});

const updateOpportunity = wrap(async (req, res) => {
  const b = body(req);
  const opportunity = await api.updateDraftOpportunity(req.user.id, req.params.id, {
    ...b,
    expectedVersion: expectedVersion(req),
  });
  return res.json({ opportunity });
});

const submitOpportunity = wrap(async (req, res) => {
  const opportunity = await api.submitOpportunityForReview(req.user.id, req.params.id);
  return res.json({ opportunity, published: false, note: 'Submitted for review. Submission does not publish the opportunity.' });
});

const reviewOpportunity = wrap(async (req, res) => {
  const b = body(req);
  const opportunity = await api.reviewOpportunity({
    opportunityId: req.params.id,
    reviewerUserId: req.user.id,
    action: b.action,
    expectedVersion: expectedVersion(req),
    note: b.note || null,
    verificationSummary: b.verificationSummary || null,
  });
  return res.json({ opportunity });
});

const publishOpportunity = wrap(async (req, res) => {
  const opportunity = await api.publishOpportunity({
    opportunityId: req.params.id,
    reviewerUserId: req.user.id,
    expectedVersion: expectedVersion(req),
  });
  return res.json({ opportunity });
});

const createAgreementVersion = wrap(async (req, res) => {
  const b = body(req);
  if (!b.body || !String(b.body).trim()) fail('Agreement body is required', 'invest_agreement_body_required');
  const version = await api.createOpportunityAgreementVersion(req.user.id, req.params.id, String(b.body));
  return res.status(201).json({ agreementVersion: version });
});

const listAgreementVersions = wrap(async (req, res) => {
  const versions = await api.listAgreementVersions(req.user, req.params.id);
  return res.json({ agreementVersions: versions });
});

// ── Participation applications ───────────────────────────────────────────

const createApplication = wrap(async (req, res) => {
  const key = requireIdemKey(req);
  const b = body(req);
  if (!b.opportunityId) fail('opportunityId is required for a participation application', 'invest_application_opportunity_required');
  // Applying never blocks ordinary customer functionality: this creates
  // only the application row. No account, mode, or grant changes here, and
  // no global gate is set on the applicant.
  const { application, replayed } = await createParticipationApplication({
    userId: req.user.id,
    opportunityId: b.opportunityId,
    agreementVersionId: b.agreementVersionId || null,
    idempotencyKey: key,
  });
  const presented = { ...application, status: api.apiApplicationStatus(application.status) };
  return res.status(replayed ? 200 : 201).json({ application: presented, replayed });
});

const listApplications = wrap(async (req, res) => {
  const applications = await api.listMyApplications(req.user.id);
  return res.json({ applications });
});

const getApplication = wrap(async (req, res) => {
  const application = await api.getApplicationForUser(req.user, req.params.id);
  return res.json({ application });
});

const updateApplication = wrap(async (req, res) => {
  const application = await api.updateApplicationSections(req.user.id, req.params.id, body(req));
  return res.json({ application });
});

const submitApplication = wrap(async (req, res) => {
  const application = await submitParticipationApplication({ applicationId: req.params.id, userId: req.user.id });
  return res.json({ application: { ...application, status: api.apiApplicationStatus(application.status) } });
});

const withdrawApplication = wrap(async (req, res) => {
  const application = await api.withdrawApplication(req.user.id, req.params.id);
  return res.json({ application });
});

const acceptAgreement = wrap(async (req, res) => {
  const application = await api.acceptApplicationAgreement(req.user.id, req.params.id);
  return res.json({ application });
});

const reviewApplication = wrap(async (req, res) => {
  const b = body(req);
  if (!['approved', 'declined', 'needs_information'].includes(b.decision)) {
    fail('Review decision must be approved, declined, or needs_information', 'invest_application_decision_invalid');
  }
  let application;
  if (b.decision === 'needs_information') {
    application = await api.requestApplicationInformation({
      applicationId: req.params.id,
      reviewerUserId: req.user.id,
      reviewNote: b.reviewNote || b.informationRequest || null,
      expectedVersion: expectedVersion(req),
    });
  } else {
    application = await api.reviewApplication({
      applicationId: req.params.id,
      reviewerUserId: req.user.id,
      decision: b.decision,
      identityVerified: b.identityVerified === true,
      authorityVerified: b.authorityVerified === true,
      reviewNote: b.reviewNote || null,
      expectedVersion: expectedVersion(req),
    });
  }
  return res.json({ application });
});

// ── Commitments ──────────────────────────────────────────────────────────

const CANCELLATION_TERMS = 'A reserved commitment can be cancelled while it is still reserved. On cancellation the reserved Credit is released back to the original balance classification and restrictions, and the commitment is recorded as cancelled. A completed commitment cannot be cancelled.';

const createCommitment = wrap(async (req, res) => {
  const key = requireIdemKey(req);
  const b = body(req);
  if (b.riskAcknowledged !== true) {
    fail('Risk acknowledgement is required before committing', 'invest_commitment_risk_acknowledgement_required', 400);
  }
  if (!b.applicationId) fail('applicationId is required for a commitment', 'invest_commitment_application_required');
  if (!b.agreementVersionId) fail('agreementVersionId is required for a commitment', 'invest_commitment_agreement_required');
  const amountCents = Number(b.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    fail('amountCents must be a positive integer number of cents', 'invest_commitment_amount_invalid');
  }
  const { commitment, replayed } = await createCommitmentService({
    userId: req.user.id,
    opportunityId: req.params.id,
    applicationId: b.applicationId,
    amountCents,
    currencyCode: b.currencyCode || 'USD',
    agreementVersionId: b.agreementVersionId,
    idempotencyKey: key,
  });
  const opportunity = await getOpportunity(req.params.id);
  const { rows: versionRows } = await pool.query(
    `SELECT id, version_number, content_hash FROM investment_agreement_versions WHERE id = $1`,
    [commitment.agreementVersionId],
  );
  const version = versionRows[0] || null;
  // The review screen data: exact amount, valuation rule, itemized fees,
  // rights summary linked to the controlling agreement, pending (not
  // completed) status, cancellation terms, risk acknowledgement, and the
  // exact agreement version accepted.
  const review = {
    amountCents: commitment.amountCents,
    currencyCode: commitment.currencyCode,
    valuationRule: opportunity ? opportunity.valuationRule : null,
    fees: [],
    feesTotalCents: 0,
    feesNote: 'No investor fees are charged in this build. No intermediary fee schedule has been defined; no fee is added to the amount above.',
    rightsSummary: version
      ? `Rights are governed by agreement version ${version.version_number} (SHA-256 ${version.content_hash}). The full agreement text is the controlling document.`
      : 'Rights are governed by the controlling agreement version recorded on the commitment.',
    agreementVersion: version ? {
      id: String(version.id),
      versionNumber: Number(version.version_number),
      contentHash: version.content_hash,
    } : null,
    status: 'pending',
    statusNote: 'This is a pending commitment, not a completed investment. The Credit is reserved and the commitment completes only if the opportunity closes.',
    cancellationTerms: CANCELLATION_TERMS,
    riskAcknowledged: true,
    riskNote: 'Investing involves risk, including possible loss of the amount committed. No return is guaranteed and distributions are not promised.',
  };
  return res.status(replayed ? 200 : 201).json({ commitment, replayed, review });
});

const cancelCommitment = wrap(async (req, res) => {
  const commitment = await cancelCommitmentService({
    commitmentId: req.params.id,
    userId: req.user.id,
    reason: body(req).reason || null,
  });
  return res.json({ commitment });
});

const getCommitment = wrap(async (req, res) => {
  const commitment = await api.getCommitmentForUser(req.user, req.params.id);
  return res.json({ commitment });
});

// ── My investments ───────────────────────────────────────────────────────

const getMyInvestments = wrap(async (req, res) => {
  const mine = await api.myInvestments(req.user.id, { suspended: !!req.investRestrictedRead });
  return res.json(mine);
});

// ── Reviewer queue, closing, proceeds, distributions ────────────────────

const getReviewQueue = wrap(async (req, res) => {
  const queue = await api.listReviewQueue(req.user, { type: req.query.type || null });
  return res.json(queue);
});

const approveClosingConditions = wrap(async (req, res) => {
  const result = await approveClosingConditionsService({ opportunityId: req.params.id, approverUserId: req.user.id });
  return res.json({ closingConditionsApprovedAt: result.closing_conditions_approved_at || null });
});

const recordClosingApproval = wrap(async (req, res) => {
  const b = body(req);
  const { approval, replayed } = await recordClosingApprovalService({
    opportunityId: req.params.id,
    stage: b.stage,
    approverUserId: req.user.id,
    decision: b.decision || 'approved',
    note: b.note || null,
  });
  return res.json({
    approval: {
      id: String(approval.id),
      opportunityId: String(approval.opportunity_id),
      stage: approval.stage,
      approverUserId: String(approval.approver_user_id),
      decision: approval.decision,
      decidedAt: approval.decided_at || null,
    },
    replayed,
  });
});

const closeOpportunity = wrap(async (req, res) => {
  const result = await closeOpportunityService({ opportunityId: req.params.id, executorUserId: req.user.id });
  return res.json(result);
});

const failCloseOpportunity = wrap(async (req, res) => {
  const result = await failCloseOpportunityService({
    opportunityId: req.params.id,
    actorUserId: req.user.id,
    reason: body(req).reason || null,
  });
  return res.json(result);
});

const recordPartnerEscrowConfirmation = wrap(async (req, res) => {
  const result = await recordPartnerEscrowConfirmationService({
    commitmentId: req.params.id,
    partnerRef: body(req).partnerRef,
    confirmedBy: req.user.id,
    note: body(req).note || null,
  });
  return res.json({ settlement: result });
});

const releaseProceeds = wrap(async (req, res) => {
  const result = await releaseProceedsService({ opportunityId: req.params.id, releasedBy: req.user.id });
  return res.json(result);
});

const recordDistribution = wrap(async (req, res) => {
  const key = requireIdemKey(req);
  const b = body(req);
  const { distribution, replayed } = await recordDistributionService({
    opportunityId: req.params.id,
    positionId: b.positionId,
    userId: b.userId,
    amountCents: b.amountCents,
    currencyCode: b.currencyCode || 'USD',
    idempotencyKey: key,
    actorUserId: req.user.id,
  });
  return res.status(replayed ? 200 : 201).json({ distribution, replayed });
});

// ── Q and A, updates, amendments, documents ──────────────────────────────

const askQuestion = wrap(async (req, res) => {
  const question = await api.askQuestion(req.user.id, req.params.id, body(req).question);
  return res.status(201).json({ question });
});

const listQuestions = wrap(async (req, res) => {
  const questions = await api.listQuestions(req.user, req.params.id);
  return res.json({ questions });
});

const answerQuestion = wrap(async (req, res) => {
  const question = await api.answerQuestion(req.user.id, req.params.id, req.params.questionId, body(req).answer);
  return res.json({ question });
});

const createUpdate = wrap(async (req, res) => {
  const update = await api.createUpdate(req.user.id, req.params.id, body(req));
  return res.status(201).json({ update });
});

const listUpdates = wrap(async (req, res) => {
  const updates = await api.listUpdates(req.user, req.params.id);
  return res.json({ updates });
});

const publishUpdate = wrap(async (req, res) => {
  const update = await api.publishUpdate(req.user.id, req.params.id, req.params.updateId);
  return res.json({ update });
});

const createAmendment = wrap(async (req, res) => {
  const amendment = await api.createAmendment(req.user.id, req.params.id, body(req));
  return res.status(201).json({ amendment });
});

const listAmendments = wrap(async (req, res) => {
  const amendments = await api.listAmendments(req.user, req.params.id);
  return res.json({ amendments });
});

const proposeAmendment = wrap(async (req, res) => {
  const amendment = await api.proposeAmendment(req.user.id, req.params.id, req.params.amendmentId, body(req).reconfirmationDeadlineAt);
  return res.json({ amendment });
});

const reviewAmendment = (decision) => wrap(async (req, res) => {
  const result = await api.reviewAmendment({
    amendmentId: req.params.id,
    reviewerUserId: req.user.id,
    decision,
    note: body(req).note || null,
    expectedVersion: expectedVersion(req),
  });
  return res.json(result);
});

const reconfirmAmendment = wrap(async (req, res) => {
  const result = await api.reconfirmAmendment(req.user.id, req.params.id, req.params.amendmentId);
  return res.json(result);
});

const createDocument = wrap(async (req, res) => {
  const document = await api.createDocument(req.user.id, req.params.id, body(req));
  return res.status(201).json({ document });
});

const listDocuments = wrap(async (req, res) => {
  const documents = await api.listDocuments(req.user, req.params.id);
  return res.json({ documents });
});

const getDocument = wrap(async (req, res) => {
  const document = await api.getDocument(req.user, req.params.id);
  return res.json({ document });
});

// ── Support ──────────────────────────────────────────────────────────────

const createSupportRequest = wrap(async (req, res) => {
  const b = body(req);
  const key = idemKey(req);
  let clientRequestId = null;
  if (key) {
    const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
    if (uuidLike) clientRequestId = key;
  }
  const { ticket, replayed } = await api.createSupportRequest(req.user.id, {
    opportunityId: b.opportunityId || null,
    commitmentId: b.commitmentId || null,
    category: b.category || 'investment',
    subject: b.subject || null,
    details: b.details,
    clientRequestId,
  });
  return res.status(replayed ? 200 : 201).json({ ticket, replayed });
});

const listSupportRequests = wrap(async (req, res) => {
  const tickets = await api.listSupportRequests(req.user.id);
  return res.json({ tickets });
});

module.exports = {
  requireInvestEnabledMw,
  requireInvestCommitmentsEnabledMw,
  investSuspensionGuard,
  listOpportunities,
  createOpportunity,
  getOpportunityDetail,
  getOpportunityPreview,
  updateOpportunity,
  submitOpportunity,
  reviewOpportunity,
  publishOpportunity,
  createAgreementVersion,
  listAgreementVersions,
  createApplication,
  listApplications,
  getApplication,
  updateApplication,
  submitApplication,
  withdrawApplication,
  acceptAgreement,
  reviewApplication,
  createCommitment,
  cancelCommitment,
  getCommitment,
  getMyInvestments,
  getReviewQueue,
  approveClosingConditions,
  recordClosingApproval,
  closeOpportunity,
  failCloseOpportunity,
  recordPartnerEscrowConfirmation,
  releaseProceeds,
  recordDistribution,
  askQuestion,
  listQuestions,
  answerQuestion,
  createUpdate,
  listUpdates,
  publishUpdate,
  createAmendment,
  listAmendments,
  proposeAmendment,
  reviewAmendment,
  reconfirmAmendment,
  createDocument,
  listDocuments,
  getDocument,
  createSupportRequest,
  listSupportRequests,
};
