// LEGACY guest-to-helper chat routes (/api/guest-chat).
// Not used by PublicProfileMessenger — prefer profile messenger guest gate.
// Kept for older clients and securityHardening tests; do not expand.

const express = require('express');
const router = express.Router();
const {
  createGuestSession,
  sendGuestMessage,
  helperClaimSession,
  sendHelperMessage,
  resolveSession,
  getSession
} = require('../controllers/guestChatController');
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');

// ── Public endpoints (no authentication required) ────────────────────────────────
// Guest creates a new session and sends initial message
router.post(
  '/sessions',
  generalLimiter,
  createGuestSession
);

// Guest sends a message to an existing session
router.post(
  '/sessions/:sessionId/messages',
  generalLimiter,
  sendGuestMessage
);

// Get session and messages (public for now, can be restricted later)
router.get(
  '/sessions/:sessionId',
  generalLimiter,
  getSession
);

// ── Authenticated endpoints (helpers only) ────────────────────────────────────────
// Helper claims a session from AI support
router.post(
  '/sessions/:sessionId/claim',
  authenticate,
  helperClaimSession
);

// Helper sends a message to the guest
router.post(
  '/sessions/:sessionId/messages/helper',
  authenticate,
  sendHelperMessage
);

// Resolve a session (guest or helper)
router.post(
  '/sessions/:sessionId/resolve',
  authenticate,
  resolveSession
);

module.exports = router;
