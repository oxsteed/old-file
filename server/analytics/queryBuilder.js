'use strict';

/**
 * Structured query builder (analytics platform, Phase 3, Item 11 — Track A).
 *
 * Admins compose read-only analytics queries from governed registry metrics
 * without writing SQL. Track B (natural language) compiles utterances into
 * this same contract and calls executeBuilderQuery with `rawUtterance` set.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE BUILDER QUERY CONTRACT (v1 — Track B builds against this)
 * ══════════════════════════════════════════════════════════════════════════
 * {
 *   metric:     string,   // one of the 13 keys of BUILDER_DIMENSIONS below
 *   dimensions: string[], // subset of the metric's dimension allowlist
 *                          // (order-insensitive; duplicates rejected)
 *   filters:    object,   // keys limited to the metric's declared filter
 *                          // params (see BUILDER_FILTERS); values are
 *                          // validated per filter (UUID / positive int /
 *                          // fixed enum) and bound as query parameters
 *   period:     '1d' | '7d' | '30d' | '90d' | '1y'   // defaults to '30d'
 * }
 *
 * executeBuilderQuery(db, user, query, opts) resolves to:
 * {
 *   rows:       object[],  // result rows (plain JSON)
 *   columns:    string[],  // column keys, in select order
 *   rowCount:   number,    // rows.length (post-cap)
 *   truncated:  boolean,  // true when the 10,000-row cap cut rows off
 *   durationMs: number,    // server-side execution time incl. audit write
 * }
 * opts: { rawUtterance?: string } — set by Track B; NULL for builder queries.
 *
 * Refinements vs. the draft contract (documented, not silent):
 * - `period` is accepted for every metric but only WINDOWED metrics use it.
 *   Point-in-time / all-time metrics (open_disputes, investor_gmv_cents,
 *   investor_take_rate_pct, mrr_cents, escrow_held_cents) ignore it; the
 *   /meta endpoint marks them periodSensitive: false so the UI can say so.
 * - The `role` filter cannot be combined with the `role` dimension (400):
 *   silently ignoring one of them would mislead.
 * - A `customerId` filter implies the customer cohort; combining it with
 *   role='helper' is 400.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * READ-ONLY BY CONSTRUCTION
 * ══════════════════════════════════════════════════════════════════════════
 * Execution goes through fixed per-metric SQL builders keyed by metric name.
 * Dimensions map to fixed GROUP BY fragments; filters map to fixed WHERE
 * predicates with bound parameters ($1, $2, …). User input is NEVER
 * concatenated into SQL: the only interpolated tokens are constants drawn
 * from frozen allowlists (metric names, dimension names, period trunc
 * units), all validated before the builder is chosen. There is no freeform
 * SQL and no expression language. Every execution runs inside a transaction
 * with SET LOCAL statement_timeout = '30s' on a dedicated client, and
 * results are capped at 10,000 rows.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * SCOPE SEMANTICS
 * ══════════════════════════════════════════════════════════════════════════
 * - resolveScope(user) runs first. Callers without an admin/super_admin
 *   platform role get 403 (defense in depth; the routes also sit behind
 *   requireAdmin, so this path should never fire in production).
 * - Global metrics require a current global domain grant. Regional-only
 *   grants cannot authorize them; catalogs and workers use the same policy.
 * - Restaurant-dimensioned metrics (restaurant_repeat_order_rate,
 *   restaurant_top_items_revenue): super_admin reads global. A plain admin
 *   is constrained to scope.restaurantIds (ownership/membership standing
 *   from resolveScope — the same CASE as the canonical restaurant gate).
 *   A restaurantId filter outside that set is 403; an admin with no
 *   restaurant standing gets zero rows (a valid empty answer, not an
 *   error). Note this is intentionally narrower than resolveScope's
 *   `global` flag: platform admins do NOT get other owners' restaurant
 *   rows from the query builder.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * AUDIT
 * ══════════════════════════════════════════════════════════════════════════
 * EVERY execution attempt is appended to analytics_query_audit (migration
 * 891) — success and failure alike, including validation failures. The
 * audit write is fail-closed: no result is disclosed during a ledger outage.
 * compiled_query stores { sql, params }.
 */

