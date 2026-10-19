'use strict';

const AppError = require('../utils/appError');
const db = require('../db');
const { hasGlobalGrant } = require('../middleware/adminAuth');
const { DEFINITIONS } = require('./operationalMetrics');
const { normalizeBoundary } = require('./regionScope');

// Global metrics use the same grant boundary as their underlying admin lists.
// A current GLOBAL grant (or super_admin) sees platform-wide rows. An admin
// whose grants for the permission are only regional sees region-filtered rows
// (analytics/regionScope.js); every path fails closed.
const METRIC_PERMISSIONS = Object.freeze({
  ...Object.fromEntries(Object.entries(DEFINITIONS).map(([name, def]) => [name, def.permission])),
  open_disputes: 'manage_disputes',
  cancel_rate_pct: 'manage_operations',
  platform_revenue_cents: 'view_financials',
  investor_gmv_cents: 'view_financials',
  investor_take_rate_pct: 'view_financials',
  mrr_cents: 'view_financials',
  escrow_held_cents: 'view_financials',
  promo_discount_cents: 'view_financials',
  consulting_cancel_rate_pct: 'manage_operations',
  consulting_avg_nps: 'manage_operations',
  sla_first_response_compliance_pct: 'manage_support',
  support_nps_index: 'manage_support',
  restaurant_repeat_order_rate: 'view_financials',
  restaurant_top_items_revenue: 'view_financials',
});

const GLOBAL_SCOPE = Object.freeze({ global: true, regions: null, regionIds: null });

/**
 * Current regional territory for a permission: valid boundaries from active,
 * unexpired, non-revoked grants with a region. Grants whose region row is
 * gone or whose boundary is not a valid known shape contribute nothing.
 */
async function regionalTerritory(userId, permission, conn = db) {
  const { rows } = await conn.query(
    `SELECT g.region_id, r.id AS region_row_id, r.boundary_definition
       FROM admin_permission_grants g
       LEFT JOIN admin_regions r ON r.id = g.region_id
      WHERE g.grantee_id = $1 AND g.permissions ? $2
        AND g.expires_at > NOW() AND g.revoked_at IS NULL
        AND g.region_id IS NOT NULL
      ORDER BY g.region_id`,
    [userId, permission]);
  const regions = [];
  const regionIds = [];
  let grants = 0;
  for (const row of rows) {
    grants += 1;
    if (row.region_row_id == null) continue;
    const boundary = normalizeBoundary(row.boundary_definition);
    if (!boundary || regionIds.includes(row.region_id)) continue;
    regions.push(boundary);
    regionIds.push(row.region_id);
  }
  return { grants, regions, regionIds };
}

/**
 * Scope for one metric: GLOBAL_SCOPE, a regional scope, or null (no access).
 * Throws AppError 403 region_unknown when the admin's only grants are regional
 * but none resolves to a valid territory.
 */
async function metricScope(user, metric, cache = new Map()) {
  if (!user?.id || !['admin', 'super_admin'].includes(user.role)) return null;
  if (!Object.hasOwn(METRIC_PERMISSIONS, metric)) return null;
  if (user.role === 'super_admin') return GLOBAL_SCOPE;
  const permission = METRIC_PERMISSIONS[metric];
  if (!cache.has(permission)) {
    cache.set(permission, (async () => {
      if (await hasGlobalGrant(user.id, permission)) return GLOBAL_SCOPE;
      const territory = await regionalTerritory(user.id, permission);
      if (!territory.grants) return null;
      if (!territory.regions.length) return { unknown: true };
      return Object.freeze({ global: false, regions: territory.regions, regionIds: territory.regionIds, permission });
    })());
  }
  return cache.get(permission);
}

async function permittedMetrics(user, names = Object.keys(METRIC_PERMISSIONS)) {
  const known = names.filter(name => Object.hasOwn(METRIC_PERMISSIONS, name));
  const cache = new Map();
  const scopes = await Promise.all(known.map(name => metricScope(user, name, cache)));
  return known.filter((name, i) => scopes[i] && !scopes[i].unknown);
}

/** Per-metric scope kinds for catalogs: { name: 'global' | 'regional' }. */
async function permittedMetricScopes(user, names = Object.keys(METRIC_PERMISSIONS)) {
  const known = names.filter(name => Object.hasOwn(METRIC_PERMISSIONS, name));
  const cache = new Map();
  const scopes = await Promise.all(known.map(name => metricScope(user, name, cache)));
  const out = {};
  known.forEach((name, i) => { if (scopes[i] && !scopes[i].unknown) out[name] = scopes[i].global ? 'global' : 'regional'; });
  return out;
}

/** Asserts access and returns the scope to execute under. */
async function assertMetricAccess(user, metric) {
  const scope = await metricScope(user, metric);
  if (scope?.unknown) {
    throw new AppError('Your regional grant does not resolve to a known region', 403, 'region_unknown',
      { required: METRIC_PERMISSIONS[metric] || null });
  }
  if (!scope) {
    throw new AppError('A current permission is required for this metric', 403,
      'metric_permission_required', { required: METRIC_PERMISSIONS[metric] || null });
  }
  return scope;
}

module.exports = {
  METRIC_PERMISSIONS, GLOBAL_SCOPE, permittedMetrics, permittedMetricScopes, assertMetricAccess,
  metricScope, regionalTerritory,
};
