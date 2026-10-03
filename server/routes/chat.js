const router = require('express').Router();
const {
  chatMessage,
  profileChatMessage,
  guestProfileChatSession,
  claimGuestProfileChatSessions,
  startGuestProfileChatVerification,
  verifyGuestProfileChatCode,
  resendGuestProfileChatCode,
  createMessengerGuestBooking,
  financialAdvisor,
  transcribeAudio,
  getProfileContext,
} = require('../controllers/chatController');
const { chatLimiter, profileChatLimiter, authLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const logger = require('../utils/logger');

// Middleware: attach user if token present and valid; continue as unauthenticated otherwise.
// Never sends 401/403 - an expired or invalid token simply means req.user stays undefined,
// which the profileChatMessage handler treats as "AI mode".
const jwt = require('jsonwebtoken');
const pool = require('../db');
const chatQuotes = require('../controllers/chatQuotesController');
const chatPop = require('../controllers/chatProofOfPaymentController');
const chatAgreements = require('../controllers/chatAgreementsController');
const chatCreditPay = require('../controllers/chatOxsteedCreditPaymentController');
const chatBookingRequests = require('../controllers/chatBookingRequestsController');
const chatClientIntakes = require('../controllers/chatClientIntakeController');

const {
  extractGuestAuth,
  loadVerifiedGuestSession,
  tokenMatchesProfile,
} = require('../services/guestProfileChatVerification');

const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const hasGuestHeader =
    header.startsWith('Guest ') ||
    Boolean(String(req.headers['x-guest-profile-token'] || '').trim());
  if (hasGuestHeader) {
    try {
      const { token, sessionId } = extractGuestAuth(req);
      const session = await loadVerifiedGuestSession(token, sessionId);
      if (session) {
        const helperId = req.body?.helperId || req.body?.helper_id;
        const businessId = req.body?.businessId ?? req.body?.business_id ?? null;
        // When body omits ids (rare), still attach session; handler re-checks binding.
        if (!helperId || tokenMatchesProfile(session, { helperId, businessId })) {
          req.guestSession = session;
          req.guestToken = token;
        }
      }
    } catch {
      // Invalid guest token - continue without guest session
    }
    return next();
  }
  if (!header.startsWith('Bearer ')) return next();
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
    // Expired, invalid, or DB error - continue as unauthenticated
  }
  next();
};

// Public - no auth required for support chat. optionalAuth attaches req.user
// when a valid Bearer <redacted> present so signed-in users keep the Meta-first
// provider chain; anonymous requests skip Meta entirely (free tier only).
router.post('/message', chatLimiter, optionalAuth, chatMessage);

// POST /api/chat/financial-advisor
// Personalized financial advice - requires authentication
router.post('/financial-advisor', chatLimiter, authenticate, financialAdvisor);

// POST /api/chat/profile-message
// Auth optional - authenticated users get live routing when helper is online;
// unauthenticated users get AI-only mode.
router.post('/profile-message', chatLimiter, profileChatLimiter, optionalAuth, profileChatMessage);


// Guest email verification for profile messenger (OTP → bound guest token)
router.post('/sessions/guest/verify/start', authLimiter, profileChatLimiter, startGuestProfileChatVerification);
router.post('/sessions/guest/verify', authLimiter, profileChatLimiter, verifyGuestProfileChatCode);
router.post('/sessions/guest/verify/resend', authLimiter, profileChatLimiter, resendGuestProfileChatCode);

// GET /api/chat/sessions/guest/messages - verified guest history for the bound session
router.get('/sessions/guest/messages', chatLimiter, optionalAuth, async (req, res) => {
  try {
    const session = req.guestSession;
    if (!session) return res.status(401).json({ error: 'Verified guest session required', code: 'auth_error' });
    const { rows } = await pool.query(
      `SELECT id, sender_type, sender_name, message, created_at
         FROM guest_profile_chat_messages
        WHERE session_id = $1
        ORDER BY created_at ASC
        LIMIT 500`,
      [session.id],
    );
    res.json(rows.map((row) => ({
      id: String(row.id),
      itemType: 'message',
      authorType: row.sender_type === 'guest' ? 'user' : 'helper_human',
      sender_name: row.sender_name,
      content: row.message,
      timestamp: row.created_at,
    })));
  } catch (err) {
    logger.error('Failed to load guest chat history', { error: err.message });
    res.status(500).json({ error: 'Failed to load guest chat history' });
  }
});