const AppError = require('../utils/appError');
const registry = require('./metricsRegistry');
const { resolveScope } = require('../services/scopeModel');
const logger = require('../utils/logger');
const { assertMetricAccess } = require('./metricAccess');
const { MONEY_METRICS, financialMetricSql } = require('./financialMetrics');
const { DEFINITIONS: operationalMetrics, operationalMetricSql } = require('./operationalMetrics');
const { paidOrderPredicate } = require('./restaurantAnalytics');
const { metricEvidenceSql } = require('./metricEvidence');
const { regionScopedDb } = require('./regionScope');

const PERIODS = Object.freeze(['1d', '7d', '30d', '90d', '1y']);
// Window lengths in days for metrics that need a day count (NPS days,
// restaurant windows). The canonical interval strings come from the
// registry's PERIOD_INTERVAL; this map is the day-count twin.
const PERIOD_DAYS = Object.freeze({ '1d': 1, '7d': 7, '30d': 30, '90d': 90, '1y': 365 });

const ROW_CAP = 10000;
const STATEMENT_TIMEOUT = '30s';

// ── Per-metric canonical dimension allowlist ────────────────────────────────
// The registry's dimension declarations are loose strings; THIS is the
// enforceable list. Exported so Track B's NL parser can read it.
const BUILDER_DIMENSIONS = Object.freeze({
  ...Object.fromEntries(Object.keys(operationalMetrics).map(name => [name, Object.freeze([])])),
  open_disputes: Object.freeze([]),
  platform_revenue_cents: Object.freeze(['period']),
  investor_gmv_cents: Object.freeze([]),
  investor_take_rate_pct: Object.freeze([]),
  cancel_rate_pct: Object.freeze(['role']),
  consulting_cancel_rate_pct: Object.freeze([]),
  sla_first_response_compliance_pct: Object.freeze(['business']),
  support_nps_index: Object.freeze(['business']),
  consulting_avg_nps: Object.freeze([]),
  mrr_cents: Object.freeze([]),
  escrow_held_cents: Object.freeze([]),
  restaurant_repeat_order_rate: Object.freeze(['restaurant']),
  restaurant_top_items_revenue: Object.freeze(['restaurant']),
});

// ── Per-metric declared filter params ───────────────────────────────────────
// filters are limited to these keys per metric; each key has a fixed value
// validator and a fixed WHERE predicate below.
const BUILDER_FILTERS = Object.freeze({
  ...Object.fromEntries(Object.keys(operationalMetrics).map(name => [name, Object.freeze([])])),
  open_disputes: Object.freeze([]),
  platform_revenue_cents: Object.freeze([]),
  investor_gmv_cents: Object.freeze([]),
  investor_take_rate_pct: Object.freeze([]),
  cancel_rate_pct: Object.freeze(['role', 'customerId']),
  consulting_cancel_rate_pct: Object.freeze([]),
  sla_first_response_compliance_pct: Object.freeze(['businessId']),
  support_nps_index: Object.freeze(['businessId']),
  consulting_avg_nps: Object.freeze([]),
  mrr_cents: Object.freeze([]),
  escrow_held_cents: Object.freeze([]),
  restaurant_repeat_order_rate: Object.freeze(['restaurantId']),
  restaurant_top_items_revenue: Object.freeze(['restaurantId']),
});

const RESTAURANT_METRICS = Object.freeze([
  'restaurant_repeat_order_rate',
  'restaurant_top_items_revenue',
]);

// Metrics whose value is a point-in-time / all-time snapshot: `period` is
// accepted but does not change the value (meta marks periodSensitive false).
const POINT_IN_TIME_METRICS = Object.freeze(new Set([
  'open_disputes',
  'investor_gmv_cents',
  'investor_take_rate_pct',
  'mrr_cents',
  'escrow_held_cents',
]));

