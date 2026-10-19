'use strict';

/**
 * Governed metric snapshots (analytics decision 4).
 *
 * Every snapshot is produced by the SAME fixed SQL the query builder runs
 * (buildMetricSql), so a trend point and a live builder result can never
 * disagree on definition. Two value kinds:
 *
 *  - daily_cohort: period-sensitive metrics evaluated with period '1d' as of
 *    the end of a UTC day, i.e. over the window [day, day + 1). These can be
 *    backfilled because every window predicate is bounded on both sides; the
 *    cohort uses each record's current status (the governed cohort rule).
 *  - point_in_time: state metrics (open disputes, MRR, escrow, GMV, take
 *    rate) have no history to reconstruct, so they are captured once per UTC
 *    day by the nightly run and never backfilled.
 *
 * Scopes: 'global', plus one 'regions:<ids>' series per distinct regional
 * territory currently held by an admin (analytics/metricAccess.js), filtered
 * with the same region shadow CTEs as live reads. Restaurant metrics are
 * per-restaurant views, not platform series, and are not snapshotted.
 */

const crypto = require('crypto');
const { buildMetricSql, validateBuilderQuery } = require('./queryBuilder');
const { DEFINITIONS: operationalMetrics } = require('./operationalMetrics');
const { MONEY_METRICS } = require('./financialMetrics');
const { regionScopedDb, supportsRegionScope } = require('./regionScope');

const VALUE_COLUMNS = Object.freeze({
  ...Object.fromEntries(Object.entries(operationalMetrics).map(([n, d]) => [n, d.valueColumn || 'value'])),
  open_disputes: 'value',
  platform_revenue_cents: 'revenue_cents',
  investor_gmv_cents: 'gmv_cents',
  investor_take_rate_pct: 'take_rate_pct',
  mrr_cents: 'mrr_cents',
  escrow_held_cents: 'escrow_held_cents',
  promo_discount_cents: 'promo_discount_cents',
  cancel_rate_pct: 'cancel_rate_pct',
  consulting_cancel_rate_pct: 'cancel_rate_pct',
  sla_first_response_compliance_pct: 'compliance_pct',
  support_nps_index: 'nps_index',
  consulting_avg_nps: 'avg_nps',
});

const POINT_IN_TIME = Object.freeze(new Set(['open_disputes', 'investor_gmv_cents', 'investor_take_rate_pct', 'mrr_cents', 'escrow_held_cents']));
const SNAPSHOT_METRICS = Object.freeze(Object.keys(VALUE_COLUMNS));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isSnapshotMetric(name) { return Object.hasOwn(VALUE_COLUMNS, name); }
function valueKind(name) { return POINT_IN_TIME.has(name) ? 'point_in_time' : 'daily_cohort'; }

function builtFor(metric) {
  return buildMetricSql(validateBuilderQuery({ metric, period: '1d' }), { isSuperAdmin: true });
}

function definitionHash(metric) {
  const built = builtFor(metric);
  return crypto.createHash('sha256').update(`${metric}\n${valueKind(metric)}\n${built.text}`).digest('hex');
}

function supportsRegionalSnapshot(metric) { return supportsRegionScope([builtFor(metric)]); }

/** UTC calendar helpers. Dates are 'YYYY-MM-DD' strings. */
function utcDay(date) { return new Date(date).toISOString().slice(0, 10); }
function addDays(day, n) {
  if (!DAY_RE.test(day)) throw new Error('Invalid day');
  const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return utcDay(d);
}
function dayRange(from, to) {
  const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out;
}

/**
 * Evaluate a query "as of" a fixed instant: every NOW() in the fixed SQL is
 * bound to that instant (appended parameter). Composes with regionScopedDb.
 */
function asOfDb(db, asOf) {
  if (asOf == null) return db;
  const iso = new Date(asOf).toISOString();
  const rewrite = (text, params) => {
    const values = [...(params || [])];
    values.push(iso);
    const ref = `$${values.length}::TIMESTAMPTZ`;
    return { text: String(text).replace(/\bnow\(\)/gi, ref), values };
  };
  return {
    query(text, params) {
      if (text && typeof text === 'object') {
        const r = rewrite(text.text, text.values);
        return db.query({ ...text, text: r.text, values: r.values });
      }
      const r = rewrite(text, params);
      return db.query(r.text, r.values);
    },
  };
}

