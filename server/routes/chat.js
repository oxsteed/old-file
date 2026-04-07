const router = require('express').Router();
const { chatMessage, profileChatMessage } = require('../controllers/chatController');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

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

// POST /api/chat/feedback — thumbs up/down on AI replies (best-effort logging)
router.post('/feedback', (req, res) => {
  const { value, messageContent, pageContext } = req.body;
  if (value === 'up' || value === 'down') {
    logger.info('[Chat] Feedback received', {
      value,
      path:    pageContext?.path || null,
      preview: String(messageContent || '').slice(0, 80),
    });
  }
  res.json({ ok: true });
});

module.exports = router;
