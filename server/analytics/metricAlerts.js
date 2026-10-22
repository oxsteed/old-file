'use strict';

/**
 * Metric threshold alerts (analytics platform, Phase 2, Item 9).
 *
 * Shared validation + canonical compute map for metric alert rules. The
 * evaluator (server/jobs/metricThresholdAlerts.js) and the rule CRUD
 * endpoints (server/controllers/adminSelfSettingsController.js) both
 * require this module, so validation and computation can never drift.
 *
 * Alertable = registry metrics that have a canonical compute function.
 * v1 deliberately EXCLUDES three registry metrics with no compute function:
 *   - investor_gmv_cents            (definition is registered; no compute fn)
 *   - consulting_cancel_rate_pct    (definition is registered; no compute fn)
 *   - sla_first_response_compliance_pct (definition fragments exist; no
 *     standalone compute fn)
 * Rules for those names are rejected with 400 until a compute function is
 * registered. Threshold units are the metric's native unit: integer cents
 * for *_cents metrics, percentage points for *_pct metrics (2dp), and the
 * raw index/average for *_index / *_avg_nps metrics.
 */

const registry = require('./metricsRegistry');
const { AppError } = require('../middleware/errorHandler');
const { financialMetricValue } = require('./financialMetrics');
const { DEFINITIONS: operationalMetrics } = require('./operationalMetrics');

// Execute the same governed SQL as the interactive builder. This keeps the
// window/cohort and eligible denominator identical across both consumers.
async function builderValue(db, metric, params, column = 'value') {
  const { buildMetricSql, validateBuilderQuery } = require('./queryBuilder');
  const query = validateBuilderQuery({ metric, period: paramsForPeriod(params) });
  const built = buildMetricSql(query, { isSuperAdmin: true });
  const { rows } = await db.query(built.text, built.params);
  return rows[0]?.[column] ?? null;
}

const OPERATORS = Object.freeze(['>', '<', '==']);

// Per-metric optional params accepted from rule input.
const PERIODS = Object.freeze(['1d', '7d', '30d', '90d', '1y']);

function paramsForPeriod(params) {
  const period = params && params.period != null ? String(params.period) : '30d';
  if (!PERIODS.includes(period)) {
    throw new AppError(`Invalid period "${period}": expected one of ${PERIODS.join(', ')}`, 400, 'invalid_param');
  }
  return registry.resolvePeriod(period);
}