const METRIC_UNITS = Object.freeze({
  ...Object.fromEntries(Object.entries(operationalMetrics).map(([name, def]) => [name, def.unit])),
  open_disputes: 'count',
  platform_revenue_cents: 'cents',
  investor_gmv_cents: 'cents',
  investor_take_rate_pct: 'pct',
  cancel_rate_pct: 'pct',
  consulting_cancel_rate_pct: 'pct',
  sla_first_response_compliance_pct: 'pct',
  support_nps_index: 'index',
  consulting_avg_nps: 'average',
  mrr_cents: 'cents',
  escrow_held_cents: 'cents',
  restaurant_repeat_order_rate: 'ratio',
  restaurant_top_items_revenue: 'cents',
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Validate + normalize a builder query. Returns the canonical query
 * { metric, dimensions, filters, period }. Throws AppError 400 on:
 * unknown metric, dimension not in the metric's allowlist, duplicate
 * dimension, unknown filter key, invalid filter value, bad period.
 */
function validateBuilderQuery(input) {
  const body = input && typeof input === 'object' ? input : {};
  const metric = String(body.metric || '').trim();
  if (!hasOwn(BUILDER_DIMENSIONS, metric)) {
    throw new AppError(
      `Invalid metric "${metric}": expected one of ${Object.keys(BUILDER_DIMENSIONS).join(', ')}`,
      400,
      'invalid_metric'
    );
  }
  const allowedDims = BUILDER_DIMENSIONS[metric];
  const rawDims = Array.isArray(body.dimensions) ? body.dimensions : [];
  const dimensions = [];
  const seenDims = new Set();
  for (const raw of rawDims) {
    const name = String(raw).trim();
    if (!allowedDims.includes(name)) {
      throw new AppError(
        `Invalid dimension "${name}" for metric "${metric}": expected ${allowedDims.length ? `one of ${allowedDims.join(', ')}` : 'no dimensions'}`,
        400,
        'invalid_dimension'
      );
    }
    if (seenDims.has(name)) {
      throw new AppError(`Duplicate dimension "${name}"`, 400, 'invalid_dimension');
    }
    seenDims.add(name);
    dimensions.push(name);
  }

  const rawFilters = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)
    ? body.filters
    : {};
  const allowedFilters = BUILDER_FILTERS[metric];
  for (const key of Object.keys(rawFilters)) {
    if (!allowedFilters.includes(key)) {
      throw new AppError(
        `Invalid filter "${key}" for metric "${metric}": expected ${allowedFilters.length ? `one of ${allowedFilters.join(', ')}` : 'no filters'}`,
        400,
        'invalid_filter'
      );
    }
  }
  const filters = {};
  if (rawFilters.role != null) {
    const role = String(rawFilters.role).trim();
    if (!registry.CANCEL_ROLES.includes(role)) {
      throw new AppError(
        `Invalid role filter "${role}": expected one of ${registry.CANCEL_ROLES.join(', ')}`,
        400,
        'invalid_filter'
      );
    }
    filters.role = role;
  }
  if (rawFilters.customerId != null) {
    const customerId = String(rawFilters.customerId).trim();
    if (!UUID_RE.test(customerId)) {
      throw new AppError('Invalid customerId filter: expected a UUID', 400, 'invalid_filter');
    }
    if (filters.role && filters.role !== 'customer') {
      throw new AppError('Filter "customerId" implies the customer cohort and cannot be combined with role="helper" or role="platform"', 400, 'invalid_filter');
    }
    filters.customerId = customerId;
  }
  if (rawFilters.businessId != null) {
    const businessId = Number(rawFilters.businessId);
    if (!Number.isSafeInteger(businessId) || businessId <= 0) {
      throw new AppError('Invalid businessId filter: expected a positive integer', 400, 'invalid_filter');
    }
    filters.businessId = businessId;
  }
  if (rawFilters.restaurantId != null) {
    const restaurantId = Number(rawFilters.restaurantId);
    if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) {
      throw new AppError('Invalid restaurantId filter: expected a positive integer', 400, 'invalid_filter');
    }
    filters.restaurantId = restaurantId;
  }
  // Cohort filters are meaningless alongside the role dimension (which
  // expands all cohorts); reject instead of silently ignoring them.
  if (dimensions.includes('role') && (filters.role != null || filters.customerId != null)) {
    throw new AppError('Filters "role" and "customerId" cannot be combined with the "role" dimension', 400, 'invalid_filter');
  }

  const period = body.period != null ? String(body.period).trim() : '30d';
  if (!PERIODS.includes(period)) {
    throw new AppError(
      `Invalid period "${period}": expected one of ${PERIODS.join(', ')}`,
      400,
      'invalid_period'
    );
  }
  return { metric, dimensions, filters, period };
}

