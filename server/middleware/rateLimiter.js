const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

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
      .then(() => logger.info('Rate limiter: Redis connected'))
      .catch(err => {
        logger.warn('Rate limiter: Redis connect failed — falling back to memory', { message: err.message });
        redisClient = null;
      });
    redisClient.on('error', (err) => logger.warn('Rate limiter: Redis error', { message: err.message }));
    logger.info('Rate limiter: using Redis store');
  } catch (err) {
    logger.warn('Rate limiter: Redis store unavailable — falling back to memory', { message: err.message });
    redisClient = null;
    RedisStore = null;
  }
} else {
  logger.info('Rate limiter: REDIS_URL not set — using in-memory store (not suitable for multi-instance)');
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

// General API rate limiter: 200 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  ...createStoreOption('rl:general:'),
  windowMs: 15 * 60 * 1000,
  max: 200,
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

module.exports = { generalLimiter, authLimiter, strictLimiter };
