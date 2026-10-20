const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const pool = require('../db');

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

// Review P3-13-F22: limiters NEVER use `skip: (req) => !req.user`. That
// pattern silently disabled the limiter for any mount that forgot (or never
// had) the authenticate middleware. Instead every limiter below keys by
// user id when authenticated and falls back to req.ip otherwise, so an
// unauthenticated request is still limited (fail-closed) and a future mount
// without authenticate cannot silently bypass the limit.

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

// Normal web sessions use HttpOnly cookies, not Authorization headers. Match
// authenticate's token precedence so valid web sessions get the per-user budget,
// while an invalid cookie cannot fall back to a different Bearer identity.
// Signature verification is mandatory: cookie presence alone grants nothing.
function getVerifiedAuthUserId(req) {
  if (req._verifiedAuthUser !== undefined) return req._verifiedAuthUser;
  let cookieToken = null;
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/(?:^|;\s*)oxsteed_access=([^;]+)/);
    if (match) {
      try { cookieToken = decodeURIComponent(match[1]); } catch { cookieToken = match[1]; }
    }
  }
  const header = req.headers.authorization;
  const bearerToken = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length) : null;
  // Decode only selects the token; the selected token is verified below.
  let useBearer = false;
  if (bearerToken) {
    try { useBearer = !!jwt.decode(bearerToken)?.isImpersonated; } catch { /* malformed token */ }
  }
  const token = useBearer ? bearerToken : cookieToken || bearerToken;
  let userId = null;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      if (decoded && decoded.id != null && !decoded.isMfaToken && decoded.type !== 'refresh') {
        userId = decoded.id;
      }
    } catch {
      // Expired, malformed, wrongly signed, MFA and refresh tokens stay anonymous.
    }
  }
  req._verifiedAuthUser = userId;
  return userId;
}

// Verified paired-display identity for the rate limiters.
//
// A paired display presents its pairing token as a Bearer credential (64 hex
// chars, the same shape heartbeat and the kitchen middleware verify). When
// the token matches a paired row in display_pairings, the request is device
// traffic and leaves the anonymous IP bucket; when it does not, the request
// stays anonymous and the normal IP budget applies (fail closed).
//
// The token is SHA-256 hashed before any lookup, and the in-memory cache is
// keyed by that hash: the raw credential never becomes a cache key and is
// never logged. Positive results cache for 5 minutes, negative for 60s. On
// a DB error the request is treated as unverified (null) so it stays in the
// anonymous bucket; route-level auth still runs in the controllers and
// rejects invalid tokens. The result rides on req._verifiedDisplayDevice so
// skip() and keyGenerator() share one verification per request, mirroring
// the _verifiedAuthUser pattern above.
const DISPLAY_DEVICE_CACHE_POSITIVE_MS = 5 * 60 * 1000;
const DISPLAY_DEVICE_CACHE_NEGATIVE_MS = 60 * 1000;
const DISPLAY_DEVICE_CACHE_MAX_ENTRIES = 5000;
const displayDeviceCache = new Map(); // tokenHash -> { device, expiresAt }

async function getVerifiedDisplayDevice(req) {
  if (req._verifiedDisplayDevice !== undefined) return req._verifiedDisplayDevice;
  let device = null;
  const header = req.headers?.authorization;
  const match = typeof header === 'string' ? /^Bearer\s+([0-9a-f]{64})$/i.exec(header) : null;
  if (match) {
    // Hash the token exactly as presented: verifyDisplayPairingToken hashes
    // the same way, so a token that would fail there also fails here.
    const tokenHash = crypto.createHash('sha256').update(match[1], 'utf8').digest('hex');
    const now = Date.now();
    const cached = displayDeviceCache.get(tokenHash);
    if (cached && cached.expiresAt > now) {
      device = cached.device;
    } else {
      try {
        const { rows } = await pool.query(
          `SELECT id, restaurant_id, device_role
             FROM display_pairings
            WHERE pairing_token_hash = $1 AND paired_at IS NOT NULL`,
          [tokenHash]
        );
        const row = rows[0];
        device = row
          ? {
              pairingId: Number(row.id),
              restaurantId: Number(row.restaurant_id),
              deviceRole: row.device_role || 'kiosk',
            }
          : null;
        if (displayDeviceCache.size >= DISPLAY_DEVICE_CACHE_MAX_ENTRIES) {
          displayDeviceCache.clear();
        }
        displayDeviceCache.set(tokenHash, {
          device,
          expiresAt: now + (device ? DISPLAY_DEVICE_CACHE_POSITIVE_MS : DISPLAY_DEVICE_CACHE_NEGATIVE_MS),
        });
      } catch (err) {
        logger.warn('display device verification failed; treating as unverified', { message: err.message });
        device = null;
      }
    }
  }
  req._verifiedDisplayDevice = device;
  return device;
}

