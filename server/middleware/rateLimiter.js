const rateLimit = require('express-rate-limit');

let redisStore = null;
if (process.env.REDIS_URL) {
  try {
    const { RedisStore } = require('rate-limit-redis');
    const Redis = require('ioredis');
    const client = new Redis(process.env.REDIS_URL, { lazyConnect: true });
    client.on('error', (err) => console.warn('[RateLimit] Redis error:', err.message));
    redisStore = new RedisStore({ sendCommand: (...args) => client.call(...args) });
    console.log('[RateLimit] Using Redis store');
  } catch (err) {
    console.warn('[RateLimit] Redis store unavailable, falling back to memory:', err.message);
  }
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

// Auth rate limiter: 10 attempts per 15 minutes per IP
// Protects login, register, OTP endpoints from brute-force
const authLimiter = rateLimit({
  ...storeOption,
  windowMs: 15 * 60 * 1000,
  max: 10,
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
