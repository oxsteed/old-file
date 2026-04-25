const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/consultingFeedbackController');
const { authenticate } = require('../middleware/auth');

// Public endpoint - submit feedback (no auth required for anonymous feedback)
router.post('/:sessionId', feedbackController.submitFeedback);

// Get feedback for a specific session (public)
router.get('/sessions/:sessionId', feedbackController.getSessionFeedback);

// Get all feedback for a consultant (requires auth, admin only)
router.get('/consultant/:consultantId', authenticate, feedbackController.getConsultantFeedback);

module.exports = router;
