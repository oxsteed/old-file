'use strict';

const AppError = require('../utils/appError');
const { hasGlobalGrant } = require('../middleware/adminAuth');

// Global metrics use the same grant boundary as their underlying admin lists.
// A regional grant cannot authorize a global aggregation. Restaurant metrics
// additionally retain the builder's existing restaurant ownership restriction.
const METRIC_PERMISSIONS = Object.freeze({
  open_disputes: 'manage_disputes',
  cancel_rate_pct: 'manage_operations',
  platform_revenue_cents: 'view_financials',
  investor_gmv_cents: 'view_financials',
  investor_take_rate_pct: 'view_financials',
  mrr_cents: 'view_financials',
  escrow_held_cents: 'view_financials',
  consulting_cancel_rate_pct: 'manage_operations',
  consulting_avg_nps: 'manage_operations',
  sla_first_response_compliance_pct: 'manage_support',
  support_nps_index: 'manage_support',
  restaurant_repeat_order_rate: 'view_financials',
  restaurant_top_items_revenue: 'view_financials',
});

async function permittedMetrics(user, names = Object.keys(METRIC_PERMISSIONS)) {
  if (!user?.id || !['admin', 'super_admin'].includes(user.role)) return [];
  const known = names.filter(name => Object.hasOwn(METRIC_PERMISSIONS, name));
  if (user.role === 'super_admin') return known;
  const permissions = [...new Set(known.map(name => METRIC_PERMISSIONS[name]))];
  const grants = new Map(await Promise.all(permissions.map(async permission =>
    [permission, await hasGlobalGrant(user.id, permission)])));
  return known.filter(name => grants.get(METRIC_PERMISSIONS[name]) === true);
}

async function assertMetricAccess(user, metric) {
  if (!(await permittedMetrics(user, [metric])).includes(metric)) {
    throw new AppError('A current global permission is required for this metric', 403,
      'metric_permission_required', { required: METRIC_PERMISSIONS[metric] || null });
  }
}

module.exports = { METRIC_PERMISSIONS, permittedMetrics, assertMetricAccess };
