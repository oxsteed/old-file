const rateLimit = require('express-rate-limit');
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

// General API rate limiter: 200 requests per 15 minutes per IP (unauthenticated only)
const generalLimiter = rateLimit({
  ...createStoreOption('rl:general:'),
  windowMs: 15 * 60 * 1000,
  max: 200,
  // Skip requests that carry a Bearer token - those are handled by authenticatedLimiter.
  skip: (req) => !!req.headers.authorization?.startsWith('Bearer '),
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
// Falls back to IP if the token is expired or invalid.
const authenticatedLimiter = rateLimit({
  ...createStoreOption('rl:auth_user:'),
  windowMs: 15 * 60 * 1000,
  max: 500,
  skip: (req) => !req.headers.authorization?.startsWith('Bearer '),
  keyGenerator: (req) => {
    try {
      const token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      return `user:${decoded.id}`;
    } catch {
      // Expired / invalid token - fall back to IP so the request still gets limited.
      return req.ip;
    }
  },
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
  skip: (req) => !!req.headers.authorization?.startsWith('Bearer '),
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
  skip: (req) => !req.headers.authorization?.startsWith('Bearer '),
  keyGenerator: (req) => {
    try {
      const token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      return `discover:${decoded.id}`;
    } catch {
      return req.ip;
    }
  },
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

module.exports = {
  generalLimiter,
  authenticatedLimiter,
  authLimiter,
  strictLimiter,
  chatLimiter,
  conversationMessageLimiter,
  profileChatLimiter,
  userChatLimiter,
  discoverLimiter,
  discoverAuthLimiter,
  geoLimiter,
  invoiceLimiter,
  reportLimiter,
  termsLimiter,
};
