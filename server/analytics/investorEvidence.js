'use strict';

/**
 * Aggregate-only evidence for investor dashboard KPIs.
 *
 * Investors can drill from a KPI into how it is made up, but never into
 * records: the output is bucket totals (period buckets, currency, source)
 * over exactly the record set the builder's evidence uses
 * (metricEvidenceSql), so the totals reconcile with the KPI. No ids, names,
 * emails, codes or free text leave this module. Buckets with fewer than
 * MIN_CELL records are suppressed (counts and sums withheld) so a bucket
 * cannot single out one job or payment; the grand total is always shown
 * because it is the KPI itself.
 */
const registry = require('./metricsRegistry');
const { metricEvidenceSql } = require('./metricEvidence');
const { validateBuilderQuery, buildMetricSql } = require('./queryBuilder');
const AppError = require('../utils/appError');

const MIN_CELL = 3;
const INVESTOR_EVIDENCE_METRICS = Object.freeze([
  'platform_revenue_cents', 'job_completion_rate_pct', 'investor_gmv_cents', 'investor_take_rate_pct',
]);
const TRUNCS = Object.freeze(['hour', 'day', 'week', 'month']);

function evidenceBase(metric, period) {
  const query = validateBuilderQuery({ metric, dimensions: [], filters: {}, period });
  const scope = { isSuperAdmin: true, isAdmin: true, restaurantIds: [] };
  return { query, built: metricEvidenceSql(query, scope, registry, buildMetricSql(query, scope)) };
}

function aggregateSql(metric, period) {
  const { query, built } = evidenceBase(metric, period);
  const trunc = registry.PERIOD_INTERVAL[query.period].trunc;
  if (!TRUNCS.includes(trunc)) throw new AppError('Unsupported period', 400, 'invalid_period');
  const e = `WITH e AS (${built.text})`;
  switch (metric) {
    case 'platform_revenue_cents':
      return { query, params: built.params, sql: `${e}
        SELECT DATE_TRUNC('${trunc}', created_at) AS bucket, currency_code, source_type,
               COUNT(*)::int AS records, SUM(amount_cents)::bigint AS amount_cents
          FROM e GROUP BY 1,2,3 ORDER BY 1,2,3`,
        totalsSql: `${e} SELECT currency_code, COUNT(*)::int AS records, SUM(amount_cents)::bigint AS amount_cents FROM e GROUP BY 1 ORDER BY 1` };
    case 'job_completion_rate_pct':
      return { query, params: built.params, sql: `${e}
        SELECT DATE_TRUNC('${trunc}', created_at) AS bucket,
               COUNT(*)::int AS records,
               COUNT(*) FILTER (WHERE status='completed')::int AS completed,
               COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled
          FROM e GROUP BY 1 ORDER BY 1`,
        totalsSql: `${e} SELECT COUNT(*)::int AS records, COUNT(*) FILTER (WHERE status='completed')::int AS completed,
               COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled FROM e` };
    case 'investor_gmv_cents':
    case 'investor_take_rate_pct':
      // The cohort is all-time completed jobs; there is no date to bucket by.
      return { query, params: built.params, sql: `${e}
        SELECT NULL::timestamptz AS bucket, currency_code, COUNT(*)::int AS records,
               COUNT(*) FILTER (WHERE gmv_cents IS NULL)::int AS unpriced,
               SUM(gmv_cents)::bigint AS gmv_cents, SUM(fee_cents)::bigint AS fee_cents
          FROM e GROUP BY 2 ORDER BY 2`,
        totalsSql: null };
    default:
      throw new AppError('No investor evidence for this metric', 404, 'unknown_metric');
  }
}

function suppress(row) {
  if (Number(row.records) >= MIN_CELL) return { ...row, suppressed: false };
  const out = { suppressed: true };
  for (const key of ['bucket', 'currency_code', 'source_type']) if (key in row) out[key] = row[key];
  return out;
}

async function investorEvidence(db, metric, period = '30d') {
  if (!INVESTOR_EVIDENCE_METRICS.includes(metric)) throw new AppError('No investor evidence for this metric', 404, 'unknown_metric');
  const spec = aggregateSql(metric, period);
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15s'");
    const { rows } = await client.query(spec.sql, spec.params);
    const totals = spec.totalsSql ? (await client.query(spec.totalsSql, spec.params)).rows : rows;
    await client.query('COMMIT');
    const periodSensitive = !['investor_gmv_cents', 'investor_take_rate_pct'].includes(metric);
    return {
      metric, period: spec.query.period, period_sensitive: periodSensitive, min_cell: MIN_CELL,
      buckets: rows.map(suppress),
      totals,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { INVESTOR_EVIDENCE_METRICS, MIN_CELL, investorEvidence };
