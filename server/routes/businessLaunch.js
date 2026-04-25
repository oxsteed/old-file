const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { generalLimiter, strictLimiter } = require('../middleware/rateLimiter');
const {
  submitBusinessLaunchRequest,
  getBusinessLaunchRequests,
  getBusinessLaunchRequest,
  updateBusinessLaunchRequestStatus,
  getUserBusinessLaunchRequests,
  searchBusinessLaunchRequests,
} = require('../controllers/businessLaunchController');
const {
  addNote,
  getNotes,
  deleteNote,
  sendCustomMessage,
  getMessages,
  getMessageTemplates,
} = require('../controllers/businessLaunchNotesController');

// Public route: Submit a new Business Launch request
router.post(
  '/submit',
  generalLimiter,
  submitBusinessLaunchRequest
);

// User routes: View own requests
router.get(
  '/my-requests',
  authenticate,
  getUserBusinessLaunchRequests
);

// Authenticated route: Search requests by email — leaks PII (skill_description,
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
  '/requests',
  authenticate,
  requireAdmin,
  getBusinessLaunchRequests
);

router.get(
  '/requests/:id',
  authenticate,
  requireAdmin,
  getBusinessLaunchRequest
);

router.patch(
  '/requests/:id',
  authenticate,
  requireAdmin,
  updateBusinessLaunchRequestStatus
);

// Notes endpoints (admin only)
router.post(
  '/requests/:id/notes',
  authenticate,
  requireAdmin,
  addNote
);

router.get(
  '/requests/:id/notes',
  authenticate,
  requireAdmin,
  getNotes
);

router.delete(
  '/notes/:noteId',
  authenticate,
  requireAdmin,
  deleteNote
);

// Custom message endpoints (admin only)
router.post(
  '/requests/:id/send-message',
  authenticate,
  requireAdmin,
  sendCustomMessage
);

router.get(
  '/requests/:id/messages',
  authenticate,
  requireAdmin,
  getMessages
);

// Public message templates
router.get(
  '/message-templates',
  authenticate,
  requireAdmin,
  getMessageTemplates
);

module.exports = router;
