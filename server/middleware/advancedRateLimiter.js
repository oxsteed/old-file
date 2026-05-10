// Advanced rate limiting with per-user, per-endpoint, and behavioral rules
// Enterprise-grade DDoS and abuse prevention

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redis = require('redis');
const logger = require('../utils/logger');
const metricsService = require('../services/metricsService');

// Try to use Redis, fall back to in-memory
let store;
try {
  if (process.env.REDIS_URL) {
    const client = redis.createClient({ url: process.env.REDIS_URL });
    client.connect().catch(() => logger.warn('Redis connection failed, using memory store'));
    store = new RedisStore({ client, prefix: 'rl:' });
  }
} catch (err) {
  logger.warn('Redis store unavailable, using memory store', { error: err.message });
}

// ── ENDPOINT-SPECIFIC LIMITERS ──────────────────────────────

const apiLimiter = rateLimit({
  store,
  windowMs: 15 * 60 * 1000, // 15 min
  max: (req) => {
    // Authenticated users get higher limit
    if (req.user) return 1000;
    return 200;
  },
  keyGenerator: (req) => {
    // Use user ID if authenticated, otherwise IP
    return req.user?.id || (req.ip || req.connection.remoteAddress);
  },
  handler: (req, res) => {
    metricsService.incrementCounter('ratelimit.exceeded', 1, { endpoint: req.path });
    metricsService.recordSecurityEvent('rate_limit_exceeded', 'warning', req.user?.id, {
      endpoint: req.path,
      ip: req.ip,
    });
    res.status(429).json({
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
      retryAfter: req.rateLimit.resetTime,
    });
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
});

// Stricter limits for auth endpoints (brute force protection)
const authLimiter = rateLimit({
  store,
  windowMs: 15 * 60 * 1000,
  max: (req) => {
    const email = req.body?.email || req.body?.username || '';
    // Same email hit limit = brute force signature
    return 10;
  },
  keyGenerator: (req) => {
    // Rate limit by email + IP combination
    const email = req.body?.email || req.body?.username || '';
    const ip = req.ip || req.connection.remoteAddress;
    return `${email}:${ip}`;
  },
  handler: (req, res) => {
    metricsService.incrementCounter('auth.rate_limit', 1);
    metricsService.recordSecurityEvent('auth_brute_force_attempt', 'critical', null, {
      email: req.body?.email,
      ip: req.ip,
    });
    logger.warn('AUTH BRUTE FORCE ATTEMPT', {
      email: req.body?.email,
      ip: req.ip,
    });
    res.status(429).json({
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      message: 'Too many login attempts. Please try again in 15 minutes.',
    });
  },
});

// Payment operations: stricter limits
const paymentLimiter = rateLimit({
  store,
  windowMs: 60 * 1000, // 1 min
  max: 10, // Max 10 payment operations per minute per user
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (req, res) => {
    metricsService.incrementCounter('payment.rate_limit', 1);
    metricsService.recordSecurityEvent('payment_rate_limit_exceeded', 'high', req.user?.id, {
      ip: req.ip,
    });
    res.status(429).json({
      code: 'PAYMENT_RATE_LIMIT',
      message: 'Too many payment requests. Please wait before trying again.',
    });
  },
});

// Admin operations: per-action rate limits
const adminActionLimiter = rateLimit({
  store,
  windowMs: 60 * 1000,
  max: 50, // Max 50 admin actions per minute
  keyGenerator: (req) => req.user?.id,
  handler: (req, res) => {
    metricsService.incrementCounter('admin.action_rate_limit', 1);
    metricsService.recordSecurityEvent('admin_rate_limit_exceeded', 'high', req.user?.id, {
      action: req.path,
      ip: req.ip,
    });
    logger.warn('ADMIN RATE LIMIT EXCEEDED', {
      userId: req.user?.id,
      action: req.path,
    });
    res.status(429).json({
      code: 'ADMIN_RATE_LIMIT',
      message: 'Too many admin operations.',
    });
  },
});

// Data export: 1 per hour per user (prevent data scraping)
const dataExportLimiter = rateLimit({
  store,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1,
  keyGenerator: (req) => req.user?.id,
  handler: (req, res) => {
    metricsService.recordSecurityEvent('data_export_rate_limit', 'warning', req.user?.id, {
      ip: req.ip,
    });
    res.status(429).json({
      code: 'DATA_EXPORT_LIMIT',
      message: 'You can only export data once per hour.',
    });
  },
});

// Account deletion: 1 per day (prevent accidental clicks)
const deleteAccountLimiter = rateLimit({
  store,
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 1,
  keyGenerator: (req) => req.user?.id,
  handler: (req, res) => {
    res.status(429).json({
      code: 'DELETE_ACCOUNT_LIMIT',
      message: 'Account deletion requests are limited to once per 24 hours.',
    });
  },
});

// Directory browsing: prevent enumeration attacks
const directoryLimiter = rateLimit({
  store,
  windowMs: 15 * 60 * 1000,
  max: 100, // Max 100 directory searches per 15 min per IP
  keyGenerator: (req) => req.ip || req.connection.remoteAddress,
  handler: (req, res) => {
    metricsService.recordSecurityEvent('directory_enumeration_attempt', 'warning', req.user?.id, {
      ip: req.ip,
    });
    res.status(429).json({
      code: 'DIRECTORY_LIMIT',
      message: 'Too many search requests. Please try again later.',
    });
  },
});

module.exports = {
  apiLimiter,
  authLimiter,
  paymentLimiter,
  adminActionLimiter,
  dataExportLimiter,
  deleteAccountLimiter,
  directoryLimiter,
};
