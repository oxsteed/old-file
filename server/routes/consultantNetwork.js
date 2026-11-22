const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const controller = require('../controllers/consultantNetworkController');
const screeningController = require('../controllers/consultantScreeningController');
const schedulingController = require('../controllers/consultantSchedulingController');
const proposalController = require('../controllers/consultantProposalController');
const deliverableController = require('../controllers/consultantDeliverableController');
const changeController = require('../controllers/consultantChangeController');
const confidentialityController = require('../controllers/consultantConfidentialityController');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');

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
// Group 10 Slice E (526-530): deliver work. The milestone board runs on
// consulting_deliverables: start-engagement seeds it from the approved
// proposal, the consultant moves milestones and delivers drafts, and
// documents exchange on a milestone with visibility + signed URLs.
router.post('/referrals/:requestId/start-engagement', authenticate, deliverableController.startEngagement);
router.get('/engagements', authenticate, deliverableController.listMyEngagements);
router.get('/sessions/:sessionId/deliverables', authenticate, deliverableController.listDeliverables);
router.patch('/sessions/:sessionId/deliverables/:deliverableId/status', authenticate, deliverableController.updateDeliverableStatus);
router.post('/sessions/:sessionId/deliverables/:deliverableId/deliver-draft', authenticate, deliverableController.deliverDraft);
router.post('/sessions/:sessionId/deliverables/:deliverableId/documents', authenticate, upload.single('file'), validateFileUpload, deliverableController.attachDocument);
router.get('/sessions/:sessionId/deliverables/:deliverableId/documents', authenticate, deliverableController.listDocuments);
router.get('/documents/:documentId/download', authenticate, deliverableController.downloadDocument);
// Group 10 Slice F (531-535): handle changes. Change requests (scope,
// deadline, fee) with approval and history, plus engagement pause/resume.
router.post('/sessions/:sessionId/change-requests', authenticate, changeController.createChangeRequest);
router.get('/sessions/:sessionId/change-requests', authenticate, changeController.listChangeRequests);
router.post('/sessions/:sessionId/change-requests/:requestId/approve', authenticate, changeController.decideChangeRequest('approved'));
router.post('/sessions/:sessionId/change-requests/:requestId/reject', authenticate, changeController.decideChangeRequest('rejected'));
router.post('/sessions/:sessionId/change-requests/:requestId/withdraw', authenticate, changeController.withdrawChangeRequest);
router.get('/sessions/:sessionId/history', authenticate, changeController.getEngagementHistory);
router.post('/sessions/:sessionId/pause', authenticate, changeController.pauseEngagement);
router.post('/sessions/:sessionId/resume', authenticate, changeController.resumeEngagement);
// Group 10 Slice G (536-540): maintain confidentiality. Participants,
// confidentiality acknowledgment, document sharing, and the record
// export on the engagement session.
router.get('/sessions/:sessionId/participants', authenticate, confidentialityController.listParticipants);
router.post('/sessions/:sessionId/participants', authenticate, confidentialityController.addParticipant);
router.delete('/sessions/:sessionId/participants/:participantId', authenticate, confidentialityController.removeParticipant);
router.get('/sessions/:sessionId/confidentiality', authenticate, confidentialityController.getAcknowledgmentStatus);
router.post('/sessions/:sessionId/confidentiality/acknowledge', authenticate, confidentialityController.acknowledgeConfidentiality);
router.patch('/sessions/:sessionId/deliverables/:deliverableId/documents/:documentId', authenticate, confidentialityController.updateDocumentSharing);
router.get('/sessions/:sessionId/export', authenticate, confidentialityController.exportEngagementRecord);

// Public specialty profile (506). No auth: only approved, active profiles
// are ever returned; anything else 404s.
router.get('/public/:userId', controller.getPublicConsultantProfile);
// Admin profile approval workflow (504).
router.get('/admin/profiles', authenticate, requireAdmin, controller.listConsultantProfilesForReview);
router.post('/admin/profiles/:userId/decision', authenticate, requireAdmin, controller.decideConsultantProfileApproval);

module.exports = router;
