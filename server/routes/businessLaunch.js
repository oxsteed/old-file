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
