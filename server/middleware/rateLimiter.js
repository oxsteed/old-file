const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// Shared Redis client - created once in utils/redis.js, reused here.
// Falls back gracefully to in-memory when Redis is unavailable.
const redisClient = require('../utils/redis');
let RedisStore = null;

if (redisClient) {
  try {
    RedisStore = require('rate-limit-redis').default;
    logger.info('Rate limiter: using Redis store');
  } catch (err) {
    logger.warn('Rate limiter: rate-limit-redis unavailable - falling back to memory', { message: err.message });
  }
} else {
  logger.info('Rate limiter: Redis not available - using in-memory store (not suitable for multi-instance)');
}

// Helper to create a unique RedisStore per limiter
function createStoreOption(prefix) {
  if (redisClient && RedisStore) {
    return {
      store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
        prefix: prefix,
      }),
    };
  }
  return {};
}

// SECURITY: verifies the Authorization Bearer token for real instead of
// trusting the syntactic presence of a "Bearer ..." header. A bogus or
// plausible-but-invalid token (expired, wrong signature, wrong secret) must
// NOT promote a request into the larger authenticated bucket; such requests
// stay in the anonymous bucket so the limiter actually limits them.
//
// Returns the JWT subject id when the header carries a valid HS256 JWT,
// otherwise null. The result is cached on the request so skip() and
// keyGenerator() share a single verification per request.
function getVerifiedBearerUserId(req) {
  if (req._verifiedBearer !== undefined) return req._verifiedBearer;
  const header = req.headers.authorization;
  let userId = null;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(header.slice('Bearer '.length), process.env.JWT_SECRET, { algorithms: ['HS256'] });
      if (decoded && decoded.id != null) userId = decoded.id;
    } catch {
      // Expired, malformed, or wrongly-signed token - treat as anonymous.
      userId = null;
    }
  }
  req._verifiedBearer = userId;
  return userId;
}

// General API rate limiter: 200 requests per 15 minutes per IP (unauthenticated only)
const generalLimiter = rateLimit({
  ...createStoreOption('rl:general:'),
  windowMs: 15 * 60 * 1000,
  max: 200,
  // Skip only requests with a VERIFIED Bearer token - those are handled by
  // authenticatedLimiter. Garbage or invalid tokens stay in this bucket.
  skip: (req) => getVerifiedBearerUserId(req) !== null,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please try again later.',
    retryAfter: '15 minutes',
  },
});

