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
const { requireHelperCapability } = require('../middleware/requireAccess');
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

// In-chat booking routes serve both customer requests and provider actions.
// Resolve the linked conversation/booking first so business members keep their
// existing business-scope authorization while helper-owned provider actions
// use the progressive helper capability gate.
const requireChatHelperProviderCapability = async (req, res, next) => {
  try {
    const bookingId = req.params?.id;
    const conversationId = req.body?.conversationId || req.body?.conversation_id;
    const query = bookingId
      ? ['SELECT helper_id, business_id FROM booking_requests WHERE id = $1', bookingId]
      : ['SELECT helper_id, business_id FROM conversations WHERE id = $1', conversationId];
    if (!query[1]) return next();
    const { rows } = await pool.query(query[0], [query[1]]);
    const target = rows[0];
    if (target && !target.business_id && String(target.helper_id) === String(req.user?.id)) {
      return requireHelperCapability(req, res, next);
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

const requireChatHelperAgreementCapability = async (req, res, next) => {
  try {
    const agreementId = req.params?.id;
    const conversationId = req.body?.conversationId || req.body?.conversation_id;
    const guestSessionId = req.body?.guestSessionId || req.body?.guest_session_id;
    const query = agreementId
      ? ['SELECT helper_id, business_id FROM chat_agreements WHERE id = $1', agreementId]
      : conversationId
        ? ['SELECT helper_id, business_id FROM conversations WHERE id = $1', conversationId]
        : guestSessionId
          ? ['SELECT helper_id, business_id FROM guest_profile_chat_inbound WHERE id = $1', guestSessionId]
          : [null, null];
    if (!query[1]) return next();
    const { rows } = await pool.query(query[0], [query[1]]);
    const target = rows[0];
    if (target && !target.business_id && String(target.helper_id) === String(req.user?.id)) {
      return requireHelperCapability(req, res, next);
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

// Quote sharing/revision supports both business and helper quotes. Only the
// helper provider mutations need progressive helper access; business quotes
// continue through their existing membership/ownership checks.
const requireHelperQuoteCapability = (req, res, next) => {
  const kind = String(req.body?.kind || req.body?.quoteKind || req.params?.kind || '').toLowerCase();
  if (kind !== 'helper') return next();
  return requireHelperCapability(req, res, next);
};

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
// same local Ollama provider chain.
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
router.post('/actions/:actionId/result', chatLimiter, authenticate, rejectImpersonated, recordSupportActionResult);
router.post('/actions/:actionId/dismiss', chatLimiter, authenticate, rejectImpersonated, dismissSupportAction);

// POST /api/chat/financial-advisor
// Personalized financial advice - requires authentication
router.post('/financial-advisor', chatLimiter, authenticate, rejectImpersonated, financialAdvisor);

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
router.post('/quotes/share', chatLimiter, authenticate, requireHelperQuoteCapability, chatQuotes.shareQuote);
router.get('/quotes/:kind/:id', chatLimiter, optionalAuth, chatQuotes.getQuote);
router.post('/quotes/:kind/:id/respond', chatLimiter, optionalAuth, chatQuotes.respondQuote);
router.post('/quotes/:kind/:id/revise', chatLimiter, authenticate, requireHelperQuoteCapability, chatQuotes.reviseQuote);
router.post('/quotes/:kind/:id/schedule', chatLimiter, optionalAuth, chatQuotes.scheduleFromQuote);


// ── In-chat OxSteed Credit payments ──────────────────────────────────────────
// Review P2-7-F07: in-chat OxSteed Credit payments are a checkout surface.
router.post('/payments/oxsteed-credit', chatLimiter, authenticate, checkRestrictions('checkout'), paymentsLimiter, rejectImpersonated, chatCreditPay.payWithOxsteedCredit);
router.post('/payments/request', chatLimiter, authenticate, rejectImpersonated, chatCreditPay.requestPayment);
router.get('/payments/request/:id', chatLimiter, authenticate, chatCreditPay.getPaymentRequest);
router.post('/payments/:id/refund', chatLimiter, authenticate, paymentsLimiter, rejectImpersonated, chatCreditPay.refundChatCreditPayment);
router.get('/payments/credit-hint', chatLimiter, authenticate, chatCreditPay.getCreditPayHint);

// ── In-chat proof of payment + agreements ────────────────────────────────────
router.post('/pop/share', chatLimiter, optionalAuth, upload.single('file'), validateFileUpload, chatPop.sharePop);
router.get('/pop/:id', chatLimiter, optionalAuth, chatPop.getPop);
router.get('/pop/:id/download', chatLimiter, optionalAuth, chatPop.downloadPop);
router.post('/pop/:id/confirm', chatLimiter, authenticate, chatPop.confirmPop);

router.post('/agreements/share', chatLimiter, authenticate, requireChatHelperAgreementCapability, upload.single('file'), validateFileUpload, chatAgreements.shareAgreement);
router.get('/agreements/:id', chatLimiter, optionalAuth, chatAgreements.getAgreement);
router.get('/agreements/:id/download', chatLimiter, optionalAuth, chatAgreements.downloadAgreement);
router.post('/agreements/:id/respond', chatLimiter, optionalAuth, chatAgreements.respondAgreement);
router.post('/agreements/:id/revise', chatLimiter, authenticate, requireChatHelperAgreementCapability, upload.single('file'), validateFileUpload, chatAgreements.reviseAgreement);



// ── In-chat booking request accept / decline / propose ───────────────────────
router.post('/booking-requests', chatLimiter, authenticate, requireChatHelperProviderCapability, chatBookingRequests.createChatBookingRequest);
router.get('/booking-requests/:id', chatLimiter, optionalAuth, chatBookingRequests.getBookingRequest);
router.post('/booking-requests/:id/accept', chatLimiter, authenticate, rejectImpersonated, requireChatHelperProviderCapability, chatBookingRequests.acceptBookingRequest);
router.post('/booking-requests/:id/decline', chatLimiter, authenticate, rejectImpersonated, requireChatHelperProviderCapability, chatBookingRequests.declineBookingRequest);
router.post('/booking-requests/:id/propose', chatLimiter, authenticate, rejectImpersonated, requireChatHelperProviderCapability, chatBookingRequests.proposeBookingTime);
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
// Transcribe audio using a self-hosted transcriber (fallback when Web Speech
// confidence is low). No server-side transcriber is deployed yet, so this
// currently answers 501; audio is never sent to an external transcription or
// AI API (security review F-04: local-only).
// Requires authentication.
router.post('/transcribe', chatLimiter, authenticate, upload.single('audio'), validateFileUpload, transcribeAudio);

// POST /api/chat/feedback - thumbs up/down (+ reason, un-toggle) on one AI
// reply, stored for quality metrics (item 5, migration 915).
router.post('/feedback', chatLimiter, optionalAuth, supportChatFeedback);

module.exports = router;