const ALERTABLE_METRICS = Object.freeze({
  ...Object.fromEntries(Object.entries(operationalMetrics).map(([name, def]) => [name, Object.freeze({
    unit: def.unit, params: ['period', 'comparison'], preference: def.preference,
    compute: (db, params) => builderValue(db, name, params, def.valueColumn || 'value'),
  })])),
  investor_gmv_cents: Object.freeze({
    unit: 'cents', params: ['currencyCode'],
    compute: (db, params) => financialMetricValue(db, 'investor_gmv_cents', params.currencyCode || 'USD'),
  }),
  consulting_cancel_rate_pct: Object.freeze({
    unit: 'pct', params: ['period'],
    compute: (db, params) => builderValue(db, 'consulting_cancel_rate_pct', params, 'cancel_rate_pct'),
  }),
  sla_first_response_compliance_pct: Object.freeze({
    unit: 'pct', params: ['period'], preference: 'notify_incidents',
    compute: (db, params) => builderValue(db, 'sla_first_response_compliance_pct', params, 'compliance_pct'),
  }),
  open_disputes: Object.freeze({
    unit: 'count',
    preference: 'notify_disputes',
    params: [],
    compute: (db) => registry.openDisputes(db),
  }),
  platform_revenue_cents: Object.freeze({
    unit: 'cents',
    params: ['period', 'currencyCode'],
    compute: async (db, params) => {
      return financialMetricValue(db, 'platform_revenue_cents', params.currencyCode || 'USD',
        { interval: registry.PERIOD_INTERVAL[paramsForPeriod(params)].interval });
    },
  }),
  promo_discount_cents: Object.freeze({
    unit: 'cents',
    params: ['period', 'currencyCode'],
    compute: (db, params) => financialMetricValue(db, 'promo_discount_cents', params.currencyCode || 'USD',
      { interval: registry.PERIOD_INTERVAL[paramsForPeriod(params)].interval }),
  }),
  investor_take_rate_pct: Object.freeze({
    unit: 'pct',
    params: ['currencyCode'],
    compute: (db, params) => registry.investorTakeRatePct(db, params.currencyCode || 'USD'),
  }),
  cancel_rate_pct: Object.freeze({
    unit: 'pct',
    params: ['period'],
    // v1 is platform-wide: customer/helper roles need a userId, which a
    // platform-wide alert rule has no natural value for. Keep the canonical
    // 'platform' cohort; per-role scoping is a documented Item-9 limitation.
    compute: (db, params) => builderValue(db, 'cancel_rate_pct', params, 'cancel_rate_pct'),
  }),
  support_nps_index: Object.freeze({
    unit: 'index',
    params: ['days'],
    compute: async (db, params) => {
      const days = params && params.days != null ? parseInt(params.days, 10) : 30;
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new AppError('Invalid days: expected an integer 1..365', 400, 'invalid_param');
      }
      const { nps_index } = await registry.supportNpsIndex(db, { days });
      return nps_index;
    },
  }),
  consulting_avg_nps: Object.freeze({
    unit: 'index',
    params: ['period'],
    compute: (db, params) => builderValue(db, 'consulting_avg_nps', params, 'avg_nps'),
  }),
  mrr_cents: Object.freeze({
    unit: 'cents',
    params: ['currencyCode'],
    compute: (db, params) => financialMetricValue(db, 'mrr_cents', params.currencyCode || 'USD'),
  }),
  escrow_held_cents: Object.freeze({
    unit: 'cents',
    params: ['currencyCode'],
    compute: (db, params) => financialMetricValue(db, 'escrow_held_cents', params.currencyCode || 'USD'),
  }),
  // Growth engine metrics (spec 21.1): single-value builders read the
  // canonical 'value' column; the two money metrics go through the
  // financial builder per currency.
  growth_campaign_recipients: Object.freeze({
    unit: 'count', params: ['period'],
    compute: (db, params) => builderValue(db, 'growth_campaign_recipients', params, 'value'),
  }),
  growth_offer_ctr_pct: Object.freeze({
    unit: 'pct', params: ['period'],
    compute: (db, params) => builderValue(db, 'growth_offer_ctr_pct', params, 'value'),
  }),
  growth_offer_optout_rate_pct: Object.freeze({
    unit: 'pct', params: ['period'],
    compute: (db, params) => builderValue(db, 'growth_offer_optout_rate_pct', params, 'value'),
  }),
  growth_push_open_rate_pct: Object.freeze({
    unit: 'pct', params: ['period'],
    compute: (db, params) => builderValue(db, 'growth_push_open_rate_pct', params, 'value'),
  }),
  demand_unfilled_rate_pct: Object.freeze({
    unit: 'pct', params: ['period'],
    compute: (db, params) => builderValue(db, 'demand_unfilled_rate_pct', params, 'value'),
  }),
  demand_gap_index: Object.freeze({
    unit: 'index', params: ['period'],
    compute: (db, params) => builderValue(db, 'demand_gap_index', params, 'value'),
  }),
  growth_affiliate_commission_cents: Object.freeze({
    unit: 'cents',
    params: ['period', 'currencyCode'],
    compute: (db, params) => financialMetricValue(db, 'growth_affiliate_commission_cents', params.currencyCode || 'USD',
      { interval: registry.PERIOD_INTERVAL[paramsForPeriod(params)].interval }),
  }),
  growth_promo_redeemed_cents: Object.freeze({
    unit: 'cents',
    params: ['period', 'currencyCode'],
    compute: (db, params) => financialMetricValue(db, 'growth_promo_redeemed_cents', params.currencyCode || 'USD',
      { interval: registry.PERIOD_INTERVAL[paramsForPeriod(params)].interval }),
  }),
});