// ── In-chat quotes (helper + business) ───────────────────────────────────────
router.get('/quotes/list', chatLimiter, authenticate, chatQuotes.listForThread);
router.get('/quotes/history', chatLimiter, authenticate, chatQuotes.listHistory);
router.get('/quotes/guest-history', chatLimiter, optionalAuth, chatQuotes.listGuestHistory);
router.post('/quotes/share', chatLimiter, authenticate, chatQuotes.shareQuote);
router.get('/quotes/:kind/:id', chatLimiter, optionalAuth, chatQuotes.getQuote);
router.post('/quotes/:kind/:id/respond', chatLimiter, optionalAuth, chatQuotes.respondQuote);
router.post('/quotes/:kind/:id/revise', chatLimiter, authenticate, chatQuotes.reviseQuote);
router.post('/quotes/:kind/:id/schedule', chatLimiter, optionalAuth, chatQuotes.scheduleFromQuote);


// ── In-chat OxSteed Credit payments ──────────────────────────────────────────
router.post('/payments/oxsteed-credit', chatLimiter, authenticate, chatCreditPay.payWithOxsteedCredit);
router.post('/payments/request', chatLimiter, authenticate, chatCreditPay.requestPayment);
router.get('/payments/request/:id', chatLimiter, authenticate, chatCreditPay.getPaymentRequest);
router.post('/payments/:id/refund', chatLimiter, authenticate, chatCreditPay.refundChatCreditPayment);
router.get('/payments/credit-hint', chatLimiter, authenticate, chatCreditPay.getCreditPayHint);

// ── In-chat proof of payment + agreements ────────────────────────────────────
router.post('/pop/share', chatLimiter, optionalAuth, upload.single('file'), validateFileUpload, chatPop.sharePop);
router.get('/pop/:id', chatLimiter, optionalAuth, chatPop.getPop);
router.get('/pop/:id/download', chatLimiter, optionalAuth, chatPop.downloadPop);
router.post('/pop/:id/confirm', chatLimiter, authenticate, chatPop.confirmPop);

router.post('/agreements/share', chatLimiter, authenticate, upload.single('file'), validateFileUpload, chatAgreements.shareAgreement);
router.get('/agreements/:id', chatLimiter, optionalAuth, chatAgreements.getAgreement);
router.get('/agreements/:id/download', chatLimiter, optionalAuth, chatAgreements.downloadAgreement);
router.post('/agreements/:id/respond', chatLimiter, optionalAuth, chatAgreements.respondAgreement);
router.post('/agreements/:id/revise', chatLimiter, authenticate, upload.single('file'), validateFileUpload, chatAgreements.reviseAgreement);



// ── In-chat booking request accept / decline / propose ───────────────────────
router.post('/booking-requests', chatLimiter, authenticate, chatBookingRequests.createChatBookingRequest);
router.get('/booking-requests/:id', chatLimiter, optionalAuth, chatBookingRequests.getBookingRequest);
router.post('/booking-requests/:id/accept', chatLimiter, authenticate, chatBookingRequests.acceptBookingRequest);
router.post('/booking-requests/:id/decline', chatLimiter, authenticate, chatBookingRequests.declineBookingRequest);
router.post('/booking-requests/:id/propose', chatLimiter, authenticate, chatBookingRequests.proposeBookingTime);
router.post('/booking-requests/:id/customer-accept', chatLimiter, optionalAuth, chatBookingRequests.customerAcceptBookingRequest);
router.post('/booking-requests/:id/customer-decline', chatLimiter, optionalAuth, chatBookingRequests.customerDeclineBookingRequest);

// POST /api/chat/sessions/guest/booking-request — verified guest pending booking from messenger slot
router.post('/sessions/guest/booking-request', chatLimiter, profileChatLimiter, optionalAuth, createMessengerGuestBooking);

// Optional client intake forms shared inside a helper/business guest chat.
router.post('/intakes', chatLimiter, authenticate, chatClientIntakes.createIntake);
router.get('/intakes/:id', chatLimiter, optionalAuth, chatClientIntakes.getIntake);
router.post('/intakes/:id/respond', chatLimiter, optionalAuth, chatClientIntakes.respondToIntake);

// POST /api/chat/sessions/guest - public guest inquiry (helper must allow guest contact)
router.post('/sessions/guest', profileChatLimiter, guestProfileChatSession);

// POST /api/chat/sessions/guest/claim - attach matching guest inquiries after signup/login
router.post('/sessions/guest/claim', chatLimiter, authenticate, claimGuestProfileChatSessions);

// GET /api/chat/profile-context/:type/:id — owner-only transparency (helper UUID or business id)
router.get('/profile-context/:type/:id', chatLimiter, authenticate, getProfileContext);

// POST /api/chat/transcribe
// Transcribe audio using OpenRouter (fallback when Web Speech confidence is low)
// Requires authentication.
router.post('/transcribe', chatLimiter, authenticate, upload.single('audio'), validateFileUpload, transcribeAudio);

// POST /api/chat/feedback - thumbs up/down on AI replies (best-effort logging)
router.post('/feedback', chatLimiter, (req, res) => {
  const { value, messageContent, pageContext } = req.body;
  if (value === 'up' || value === 'down') {
    // Sanitize path - only accept relative paths to prevent log injection
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