// Authenticated API rate limiter: 500 requests per 15 minutes per user ID.
// Keyed by user ID so each account gets its own bucket regardless of IP
// (avoids penalising everyone on a shared network).
const authenticatedLimiter = rateLimit({
  ...createStoreOption('rl:auth_user:'),
  windowMs: 15 * 60 * 1000,
  max: 500,
  // Applies only to requests with a verified token. Requests without one, or
  // with an invalid one, are limited by generalLimiter instead (no IP fallback
  // bucket here - the skip guarantees the cached id is non-null).
  skip: (req) => getVerifiedBearerUserId(req) === null,
  keyGenerator: (req) => `user:${getVerifiedBearerUserId(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please try again later.',
    retryAfter: '15 minutes',
  },
});

// Auth rate limiter: 30 attempts per 15 minutes per IP
// Protects login, register, OTP endpoints from brute-force
const authLimiter = rateLimit({
  ...createStoreOption('rl:auth:'),
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts. Please try again in 15 minutes.',
    retryAfter: '15 minutes',
  },
});

// Strict limiter for sensitive operations: 10 per hour per IP
// For password reset, account deletion, data export
const strictLimiter = rateLimit({
  ...createStoreOption('rl:strict:'),
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Rate limit exceeded for this operation. Please try again in 1 hour.',
    retryAfter: '1 hour',
  },
});

// Password reset limiter: 3 per hour per EMAIL (not IP to prevent account enumeration attacks)
// SECURITY: Stricter than strictLimiter to prevent brute-force password resets
const passwordResetLimiter = rateLimit({
  ...createStoreOption('rl:password_reset:'),
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => {
    // Key by email address, not IP
    // This prevents attackers from using multiple IPs to reset the same account
    const email = (req.body?.email || req.query?.email || '').toLowerCase();
    return email || req.ip; // Fallback to IP if email not provided
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many password reset attempts. Please try again in 1 hour.',
    retryAfter: '1 hour',
  },
});

// L2 fix: POST /api/auth/reset-password only reads {token, password}, so the
// email-keyed passwordResetLimiter above always missed and fell back to IP —
// one shared 3/hour budget across every user behind an IP, and reset attempts
// consumed the forgot-password budget. This limiter keys by a hash of the
// presented token instead, throttling token-guessing per token.
const passwordResetVerifyLimiter = rateLimit({
  ...createStoreOption('rl:password_reset_verify:'),
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => {
    const token = req.body?.token;
    if (typeof token === 'string' && token.length > 0) {
      return crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
    }
    return req.ip; // Fallback to IP when no token was presented
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many password reset attempts. Please try again in 1 hour.',
    retryAfter: '1 hour',
  },
});

// AI chat limiter: 20 messages per 10 minutes per IP
// Protects AI inference endpoints from abuse and runaway API costs.
const chatLimiter = rateLimit({
  ...createStoreOption('rl:chat:'),
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many messages sent. Please wait a few minutes before continuing.',
    retryAfter: '10 minutes',
  },
});

// Conversation message limiter: 10 messages per minute per conversation
// Prevents message spam and chat abuse within individual conversations
const conversationMessageLimiter = rateLimit({
  ...createStoreOption('rl:conv_msg:'),
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  keyGenerator: (req) => {
    const { conversationId } = req.params;
    const userId = req.user?.id || req.ip;
    return conversationId ? `conv:${conversationId}:${userId}` : req.ip;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many messages in this conversation. Please slow down.',
    retryAfter: '1 minute',
  },
});

// Signed provider webhooks are unauthenticated by design, so keep a separate
// bounded bucket instead of allowing them to bypass all abuse protection.
const channelWebhookLimiter = rateLimit({
  ...createStoreOption('rl:support_channel_webhook:'),
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: (req) => `channel:${req.params?.channel || 'unknown'}:${req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many support channel webhook requests. Please retry later.',
    retryAfter: '15 minutes',
  },
});

// Profile chat limiter: 5 messages per minute per user
// Prevents spam in guest inquiry and helper contact flows
const profileChatLimiter = rateLimit({
  ...createStoreOption('rl:profile_chat:'),
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  keyGenerator: (req) => {
    // For authenticated users, key by user ID; for guests, key by IP
    return req.user?.id ? `user:${req.user.id}` : req.ip;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many messages sent. Please wait a moment before trying again.',
    retryAfter: '1 minute',
  },
});

// Public Discover unified search - stricter than generalLimiter for anonymous scraping
const discoverLimiter = rateLimit({
  ...createStoreOption('rl:discover:'),
  windowMs: 15 * 60 * 1000,
  max: 40,
  skip: (req) => getVerifiedBearerUserId(req) !== null,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Discover search rate limit exceeded. Please wait a few minutes.',
    retryAfter: '15 minutes',
  },
});