function isAlertableMetric(name) {
  return Object.prototype.hasOwnProperty.call(ALERTABLE_METRICS, name);
}

/**
 * Validate + sanitize rule input from the API. Returns the normalized rule
 * fields (params keeps only the metric's declared params). Throws AppError
 * 400 on any invalid value.
 */
function validateRuleInput(body) {
  const input = body && typeof body === 'object' ? body : {};
  const metricName = String(input.metric_name || '').trim();
  if (!isAlertableMetric(metricName)) {
    throw new AppError(
      `Invalid metric "${metricName || ''}": expected one of ${Object.keys(ALERTABLE_METRICS).join(', ')}`,
      400,
      'invalid_metric'
    );
  }
  const def = ALERTABLE_METRICS[metricName];
  const operator = String(input.operator || '').trim();
  if (!OPERATORS.includes(operator)) {
    throw new AppError(`Invalid operator "${operator}": expected one of ${OPERATORS.join(', ')}`, 400, 'invalid_operator');
  }
  const threshold = Number(input.threshold);
  if (!Number.isFinite(threshold)) {
    throw new AppError('Invalid threshold: expected a finite number', 400, 'invalid_threshold');
  }
  if (def.unit === 'cents' && !Number.isSafeInteger(threshold)) {
    throw new AppError('Money thresholds require integer minor units', 400, 'invalid_threshold');
  }
  // Thresholds in native units; bound them so a typo cannot create an
  // always/never-firing rule that is hard to notice. Cents metrics: up to
  // $10M in cents. Counts/pct/index: sane absolute bounds.
  const bound = def.unit === 'cents' ? 1e9 : def.unit === 'count' ? 1e7 : 1e4;
  if (Math.abs(threshold) > bound) {
    throw new AppError(`Invalid threshold: out of range for ${def.unit} metrics`, 400, 'invalid_threshold');
  }
  const rawParams = input.params && typeof input.params === 'object' ? input.params : {};
  const params = {};
  for (const key of def.params) {
    if (key === 'period') {
      params.period = paramsForPeriod(rawParams);
    } else if (key === 'currencyCode') {
      const code = String(rawParams.currencyCode || 'USD').trim().toUpperCase();
      if (!Intl.supportedValuesOf('currency').includes(code)) throw new AppError('Invalid currency', 400, 'invalid_currency');
      params.currencyCode = code;
    } else if (key === 'days') {
      const days = rawParams.days != null ? parseInt(rawParams.days, 10) : 30;
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new AppError('Invalid days: expected an integer 1..365', 400, 'invalid_param');
      }
      params.days = days;
    } else if (key === 'comparison') {
      const comparison = rawParams.comparison || 'absolute';
      if (!['absolute', 'previous_period_pct'].includes(comparison)) {
        throw new AppError('Invalid comparison', 400, 'invalid_param');
      }
      params.comparison = comparison;
    }
  }
  const cooldownMinutes = input.cooldown_minutes != null ? Number(input.cooldown_minutes) : 60;
  if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 5 || cooldownMinutes > 43200) {
    throw new AppError('Invalid cooldown_minutes: expected an integer 5..43200', 400, 'invalid_cooldown');
  }
  const bool = (v, dflt) => (v == null ? dflt : v === true || v === 'true');
  const channels = {
    channel_in_app: bool(input.channel_in_app, true),
    channel_email: bool(input.channel_email, true),
    channel_sms: bool(input.channel_sms, false),
  };
  if (!channels.channel_in_app && !channels.channel_email && !channels.channel_sms) {
    throw new AppError('At least one delivery channel must be enabled', 400, 'no_channels');
  }
  return {
    metric_name: metricName,
    operator,
    threshold,
    params,
    cooldown_minutes: cooldownMinutes,
    is_active: input.is_active == null ? true : input.is_active === true || input.is_active === 'true',
    ...channels,
  };
}

