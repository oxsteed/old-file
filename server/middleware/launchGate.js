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
const { envFlagEnabled } = require('./featureFlags');

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
  // Review P1-210: the specialized-template intake is launch-gated in the
  // client; the public intake API is now gated too (owners keep access to
  // requests that already exist).
  {
    prefix: '/api/maintenance-requests/public',
    flag: 'specializedProfileTemplates',
    allow: Object.freeze([]),
  },
  {
    // Review P2-652: carts, cart checkout, shared carts and job kits are the
    // marketplace purchase path; gate them with the product catalog.
    prefix: '/api/carts',
    flag: 'productMarketplace',
    allow: Object.freeze([]),
  },
  {
    prefix: '/api/shared-carts',
    flag: 'productMarketplace',
    allow: Object.freeze([]),
  },
  {
    prefix: '/api/job-kits',
    flag: 'productMarketplace',
    allow: Object.freeze([]),
  },
  {
    prefix: '/api/media',
    flag: 'oxsteedMedia',
    allow: Object.freeze([]),
  },
  {
    prefix: '/api/admin/media',
    flag: 'oxsteedMedia',
    allow: Object.freeze([]),
  },
]);

// Server-side resolution of every client launch key (client/src/utils/
// launchScope.js LAUNCH_DEFAULTS). Each entry is [env var, default]: the
// default mirrors the client's current build-time default, so an unset
// environment changes nothing, and setting the env var plus a redeploy flips
// that launch with no code edit. Established gates keep their existing
// variables (OXSTEED_MEDIA_LAUNCHED, VORTEX_ENABLED, AFFILIATE_ENABLED);
// the rest use OXSTEED_LAUNCH_<KEY>.
const LAUNCH_KEY_ENV = Object.freeze({
  affiliateRewards: ['AFFILIATE_ENABLED', true],
  aiKnowledge: ['OXSTEED_LAUNCH_AI_KNOWLEDGE', false],
  backgroundChecks: ['OXSTEED_LAUNCH_BACKGROUND_CHECKS', false],
  businessAscension: ['OXSTEED_LAUNCH_BUSINESS_ASCENSION', false],
  businessHubAdvancedOps: ['OXSTEED_LAUNCH_BUSINESS_HUB_ADVANCED_OPS', false],
  businessHubFinancialPlanning: ['OXSTEED_LAUNCH_BUSINESS_HUB_FINANCIAL_PLANNING', false],
  businessHubGrowthTools: ['OXSTEED_LAUNCH_BUSINESS_HUB_GROWTH_TOOLS', false],
  businessHubProductCommerce: ['OXSTEED_LAUNCH_BUSINESS_HUB_PRODUCT_COMMERCE', false],
  businessHubRoleMenu: ['OXSTEED_LAUNCH_BUSINESS_HUB_ROLE_MENU', false],
  businessHubRoleMenuWidgets: ['OXSTEED_LAUNCH_BUSINESS_HUB_ROLE_MENU_WIDGETS', false],
  businessHubSpecializedTemplates: ['OXSTEED_LAUNCH_BUSINESS_HUB_SPECIALIZED_TEMPLATES', false],
  businessHubVortexAccess: ['VORTEX_ENABLED', false],
  oxsteedMedia: ['OXSTEED_MEDIA_LAUNCHED', false],
  discoverEverything: ['OXSTEED_LAUNCH_DISCOVER_EVERYTHING', false],
  footerUtilityPills: ['OXSTEED_LAUNCH_FOOTER_UTILITY_PILLS', true],
  genericQrGenerator: ['OXSTEED_LAUNCH_GENERIC_QR_GENERATOR', false],
  helperEarnings: ['OXSTEED_LAUNCH_HELPER_EARNINGS', true],
  helperGrowthCenter: ['OXSTEED_LAUNCH_HELPER_GROWTH_CENTER', false],
  helperInvoices: ['OXSTEED_LAUNCH_HELPER_INVOICES', true],
  jobEscrowLabels: ['OXSTEED_LAUNCH_JOB_ESCROW_LABELS', true],
  jobMaterialsLogistics: ['OXSTEED_LAUNCH_JOB_MATERIALS_LOGISTICS', false],
  networkBranchSwitcher: ['OXSTEED_LAUNCH_NETWORK_BRANCH_SWITCHER', false],
  personalLifeDashboard: ['OXSTEED_LAUNCH_PERSONAL_LIFE_DASHBOARD', false],
  productMarketplace: ['OXSTEED_LAUNCH_PRODUCT_MARKETPLACE', false],
  resourcesMenu: ['OXSTEED_LAUNCH_RESOURCES_MENU', false],
  specializedProfileTemplates: ['OXSTEED_LAUNCH_SPECIALIZED_PROFILE_TEMPLATES', false],
  subscriptions: ['OXSTEED_LAUNCH_SUBSCRIPTIONS', false],
  templates: ['OXSTEED_LAUNCH_TEMPLATES', false],
  toolRentals: ['OXSTEED_LAUNCH_TOOL_RENTALS', true],
  vortexWorkspaceEntry: ['VORTEX_ENABLED', false],
});

// Read at call time so /api/launch-visibility always reflects the running
// environment. The API gate below snapshots the same values at boot instead:
// env changes need a redeploy either way.
function getServerLaunchVisibility() {
  const out = {};
  for (const [key, [envKey, defaultValue]] of Object.entries(LAUNCH_KEY_ENV)) {
    out[key] = envFlagEnabled(envKey, defaultValue);
  }
  return out;
}

// Boot snapshot for the gated products only. The full map above is served by
// /api/launch-visibility; the gate enforces the same values for the four
// prefixes it blocks, so a launch enabled via env unblocks its APIs in step
// with the client UI instead of rendering against 404s.
const LAUNCH_VISIBILITY = Object.freeze({
  templates: envFlagEnabled('OXSTEED_LAUNCH_TEMPLATES', false),
  productMarketplace: envFlagEnabled('OXSTEED_LAUNCH_PRODUCT_MARKETPLACE', false),
  specializedProfileTemplates: envFlagEnabled('OXSTEED_LAUNCH_SPECIALIZED_PROFILE_TEMPLATES', false),
  oxsteedMedia: envFlagEnabled('OXSTEED_MEDIA_LAUNCHED', false),
});

function isLaunchGateDisabled() {
  return String(process.env.LAUNCH_GATE_DISABLED || '').toLowerCase() === 'true';
}

/**
 * Product launch states for AI/support contexts (gap #4: launch-flag
 * blindness). Mirrors LAUNCH_VISIBILITY plus the main env-gated products
 * so the assistant never recommends a product the user cannot access.
 */
function getLaunchVisibility() {
  const on = (v) => String(v || '').trim().toLowerCase() === 'true';
  return {
    templates: LAUNCH_VISIBILITY.templates,
    productMarketplace: LAUNCH_VISIBILITY.productMarketplace,
    specializedProfileTemplates: LAUNCH_VISIBILITY.specializedProfileTemplates,
    oxsteedMedia: LAUNCH_VISIBILITY.oxsteedMedia,
    affiliate: on(process.env.AFFILIATE_ENABLED),
    logisticsPayments: on(process.env.LOGISTICS_PAYMENTS_ENABLED),
  };
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
  getLaunchVisibility,
  getServerLaunchVisibility,
  _resolveRequestPath: resolveRequestPath,
};
