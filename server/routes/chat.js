const router = require('express').Router();
const { chatMessage, profileChatMessage } = require('../controllers/chatController');
const { authenticate } = require('../middleware/auth');

// Middleware: attach user if token present, but don't reject unauthenticated requests
const optionalAuth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  authenticate(req, res, next);
};

// Public — no auth required for support chat
router.post('/message', chatMessage);

// POST /api/chat/profile-message
// Auth optional — authenticated users get live routing when helper is online;
// unauthenticated users get AI-only mode.
router.post('/profile-message', optionalAuth, profileChatMessage);

module.exports = router;
