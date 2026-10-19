'use strict';

/**
 * Nightly governed-metric snapshot worker (analytics decision 4).
 *
 * Fencing: a run holds a session advisory lock on a dedicated connection
 * and every write goes through that same connection, gated on its own run
 * row still being 'running'. A partial unique index allows only one running
 * run, so even a lost lock cannot produce two concurrent writers. The lock
 * holder marks orphaned 'running' rows failed before starting.
 *
 * Idempotency: one row per (UTC day, metric, scope, currency). Normal runs
 * only insert missing rows; an explicit recompute backfill replaces them.
 *
 * Schedule: hourly tick. Each tick fills missing closed days within the
 * lookback window (METRIC_SNAPSHOT_LOOKBACK_DAYS, default 90) at most
 * METRIC_SNAPSHOT_MAX_DAYS_PER_RUN (default 14) days at a time, oldest first,
 * so a fresh deploy backfills itself gradually, then captures today's
 * point-in-time values once per UTC day.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { metricScope } = require('../analytics/metricAccess');
const snapshots = require('../analytics/metricSnapshots');
const { MONEY_METRICS } = require('../analytics/financialMetrics');
const { rollupSupportDay } = require('../analytics/supportDailyRollups');

const LOCK_KEY = 'metric-snapshots';
const MAX_BACKFILL_DAYS = 400;

function intEnv(name, fallback, min, max) {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** Distinct regional territories currently held, per metric. */
async function regionalScopes(conn) {
  const { rows } = await conn.query(`SELECT DISTINCT g.grantee_id AS id, u.role
      FROM admin_permission_grants g JOIN users u ON u.id = g.grantee_id
     WHERE g.region_id IS NOT NULL AND g.revoked_at IS NULL AND g.expires_at > NOW()
       AND u.role = 'admin'`);
  const byMetric = new Map(snapshots.SNAPSHOT_METRICS.map(m => [m, new Map()]));
  // Metrics whose tables have no geographic anchor never get regional series.
  const scopable = snapshots.SNAPSHOT_METRICS.filter(m => snapshots.supportsRegionalSnapshot(m));
  for (const user of rows) {
    const cache = new Map();
    for (const metric of scopable) {
      const scope = await metricScope(user, metric, cache);
      if (!scope || scope.unknown || scope.global || !scope.regionIds?.length) continue;
      byMetric.get(metric).set(snapshots.scopeKey(scope), scope);
    }
  }
  return byMetric;
}

function scopesFor(metric, regional) {
  return [{ key: 'global', scope: null }, ...[...(regional.get(metric) || new Map())].map(([key, scope]) => ({ key, scope }))];
}

async function writeRows(client, runId, { day, metric, key, scope, rows, source, recompute }) {
  const hash = snapshots.definitionHash(metric);
  const kind = snapshots.valueKind(metric);
  const regionIds = scope ? [...scope.regionIds].map(Number).sort((a, b) => a - b) : null;
  const all = MONEY_METRICS.includes(metric)
    // Money series: a currency-less marker row records that the day/scope was
    // computed, so an absent currency reads as zero rather than missing.
    ? [{ dimensionKey: '', value: null, components: { currencies: rows.map(r => r.dimensionKey) } }, ...rows]
    : rows.length ? rows : [{ dimensionKey: '', value: null, components: {} }];
  let written = 0;
  for (const row of all) {
    const res = await client.query(
      `INSERT INTO metric_daily_snapshots
         (snapshot_date, metric_name, scope_key, region_ids, dimension_key, value, components,
          value_kind, source, definition_hash, run_id)
       SELECT $1::DATE, $2, $3, $4::INTEGER[], $5, $6::NUMERIC, $7::JSONB, $8, $9, $10, $11
        WHERE EXISTS (SELECT 1 FROM metric_snapshot_runs WHERE id = $11 AND status = 'running')
       ON CONFLICT (snapshot_date, metric_name, scope_key, dimension_key) DO UPDATE SET
         value = EXCLUDED.value, components = EXCLUDED.components, source = EXCLUDED.source,
         definition_hash = EXCLUDED.definition_hash, run_id = EXCLUDED.run_id, computed_at = NOW(),
         region_ids = EXCLUDED.region_ids
        WHERE $12::BOOLEAN`,
      [day, metric, key, regionIds, row.dimensionKey, row.value, JSON.stringify(row.components),
        kind, source, hash, runId, recompute === true]);
    written += res.rowCount;
  }
  return written;
}

async function existingKeys(client, from, to) {
  const { rows } = await client.query(`SELECT to_char(snapshot_date,'YYYY-MM-DD') AS d, metric_name, scope_key
      FROM metric_daily_snapshots WHERE snapshot_date BETWEEN $1::DATE AND $2::DATE AND dimension_key = ''`, [from, to]);
  return new Set(rows.map(r => `${r.d}|${r.metric_name}|${r.scope_key}`));
}

/**
 * Run the pipeline once. Options:
 *   kind: 'nightly' (default) or 'backfill'
 *   from, to: 'YYYY-MM-DD' (backfill; inclusive; closed days only)
 *   recompute: replace existing cohort rows (backfill only)
 *   requestedBy: admin id for backfill runs
 */