// Test seam: lets a test invalidate the in-memory device cache between cases.
function _clearDisplayDeviceCache() {
  displayDeviceCache.clear();
}

// General API rate limiter: 200 requests per 15 minutes per IP (unauthenticated only)
const generalLimiter = rateLimit({
  ...createStoreOption('rl:general:'),
  windowMs: 15 * 60 * 1000,
  max: 200,
  // Cookie and native Bearer sessions share the verified per-user budget.
  // Verified paired displays skip the anonymous IP bucket too: their own
  // deviceApiLimiter counts them per pairing id, so a restaurant full of TVs
  // on one Wi-Fi never exhausts the shared IP budget.
  skip: async (req) => getVerifiedAuthUserId(req) !== null || (await getVerifiedDisplayDevice(req)) !== null,
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
  // No-token/invalid-token requests remain in the anonymous IP bucket.
  skip: (req) => getVerifiedAuthUserId(req) === null,
  keyGenerator: (req) => `user:${getVerifiedAuthUserId(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please try again later.',
    retryAfter: '15 minutes',
  },
});

// Login gets its own budget, shared by password, MFA and internal-access login.
// Routine session requests and signup must not consume sign-in attempts.
const loginLimiter = rateLimit({
  ...createStoreOption('rl:login:'),
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts. Please try again in 15 minutes.',
    retryAfter: '15 minutes',
  },
});

// Session refresh/logout are normal browser activity, not credential attempts.
// They remain bounded in addition to the global API limit.
const authSessionLimiter = rateLimit({
  ...createStoreOption('rl:auth_session:'),
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please try again later.',
    retryAfter: '15 minutes',
  },
});

// Non-authoritative signup lookups have a separate, bounded budget.
const authLookupLimiter = rateLimit({
  ...createStoreOption('rl:auth_lookup:'),
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please try again later.',
    retryAfter: '15 minutes',
  },
});

// Registration, OTP and sensitive account changes: 30 per 15 minutes per IP.
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
    // Review P3-1097: routes without :conversationId (support AI message,
    // QA review, reminders) are keyed by business/route and caller instead
    // of collapsing every caller behind one bare-IP bucket.
    const params = req.params || {};
    const caller = req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`;
    if (params.conversationId) return `conv:${params.conversationId}:${caller}`;
    if (params.businessId) return `biz:${params.businessId}:${caller}`;
    return `route:${req.baseUrl || ''}${req.route?.path || req.path || ''}:${caller}`;
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
  // Match the auth token precedence used by the other limiters so browser
  // sessions using the HttpOnly cookie are not treated as anonymous.
  skip: (req) => getVerifiedAuthUserId(req) !== null,
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
  skip: (req) => getVerifiedAuthUserId(req) === null,
  keyGenerator: (req) => `discover:${getVerifiedAuthUserId(req)}`,
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
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'You are sending messages too quickly. Please wait a moment before sending more.',
    retryAfter: '5 minutes',
  },
});

