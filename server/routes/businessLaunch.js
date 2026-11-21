const express = require('express');
const router = express.Router();
const { authenticate, authenticateIfPresent } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { generalLimiter, strictLimiter } = require('../middleware/rateLimiter');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const attachmentController = require('../controllers/businessLaunchAttachmentController');
const {
  submitBusinessLaunchRequest,
  getBusinessLaunchRequests,
  getBusinessLaunchRequest,
  exportBusinessLaunchRequests,
  updateBusinessLaunchRequestStatus,
  getUserBusinessLaunchRequests,
  searchBusinessLaunchRequests,
  getMatchedConsultants,
  assignConsultant,
} = require('../controllers/businessLaunchController');
const {
  addNote,
  getNotes,
  deleteNote,
  sendCustomMessage,
  getMessages,
  getMessageTemplates,
} = require('../controllers/businessLaunchNotesController');
const proposalController = require('../controllers/consultantProposalController');
const deliverableController = require('../controllers/consultantDeliverableController');
const changeController = require('../controllers/consultantChangeController');

// Public route: Submit a new Business Launch request
router.post(
  '/submit',
  generalLimiter,
  authenticateIfPresent,
  submitBusinessLaunchRequest
);

// User routes: View own requests
router.get(
  '/my-requests',
  authenticate,
  getUserBusinessLaunchRequests
);

// Authenticated route: Search requests by email - leaks PII (skill_description,
// target_market, urgency, package_price), so requires login + strict rate limit.
// The controller additionally enforces that non-admins can only search their own email.
router.get(
  '/search',
  strictLimiter,
  authenticate,
  searchBusinessLaunchRequests
);

// Admin routes: View and manage requests
router.get(
  '/consultants',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  getMatchedConsultants
);

router.get(
  '/requests',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  getBusinessLaunchRequests
);

// ADM-093: PII export runs server-side and is audited. This route must stay
// ABOVE /requests/:id or Express will treat "export" as an :id.
router.get(
  '/requests/export',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  strictLimiter,
  exportBusinessLaunchRequests
);

router.get(
  '/requests/:id',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  getBusinessLaunchRequest
);

router.patch(
  '/requests/:id',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  updateBusinessLaunchRequestStatus
);

router.post(
  '/requests/:id/assign-consultant',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  assignConsultant
);

// Group 10 Slice D (521-525): the client reads their proposals and
// approves or rejects the sent version. The controller enforces the
// client-owner rule (user_id, or verified-email guest recovery) or admin.
router.get(
  '/requests/:id/proposals',
  authenticate,
  proposalController.listProposals
);
router.get(
  '/requests/:id/proposals/:proposalId',
  authenticate,
  proposalController.getProposal
);
router.post(
  '/requests/:id/proposals/:proposalId/approve',
  authenticate,
  proposalController.approveProposal
);
router.post(
  '/requests/:id/proposals/:proposalId/reject',
  authenticate,
  proposalController.rejectProposal
);

// Group 10 Slice E (526-530): deliver work. The client reads the
// milestone board for their engagement session, exchanges documents on
// a milestone, leaves feedback, and accepts milestones.
router.get(
  '/requests/:id/session',
  authenticate,
  deliverableController.getEngagementSession
);
router.get(
  '/sessions/:sessionId/deliverables',
  authenticate,
  deliverableController.listDeliverables
);
router.post(
  '/sessions/:sessionId/deliverables/:deliverableId/documents',
  authenticate,
  upload.single('file'),
  validateFileUpload,
  deliverableController.attachDocument
);
router.get(
  '/sessions/:sessionId/deliverables/:deliverableId/documents',
  authenticate,
  deliverableController.listDocuments
);
router.get(
  '/documents/:documentId/download',
  authenticate,
  deliverableController.downloadDocument
);
router.post(
  '/sessions/:sessionId/feedback',
  authenticate,
  deliverableController.submitFeedback
);
router.post(
  '/sessions/:sessionId/deliverables/:deliverableId/accept',
  authenticate,
  deliverableController.acceptDeliverable
);

// Group 10 Slice F (531-535): handle changes. The client files change
// requests, decides the consultant's requests, and pauses/resumes the
// engagement; the change history shows requests and events together.
router.post(
  '/sessions/:sessionId/change-requests',
  authenticate,
  changeController.createChangeRequest
);
router.get(
  '/sessions/:sessionId/change-requests',
  authenticate,
  changeController.listChangeRequests
);
router.post(
  '/sessions/:sessionId/change-requests/:requestId/approve',
  authenticate,
  changeController.decideChangeRequest('approved')
);
router.post(
  '/sessions/:sessionId/change-requests/:requestId/reject',
  authenticate,
  changeController.decideChangeRequest('rejected')
);
router.post(
  '/sessions/:sessionId/change-requests/:requestId/withdraw',
  authenticate,
  changeController.withdrawChangeRequest
);
router.get(
  '/sessions/:sessionId/history',
  authenticate,
  changeController.getEngagementHistory
);
router.post(
  '/sessions/:sessionId/pause',
  authenticate,
  changeController.pauseEngagement
);
router.post(
  '/sessions/:sessionId/resume',
  authenticate,
  changeController.resumeEngagement
);

router.post('/requests/:id/attachments', authenticate, generalLimiter, upload.single('file'), validateFileUpload, attachmentController.uploadAttachment);
router.get('/requests/:id/attachments', authenticate, attachmentController.listAttachments);
router.get('/attachments/:attachmentId/download', authenticate, attachmentController.downloadAttachment);
router.delete('/attachments/:attachmentId', authenticate, attachmentController.deleteAttachment);

// Notes endpoints (admin only)
router.post(
  '/requests/:id/notes',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  addNote
);

router.get(
  '/requests/:id/notes',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  getNotes
);

router.delete(
  '/notes/:noteId',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  deleteNote
);

// Custom message endpoints (admin only)
router.post(
  '/requests/:id/send-message',
  authenticate,
  requireAdmin, requirePermission('message_users'),
  sendCustomMessage
);

router.get(
  '/requests/:id/messages',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  getMessages
);

// Public message templates
router.get(
  '/message-templates',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  getMessageTemplates
);

module.exports = router;
