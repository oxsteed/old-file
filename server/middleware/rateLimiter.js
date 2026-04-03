const rateLimit = require('express-rate-limit');

let redisClient = null;
let RedisStore = null;

if (process.env.REDIS_URL) {
  try {
    RedisStore = require('rate-limit-redis').default;
    const Redis = require('ioredis');
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });
    redisClient.connect()
      .then(() => console.log('[RateLimit] Redis connected'))
      .catch(err => {
        console.warn('[RateLimit] Redis connect failed:', err.message);
        redisClient = null;
      });
    redisClient.on('error', (err) => console.warn('[RateLimit] Redis error:', err.message));
    console.log('[RateLimit] Using Redis store');
  } catch (err) {
    console.warn('[RateLimit] Redis store unavailable, falling back to memory:', err.message);
    redisClient = null;
    RedisStore = null;
  }
} else {
  console.log('[RateLimit] REDIS_URL not set, using in-memory store');
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

// General API rate limiter: 100 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  ...createStoreOption('rl:general:'),
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please try again later.',
    retryAfter: '15 minutes',
  },
});

// Auth rate limiter: 15 attempts per 15 minutes per IP
// Protects login, register, OTP endpoints from brute-force
const authLimiter = rateLimit({
  ...createStoreOption('rl:auth:'),
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts. Please try again in 15 minutes.',
    retryAfter: '15 minutes',
  },
});

// Strict limiter for sensitive operations: 5 per hour per IP
// For password reset, account deletion, data export
const strictLimiter = rateLimit({
  ...createStoreOption('rl:strict:'),
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Rate limit exceeded for this operation. Please try again in 1 hour.',
    retryAfter: '1 hour',
  },
});

module.exports = { generalLimiter, authLimiter, strictLimiter };
