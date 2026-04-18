// API Versioning Router
// Routes requests to appropriate version handlers
// Falls back to v1 if v2 route doesn't exist

const express = require('express');
const logger = require('../utils/logger');

/**
 * Create versioned API router.
 * All routes are mounted under /api/:version/...
 * If v2 route doesn't exist, falls back to v1
 *
 * Usage in main app:
 *   const apiRouter = createVersionedRouter();
 *   app.use('/api', apiRouter);
 *
 * Client usage:
 *   GET /api/v1/jobs         (explicit v1)
 *   GET /api/v2/jobs         (v2 if exists, else v1)
 *   GET /api/jobs            (ERROR: must specify version)
 */
const createVersionedRouter = () => {
  const router = express.Router();

  // Require version in all requests
  router.use((req, res, next) => {
    const version = req.params.version || req.headers['api-version'];
    if (!version) {
      return res.status(400).json({
        error: 'API version required',
        hint: 'Use /api/v1 or /api/v2, or set API-Version header',
      });
    }
    req.apiVersion = version;
    next();
  });

  // V1 routes (current stable)
  router.use('/v1', (req, res, next) => {
    req.apiVersion = 'v1';
    next();
  });

  // V2 routes (new features)
  router.use('/v2', (req, res, next) => {
    req.apiVersion = 'v2';
    next();
  });

  // Fallback: if v2 route not found, try v1
  router.use('/v2', (req, res, next) => {
    res.status(404).json({
      error: 'Route not found in v2',
      hint: 'This endpoint may not be available in v2. Try /api/v1 instead.',
      version: 'v2',
      path: req.path,
    });
  });

  return router;
};

/**
 * Version-aware middleware to log API version usage.
 * Attach to individual routes or globally.
 */
const versionLog = (req, res, next) => {
  const version = req.apiVersion || 'unknown';
  logger.info('API request', {
    version,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userId: req.user?.id || null,
  });
  next();
};

/**
 * Version-specific response formatter.
 * Ensures consistency across versions.
 */
const versionedResponse = (version) => {
  return (req, res, next) => {
    const originalJson = res.json;
    res.json = function (data) {
      const envelope = {
        apiVersion: version,
        timestamp: new Date().toISOString(),
        data,
      };
      return originalJson.call(this, envelope);
    };
    next();
  };
};

module.exports = {
  createVersionedRouter,
  versionLog,
  versionedResponse,
};