// Authenticated Discover - separate bucket so signed-in users are not capped at guest limits
const discoverAuthLimiter = rateLimit({
  ...createStoreOption('rl:discover_auth:'),
  windowMs: 15 * 60 * 1000,
  max: 200,
  skip: (req) => getVerifiedBearerUserId(req) === null,
  keyGenerator: (req) => `discover:${getVerifiedBearerUserId(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Discover search rate limit exceeded. Please wait a few minutes.',
    retryAfter: '15 minutes',
  },
});

// Geo services limiter: 100 requests per 15 minutes per IP
// Prevents scraping and map API cost spikes.
const geoLimiter = rateLimit({
  ...createStoreOption('rl:geo:'),
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Map service rate limit exceeded. Please try again later.',
    retryAfter: '15 minutes',
  },
});

// Directory listing limiter: 60 requests per 15 minutes per IP
// SECURITY: Prevents bulk enumeration of helpers/jobs (e.g., scraping all 10K helpers)
// 60 requests = 2-3 full enumerations; beyond that requires delay
const directoryLimiter = rateLimit({
  ...createStoreOption('rl:directory:'),
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Directory search rate limit exceeded. Please try again in 15 minutes.',
    retryAfter: '15 minutes',
  },
});

// Invoice creation limiter: 10 per hour per user
// Prevents spam invoice creation and double-billing attacks
const invoiceLimiter = rateLimit({
  ...createStoreOption('rl:invoice:'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  skip: (req) => !req.user,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many invoices created. Please try again later.',
    retryAfter: '1 hour',
  },
});

// Report submission limiter: 10 per hour per user
// Prevents spam reports and abuse of reporting system
const reportLimiter = rateLimit({
  ...createStoreOption('rl:report:'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  skip: (req) => !req.user,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many reports submitted. Please try again later.',
    retryAfter: '1 hour',
  },
});

// Terms acceptance limiter: 5 per hour per user
// Prevents acceptance spam and false acceptance attacks
const termsLimiter = rateLimit({
  ...createStoreOption('rl:terms:'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  skip: (req) => !req.user,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many acceptance attempts. Please try again later.',
    retryAfter: '1 hour',
  },
});

// Per-user chat rate limiter: 100 messages per 5 minutes per user (global across all conversations)
// Prevents chat spam and abuse at the user level, complementing conversation-level limiter
// Falls back to IP for unauthenticated requests
const userChatLimiter = rateLimit({
  ...createStoreOption('rl:user_chat:'),
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100,
  keyGenerator: (req) => {
    // Key by user ID if authenticated, otherwise by IP
    // This ensures each user gets their own bucket regardless of which conversation they're in
    if (req.user?.id) {
      return `user:${req.user.id}`;
    }
    return req.ip;
  },
  skip: (req) => !req.user, // Only applies to authenticated users
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'You are sending messages too quickly. Please wait a moment before sending more.',
    retryAfter: '5 minutes',
  },
});

// Payments limiter: 20 per hour per user
// Protects PaymentIntent creation/capture from abuse and accidental retries.
const paymentsLimiter = rateLimit({
  ...createStoreOption('rl:payments:'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  skip: (req) => !req.user,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many payment attempts. Please try again later.',
    retryAfter: '1 hour',
  },
});

// Stripe Connect account-link limiter: 5 per day per user
// Prevents repeated account link creation and reduces support load.
const connectAccountLimiter = rateLimit({
  ...createStoreOption('rl:connect_account:'),
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 5,
  skip: (req) => !req.user,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many Connect onboarding attempts. Please try again later.',
    retryAfter: '24 hours',
  },
});

// OxSteed Credit mutation limiter: holds, transfers, disputes, and releases
// are financially sensitive even though they are protected by idempotency.
// Keep this bucket separate from general API traffic so a noisy read client
// cannot consume the write budget. Redis makes the limit consistent across
// application instances; the in-memory fallback remains development-only.
//
// Restaurant top-up intent limiter: money-in intent creation is capped per
// user (20 per 15 minutes) so a misbehaving client cannot mint PaymentIntents
// at will. The Stripe PaymentIntent itself stays idempotent per top-up row.
const restaurantTopupIntentLimiter = rateLimit({
  ...createStoreOption('rl:restaurant_topup_intent:'),
  windowMs: 15 * 60 * 1000,
  max: 20,
  skip: (req) => !req.user,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many restaurant top-up attempts. Please wait before trying again.',
    retryAfter: '15 minutes',
  },
});
const creditMutationLimiter = rateLimit({
  ...createStoreOption('rl:oxsteed_credit_mutation:'),
  windowMs: 15 * 60 * 1000,
  max: 60,
  skip: (req) => !req.user,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many OxSteed Credit changes. Please wait before trying again.',
    retryAfter: '15 minutes',
  },
});

// The restaurant wallet is a separate stored-value rail from OxSteed Credit,
// but its holds, transfers, payment sessions, and load approvals are equally
// sensitive. Keep a distinct bucket so wallet activity cannot consume the
// OxSteed Credit budget and so normal restaurant reads remain unaffected.
const restaurantCreditMutationLimiter = rateLimit({
  ...createStoreOption('rl:restaurant_credit_mutation:'),
  windowMs: 15 * 60 * 1000,
  max: 60,
  skip: (req) => !req.user,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many restaurant credit changes. Please wait before trying again.',
    retryAfter: '15 minutes',
  },
});

// OxSteed Credit orders create a new stored-value spend attempt when they
// create a food order. Keep this limit separate from holds and disputes so a
// customer cannot exhaust the mutation budget with order retries, while
// preserving the normal order limits for non-Credit payment methods.
const creditPurchaseLimiter = rateLimit({
  ...createStoreOption('rl:oxsteed_credit_purchase:'),
  windowMs: 15 * 60 * 1000,
  max: 30,
  skip: (req) => {
    const requestedMode = req.body?.paymentMode || req.body?.payment_mode;
    return !['oxsteed_credit', 'oxsteedCredit', 'credit'].includes(requestedMode);
  },
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many OxSteed Credit purchase attempts. Please wait before trying again.',
    retryAfter: '15 minutes',
  },
});

// Super Admin credit controls can issue, adjust, suspend, and settle value.
// They use a distinct bucket so operator activity cannot exhaust a customer
// bucket and so the audit trail remains the primary authorization control.
const creditAdminMutationLimiter = rateLimit({
  ...createStoreOption('rl:oxsteed_credit_admin_mutation:'),
  windowMs: 15 * 60 * 1000,
  max: 60,
  skip: (req) => !req.user,
  keyGenerator: (req) => req.user?.id ? `admin:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many OxSteed Credit administrative changes. Please wait before trying again.',
    retryAfter: '15 minutes',
  },
});