// ── Fixed SQL builders ──────────────────────────────────────────────────────
// Each builder returns { text, params, columns }. `text` is a fixed template
// with $n placeholders; the ONLY interpolated values are constants from
// frozen allowlists validated above (never user input).

function intervalParam(period) {
  return registry.PERIOD_INTERVAL[period].interval;
}

// Cancel-rate cohort predicates. Fixed fragments; the customer/user-bound
// variant takes the bound UUID as a parameter, never inline.
const CANCEL_COHORT_PREDICATES = Object.freeze({
  customer: 'j.client_id IS NOT NULL',
  helper: 'j.assigned_helper_id IS NOT NULL',
  platform: 'TRUE',
});

function buildCancelRate(query) {
  const params = [intervalParam(query.period)];
  const byRole = query.dimensions.includes('role');
  const cohort = query.filters.customerId ? 'customer' : (query.filters.role || 'platform');
  const selectCohorts = byRole ? registry.CANCEL_ROLES : [cohort];
  const pieces = [];
  const columns = ['cohort', 'cancel_rate_pct', 'risk_band', 'cancelled', 'total'];
  for (const c of selectCohorts) {
    const predicate = CANCEL_COHORT_PREDICATES[c];
    const localParams = [...params];
    let userPredicate = predicate;
    if (!byRole && query.filters.customerId) {
      localParams.push(query.filters.customerId);
      userPredicate = `j.client_id = $${localParams.length}::UUID`;
    }
    // Each cohort is a fixed SELECT; UNION ALL over a fixed cohort list.
    // The risk band reuses the registry's canonical CASE fragment.
    const rateExpr = `ROUND(100.0 * COUNT(*) FILTER (WHERE j.status = 'cancelled') / NULLIF(COUNT(*), 0), 1)`;
    const cancelledExpr = `COUNT(*) FILTER (WHERE j.status = 'cancelled')`;
    pieces.push(`SELECT '${c}' AS cohort,
      ${rateExpr}::FLOAT AS cancel_rate_pct,
      ${registry.cancelRiskLevelCaseSql(rateExpr, cancelledExpr)} AS risk_band,
      ${cancelledExpr}::INT AS cancelled,
      COUNT(*)::INT AS total
      FROM jobs j
      WHERE j.deleted_at IS NULL AND ${userPredicate}
        AND j.created_at >= NOW() - $1::interval`);
    if (pieces.length === 1) params.push(...localParams.slice(1));
  }
  // All cohort SELECTs share the same parameter layout ($1 = interval,
  // optional $2 = customer UUID), so one params array serves the UNION ALL.
  return { text: pieces.join('\nUNION ALL\n') + '\nORDER BY 1', params, columns };
}

function buildSlaCompliance(query) {
  const params = [intervalParam(query.period)];
  const byBusiness = query.dimensions.includes('business');
  const join = registry.slaTargetsJoinSql('sc', 'sla_tgt');
  const target = registry.slaFirstResponseTargetSql('sc', 'sla_tgt');
  const metExpr = `SUM(CASE WHEN sc.first_response_at IS NOT NULL AND sc.first_response_at <= (${target}) THEN 1 ELSE 0 END)`;
  const eligibleExpr = `COUNT(*) FILTER (WHERE sc.first_response_at IS NOT NULL OR NOW() > (${target}))`;
  const where = [`sc.status <> 'merged'`, `sc.created_at >= NOW() - $1::interval`];
  if (query.filters.businessId != null) {
    params.push(query.filters.businessId);
    where.push(`sc.business_id = $${params.length}::INTEGER`);
  }
  const select = byBusiness
    ? `sc.business_id, MAX(b.business_name) AS business_name,`
    : `'all' AS scope,`;
  const groupBy = byBusiness ? 'GROUP BY sc.business_id ORDER BY sc.business_id' : '';
  const joinBusiness = byBusiness ? 'LEFT JOIN businesses b ON b.id = sc.business_id' : '';
  return {
    text: `SELECT ${select}
             ROUND(100.0 * ${metExpr} / NULLIF(${eligibleExpr}, 0), 1)::FLOAT AS compliance_pct,
             ${metExpr}::INT AS met,
             ${eligibleExpr}::INT AS eligible
           FROM support_conversations sc
           ${join}
           ${joinBusiness}
           WHERE ${where.join(' AND ')}
           ${groupBy}`,
    params,
    columns: byBusiness
      ? ['business_id', 'business_name', 'compliance_pct', 'met', 'eligible']
      : ['scope', 'compliance_pct', 'met', 'eligible'],
  };
}