async function runMetricSnapshots(options = {}, db = pool) {
  const now = options.now ? new Date(options.now) : new Date();
  const today = snapshots.utcDay(now);
  const yesterday = snapshots.addDays(today, -1);
  const kind = options.kind === 'backfill' ? 'backfill' : 'nightly';
  let from, to;
  if (kind === 'backfill') {
    from = options.from; to = options.to || yesterday;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to)) || from > to || to > yesterday
      || snapshots.dayRange(from, to).length > MAX_BACKFILL_DAYS) {
      const err = new Error('Invalid backfill range'); err.code = 'invalid_range'; throw err;
    }
  } else {
    from = snapshots.addDays(today, -intEnv('METRIC_SNAPSHOT_LOOKBACK_DAYS', 90, 1, MAX_BACKFILL_DAYS));
    to = yesterday;
  }
  const recompute = kind === 'backfill' && options.recompute === true;
  const client = await db.connect();
  let locked = false, runId = null, written = 0;
  const failures = [];
  try {
    ({ rows: [{ locked }] } = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [LOCK_KEY]));
    if (!locked) return { skipped: 'locked' };
    await client.query(`UPDATE metric_snapshot_runs SET status = 'failed', error_code = 'superseded', finished_at = NOW()
      WHERE status = 'running'`);
    ({ rows: [{ id: runId }] } = await client.query(`INSERT INTO metric_snapshot_runs(kind, from_date, to_date, recompute, requested_by)
      VALUES($1, $2::DATE, $3::DATE, $4, $5) RETURNING id`, [kind, from, to, recompute, options.requestedBy || null]));
    const regional = await regionalScopes(client);
    const have = recompute ? new Set() : await existingKeys(client, from, today);
    const cohortMetrics = snapshots.SNAPSHOT_METRICS.filter(m => snapshots.valueKind(m) === 'daily_cohort');
    let days = snapshots.dayRange(from, to).filter(day => cohortMetrics.some(m =>
      scopesFor(m, regional).some(s => !have.has(`${day}|${m}|${s.key}`))));
    if (kind === 'nightly') days = days.slice(0, intEnv('METRIC_SNAPSHOT_MAX_DAYS_PER_RUN', 14, 1, MAX_BACKFILL_DAYS));
    const source = kind === 'backfill' ? 'backfill' : (d => d === yesterday ? 'nightly' : 'backfill');
    const work = days.map(day => ({ day, metrics: cohortMetrics, asOfDay: day }));
    if (kind === 'nightly') {
      work.push({ day: today, metrics: snapshots.SNAPSHOT_METRICS.filter(m => snapshots.valueKind(m) === 'point_in_time'), asOfDay: null });
    }
    for (const item of work) {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      try {
        await client.query("SET LOCAL statement_timeout = '60s'");
        for (const metric of item.metrics) {
          for (const { key, scope } of scopesFor(metric, regional)) {
            if (have.has(`${item.day}|${metric}|${key}`)) continue;
            await client.query('SAVEPOINT snap');
            try {
              const rows = await snapshots.computeSnapshot(client, metric, scope, item.asOfDay);
              written += await writeRows(client, runId, {
                day: item.day, metric, key, scope, rows, recompute,
                source: typeof source === 'function' ? (item.asOfDay == null ? 'nightly' : source(item.day)) : source,
              });
              await client.query('RELEASE SAVEPOINT snap');
            } catch (err) {
              await client.query('ROLLBACK TO SAVEPOINT snap');
              if (err.code === 'region_scope_unsupported') continue;
              failures.push({ day: item.day, metric, scope: key, code: err.code || 'error' });
              logger.warn('Metric snapshot failed', { day: item.day, metric, scope: key, code: err.code });
            }
          }
        }
        if (item.asOfDay != null) {
          await client.query('SAVEPOINT rollup');
          try {
            await rollupSupportDay(client, item.day);
            await client.query('RELEASE SAVEPOINT rollup');
          } catch (err) {
            await client.query('ROLLBACK TO SAVEPOINT rollup');
            failures.push({ day: item.day, metric: 'support_daily_rollups', scope: 'global', code: err.code || 'error' });
            logger.warn('Support daily rollup failed', { day: item.day, code: err.code });
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    }
    const status = failures.length ? 'failed' : 'succeeded';
    await client.query(`UPDATE metric_snapshot_runs SET status = $2, rows_written = $3, finished_at = NOW(), error_code = $4
      WHERE id = $1 AND status = 'running'`, [runId, status, written, failures.length ? 'partial_failure' : null]);
    return { runId, status, days: days.length, written, failures };
  } catch (err) {
    if (runId) {
      await client.query(`UPDATE metric_snapshot_runs SET status = 'failed', rows_written = $2, finished_at = NOW(), error_code = $3
        WHERE id = $1 AND status = 'running'`, [runId, written, String(err.code || 'error').slice(0, 64)]).catch(() => {});
    }
    throw err;
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [LOCK_KEY]);
    } finally { client.release(); }
  }
}

function startMetricSnapshots() {
  if (process.env.METRIC_SNAPSHOTS_ENABLED === 'false') return { stop() {} };
  let stopped = false, running = null;
  const tick = () => {
    if (stopped || running) return;
    running = runMetricSnapshots()
      .then(result => { if (result?.written) logger.info('Metric snapshots written', { runId: result.runId, written: result.written, days: result.days }); })
      .catch(error => logger.warn('Metric snapshots will retry', { code: error.code }))
      .finally(() => { running = null; });
  };
  const first = setTimeout(tick, 5 * 60000); first.unref?.();
  const timer = setInterval(tick, 60 * 60000); timer.unref?.();
  return { stop() { stopped = true; clearTimeout(first); clearInterval(timer); } };
}

module.exports = { runMetricSnapshots, startMetricSnapshots, regionalScopes };
