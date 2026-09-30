const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');
const { sendError } = require('../utils/apiError');

/**
 * Middleware to validate API keys for API product endpoints
 * Checks: key existence, expiry, rate limits, revocation
 */
async function validateApiKey(req, res, next) {
  try {
    const apiKey = extractApiKey(req);

    if (!apiKey) {
      return sendError(res, 401, 'Missing API key');
    }

    // Hash the provided key
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Look up key in database
    const keyRecord = await pool.query(
      `SELECT apk.*, ap.id as api_product_id, ap.max_requests_per_month
       FROM api_product_keys apk
       JOIN api_products ap ON apk.api_product_id = ap.id
       WHERE apk.key_hash = $1`,
      [keyHash]
    );

    if (!keyRecord.rows.length) {
      logger.warn('Invalid API key attempt', { keyPrefix: apiKey.substring(0, 8) });
      return sendError(res, 401, 'Invalid API key');
    }

    const key = keyRecord.rows[0];

    // Check if key is revoked
    if (key.revoked_at) {
      logger.warn('Revoked API key used', { keyId: key.id, revokedAt: key.revoked_at });
      return sendError(res, 401, 'API key has been revoked');
    }

    // Check if key has expired
    if (key.expires_at && new Date(key.expires_at) < new Date()) {
      logger.warn('Expired API key used', { keyId: key.id, expiresAt: key.expires_at });
      return sendError(res, 401, 'API key has expired');
    }

    // Check rate limit (requests this month)
    if (key.usage_limit && key.requests_this_month >= key.usage_limit) {
      logger.warn('API key rate limit exceeded', { keyId: key.id, usage: key.requests_this_month, limit: key.usage_limit });
      return sendError(res, 429, 'API key rate limit exceeded');
    }

    // Attach validated key info to request
    req.apiKey = {
      id: key.id,
      productId: key.api_product_id,
      customerId: key.customer_id,
      maxRequests: key.max_requests_per_month,
      currentRequests: key.requests_this_month,
      issuedAt: key.created_at
    };

    // Update last_used_at timestamp
    pool.query(
      'UPDATE api_product_keys SET last_used_at = CURRENT_TIMESTAMP, requests_this_month = requests_this_month + 1 WHERE id = $1',
      [key.id]
    ).catch(err => logger.error('Failed to update API key usage', { error: err.message }));

    next();
  } catch (error) {
    logger.error('API key validation error', { error });
    sendError(res, 500, 'API key validation failed');
  }
}

/**
 * Extract API key from request (header, query, or body)
 */
function extractApiKey(req) {
  // Check Authorization header: Bearer <key> or ApiKey <key>
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ') || authHeader.startsWith('ApiKey ')) {
    return authHeader.split(' ')[1];
  }

  // Check X-API-Key header
  if (req.headers['x-api-key']) {
    return req.headers['x-api-key'];
  }

  // Check query parameter (less secure, discouraged)
  if (req.query.api_key) {
    return req.query.api_key;
  }

  return null;
}

/**
 * Middleware to reset monthly request counters (call once daily)
 * Should be triggered by a cron job at the start of each month
 */
async function resetMonthlyApiKeyCounters() {
  try {
    const result = await pool.query(
      'UPDATE api_product_keys SET requests_this_month = 0 WHERE id > 0'
    );
    logger.info('API key monthly counters reset', { count: result.rowCount });
  } catch (error) {
    logger.error('Failed to reset API key counters', { error });
  }
}

module.exports = {
  validateApiKey,
  extractApiKey,
  resetMonthlyApiKeyCounters
};