function scopeKey(scope) {
  if (!scope || scope.global) return 'global';
  const ids = [...scope.regionIds].map(Number).sort((a, b) => a - b);
  return `regions:${ids.join(',')}`;
}

/**
 * Compute one metric for one scope. day=null means "now" (point-in-time).
 * Returns [{ dimensionKey, value, components }] (one per currency for money
 * metrics, one row otherwise).
 */
async function computeSnapshot(db, metric, scope, day) {
  const built = builtFor(metric);
  const asOf = day == null ? null : `${addDays(day, 1)}T00:00:00Z`;
  const reader = asOfDb(regionScopedDb(db, scope), asOf);
  const { rows } = await reader.query(built.text, built.params);
  const column = VALUE_COLUMNS[metric];
  const money = MONEY_METRICS.includes(metric);
  const pick = metric === 'cancel_rate_pct' ? rows.filter(r => r.cohort === 'platform') : rows;
  return pick.slice(0, money ? 200 : 1).map(row => {
    const components = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === column || k === 'currency_code' || k === 'cohort' || k === 'scope') continue;
      components[k] = v == null ? null : (typeof v === 'number' ? v : String(v));
    }
    const raw = row[column];
    return {
      dimensionKey: money ? String(row.currency_code || '').toUpperCase() : '',
      value: raw == null ? null : String(raw),
      components,
    };
  }).filter(r => !money || /^[A-Z]{3}$/.test(r.dimensionKey));
}

module.exports = {
  VALUE_COLUMNS, POINT_IN_TIME, SNAPSHOT_METRICS, isSnapshotMetric, valueKind, definitionHash, supportsRegionalSnapshot,
  utcDay, addDays, dayRange, asOfDb, scopeKey, computeSnapshot,
};

/**
 * Read a snapshot series for the caller's own scope (global or exactly their
 * regional territory). Never falls back to another scope: a regional admin
 * whose territory has no series yet gets an empty, pending series.
 */
async function readTrend(db, scope, { metric, days = 90, currency = 'USD', today = utcDay(new Date()) }) {
  const key = scopeKey(scope);
  const money = MONEY_METRICS.includes(metric);
  const from = addDays(today, -days);
  const { rows } = await db.query(
    `SELECT to_char(snapshot_date,'YYYY-MM-DD') AS date, dimension_key, value::TEXT AS value, components,
            definition_hash, computed_at
       FROM metric_daily_snapshots
      WHERE metric_name = $1 AND scope_key = $2 AND snapshot_date >= $3::DATE AND snapshot_date <= $4::DATE
        AND dimension_key = ANY($5::TEXT[])
      ORDER BY snapshot_date`,
    [metric, key, from, today, money ? ['', currency] : ['']]);
  const byDate = new Map();
  for (const row of rows) {
    const entry = byDate.get(row.date) || { date: row.date, marker: null, row: null };
    if (row.dimension_key === '') entry.marker = row; else entry.row = row;
    byDate.set(row.date, entry);
  }
  const points = [];
  const currencies = new Set(money ? [currency] : []);
  let lastComputedAt = null;
  const hashes = new Set();
  for (const { date, marker, row } of byDate.values()) {
    if (!marker) continue;
    for (const c of marker.components?.currencies || []) currencies.add(c);
    const source = money ? row : marker;
    let value = source ? source.value : null;
    // A computed money day with no row for this currency is zero, except a
    // ratio (take rate) which is undefined without volume.
    if (money && !row) value = metric === 'investor_take_rate_pct' ? null : '0';
    points.push({ date, value, components: source ? source.components : {} });
    hashes.add(marker.definition_hash);
    const at = new Date(marker.computed_at).toISOString();
    if (!lastComputedAt || at > lastComputedAt) lastComputedAt = at;
  }
  return {
    metric, valueKind: valueKind(metric), currency: money ? currency : null,
    currencies: [...currencies].sort(),
    scope: scope && !scope.global ? { kind: 'regional', regionIds: [...scope.regionIds] } : { kind: 'global' },
    from, to: today, points,
    coverage: { expectedDays: valueKind(metric) === 'point_in_time' ? null : days, presentDays: points.length },
    lastComputedAt,
    definitionChanged: hashes.size > 1 || (hashes.size === 1 && !hashes.has(definitionHash(metric))),
  };
}

module.exports.readTrend = readTrend;
