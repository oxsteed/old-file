'use strict';

// Server-side launch gate for product APIs.
//
// The client hides unlaunched products via LAUNCH_VISIBILITY
// (client/src/utils/launchScope.js), but nothing stopped direct API calls.
// This middleware blocks API requests to explicitly unlaunched product areas.
//
// Design:
// - Explicit blocklist only: unknown paths are allowed (fail-open) so
//   launched products are never accidentally broken.
// - Kill-switch: set LAUNCH_GATE_DISABLED=true to disable (e.g., for admin
//   preview/testing, or if a product launches without a code change).
// - Path matching uses the full URL path (req.baseUrl + req.path), because
//   when this middleware is mounted with app.use('/api/templates', ...) Express
//   strips the mount prefix from req.path.
// - Operator sub-paths stay reachable: the admin template management screens
//   (/api/templates/admin/*) and the admin Home Depot sync are already guarded
//   by authenticate + requireAdmin/requireRole in their routers, so the gate
//   lets them through. Everything user-facing under a gated prefix returns 404,
//   matching the client, which redirects /templates to /business-hub and hides
//   the product marketplace while the flags are false.

const logger = require('../utils/logger');

// API path prefixes mapped to their launch flag. Only prefixes listed here
// are gated; everything else passes through. Note: /api/affiliate is already
// gated by requireFeatureEnabled('Affiliate', 'AFFILIATE_ENABLED'), so it is
// not duplicated here.
const GATED_PREFIXES = Object.freeze([
  {
    prefix: '/api/templates',
    flag: 'templates',
    allow: Object.freeze(['/api/templates/admin']),
  },
  {
    prefix: '/api/marketplace/products',
    flag: 'productMarketplace',
    allow: Object.freeze(['/api/marketplace/products/sync-homedepot']),
  },
]);

// Mirrors client/src/utils/launchScope.js LAUNCH_VISIBILITY for the gated
// products. When a product launches, flip its flag here (and in the client).
const LAUNCH_VISIBILITY = Object.freeze({
  templates: false,
  productMarketplace: false,
});

function isLaunchGateDisabled() {
  return String(process.env.LAUNCH_GATE_DISABLED || '').toLowerCase() === 'true';
}

function matchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function resolveRequestPath(req) {
  // req.baseUrl holds the mount path ('/api/templates'); req.path is relative
  // to it. Fall back to originalUrl (minus the query string) when neither is
  // available, e.g. in unit tests that call the middleware directly.
  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  const rel = typeof req.path === 'string' ? req.path : '';
  let path = `${base}${rel === '/' && base ? '' : rel}`;
  if (!path) path = String(req.originalUrl || req.url || '').split('?')[0];
  // Normalise duplicate and trailing slashes so '/api/templates//' matches.
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path.toLowerCase();
}

function launchGate() {
  return (req, res, next) => {
    if (isLaunchGateDisabled()) return next();
    const path = resolveRequestPath(req);
    for (const { prefix, flag, allow } of GATED_PREFIXES) {
      if (!matchesPrefix(path, prefix)) continue;
      if (LAUNCH_VISIBILITY[flag]) return next();
      if (allow.some((allowed) => matchesPrefix(path, allowed))) return next();
      logger.info('[launchGate] blocked unlaunched product API', { path, flag });
      return res.status(404).json({ error: 'Not found' });
    }
    return next();
  };
}

module.exports = {
  launchGate,
  GATED_PREFIXES,
  LAUNCH_VISIBILITY,
  _resolveRequestPath: resolveRequestPath,
};
