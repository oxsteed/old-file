const crypto = require('crypto');
const logger = require('../utils/logger');

// CSRF token middleware for protecting against Cross-Site Request Forgery attacks
//
// For SPA applications:
// - CSRF tokens are stored in Redis (with in-memory fallback for single-instance dev)
// - Tokens are validated on all state-changing operations (POST/PUT/DELETE)
// - SameSite cookies provide an additional layer of protection
//
// The CSRF token is generated once per session and reused for all requests.
// Redis key: csrf:<userId>  (TTL = TOKEN_EXPIRY_SECS)

const TOKEN_LENGTH      = 32;
const TOKEN_EXPIRY_SECS = 24 * 60 * 60; // 24 hours
const REDIS_PREFIX      = 'csrf:';

// ── Redis client (optional) ──────────────────────────────────────────────────
// Shared client from utils/redis.js; null when Redis is not configured.
const redisClient = require('../utils/redis');
if (!redisClient) {
  logger.warn('CSRF: Redis unavailable — falling back to in-memory store. Not suitable for multi-instance deployments.');
}

// In-memory fallback (single-instance only)
const tokenMap = new Map(); // userId -> { token, expiresAt }

// ── Storage helpers ──────────────────────────────────────────────────────────

async function storeToken(userId, token) {
  if (redisClient) {
    await redisClient.set(
      `${REDIS_PREFIX}${userId}`,
      token,
      'EX',
      TOKEN_EXPIRY_SECS
    );
  } else {
    tokenMap.set(userId, { token, expiresAt: Date.now() + TOKEN_EXPIRY_SECS * 1000 });
  }
}

async function fetchToken(userId) {
  if (redisClient) {
    return redisClient.get(`${REDIS_PREFIX}${userId}`);
  }
  const entry = tokenMap.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { tokenMap.delete(userId); return null; }
  return entry.token;
}

async function deleteToken(userId) {
  if (redisClient) {
    await redisClient.del(`${REDIS_PREFIX}${userId}`);
  } else {
    tokenMap.delete(userId);
  }
}

// ── Core logic ───────────────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
}

async function getOrGenerateToken(userId) {
  const existing = await fetchToken(userId);
  if (existing) return existing;
  const token = generateToken();
  await storeToken(userId, token);
  return token;
}

async function validateToken(userId, token) {
  const stored = await fetchToken(userId);
  if (!stored) return false;
  try {
    // Constant-time comparison to prevent timing attacks.
    // Both buffers must be equal length; timingSafeEqual throws otherwise.
    return crypto.timingSafeEqual(
      Buffer.from(stored),
      Buffer.from(token)
    );
  } catch {
    return false;
  }
}

// ── Middleware ───────────────────────────────────────────────────────────────

// Attach CSRF token to every authenticated response so the client can read it.
async function attachCsrfToken(req, res, next) {
  if (!req.user?.id) return next();
  try {
    const token = await getOrGenerateToken(req.user.id);
    res.set('X-CSRF-Token', token);
    req.csrfToken = token;
  } catch (err) {
    logger.error('CSRF attachCsrfToken error', { message: err.message });
  }
  next();
}

// Validate CSRF token on all state-changing requests.
async function validateCsrfToken(req, res, next) {
  // Skip in test environment
  if (process.env.NODE_ENV === 'test') return next();

  // Safe methods are exempt
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // OxSteed's current authentication contract is an Authorization: Bearer
  // header, not an ambient cookie. Browsers cannot attach that custom header
  // from a cross-site form, so bearer-authenticated requests are already
  // protected against CSRF. Route-local authenticate middleware runs after
  // this global middleware; requiring a CSRF token here would either have no
  // user identity or break every existing API client. If cookie sessions are
  // introduced, they must populate req.user before this middleware or add a
  // dedicated cookie-auth CSRF boundary.
  if (req.headers.authorization?.startsWith('Bearer ')) return next();

  // Unauthenticated requests have no session token to validate against.
  if (!req.user?.id) return next();

  const token = req.headers['x-csrf-token'] || req.body?._csrf;

  if (!token) {
    return res.status(403).json({
      error: 'CSRF token missing',
      message: 'State-changing requests require X-CSRF-Token header',
    });
  }

  try {
    const valid = await validateToken(req.user.id, token);
    if (!valid) {
      return res.status(403).json({
        error: 'CSRF token invalid',
        message: 'Token is invalid or expired',
      });
    }
  } catch (err) {
    logger.error('CSRF validateCsrfToken error', { message: err.message });
    return res.status(403).json({
      error: 'CSRF token invalid',
      message: 'Token format is invalid',
    });
  }

  next();
}

async function invalidateToken(userId) {
  await deleteToken(userId);
}

module.exports = {
  attachCsrfToken,
  validateCsrfToken,
  invalidateToken,
  getOrGenerateToken,
};