function buildSupportNps(query) {
  const params = [intervalParam(query.period), query.filters.businessId != null ? query.filters.businessId : null];
  const byBusiness = query.dimensions.includes('business');
  const npsExpr = `ROUND(100.0 * (COUNT(*) FILTER (WHERE scr.nps_score >= 9) - COUNT(*) FILTER (WHERE scr.nps_score <= 6)) / NULLIF(COUNT(scr.nps_score), 0), 1)`;
  const select = byBusiness ? 'sc.business_id, MAX(b.business_name) AS business_name,' : `'all' AS scope,`;
  const groupBy = byBusiness ? 'GROUP BY sc.business_id ORDER BY sc.business_id' : '';
  const joinBusiness = byBusiness ? 'LEFT JOIN businesses b ON b.id = sc.business_id' : '';
  return {
    text: `SELECT ${select}
             ${npsExpr}::FLOAT AS nps_index,
             COUNT(scr.nps_score)::INT AS responses
           FROM support_conversation_reviews scr
           JOIN support_conversations sc ON sc.id = scr.conversation_id
           ${joinBusiness}
           WHERE scr.nps_score IS NOT NULL
             AND scr.created_at >= NOW() - $1::INTERVAL
             AND ($2::INTEGER IS NULL OR sc.business_id = $2::INTEGER)
           ${groupBy}`,
    params,
    columns: byBusiness
      ? ['business_id', 'business_name', 'nps_index', 'responses']
      : ['scope', 'nps_index', 'responses'],
  };
}

// Restaurant scoping for restaurant-dimensioned metrics.
// Returns one of:
//   { singleId }     — constrain to one restaurant (bound as a parameter)
//   { idList }       — constrain to an id list (bound as a BIGINT[] parameter)
//   { unconstrained } — super_admin with no filter: no constraint.
// Plain admins are constrained to scope.restaurantIds; an explicit
// restaurantId filter outside that set throws 403 here.
function restaurantScopeClause(query, scope) {
  if (scope.isSuperAdmin) {
    if (query.filters.restaurantId != null) return { singleId: query.filters.restaurantId };
    return { unconstrained: true };
  }
  const allowed = scope.restaurantIds || [];
  if (query.filters.restaurantId != null) {
    if (!allowed.includes(query.filters.restaurantId)) {
      throw new AppError(
        `Forbidden: restaurant ${query.filters.restaurantId} is outside your access`,
        403,
        'forbidden'
      );
    }
    return { singleId: query.filters.restaurantId };
  }
  return { idList: allowed };
}

function buildRestaurantRepeatRate(query, scope) {
  const params = [intervalParam(query.period)];
  const rs = restaurantScopeClause(query, scope);
  let restaurantPredicate;
  if (rs.singleId != null) {
    params.push(rs.singleId);
    restaurantPredicate = `fr.id = $${params.length}::BIGINT`;
  } else if (rs.idList) {
    params.push(rs.idList);
    restaurantPredicate = `fr.id = ANY($${params.length}::BIGINT[])`;
  } else {
    restaurantPredicate = 'TRUE';
  }
  return {
    text: `WITH identified AS (
             SELECT fo.restaurant_id, fo.customer_id, fo.id
               FROM food_orders fo
              WHERE fo.created_at >= NOW() - $1::INTERVAL
                AND ${paidOrderPredicate()}
                AND fo.customer_id IS NOT NULL
           ),
           customer_orders AS (
             SELECT restaurant_id, customer_id, COUNT(*) AS n
               FROM identified GROUP BY 1, 2
           )
           SELECT fr.id::INT AS restaurant_id,
                  fr.display_name AS restaurant_name,
                  COUNT(i.id)::INT AS total_identified_orders,
                  COUNT(i.id) FILTER (WHERE co.n > 1)::INT AS repeat_orders,
                  CASE WHEN COUNT(i.id) > 0
                    THEN ROUND(COUNT(i.id) FILTER (WHERE co.n > 1)::NUMERIC / COUNT(i.id), 4)::FLOAT
                  END AS repeat_order_rate
             FROM food_restaurants fr
             LEFT JOIN identified i ON i.restaurant_id = fr.id
             LEFT JOIN customer_orders co
               ON co.restaurant_id = i.restaurant_id AND co.customer_id = i.customer_id
            WHERE ${restaurantPredicate}
            GROUP BY fr.id, fr.display_name
            ORDER BY fr.id`,
    params,
    columns: ['restaurant_id', 'restaurant_name', 'total_identified_orders', 'repeat_orders', 'repeat_order_rate'],
  };
}

