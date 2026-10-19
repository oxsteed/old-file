'use strict';

/**
 * Governed KPI values for dashboard cards (MoneyPage, OperationsOverview,
 * Customer 360). Each value is the registry metric computed with the query
 * builder's own SQL (buildMetricSql), the admin's per-metric grant and the
 * same region filter the builder and evidence use, so a card, the builder
 * result and the evidence summary cannot disagree. Metrics the viewer has no
 * grant for are returned as { permitted: false } with no value (fail closed).
 *
 * This is a read path for page cards: it does not write query-ledger rows.
 * Drilling into evidence goes through the builder, which audits.
 */
const registry = require('./metricsRegistry');
const {
  validateBuilderQuery, buildMetricSql, runCappedQuery, BUILDER_FILTERS, PERIODS,
} = require('./queryBuilder');
const { metricScope } = require('./metricAccess');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');

// Restaurant metrics need a restaurant scope and are not dashboard cards.
const CARD_METRICS = Object.freeze([
  'platform_revenue_cents', 'refund_rate_pct', 'promo_discount_cents', 'mrr_cents', 'escrow_held_cents',
  'payout_failure_count', 'dispute_rate_pct', 'open_disputes', 'job_completion_rate_pct', 'cancel_rate_pct',
  'investor_gmv_cents', 'investor_take_rate_pct', 'sla_first_response_compliance_pct', 'support_nps_index',
  'consulting_avg_nps', 'consulting_cancel_rate_pct',
]);

// The value column of each metric's aggregate row, plus the count columns
// shown as the denominator.
const VALUE_COLUMNS = Object.freeze({
  platform_revenue_cents: { value: 'revenue_cents' },
  refund_rate_pct: { value: 'refund_rate_pct', numerator: 'refunded', denominator: 'total' },
  promo_discount_cents: { value: 'promo_discount_cents', numerator: 'redemptions' },
  mrr_cents: { value: 'mrr_cents' },
  escrow_held_cents: { value: 'escrow_held_cents' },
  payout_failure_count: { value: 'value' },
  dispute_rate_pct: { value: 'dispute_rate_pct', numerator: 'disputed', denominator: 'total' },
  open_disputes: { value: 'value' },
  job_completion_rate_pct: { value: 'completion_rate_pct', numerator: 'completed', denominator: 'decided' },
  cancel_rate_pct: { value: 'cancel_rate_pct', numerator: 'cancelled', denominator: 'total' },
  investor_gmv_cents: { value: 'gmv_cents', numerator: 'completed_jobs' },
  investor_take_rate_pct: { value: 'take_rate_pct' },
  sla_first_response_compliance_pct: { value: 'compliance_pct', numerator: 'met', denominator: 'eligible' },
  support_nps_index: { value: 'nps_index', denominator: 'responses' },
  consulting_avg_nps: { value: 'avg_nps', denominator: 'responses' },
  consulting_cancel_rate_pct: { value: 'cancel_rate_pct', numerator: 'cancelled', denominator: 'decided' },
});

const MAX_METRICS = 12;

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseMetricList(raw) {
  const names = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length || names.length > MAX_METRICS) {
    throw new AppError(`metrics: 1-${MAX_METRICS} names expected`, 400, 'invalid_param');
  }
  for (const n of names) {
    if (!CARD_METRICS.includes(n)) throw new AppError(`Unknown card metric "${n}"`, 400, 'invalid_metric');
  }
  return [...new Set(names)];
}

/**
 * @param {object} db pool
 * @param {object} user req.user
 * @param {string[]} metrics
 * @param {{ period?: string, filters?: object }} opts filters are applied only to
 *   metrics that declare the key (e.g. customerId for cancel_rate_pct).
 */
async function governedKpis(db, user, metrics, { period = '30d', filters = {} } = {}) {
  if (!PERIODS.includes(period)) throw new AppError('Invalid period', 400, 'invalid_period');
  const cache = new Map();
  const out = [];
  for (const metric of metrics) {
    const def = registry.METRICS?.[metric] || null;
    const scope = await metricScope(user, metric, cache).catch(err => {
      if (err?.code === 'region_unknown') return { unknown: true };
      throw err;
    });
    if (!scope || scope.unknown) { out.push({ metric, permitted: false }); continue; }
    const allowed = BUILDER_FILTERS[metric] || [];
    const metricFilters = Object.fromEntries(Object.entries(filters || {}).filter(([k, v]) => allowed.includes(k) && v != null && v !== ''));
    const query = validateBuilderQuery({ metric, dimensions: [], filters: metricFilters, period });
    const built = buildMetricSql(query, { isSuperAdmin: user.role === 'super_admin', isAdmin: true, restaurantIds: [] });
    try {
      const { rows } = await runCappedQuery(db, built, 50, { regionScope: scope });
      const cols = VALUE_COLUMNS[metric];
      const values = rows.map(row => ({
        currency_code: row.currency_code || null,
        cohort: row.cohort || null,
        value: num(row[cols.value]),
        numerator: cols.numerator ? num(row[cols.numerator]) : null,
        denominator: cols.denominator ? num(row[cols.denominator]) : null,
      }));
      out.push({
        metric, permitted: true, period: query.period, filters: query.filters,
        scope: scope.global ? 'global' : 'regional',
        definition: def?.definition || null,
        values,
      });
    } catch (err) {
      logger.warn('Governed KPI failed', { metric, code: err.code || err.message });
      out.push({ metric, permitted: true, period: query.period, filters: query.filters, error: 'query_failed', values: [] });
    }
  }
  return out;
}

module.exports = { CARD_METRICS, VALUE_COLUMNS, governedKpis, parseMetricList };
