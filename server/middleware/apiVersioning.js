// API Version tracking middleware
// Detects version from query param (?v=v2) or header (API-Version: v2)
// Defaults to v1 for backward compatibility
// Enables gradual migration to explicit versioning

const logger = require('../utils/logger');

/**
 * Middleware to detect and track API version for requests.
 * Stores version in req.apiVersion for use in controllers.
 *
 * Detection order (first match wins):
 * 1. Query parameter: ?v=v1
 * 2. Header: API-Version: v1
 * 3. Default: v1
 *
 * Usage in index.js:
 *   app.use('/api/', apiVersionMiddleware);
 */
const apiVersionMiddleware = (req, res, next) => {
  // Try to detect version from request
  const versionFromQuery = req.query.v;
  const versionFromHeader = req.headers['api-version'];
  const version = versionFromQuery || versionFromHeader || 'v1';

  // Validate version format (v1, v2, v3, etc.)
  if (!/^v\d+$/.test(version)) {
    logger.warn('Invalid API version format', {
      version,
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    // Don't fail, just use v1 as fallback
    req.apiVersion = 'v1';
  } else {
    req.apiVersion = version;
  }

  // Log version usage (helps monitor client upgrade patterns)
  logger.info('API request', {
    apiVersion: req.apiVersion,
    method: req.method,
    path: req.path,
    userId: req.user?.id || null,
    ip: req.ip,
  });

  next();
};

/**
 * Helper to check if request is using specific API version
 * Usage in controllers: if (isApiVersion(req, 'v2')) { ... }
 */
const isApiVersion = (req, version) => {
  return req.apiVersion === version;
};

/**
 * Helper to send version-specific responses
 * Usage in controllers:
 *   const data = getVersionSpecificData(req, v1Data, v2Data);
 */
const getVersionSpecificData = (req, v1Data, v2Data) => {
  return isApiVersion(req, 'v2') ? v2Data : v1Data;
};

/**
 * Version-specific deprecation warning
 * Add to response headers when responding with v1
 */
const addDeprecationHeader = (res, version, sunsetDate) => {
  if (version === 'v1') {
    res.set('Deprecation', 'true');
    res.set('Sunset', sunsetDate);
    res.set('Link', '</api/v2; rel="successor-version"');
  }
};

module.exports = {
  apiVersionMiddleware,
  isApiVersion,
  getVersionSpecificData,
  addDeprecationHeader,
};
