// Response sanitizer - removes sensitive data from error responses
// Prevents information disclosure vulnerabilities

const logger = require('../utils/logger');

/**
 * Sanitize error responses to prevent information disclosure
 * - Remove stack traces in production
 * - Remove system paths
 * - Remove database details
 * - Redact sensitive fields
 */
function responseSanitizer(req, res, next) {
  // Store original json method
  const originalJson = res.json;

  // Override res.json
  res.json = function(data) {
    const isProduction = process.env.NODE_ENV === 'production';

    if (data && data.error && isProduction) {
      // Sanitize error responses in production
      const sanitized = sanitizeErrorResponse(data);
      return originalJson.call(this, sanitized);
    }

    return originalJson.call(this, data);
  };

  next();
}

/**
 * Remove sensitive data from error responses
 */
function sanitizeErrorResponse(data) {
  const sanitized = { ...data };

  // Never leak stack traces
  if (sanitized.stack) {
    delete sanitized.stack;
  }

  // Never leak system paths
  if (sanitized.error && typeof sanitized.error === 'string') {
    sanitized.error = sanitized.error
      .replace(/\/[a-zA-Z0-9_\-./]+\.(js|sql|ts)/g, '[PATH]')
      .replace(/postgresql:\/\/[^\s]+/g, '[DB_URL]')
      .replace(/\$\{[^\}]+\}/g, '[ENV_VAR]');
  }

  // Never leak SQL details
  if (sanitized.message && typeof sanitized.message === 'string') {
    sanitized.message = sanitized.message
      .replace(/FROM\s+"[^"]+"/gi, 'FROM [TABLE]')
      .replace(/WHERE\s+[^\s]+\s*=/gi, 'WHERE [COLUMN]=')
      .replace(/SQL:/gi, '[DB_ERROR]');
  }

  return sanitized;
}

/**
 * Validate response headers for security compliance
 */
function validateSecurityHeaders(req, res, next) {
  // Check required headers are present
  const requiredHeaders = [
    'x-content-type-options',
    'x-frame-options',
    'strict-transport-security',
  ];

  const headerCheck = requiredHeaders.map(h => ({
    header: h,
    present: !!res.getHeader(h),
  }));

  const missing = headerCheck.filter(h => !h.present);
  if (missing.length > 0) {
    logger.warn('Missing security headers', { missing: missing.map(m => m.header) });
  }

  next();
}

/**
 * Add additional security headers that helmet might miss
 */
function addAdditionalSecurityHeaders(req, res, next) {
  // Prevent browsers from guessing MIME types
  res.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  res.set('X-Frame-Options', 'DENY');

  // XSS filter for legacy browsers
  res.set('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Do not let browsers or intermediary caches retain authenticated API and
  // admin responses. Public page assets keep their existing cache policy.
  if (req.path?.startsWith('/api/') || req.path?.startsWith('/admin/')) {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
  }

  // Permissions policy (Chromium)
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');

  // STS header if HTTPS
  if (req.protocol === 'https') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  next();
}

module.exports = {
  responseSanitizer,
  validateSecurityHeaders,
  addAdditionalSecurityHeaders,
};
