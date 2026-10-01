// Webhook Authentication Middleware
// Validates webhook signatures and rate limits webhook processing

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const { AppError } = require('./errorHandler');

// Shared Redis client - created once in utils/redis.js, reused here.
// Falls back gracefully to in-memory when Redis is unavailable.
// Same store pattern as server/middleware/rateLimiter.js.
const redisClient = require('../utils/redis');
let RedisStore = null;

if (redisClient) {
  try {
    RedisStore = require('rate-limit-redis').default;
    logger.info('Webhook rate limiter: using Redis store');
  } catch (err) {
    logger.warn('Webhook rate limiter: rate-limit-redis unavailable - falling back to memory', { message: err.message });
  }
} else {
  logger.info('Webhook rate limiter: Redis not available - using in-memory store (not suitable for multi-instance)');
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

/**
 * ATTACK #3 FIX: Strict Webhook Signature Validation
 *
 * Verifies that webhooks are genuinely from Stripe/trusted sources.
 * Prevents attackers from forging webhook events.
 */
function validateStripeSignature(req, res, next) {
  const sig = req.headers['stripe-signature'];

  // Signature is required - no bypassing
  if (!sig) {
    logger.warn('Webhook received without signature header', {
      ip: req.ip,
      path: req.path,
      timestamp: new Date().toISOString()
    });
    return res.status(403).json({
      error: 'Webhook signature required',
      code: 'missing_webhook_signature'
    });
  }

  // Secret must be configured
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    logger.error('STRIPE_WEBHOOK_SECRET not configured - rejecting all webhooks for safety');
    return res.status(500).json({
      error: 'Webhook verification not configured',
      code: 'webhook_config_error'
    });
  }

  // Validate signature using Stripe's official method
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  try {
    // This will throw if signature is invalid
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    // Signature verified - attach event to request
    req.stripeEvent = event;
    next();
  } catch (err) {
    // Log all signature failures for security audit
    logger.warn('Webhook signature verification failed', {
      ip: req.ip,
      path: req.path,
      error: err.message,
      signature: sig.substring(0, 20) + '***', // Log partial sig for debugging
      timestamp: new Date().toISOString()
    });

    return res.status(403).json({
      error: 'Invalid webhook signature',
      code: 'invalid_webhook_signature'
    });
  }
}

/**
 * Inbound webhook rate limiter: 600 requests per 5 minutes per IP.
 *
 * The previous version of this function was a no-op that called next() in
 * every branch, so webhook endpoints had no abuse protection at all.
 *
 * The bucket is deliberately generous so legitimate provider retry bursts
 * (Stripe redelivers failed events) are never answered with a 429, which
 * could cause Stripe to disable the endpoint. Signature/HMAC verification
 * still runs after this limiter, so rejected traffic is counted cheaply.
 * Keyed by IP because inbound webhooks are unauthenticated by design.
 */
const webhookRateLimit = rateLimit({
  ...createStoreOption('rl:inbound_webhook:'),
  windowMs: 5 * 60 * 1000,
  max: 600,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many webhook requests. Please retry later.',
    retryAfter: '5 minutes',
  },
});

module.exports = {
  validateStripeSignature,
  webhookRateLimit
};
