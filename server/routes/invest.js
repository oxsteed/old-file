'use strict';

/**
 * OxSteed Invest routes (Track 2), mounted at /api/invest.
 *
 * Every route is authenticated and gated server-side on INVEST_ENABLED
 * (default on); commitment, close, proceeds, and distribution writes
 * additionally require INVEST_COMMITMENTS_ENABLED (default off, the live
 * commitment gate). No live commitment is possible while that gate is
 * off, regardless of UI state.
 *
 * Reviewer routes use the platform pattern (requireAdmin + requirePermission)
 * with a separate permission per authority, so no single grant authorizes
 * both closing and proceeds release, and the publish reviewer pool is
 * distinct from the participation reviewer pool:
 *   review_invest_participation        participation applications
 *   review_invest_opportunity_publish  publish
 *   review_invest_close                closing conditions + approvals + close
 *   review_invest_release_proceeds     proceeds release + distributions
 * Self-approval is additionally refused inside the services (the reviewer
 * cannot be the applicant, the entity representative, or the other closing
 * approver).
 *
 * Money routes also reject impersonated sessions (ADM-040).
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/investController');

const invest = ctrl.requireInvestEnabledMw;
const commitments = ctrl.requireInvestCommitmentsEnabledMw;
const suspended = ctrl.investSuspensionGuard;

// Directory and detail: neutral sort only, no recommendation score.
router.get('/opportunities', authenticate, invest, suspended, ctrl.listOpportunities);
router.post('/opportunities', authenticate, invest, suspended, ctrl.createOpportunity);
router.get('/opportunities/:id', authenticate, invest, suspended, ctrl.getOpportunityDetail);
router.put('/opportunities/:id', authenticate, invest, suspended, ctrl.updateOpportunity);
router.post('/opportunities/:id/submit-for-review', authenticate, invest, suspended, ctrl.submitOpportunity);
router.get('/opportunities/:id/preview', authenticate, invest, suspended, ctrl.getOpportunityPreview);
router.post('/opportunities/:id/agreement-versions', authenticate, invest, suspended, ctrl.createAgreementVersion);
router.get('/opportunities/:id/agreement-versions', authenticate, invest, suspended, ctrl.listAgreementVersions);

// Reviewer: opportunity review and publish (separate authorities).
router.post('/opportunities/:id/review', authenticate, invest, requireAdmin, requirePermission('review_invest_opportunity_publish'), ctrl.reviewOpportunity);
router.post('/opportunities/:id/publish', authenticate, invest, requireAdmin, requirePermission('review_invest_opportunity_publish'), ctrl.publishOpportunity);

// Commit flow: Idempotency-Key required; eligibility rechecked at commit
// inside the settlement service transaction.
router.post('/opportunities/:id/commitments', authenticate, invest, commitments, suspended, rejectImpersonated, ctrl.createCommitment);
router.post('/commitments/:id/cancel', authenticate, invest, suspended, rejectImpersonated, ctrl.cancelCommitment);
router.get('/commitments/:id', authenticate, invest, suspended, ctrl.getCommitment);

// Participation applications.
router.post('/applications', authenticate, invest, suspended, ctrl.createApplication);
router.get('/applications', authenticate, invest, suspended, ctrl.listApplications);
router.get('/applications/:id', authenticate, invest, suspended, ctrl.getApplication);
router.patch('/applications/:id', authenticate, invest, suspended, ctrl.updateApplication);
router.post('/applications/:id/submit', authenticate, invest, suspended, ctrl.submitApplication);
router.post('/applications/:id/withdraw', authenticate, invest, suspended, ctrl.withdrawApplication);
router.post('/applications/:id/accept-agreement', authenticate, invest, suspended, ctrl.acceptAgreement);
router.post('/applications/:id/review', authenticate, invest, requireAdmin, requirePermission('review_invest_participation'), ctrl.reviewApplication);

// My investments: never a live portfolio market value.
router.get('/me', authenticate, invest, suspended, ctrl.getMyInvestments);

// Reviewer queue (capability-scoped inside the service).
router.get('/review-queue', authenticate, invest, requireAdmin, ctrl.getReviewQueue);

// Closing and proceeds: separate review + execution approvals, and a
// separate authority for proceeds release. The service blocks proceeds
// until closing conditions are approved.
router.post('/opportunities/:id/closing-conditions/approve', authenticate, invest, requireAdmin, requirePermission('review_invest_close'), ctrl.approveClosingConditions);
router.post('/opportunities/:id/closing-approvals', authenticate, invest, requireAdmin, requirePermission('review_invest_close'), ctrl.recordClosingApproval);
router.post('/opportunities/:id/close', authenticate, invest, commitments, requireAdmin, requirePermission('review_invest_close'), rejectImpersonated, ctrl.closeOpportunity);
router.post('/opportunities/:id/release-proceeds', authenticate, invest, commitments, requireAdmin, requirePermission('review_invest_release_proceeds'), rejectImpersonated, ctrl.releaseProceeds);
router.post('/opportunities/:id/distributions', authenticate, invest, commitments, requireAdmin, requirePermission('review_invest_release_proceeds'), rejectImpersonated, ctrl.recordDistribution);

// Q and A, updates, amendments, documents.
router.post('/opportunities/:id/questions', authenticate, invest, suspended, ctrl.askQuestion);
router.get('/opportunities/:id/questions', authenticate, invest, suspended, ctrl.listQuestions);
router.post('/opportunities/:id/questions/:questionId/answer', authenticate, invest, suspended, ctrl.answerQuestion);
router.post('/opportunities/:id/updates', authenticate, invest, suspended, ctrl.createUpdate);
router.get('/opportunities/:id/updates', authenticate, invest, suspended, ctrl.listUpdates);
router.post('/opportunities/:id/updates/:updateId/publish', authenticate, invest, suspended, ctrl.publishUpdate);
router.post('/opportunities/:id/amendments', authenticate, invest, suspended, ctrl.createAmendment);
router.get('/opportunities/:id/amendments', authenticate, invest, suspended, ctrl.listAmendments);
router.post('/opportunities/:id/amendments/:amendmentId/propose', authenticate, invest, suspended, ctrl.proposeAmendment);
router.post('/opportunities/:id/amendments/:amendmentId/reconfirm', authenticate, invest, suspended, ctrl.reconfirmAmendment);
router.post('/opportunities/:id/documents', authenticate, invest, suspended, ctrl.createDocument);
router.get('/opportunities/:id/documents', authenticate, invest, suspended, ctrl.listDocuments);
router.get('/documents/:id', authenticate, invest, suspended, ctrl.getDocument);

// Support tied to an investment or opportunity (same support_tickets
// surface as POST /api/support-reports, linked by metadata).
router.post('/support-requests', authenticate, invest, suspended, ctrl.createSupportRequest);
router.get('/support-requests', authenticate, invest, suspended, ctrl.listSupportRequests);

// Route-local JSON error handler for consistent API responses when this
// router is mounted without the global server error handler (tests).
router.use(errorHandler);

module.exports = router;