function compareValues(operator, value, threshold) {
  if (typeof value === 'string' && /^-?\d+$/.test(value) && Number.isSafeInteger(threshold)) {
    const v = BigInt(value), t = BigInt(threshold);
    return operator === '>' ? v > t : operator === '<' ? v < t : operator === '==' ? v === t : false;
  }
  const v = Number(value);
  if (!Number.isFinite(v)) return false;
  switch (operator) {
    case '>': return v > threshold;
    case '<': return v < threshold;
    case '==': return v === threshold;
    default: return false;
  }
}

async function computeMetricValue(db, metricName, params) {
  const def = ALERTABLE_METRICS[metricName];
  if (!def) throw new AppError(`Invalid metric "${metricName}"`, 400, 'invalid_metric');
  const value = await def.compute(db, params || {});
  if (def.unit === 'cents' && value != null && /^-?\d+$/.test(String(value))) return String(value);
  const v = value == null ? null : Number(value);
  return Number.isFinite(v) ? v : null;
}

async function computeMetricObservation(db, metricName, params = {}) {
  const value = await computeMetricValue(db, metricName, params);
  let previous = null, compared = value;
  if (params.comparison === 'previous_period_pct') {
    if (!Object.hasOwn(operationalMetrics, metricName)) {
      throw new AppError('This metric has no previous-period comparison', 400, 'invalid_param');
    }
    const { operationalMetricSql } = require('./operationalMetrics');
    const interval = registry.PERIOD_INTERVAL[paramsForPeriod(params)].interval;
    const built = operationalMetricSql(metricName, interval);
    const { rows } = await db.query(built.text.replaceAll('NOW()', '(NOW()-$2::interval)'), [interval, interval]);
    previous = rows[0]?.[operationalMetrics[metricName].valueColumn || 'value'] ?? null;
    // A zero/empty baseline has no defined percentage change.
    compared = value == null || previous == null || Number(previous) === 0 ? null
      : 100 * (Number(value) - Number(previous)) / Math.abs(Number(previous));
  }
  return { value, previous, compared };
}

function formatValue(metricName, value, params = {}, locale = 'en') {
  const def = ALERTABLE_METRICS[metricName];
  const v = Number(value);
  if (!Number.isFinite(v)) return '—';
  if (params.comparison === 'previous_period_pct') return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v)}%`;
  if (def && def.unit === 'cents') {
    const currency = params.currencyCode || 'USD';
    const language = locale === 'ht' ? 'fr-HT' : locale;
    const formatter = new Intl.NumberFormat(language, { style: 'currency', currency });
    if (!/^-?\d+$/.test(String(value))) return '—';
    const digits = formatter.resolvedOptions().maximumFractionDigits, scale = 10n ** BigInt(digits);
    const minor = BigInt(String(value)), abs = minor < 0n ? -minor : minor;
    const whole = abs / scale, signed = minor < 0n ? (whole === 0n ? -0 : -whole) : whole;
    const fraction = new Intl.NumberFormat(language, { useGrouping: false, minimumIntegerDigits: digits || 1 }).format(Number(abs % scale));
    return formatter.formatToParts(signed).map(part => part.type === 'fraction' ? fraction : part.value).join('');
  }
  if (def && (def.unit === 'pct' || def.unit === 'index')) {
    return v.toFixed(2);
  }
  return String(Math.round(v));
}

module.exports = {
  OPERATORS,
  ALERTABLE_METRICS,
  isAlertableMetric,
  validateRuleInput,
  compareValues,
  computeMetricValue,
  computeMetricObservation,
  formatValue,
};
