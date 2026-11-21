const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const controller = require('../controllers/consultantNetworkController');
const screeningController = require('../controllers/consultantScreeningController');
const schedulingController = require('../controllers/consultantSchedulingController');
const proposalController = require('../controllers/consultantProposalController');

router.get('/profile', authenticate, controller.getMyConsultantProfile);
router.put('/profile', authenticate, controller.upsertMyConsultantProfile);
router.get('/dashboard', authenticate, controller.getMyConsultantDashboard);
router.patch('/referrals/:requestId', authenticate, controller.updateMyReferral);

// Group 10 Slice A (501-510).
router.get('/readiness', authenticate, controller.getMyConsultantReadiness);
router.get('/pricing-summary', authenticate, controller.getMyConsultantPricingSummary);
router.get('/portfolio', authenticate, controller.listMyPortfolio);
router.post('/portfolio', authenticate, controller.createPortfolioItem);
router.put('/portfolio/:itemId', authenticate, controller.updatePortfolioItem);
router.delete('/portfolio/:itemId', authenticate, controller.deletePortfolioItem);
// Group 10 Slice B (511-515): screen inquiries. Screening attaches to
// the business-launch referral (consulting_requests), the inquiry the
// consultant actually receives.
router.get('/inquiry-templates', authenticate, screeningController.listInquiryTemplates);
router.get('/referrals/:requestId/screen', authenticate, screeningController.getReferralScreen);
router.post('/referrals/:requestId/fit', authenticate, screeningController.upsertFitAssessment);
router.post('/referrals/:requestId/conflict', authenticate, screeningController.upsertConflictDeclaration);
router.post('/referrals/:requestId/reply', authenticate, screeningController.replyToReferral);
// Group 10 Slice C (518/520): the consultant's own appointments, with
// open reschedule proposals and attendance, for the dashboard sessions
// section.
router.get('/sessions', authenticate, schedulingController.listMyConsultantSessions);
// Group 10 Slice D (521-525): agree on work. Engagement proposals on the
// referral: the assigned consultant drafts, edits, sends, and withdraws;
// the client reads and decides through the business-launch routes.
router.get('/referrals/:requestId/proposals', authenticate, proposalController.listProposals);
router.post('/referrals/:requestId/proposals', authenticate, proposalController.createProposal);
router.get('/referrals/:requestId/proposals/:proposalId', authenticate, proposalController.getProposal);
router.put('/referrals/:requestId/proposals/:proposalId', authenticate, proposalController.updateProposal);
router.post('/referrals/:requestId/proposals/:proposalId/send', authenticate, proposalController.sendProposal);
router.post('/referrals/:requestId/proposals/:proposalId/withdraw', authenticate, proposalController.withdrawProposal);

// Public specialty profile (506). No auth: only approved, active profiles
// are ever returned; anything else 404s.
router.get('/public/:userId', controller.getPublicConsultantProfile);
// Admin profile approval workflow (504).
router.get('/admin/profiles', authenticate, requireAdmin, controller.listConsultantProfilesForReview);
router.post('/admin/profiles/:userId/decision', authenticate, requireAdmin, controller.decideConsultantProfileApproval);

module.exports = router;
