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
// Note: this runs before per-router auth, so there is no admin bypass here;
// use the kill switch for admin preview.

const logger = require('./logger');

// API path prefixes mapped to their launch flag. Only prefixes listed here
// are gated; everything else passes through. Note: /api/affiliate is already
// gated by requireFeatureEnabled('Affiliate', 'AFFILIATE_ENABLED'), so it is
// not duplicated here.
const GATED_PREFIXES = Object.freeze([
  { prefix: '/api/templates', flag: 'templates' },
  { prefix: '/api/marketplace/products', flag: 'productMarketplace' },
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

function launchGate() {
  return (req, res, next) => {
    if (isLaunchGateDisabled()) return next();
    const path = req.path || req.originalUrl || '';
    for (const { prefix, flag } of GATED_PREFIXES) {
      if (path === prefix || path.startsWith(prefix + '/')) {
        if (LAUNCH_VISIBILITY[flag]) return next();
        logger.info('[launchGate] blocked unlaunched product API', { path, flag });
        return res.status(404).json({ error: 'Not found' });
      }
    }
    return next();
  };
}

module.exports = { launchGate, GATED_PREFIXES, LAUNCH_VISIBILITY };
