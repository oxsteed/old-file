const router = require('express').Router();
const { chatMessage, profileChatMessage, guestProfileChatSession, financialAdvisor, transcribeAudio } = require('../controllers/chatController');
const { chatLimiter, profileChatLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

// Middleware: attach user if token present and valid; continue as unauthenticated otherwise.
// Never sends 401/403 — an expired or invalid token simply means req.user stays undefined,
// which the profileChatMessage handler treats as "AI mode".
const jwt = require('jsonwebtoken');
const pool = require('../db');
const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const { rows } = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.is_active
         FROM users u WHERE u.id = $1`,
      [decoded.id]
    );
    const user = rows[0];
    if (user && user.is_active) req.user = user;
  } catch {
    // Expired, invalid, or DB error — continue as unauthenticated
  }
  next();
};

// Public — no auth required for support chat
router.post('/message', chatLimiter, chatMessage);

// POST /api/chat/financial-advisor
// Personalized financial advice — requires authentication
router.post('/financial-advisor', chatLimiter, authenticate, financialAdvisor);

// POST /api/chat/profile-message
// Auth optional — authenticated users get live routing when helper is online;
// unauthenticated users get AI-only mode.
router.post('/profile-message', chatLimiter, profileChatLimiter, optionalAuth, profileChatMessage);

// POST /api/chat/sessions/guest — public guest inquiry (helper must allow guest contact)
router.post('/sessions/guest', profileChatLimiter, guestProfileChatSession);

// POST /api/chat/transcribe
// Transcribe audio using OpenRouter (fallback when Web Speech confidence is low)
// Requires authentication.
router.post('/transcribe', chatLimiter, authenticate, transcribeAudio);

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
