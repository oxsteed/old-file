const rateLimit = require('express-rate-limit');

let redisStore = null;
if (process.env.REDIS_URL) {
  try {
    const RedisStore = require('rate-limit-redis').default;
    const Redis = require('ioredis');
    const client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    client.connect()
      .then(() => console.log('[RateLimit] Redis connected'))
      .catch(err => console.warn('[RateLimit] Redis connect failed:', err.message));
    client.on('error', (err) => console.warn('[RateLimit] Redis error:', err.message));
    redisStore = new RedisStore({
      sendCommand: (...args) => client.call(...args),
      prefix: 'rl:',
    });
    console.log('[RateLimit] Using Redis store');
  } catch (err) {
    console.warn('[RateLimit] Redis store unavailable, falling back to memory:', err.message);
  }
} else {
  console.log('[RateLimit] REDIS_URL not set, using in-memory store');
}

const storeOption = redisStore ? { store: redisStore } : {};

// General API rate limiter: 100 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  ...storeOption,
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
  ...storeOption,
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
  ...storeOption,
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