// AI support chat (POST /api/chat/message). Mounted AFTER optionalAuth so
// signed-in users get their own per-user bucket instead of sharing one with
// everyone behind the same IP (offices, campuses, mobile carrier NAT).
// Guests stay keyed by IP with the original 20 / 10 min budget.
const SUPPORT_CHAT_WINDOW_MS = 10 * 60 * 1000;
const SUPPORT_CHAT_MAX_SIGNED_IN = 40;
const SUPPORT_CHAT_MAX_GUEST = 20;
const supportChatLimiter = rateLimit({
  ...createStoreOption('rl:support_chat:'),
  windowMs: SUPPORT_CHAT_WINDOW_MS,
  max: (req) => (req.user?.id ? SUPPORT_CHAT_MAX_SIGNED_IN : SUPPORT_CHAT_MAX_GUEST),
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many messages sent. Please wait a few minutes before continuing.',
    code: 'rate_limited',
    retryAfter: '10 minutes',
  },
});

// Review P3-916 / P3-912: per-user upload budget (chat attachments, agreement
// vault). Redis-backed so the budget holds across replicas.
const userUploadLimiter = rateLimit({
  ...createStoreOption('rl:user_upload:'),
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads. Please wait a few minutes and try again.', code: 'upload_rate_limited' },
});

