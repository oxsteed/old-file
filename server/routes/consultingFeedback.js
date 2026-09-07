const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/consultingFeedbackController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { generalLimiter, strictLimiter } = require('../middleware/rateLimiter');

// Public endpoint - the emailed, single-use token proves access to this session.
router.post('/:sessionId/:token', strictLimiter, feedbackController.submitFeedback);

// Get feedback for a specific session - requires auth (feedback may include PII).
router.get('/sessions/:sessionId', authenticate, feedbackController.getSessionFeedback);

// Get all feedback for a consultant - admin only (BI / consultant performance data).
router.get(
  '/consultant/:consultantId',
  generalLimiter,
  authenticate,
  requireAdmin,
  feedbackController.getConsultantFeedback,
);

module.exports = router;
