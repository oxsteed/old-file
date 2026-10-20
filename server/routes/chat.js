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
  clearSupportThread,
  getSupportThread,
  confirmSupportAction,
  recordSupportActionResult,
  dismissSupportAction,
  supportChatFeedback,
  getSupportNudges,
} = require('../controllers/chatController');
const { chatLimiter, supportChatLimiter, profileChatLimiter, authLimiter, paymentsLimiter } = require('../middleware/rateLimiter');
const { authenticate, optionalAuth: sharedOptionalAuth } = require('../middleware/auth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const checkRestrictions = require('../middleware/checkRestrictions');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const logger = require('../utils/logger');
const pool = require('../db');

// Preserve verified guest-profile sessions, then delegate normal authentication
// to the shared optionalAuth implementation. The shared middleware accepts both
// the httpOnly web access cookie and Bearer tokens, while also applying
// revocation and suspension checks.
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
  return sharedOptionalAuth(req, res, next);
};

// Public - no auth required for support chat. optionalAuth attaches req.user
// when a valid web cookie or Bearer token is present, so signed-in users get
// their account snapshot and server-side thread memory. Every caller uses the
// same OpenRouter -> Ollama provider chain.
// supportChatLimiter runs after optionalAuth so signed-in users are limited
// per user (40 / 10 min) and guests per IP (20 / 10 min).
router.post('/message', optionalAuth, supportChatLimiter, chatMessage);

// DELETE /api/chat/support-thread - clear the signed-in user's server-side
// AI support memory ("Clear conversation" in the widget).
router.delete('/support-thread', chatLimiter, authenticate, clearSupportThread);
// GET /api/chat/support-thread - the saved server conversation (item 10).
router.get('/support-thread', chatLimiter, authenticate, getSupportThread);
// GET /api/chat/nudges - proactive nudges from the user's own state (item 9).
router.get('/nudges', chatLimiter, authenticate, getSupportNudges);
// In-chat actions (item 4): confirm re-checks ownership/state server-side and
// returns the existing endpoint to call with the user's session; result and
// dismiss complete the audit row (support_chat_actions, migration 914).
router.post('/actions/:actionId/confirm', chatLimiter, authenticate, rejectImpersonated, confirmSupportAction);
router.post('/actions/:actionId/result', chatLimiter, authenticate, recordSupportActionResult);
router.post('/actions/:actionId/dismiss', chatLimiter, authenticate, dismissSupportAction);

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
// Review P2-7-F07: in-chat OxSteed Credit payments are a checkout surface.
router.post('/payments/oxsteed-credit', chatLimiter, authenticate, checkRestrictions('checkout'), paymentsLimiter, rejectImpersonated, chatCreditPay.payWithOxsteedCredit);
router.post('/payments/request', chatLimiter, authenticate, chatCreditPay.requestPayment);
router.get('/payments/request/:id', chatLimiter, authenticate, chatCreditPay.getPaymentRequest);
router.post('/payments/:id/refund', chatLimiter, authenticate, paymentsLimiter, rejectImpersonated, chatCreditPay.refundChatCreditPayment);
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
router.post('/intakes/:id/follow-up', chatLimiter, authenticate, chatClientIntakes.addFollowUpRound);

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

// POST /api/chat/feedback - thumbs up/down (+ reason, un-toggle) on one AI
// reply, stored for quality metrics (item 5, migration 915).
router.post('/feedback', chatLimiter, optionalAuth, supportChatFeedback);

module.exports = router;