// Review P2-654: unauthenticated public intake forms, 10 per hour per caller
// and business, Redis-backed.
const publicIntakeLimiter = rateLimit({
  ...createStoreOption('rl:public_intake:'),
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `${req.params?.businessId || 'none'}:${req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests sent. Please try again later.', code: 'intake_rate_limited' },
});

// Payments limiter: 20 per hour per user
// Protects PaymentIntent creation/capture from abuse and accidental retries.
const paymentsLimiter = rateLimit({
  ...createStoreOption('rl:payments:'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
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
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many OxSteed Credit changes. Please wait before trying again.',
    retryAfter: '15 minutes',
  },
});

// Dispute follow-up messages: a tight per-user bucket (~10/minute) so a
// compromised session cannot spam a dispute thread or use the idempotency
// endpoint as a write oracle. Keyed by user id when authenticated (never
// skipped for missing auth: unauthenticated requests fall back to req.ip,
// fail-closed per P3-13-F22).
const disputeMessageLimiter = rateLimit({
  ...createStoreOption('rl:dispute_message:'),
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many dispute messages. Please wait before trying again.',
    retryAfter: '1 minute',
  },
});

// Job edits: per-user bucket so edit spam (bumping, bait-and-switch probing)
// cannot run unbounded. Material edits with bids are further capped per job
// per day in services/jobEditService.js.
const jobEditLimiter = rateLimit({
  ...createStoreOption('rl:job_edit:'),
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.JOB_EDIT_RATE_LIMIT_PER_15M || 30),
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many job edits. Please wait before trying again.',
    code: 'job_edit_rate_limited',
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
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many OxSteed Credit exports. Please try again later.',
    retryAfter: '1 hour',
  },
});

// Food hosted-checkout completion (GET /orders/:orderId/checkout/complete)
// accepts a bare Stripe session_id under optionalAuth: the session_id is a
// bearer token, so throttle guessing per (IP, session) rather than per IP
// alone. 10 attempts per 15 minutes is enough for legitimate Stripe
// redirect retries while making session_id enumeration impractical.
const foodCheckoutCompleteLimiter = rateLimit({
  ...createStoreOption('rl:food_checkout_complete:'),
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => {
    const sessionId = req.query?.session_id;
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      return `${req.ip}:${crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 32)}`;
    }
    return req.ip; // Fallback to IP when no session_id was presented
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many checkout completion attempts. Please try again in 15 minutes.',
    retryAfter: '15 minutes',
  },
});

// Admin-triggered phone verification sends are expensive and sensitive. Keep
// the bucket keyed to the acting admin; the challenge service also enforces a
// per-user cooldown.
const adminPhoneVerificationLimiter = rateLimit({
  ...createStoreOption('rl:admin_phone_verification:'),
  windowMs: 60 * 60 * 1000,
  max: 10,
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

// Vortex code/token redemption limiter: 10 attempts per 15 minutes per IP.
// Code guessing against /api/vortex/preview, /api/vortex/redeem and
// /api/businesses/vortex/redeem is otherwise unbounded. Keep a dedicated
// bucket so a noisy read client cannot consume the redemption budget (and
// vice versa). Redis makes the limit consistent across app instances.
const vortexRedeemLimiter = rateLimit({
  ...createStoreOption('rl:vortex_redeem:'),
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many Vortex redemption attempts. Please try again in 15 minutes.',
    retryAfter: '15 minutes',
  },
});

// Entity ID resolution is authenticated but enumerable by shape; keep a
// tight per-user bucket on top of the global API limiters so one client
// cannot sweep the ID space.
const entityResolveLimiter = rateLimit({
  ...createStoreOption('rl:entity_resolve:'),
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyGenerator: (req) => req.user?.id ? `entity:${req.user.id}` : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many entity lookups. Please try again later.',
    retryAfter: '15 minutes',
  },
});

// Wall-display polling: the TV hits /status every 5s while waiting for an
// owner claim, and paired displays heartbeat on a similar cadence. Those
// routes must NOT share strictLimiter's 10/hour bucket (the 10th poll would
// 429 and the owner claim on the same network would be blocked too).
// 60/minute per IP covers 5s polling (12/min) for ~4-5 displays behind one
// NAT IP with headroom. Keyed by req.ip with no skip for missing auth
// (fail-closed per P3-13-F22).
const displayPollLimiter = rateLimit({
  ...createStoreOption('rl:display_poll:'),
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many display polling requests. Please slow down.',
    retryAfter: '1 minute',
  },
});

// Per-device API budget for paired displays: 300 requests / 15 min keyed by
// pairing id, NOT by IP. Several displays on one restaurant Wi-Fi share a
// single NAT IP; keying by IP would let one chatty TV eat the budget of all
// the others and the owner claim flow behind the same router. This limiter is
// mounted once for the whole API so a valid display token cannot bypass the
// global budget on an uncovered route. Non-device requests skip this limiter:
// they already have their own budgets (authenticatedLimiter / generalLimiter).
// Polling endpoints can still compose a tighter route-level limiter such as
// displayPollLimiter.
const deviceApiLimiter = rateLimit({
  ...createStoreOption('rl:device_api:'),
  windowMs: 15 * 60 * 1000,
  max: 300,
  skip: async (req) => (await getVerifiedDisplayDevice(req)) === null,
  keyGenerator: async (req) => {
    const device = await getVerifiedDisplayDevice(req);
    // skip() already ran, so device is set here; fall back to the IP so a
    // request never escapes being counted (fail closed).
    return device ? `device:${device.pairingId}` : req.ip;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many display requests. Please try again later.',
    retryAfter: '15 minutes',
  },
});

module.exports = {
  createStoreOption,
  getVerifiedBearerUserId,
  getVerifiedAuthUserId,
  getVerifiedDisplayDevice,
  _clearDisplayDeviceCache,
  generalLimiter,
  authenticatedLimiter,
  loginLimiter,
  authSessionLimiter,
  authLookupLimiter,
  authLimiter,
  strictLimiter,
  passwordResetLimiter,
  passwordResetVerifyLimiter,
  chatLimiter,
  supportChatLimiter,
  SUPPORT_CHAT_MAX_SIGNED_IN,
  SUPPORT_CHAT_MAX_GUEST,
  conversationMessageLimiter,
  channelWebhookLimiter,
  profileChatLimiter,
  userChatLimiter,
  userUploadLimiter,
  publicIntakeLimiter,
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
  disputeMessageLimiter,
  jobEditLimiter,
  restaurantCreditMutationLimiter,
  restaurantTopupIntentLimiter,
  creditPurchaseLimiter,
  creditAdminMutationLimiter,
  creditExportLimiter,
  foodCheckoutCompleteLimiter,
  adminPhoneVerificationLimiter,
  connectorMutationLimiter,
  entityResolveLimiter,
  vortexRedeemLimiter,
  displayPollLimiter,
  deviceApiLimiter,
};