function buildRestaurantTopItems(query, scope) {
  const params = [intervalParam(query.period)];
  const rs = restaurantScopeClause(query, scope);
  let orderPredicate;
  if (rs.singleId != null) {
    params.push(rs.singleId);
    orderPredicate = `fo.restaurant_id = $${params.length}::BIGINT`;
  } else if (rs.idList) {
    params.push(rs.idList);
    orderPredicate = `fo.restaurant_id = ANY($${params.length}::BIGINT[])`;
  } else {
    orderPredicate = 'TRUE';
  }
  return {
    text: `WITH ranked AS (
             SELECT fo.restaurant_id,
                    COALESCE(foi.menu_item_id::TEXT, 'name:' || foi.item_name) AS item_key,
                    MAX(foi.menu_item_id) AS menu_item_id,
                    MAX(foi.item_name) AS item_name,
                    SUM(foi.quantity)::INT AS units_sold,
                    COUNT(DISTINCT fo.id)::INT AS orders,
                    SUM(foi.line_total_cents)::BIGINT AS revenue_cents,
                    UPPER(fo.currency_code) AS currency_code,
                    ROW_NUMBER() OVER (
                      PARTITION BY fo.restaurant_id, UPPER(fo.currency_code)
                      ORDER BY SUM(foi.line_total_cents) DESC, SUM(foi.quantity) DESC
                    ) AS rn
               FROM food_order_items foi
               JOIN food_orders fo ON fo.id = foi.order_id
              WHERE ${orderPredicate}
                AND fo.created_at >= NOW() - $1::INTERVAL
                AND ${paidOrderPredicate()}
              GROUP BY fo.restaurant_id, 2, UPPER(fo.currency_code)
           )
           SELECT r.restaurant_id::INT AS restaurant_id, fr.display_name AS restaurant_name,
                  r.item_key, r.menu_item_id::INT AS menu_item_id, r.item_name,
                  r.units_sold, r.orders, r.revenue_cents, r.currency_code
             FROM ranked r
             JOIN food_restaurants fr ON fr.id = r.restaurant_id
            WHERE r.rn <= 10
            ORDER BY r.restaurant_id, r.revenue_cents DESC`,
    params,
    columns: ['restaurant_id', 'restaurant_name', 'item_key', 'menu_item_id', 'item_name', 'units_sold', 'orders', 'revenue_cents', 'currency_code'],
  };
}

// Fixed single-value builders (registry definitions, windowed where the
// metric is period-sensitive; see POINT_IN_TIME_METRICS).
function buildSingleValue(query) {
  const interval = intervalParam(query.period);
  switch (query.metric) {
    case 'open_disputes':
      return {
        text: `SELECT COUNT(*)::INT AS value FROM disputes WHERE status = 'open'`,
        params: [],
        columns: ['value'],
      };
    case 'consulting_cancel_rate_pct':
      return {
        text: `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'cancelled')
                       / NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'cancelled')), 0), 1)::FLOAT AS cancel_rate_pct,
                     COUNT(*) FILTER (WHERE status = 'cancelled')::INT AS cancelled,
                     COUNT(*) FILTER (WHERE status IN ('completed', 'cancelled'))::INT AS decided
               FROM consulting_sessions WHERE created_at >= NOW() - $1::interval`,
        params: [interval],
        columns: ['cancel_rate_pct', 'cancelled', 'decided'],
      };
    case 'consulting_avg_nps':
      return {
        text: `SELECT AVG(nps_score)::FLOAT AS avg_nps, COUNT(*)::INT AS responses
               FROM consulting_session_feedback
               WHERE nps_score IS NOT NULL AND created_at >= NOW() - $1::interval`,
        params: [interval],
        columns: ['avg_nps', 'responses'],
      };
    default:
      throw new AppError(`No query builder for metric "${query.metric}"`, 500, 'builder_missing');
  }
}