// Statements are bounded, but exports can still be expensive and contain
// sensitive financial history. Limit exports independently of normal reads.
const creditExportLimiter = rateLimit({
  ...createStoreOption('rl:oxsteed_credit_export:'),
  windowMs: 60 * 60 * 1000,
  max: 10,
  skip: (req) => !req.user,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many OxSteed Credit exports. Please try again later.',
    retryAfter: '1 hour',
  },
});

// Admin-triggered phone verification sends are expensive and sensitive. Keep
// the bucket keyed to the acting admin; the challenge service also enforces a
// per-user cooldown.
const adminPhoneVerificationLimiter = rateLimit({
  ...createStoreOption('rl:admin_phone_verification:'),
  windowMs: 60 * 60 * 1000,
  max: 10,
  skip: (req) => !req.user,
  keyGenerator: (req) => req.user?.id ? `admin:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many admin phone verification sends. Please try again later.',
    retryAfter: '1 hour',
  },
});

// M28: the connector API is a machine-facing admin surface authenticated by
// API key. Mutations (acknowledge/assign/resolve, dead-letter requeue,
// webhook retry, settings approve/reject) get a per-connector-user bucket so
// one automation client cannot exhaust a shared bucket for other operators.
const connectorMutationLimiter = rateLimit({
  ...createStoreOption('rl:connector_mutation:'),
  windowMs: 60 * 60 * 1000,
  max: 120,
  keyGenerator: (req) => req.connectorUser?.id ? `connector:${req.connectorUser.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many connector mutation requests. Please try again later.',
    retryAfter: '1 hour',
  },
});

module.exports = {
  getVerifiedBearerUserId,
  generalLimiter,
  authenticatedLimiter,
  authLimiter,
  strictLimiter,
  passwordResetLimiter,
  passwordResetVerifyLimiter,
  chatLimiter,
  conversationMessageLimiter,
  channelWebhookLimiter,
  profileChatLimiter,
  userChatLimiter,
  discoverLimiter,
  discoverAuthLimiter,
  geoLimiter,
  directoryLimiter,
  invoiceLimiter,
  reportLimiter,
  termsLimiter,
  paymentsLimiter,
  connectAccountLimiter,
  creditMutationLimiter,
  restaurantCreditMutationLimiter,
  restaurantTopupIntentLimiter,
  creditPurchaseLimiter,
  creditAdminMutationLimiter,
  creditExportLimiter,
  adminPhoneVerificationLimiter,
  connectorMutationLimiter,
};
