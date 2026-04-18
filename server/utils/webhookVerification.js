const crypto = require('crypto');
const logger = require('./logger');

// Shared webhook signature verification utility
// Consolidates verification logic for multiple webhook providers to prevent
// copy-paste security bugs. Each provider uses slightly different HMAC algorithms,
// but the security principles are the same:
//
// 1. Get the raw request body as bytes (not parsed JSON)
// 2. Compute HMAC using provider's secret + algorithm
// 3. Compare result against signature in headers (constant-time comparison)

const webhookVerifiers = {
  /**
   * Stripe webhook signature verification
   * @param {Buffer} rawBody - The raw request body bytes
   * @param {string} signature - The Stripe-Signature header value
   * @param {string} secret - STRIPE_WEBHOOK_SECRET
   * @returns {boolean} true if signature is valid
   */
  stripe: (rawBody, signature, secret) => {
    if (!signature || !secret) return false;

    try {
      // Stripe uses `t=timestamp,v1=signature` format
      const parts = signature.split(',');
      const timestampPart = parts.find(p => p.startsWith('t='));
      const signaturePart = parts.find(p => p.startsWith('v1='));

      if (!timestampPart || !signaturePart) {
        logger.warn('Stripe webhook: malformed signature header');
        return false;
      }

      const timestamp = timestampPart.split('=')[1];
      const providedSignature = signaturePart.split('=')[1];

      // Prevent replay attacks (check timestamp is recent)
      const now = Math.floor(Date.now() / 1000);
      const maxAge = 5 * 60; // 5 minutes
      if (Math.abs(now - parseInt(timestamp)) > maxAge) {
        logger.warn('Stripe webhook: timestamp too old', { timestamp, now });
        return false;
      }

      // Compute expected signature
      const signed = `${timestamp}.${rawBody.toString()}`;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(signed)
        .digest('hex');

      // Constant-time comparison
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(providedSignature)
      );
    } catch (err) {
      logger.error('Stripe webhook verification failed', { error: err.message });
      return false;
    }
  },

  /**
   * Didit webhook signature verification
   * @param {Buffer} rawBody - The raw request body bytes
   * @param {string} signature - The signature from Didit headers
   * @param {string} secret - DIDIT_WEBHOOK_SECRET
   * @returns {boolean} true if signature is valid
   */
  didit: (rawBody, signature, secret) => {
    if (!signature || !secret) return false;

    try {
      // Didit uses simple HMAC-SHA256 of the raw body
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

      // Constant-time comparison
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature)
      );
    } catch (err) {
      logger.error('Didit webhook verification failed', { error: err.message });
      return false;
    }
  },

  /**
   * Checkr webhook signature verification (part of verification routes)
   * @param {Buffer} rawBody - The raw request body bytes
   * @param {string} signature - The signature header
   * @param {string} secret - CHECKR_WEBHOOK_SECRET (if applicable)
   * @returns {boolean} true if signature is valid
   */
  checkr: (rawBody, signature, secret) => {
    if (!signature || !secret) return false;

    try {
      // Checkr uses similar pattern to Didit: HMAC-SHA256 of raw body
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature)
      );
    } catch (err) {
      logger.error('Checkr webhook verification failed', { error: err.message });
      return false;
    }
  },

  /**
   * Generic verification for webhooks with simple HMAC-SHA256 signature
   * @param {Buffer} rawBody - The raw request body bytes
   * @param {string} signature - The signature header
   * @param {string} secret - The shared secret
   * @param {string} algorithm - HMAC algorithm (default: sha256)
   * @returns {boolean} true if signature is valid
   */
  generic: (rawBody, signature, secret, algorithm = 'sha256') => {
    if (!signature || !secret) return false;

    try {
      const expectedSignature = crypto
        .createHmac(algorithm, secret)
        .update(rawBody)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature)
      );
    } catch (err) {
      logger.error('Webhook verification failed', { algorithm, error: err.message });
      return false;
    }
  },
};

/**
 * Verify a webhook signature
 * @param {string} provider - Provider name: 'stripe', 'didit', 'checkr', etc.
 * @param {Buffer} rawBody - The raw request body bytes
 * @param {string} signature - The signature from request headers
 * @param {string} secret - The webhook secret from environment
 * @returns {boolean} true if valid
 *
 * @example
 * // In Express route handler
 * const verifyWebhook = require('../utils/webhookVerification');
 *
 * app.post('/api/webhooks/stripe', (req, res) => {
 *   const isValid = verifyWebhook.verify('stripe', req.rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
 *   if (!isValid) return res.status(403).json({ error: 'Invalid signature' });
 *   // Process webhook...
 * });
 */
function verify(provider, rawBody, signature, secret) {
  const verifier = webhookVerifiers[provider];
  if (!verifier) {
    logger.error('Unknown webhook provider', { provider });
    return false;
  }

  const isValid = verifier(rawBody, signature, secret);
  if (!isValid) {
    logger.warn('Webhook signature verification failed', { provider });
  }
  return isValid;
}

module.exports = {
  verify,
  verifyStripe: (rawBody, sig, secret) => webhookVerifiers.stripe(rawBody, sig, secret),
  verifyDidit: (rawBody, sig, secret) => webhookVerifiers.didit(rawBody, sig, secret),
  verifyCheckr: (rawBody, sig, secret) => webhookVerifiers.checkr(rawBody, sig, secret),
  verifyGeneric: (rawBody, sig, secret, alg) => webhookVerifiers.generic(rawBody, sig, secret, alg),
};
