const crypto = require('crypto');

// CSRF token middleware for protecting against Cross-Site Request Forgery attacks
//
// For SPA applications:
// - CSRF tokens are stored in memory per session
// - Tokens are validated on all state-changing operations (POST/PUT/DELETE)
// - SameSite cookies provide an additional layer of protection
//
// The CSRF token is generated once per session and reused for all requests.
// Tokens are stored in a Map keyed by user ID to allow fast lookup.

const tokenMap = new Map(); // userId -> token
const TOKEN_LENGTH = 32;
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

// Generate a new CSRF token
function generateToken() {
  return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
}

// Get or generate a token for a user session
function getOrGenerateToken(userId) {
  if (!tokenMap.has(userId)) {
    const token = generateToken();
    tokenMap.set(userId, {
      token,
      createdAt: Date.now(),
    });
  }
  return tokenMap.get(userId).token;
}

// Validate a CSRF token
function validateToken(userId, token) {
  if (!tokenMap.has(userId)) return false;

  const stored = tokenMap.get(userId);

  // Check expiry
  if (Date.now() - stored.createdAt > TOKEN_EXPIRY) {
    tokenMap.delete(userId);
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(stored.token),
    Buffer.from(token)
  );
}

// Invalidate a token (e.g., on logout)
function invalidateToken(userId) {
  tokenMap.delete(userId);
}

// Middleware to attach CSRF token to request
// Token is generated on first access and reused for the session
function attachCsrfToken(req, res, next) {
  if (!req.user || !req.user.id) {
    return next();
  }

  const token = getOrGenerateToken(req.user.id);
  res.set('X-CSRF-Token', token);
  req.csrfToken = token;

  next();
}

// Middleware to validate CSRF token on state-changing requests
// Safe methods (GET, HEAD, OPTIONS) are not protected
// All other methods require a valid CSRF token in the X-CSRF-Token header
function validateCsrfToken(req, res, next) {
  // Skip validation for safe HTTP methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip validation for public endpoints (non-authenticated)
  if (!req.user || !req.user.id) {
    return next();
  }

  const token = req.headers['x-csrf-token'] || req.body._csrf;

  if (!token) {
    return res.status(403).json({
      error: 'CSRF token missing',
      message: 'State-changing requests require X-CSRF-Token header',
    });
  }

  try {
    if (!validateToken(req.user.id, token)) {
      return res.status(403).json({
        error: 'CSRF token invalid',
        message: 'Token is invalid or expired',
      });
    }
  } catch (err) {
    // timingSafeEqual can throw if lengths don't match
    return res.status(403).json({
      error: 'CSRF token invalid',
      message: 'Token format is invalid',
    });
  }

  next();
}

module.exports = {
  attachCsrfToken,
  validateCsrfToken,
  invalidateToken,
  getOrGenerateToken,
};
