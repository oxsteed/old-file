const router = require('express').Router();
const { chatMessage, profileChatMessage } = require('../controllers/chatController');
const { authenticate } = require('../middleware/auth');
const { chatLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');

// Middleware: attach user if token present, but don't reject unauthenticated requests
const optionalAuth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  authenticate(req, res, next);
};

// Public — no auth required for support chat
router.post('/message', chatLimiter, chatMessage);

// POST /api/chat/profile-message
// Auth optional — authenticated users get live routing when helper is online;
// unauthenticated users get AI-only mode.
router.post('/profile-message', chatLimiter, optionalAuth, profileChatMessage);

// POST /api/chat/feedback — thumbs up/down on AI replies (best-effort logging)
router.post('/feedback', chatLimiter, (req, res) => {
  const { value, messageContent, pageContext } = req.body;
  if (value === 'up' || value === 'down') {
    // Sanitize path — only accept relative paths to prevent log injection
    const rawPath = String(pageContext?.path || '');
    const safePath = rawPath.startsWith('/') ? rawPath.slice(0, 200) : null;
    logger.info('[Chat] Feedback received', {
      value,
      path:    safePath,
      preview: String(messageContent || '').slice(0, 80),
    });
  }
  res.json({ ok: true });
});

module.exports = router;