function buildMetricSql(query, scope) {
  if (Object.hasOwn(operationalMetrics, query.metric)) return operationalMetricSql(query.metric, intervalParam(query.period));
  if (MONEY_METRICS.includes(query.metric)) {
    return financialMetricSql(query.metric, {
      interval: intervalParam(query.period),
      trunc: query.dimensions.includes('period') ? registry.PERIOD_INTERVAL[query.period].trunc : null,
    });
  }
  switch (query.metric) {
    case 'cancel_rate_pct': return buildCancelRate(query);
    case 'sla_first_response_compliance_pct': return buildSlaCompliance(query);
    case 'support_nps_index': return buildSupportNps(query);
    case 'restaurant_repeat_order_rate': return buildRestaurantRepeatRate(query, scope);
    case 'restaurant_top_items_revenue': return buildRestaurantTopItems(query, scope);
    default: return buildSingleValue(query);
  }
}

// ── Audit ledger ────────────────────────────────────────────────────────────
// A result may only be disclosed after its execution audit is durable.

function safeJson(value) {
  try {
    const s = JSON.stringify(value);
    return s === undefined ? null : JSON.parse(s);
  } catch (_) {
    return null;
  }
}

async function auditAttempt(db, entry) {
  try {
    await db.query(
      `INSERT INTO analytics_query_audit
         (admin_user_id, metric_name, dimensions, filters, period,
          row_count, duration_ms, success, error_code, raw_utterance, compiled_query, event_type,
          scope_kind, region_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        entry.userId,
        String(entry.metricName || 'unknown').slice(0, 200),
        safeJson(entry.dimensions) == null ? null : JSON.stringify(entry.dimensions),
        safeJson(entry.filters) == null ? null : JSON.stringify(entry.filters),
        entry.period || null,
        entry.rowCount == null ? null : entry.rowCount,
        entry.durationMs == null ? null : Math.round(entry.durationMs),
        entry.success === true,
        entry.errorCode || null,
        entry.rawUtterance || null,
        entry.compiledQuery ? JSON.stringify(safeJson(entry.compiledQuery)) : null,
        entry.eventType || 'execution',
        entry.scope ? (entry.scope.global ? 'global' : 'regional') : null,
        entry.scope && !entry.scope.global ? entry.scope.regionIds : null,
      ]
    );
  } catch (err) {
    logger.warn('analytics_query_audit insert failed', {
      code: err && err.code,
      metric: entry.metricName,
      success: entry.success,
    });
    throw new AppError('Analytics audit is temporarily unavailable', 503, 'analytics_audit_unavailable');
  }
}

// ── Capped execution ─────────────────────────────────────────────────────────
// Dedicated client + transaction so SET LOCAL applies; LIMIT is a constant
// appended to the fixed template (never user input).
async function runCappedQuery(db, built, cap = ROW_CAP, { offset = 0, summary = null, regionScope = null } = {}) {
  const client = await db.connect();
  // Regional admins: every statement reads region-filtered rows (fails closed
  // on any table without a geographic anchor).
  const reader = regionScopedDb(client, regionScope);
  try {
    await client.query(summary ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    const summaryResult = summary ? await reader.query(`${summary.text}\nLIMIT ${ROW_CAP+1}`,summary.params) : null;
    const res = await reader.query(`${built.text}\nLIMIT ${cap + 1}${offset ? ` OFFSET ${offset}` : ''}`, built.params);
    await client.query('COMMIT');
    const truncated = res.rows.length > cap;
    return { rows: truncated ? res.rows.slice(0, cap) : res.rows, truncated,
      summary: summaryResult?.rows.slice(0,ROW_CAP),summaryTruncated: (summaryResult?.rows.length || 0)>ROW_CAP };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Validate, scope, execute, and audit a builder query.
 * db: the pool (needs .query and .connect). user: { id, role }.
 * opts: { rawUtterance } — Track B sets this; NULL for builder queries.
 */
async function executeBuilderQuery(db, user, input, opts = {}) {
  const startedAt = Date.now();
  const rawUtterance = opts.rawUtterance != null ? String(opts.rawUtterance).slice(0, 2000) : null;
  const userId = user && user.id ? user.id : null;
  let query;
  try {
    query = validateBuilderQuery(input);
  } catch (err) {
    await auditAttempt(db, {
      userId, metricName: input && input.metric, dimensions: input && input.dimensions,
      filters: input && input.filters, period: input && input.period,
      rowCount: 0, durationMs: Date.now() - startedAt,
      success: false, errorCode: err.code || 'validation_error',
      rawUtterance, compiledQuery: null,
      eventType: opts.eventType,
    });
    throw err;
  }
  const auditBase = {
    userId, metricName: query.metric, dimensions: query.dimensions,
    filters: query.filters, period: query.period, rawUtterance, eventType: opts.eventType,
  };
  try {
    if (!user?.id || !['admin', 'super_admin'].includes(user.role)) {
      throw new AppError('Forbidden: the query builder requires an admin account', 403, 'forbidden');
    }
    const metricScope = await assertMetricAccess(user, query.metric);
    auditBase.scope = metricScope;
    const scope = await resolveScope(user);
    if (!scope.isAdmin && !scope.isSuperAdmin) {
      throw new AppError('Forbidden: the query builder requires an admin account', 403, 'forbidden');
    }
    const aggregate = buildMetricSql(query, scope);
    const offset = opts.evidence ? Number(opts.offset || 0) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) throw new AppError('Invalid evidence page',400,'invalid_param');
    const built = opts.evidence ? metricEvidenceSql(query,scope,registry,aggregate) : aggregate;
    const { rows, truncated, summary, summaryTruncated } = await runCappedQuery(db, built,
      opts.evidence && opts.eventType !== 'export' ? 100 : ROW_CAP,
      { offset, summary: opts.evidence ? aggregate : null, regionScope: metricScope });
    const durationMs = Date.now() - startedAt;
    await auditAttempt(db, {
      ...auditBase, rowCount: rows.length, durationMs,
      success: true, errorCode: null,
      compiledQuery: { sql: built.text, params: built.params },
    });
    return { rows, columns: built.columns, rowCount: rows.length,
      scope: metricScope.global ? { kind: 'global' } : { kind: 'regional', regionIds: [...metricScope.regionIds] },
      truncated: opts.evidence && opts.eventType !== 'export' ? false : truncated, durationMs, query,
      evidence: opts.evidence === true, offset,
      ...(opts.evidence ? { summary, summaryTruncated, summaryColumns: aggregate.columns, hasMore: truncated } : {}) };
  } catch (err) {
    await auditAttempt(db, {
      ...auditBase, rowCount: 0, durationMs: Date.now() - startedAt,
      success: false,
      errorCode: err.code === '57014' ? 'statement_timeout' : (err.code || 'query_error'),
      compiledQuery: null,
    });
    if (err instanceof AppError) throw err;
    throw new AppError('Analytics query failed', 500, 'query_error');
  }
}

/**
 * /meta payload: drives the UI dropdowns (and Track B's parser context).
 */
function getBuilderMeta(allowedNames = Object.keys(BUILDER_DIMENSIONS)) {
  const metrics = Object.keys(BUILDER_DIMENSIONS).filter(name => allowedNames.includes(name)).map((name) => ({
    name,
    dimensions: [...BUILDER_DIMENSIONS[name]],
    filters: [...BUILDER_FILTERS[name]],
    periods: [...PERIODS],
    unit: METRIC_UNITS[name],
    periodSensitive: !POINT_IN_TIME_METRICS.has(name),
    definition: registry.METRICS[name] ? registry.METRICS[name].definition : '',
  }));
  return { metrics, periods: [...PERIODS], rowCap: ROW_CAP, statementTimeout: STATEMENT_TIMEOUT };
}

module.exports = {
  PERIODS,
  PERIOD_DAYS,
  ROW_CAP,
  BUILDER_DIMENSIONS,
  BUILDER_FILTERS,
  validateBuilderQuery,
  executeBuilderQuery,
  getBuilderMeta,
  runCappedQuery,
  buildMetricSql,
  auditAttempt,
};
