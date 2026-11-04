"use strict";
/**
 * Customer 360 upgrade 12: precomputed per-customer summaries.
 *
 * One row per customer in customer360_summaries holds counts and last-seen
 * times for every workspace source plus health, lifecycle, open anomalies and
 * open queue items, so the workspace header renders from one primary-key read
 * instead of ~70 aggregate queries.
 *
 * Freshness at ~6M customers:
 *  - markFromEvents (consumer 'summaries') only flags rows dirty: one batched
 *    upsert per tick, so an event burst for one customer costs one recompute.
 *  - computeDirty claims dirty rows with FOR UPDATE SKIP LOCKED and a lease,
 *    so several workers share the queue without double work.
 *  - sweepStale recomputes the oldest rows past the TTL (catches changes that
 *    do not emit events) in bounded batches via the computed_at index.
 *  - Reads never block on a recompute unless no row exists; they report
 *    staleness (fresh / dirty / stale / outdated_model / missing) and age.
 */
const db = require("../db");
const { mapBounded } = require("../utils/boundedBatch");
const { sources } = require("./customer360Sources");

const MODEL_VERSION = "c360-summary-v1";
const ttlHours = () => Math.max(1, Math.min(24 * 30, Number(process.env.CUSTOMER360_SUMMARY_TTL_HOURS) || 24));
const LEASE_SECONDS = 120;
const SOURCE_TIMEOUT_MS = 15000;

function sourceSql(def) {
  if (!/^[A-Za-z0-9_]+$/.test(def.key)) throw new Error(`invalid source key ${def.key}`);
  return `SELECT '${def.key}'::text AS key, COUNT(*)::int AS n, MAX(occurred_at) AS last_at,
    COUNT(*) FILTER (WHERE occurred_at >= NOW() - interval '30 days')::int AS last30 FROM (${def.sql}) s`;
}

async function sourceCounts(client, customerId) {
  const defs = Object.values(sources);
  const out = {};
  const failed = [];
  const fill = (rows) => rows.forEach((r) => { out[r.key] = { n: r.n, lastAt: r.last_at, last30: r.last30 }; });
  await client.query("SAVEPOINT c360_summary_all");
  try {
    const { rows } = await client.query(defs.map(sourceSql).join("\nUNION ALL\n"), [customerId]);
    fill(rows);
    await client.query("RELEASE SAVEPOINT c360_summary_all");
    return { out, failed };
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT c360_summary_all");
  }
  // One source is broken (e.g. a table not yet migrated): isolate it.
  for (const def of defs) {
    await client.query("SAVEPOINT c360_summary_one");
    try {
      const { rows } = await client.query(sourceSql(def), [customerId]);
      fill(rows);
      await client.query("RELEASE SAVEPOINT c360_summary_one");
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT c360_summary_one");
      failed.push(def.key);
    }
  }
  return { out, failed };
}

async function derived(client, customerId) {
  const { rows: [r] } = await client.query(
    `SELECT (SELECT json_build_object('n', COUNT(*), 'lastAt', MAX(occurred_at), 'maxId', COALESCE(MAX(id), 0)) FROM customer_events WHERE customer_id = $1) AS events,
            (SELECT json_build_object('churnBand', churn_band, 'paymentBand', payment_band, 'supportBand', support_band, 'computedAt', computed_at)
               FROM customer_health_scores WHERE customer_id = $1) AS health,
            (SELECT json_build_object('stage', stage, 'stageSince', stage_since, 'transactions90d', transactions_90d, 'computedAt', computed_at)
               FROM customer_lifecycle WHERE customer_id = $1) AS lifecycle,
            (SELECT COALESCE(json_object_agg(kind, n), '{}') FROM (SELECT kind, COUNT(*)::int AS n FROM customer_anomalies
               WHERE customer_id = $1 AND status IN ('open', 'acknowledged') GROUP BY kind) a) AS anomalies,
            (SELECT COALESCE(json_object_agg(topic, json_build_object('open', n, 'breached', b)), '{}') FROM (SELECT topic, COUNT(*)::int AS n,
               COUNT(*) FILTER (WHERE sla_breached_at IS NOT NULL)::int AS b FROM customer360_queue_items
               WHERE customer_id = $1 AND status <> 'resolved' GROUP BY topic) q) AS queues`, [customerId]);
  return r;
}

/** Recompute one customer's summary inside its own transaction. */
async function computeOne(customerId) {
  const started = Date.now();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${SOURCE_TIMEOUT_MS}`);
    const { rows: [exists] } = await client.query(`SELECT 1 FROM users WHERE id = $1`, [customerId]);
    if (!exists) {
      await client.query("ROLLBACK");
      return null;
    }
    // Read the watermark first: any event appended after this point re-marks the row dirty.
    const markAt = (await client.query(`SELECT NOW() AS t`)).rows[0].t;
    const { out, failed } = await sourceCounts(client, customerId);
    const d = await derived(client, customerId);
    const summary = {
      sources: out,
      events: { n: Number(d.events.n), lastAt: d.events.lastAt },
      health: d.health, lifecycle: d.lifecycle, anomalies: d.anomalies, queues: d.queues,
    };
    const { rows: [row] } = await client.query(
      `INSERT INTO customer360_summaries AS s (customer_id, model_version, summary, event_watermark, computed_at, compute_ms, failed_sources, dirty_since, claimed_until)
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, NULL, NULL)
       ON CONFLICT (customer_id) DO UPDATE SET model_version = EXCLUDED.model_version, summary = EXCLUDED.summary,
         event_watermark = GREATEST(s.event_watermark, EXCLUDED.event_watermark), computed_at = NOW(), compute_ms = EXCLUDED.compute_ms,
         failed_sources = EXCLUDED.failed_sources, claimed_until = NULL,
         dirty_since = CASE WHEN s.dirty_since > $7 THEN s.dirty_since ELSE NULL END
       RETURNING *`,
      [customerId, MODEL_VERSION, JSON.stringify(summary), Number(d.events.maxId), Date.now() - started, failed, markAt]);
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Advance the 'summaries' event consumer and flag affected customers dirty. */
async function markFromEvents({ batch = 10000 } = {}) {
  await db.query(`INSERT INTO customer360_event_consumers (consumer) VALUES ('summaries') ON CONFLICT DO NOTHING`);
  const { rows: [c] } = await db.query(`SELECT last_event_id FROM customer360_event_consumers WHERE consumer = 'summaries'`);
  const { rows: [r] } = await db.query(
    `WITH scan AS (SELECT id, customer_id, event_type FROM customer_events WHERE id > $1 ORDER BY id LIMIT $2),
          -- Admin reads of the workspace are audited as events; they never change a summary.
          e AS (SELECT id, customer_id FROM scan WHERE event_type NOT LIKE 'admin.customer360\\_%'),
          per AS (SELECT customer_id, MIN(id) AS first_id FROM e GROUP BY customer_id),
          up AS (INSERT INTO customer360_summaries AS s (customer_id, model_version, summary, event_watermark, computed_at, dirty_since)
                 SELECT p.customer_id, 'pending', '{}'::jsonb, 0, 'epoch'::timestamptz, NOW() FROM per p JOIN users u ON u.id = p.customer_id
                 ON CONFLICT (customer_id) DO UPDATE SET dirty_since = COALESCE(s.dirty_since, NOW())
                 WHERE s.event_watermark < (SELECT first_id FROM per WHERE per.customer_id = s.customer_id)
                 RETURNING 1)
     SELECT (SELECT MAX(id) FROM scan) AS max_id, (SELECT COUNT(*)::int FROM up) AS marked, (SELECT COUNT(*)::int FROM scan) AS seen`,
    [c.last_event_id, batch]);
  if (r.max_id) {
    await db.query(`UPDATE customer360_event_consumers SET last_event_id = GREATEST(last_event_id, $1), updated_at = NOW() WHERE consumer = 'summaries'`, [r.max_id]);
  }
  return { seen: r.seen, marked: r.marked };
}

async function claim(where, order, limit) {
  const { rows } = await db.query(
    `UPDATE customer360_summaries s SET claimed_until = NOW() + interval '${LEASE_SECONDS} seconds'
      WHERE s.customer_id IN (SELECT customer_id FROM customer360_summaries
        WHERE ${where} AND (claimed_until IS NULL OR claimed_until < NOW())
        ORDER BY ${order} LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING s.customer_id`, [limit]);
  return rows.map((r) => r.customer_id);
}

async function computeAll(ids) {
  // Bounded concurrency: a 200-deep dirty queue no longer drains strictly
  // serially, while the pool still caps simultaneous recomputes at 5.
  const failed = [];
  let computed = 0;
  await mapBounded(ids, 5, async (id) => {
    try {
      if (await computeOne(id)) computed += 1;
    } catch {
      failed.push(id);
    }
  });
  // Release leases of failures early so a retry is not blocked for the lease.
  if (failed.length) await db.query(`UPDATE customer360_summaries SET claimed_until = NOW() + interval '5 minutes' WHERE customer_id = ANY($1)`, [failed]);
  return { computed, failed: failed.length };
}

/** Recompute dirty rows, oldest mark first. */
async function computeDirty({ limit = 200 } = {}) {
  return computeAll(await claim("dirty_since IS NOT NULL", "dirty_since", limit));
}

/** Recompute rows past the TTL or on an older model version. */
async function sweepStale({ limit = 200 } = {}) {
  return computeAll(await claim(
    `(computed_at < NOW() - make_interval(hours => ${ttlHours()}) OR model_version <> '${MODEL_VERSION}')`, "computed_at", limit));
}

function staleness(row, latestEventId) {
  if (!row || row.model_version === "pending") return { state: "missing", ageSeconds: null, computedAt: null };
  const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(row.computed_at).getTime()) / 1000));
  const base = { ageSeconds, computedAt: row.computed_at, ttlHours: ttlHours(), dirtySince: row.dirty_since };
  if (row.model_version !== MODEL_VERSION) return { ...base, state: "outdated_model" };
  if (row.dirty_since || Number(latestEventId || 0) > Number(row.event_watermark)) return { ...base, state: "dirty" };
  if (ageSeconds > ttlHours() * 3600) return { ...base, state: "stale" };
  return { ...base, state: "fresh" };
}

/** Load, computing synchronously only when the customer has no summary yet. */
async function load(customerId, { force = false } = {}) {
  let { rows: [row] } = await db.query(`SELECT * FROM customer360_summaries WHERE customer_id = $1`, [customerId]);
  let computedNow = false;
  if (force || !row || row.model_version === "pending") {
    row = await computeOne(customerId);
    computedNow = true;
  }
  const { rows: [e] } = await db.query(`SELECT MAX(id) AS id FROM customer_events WHERE customer_id = $1`, [customerId]);
  const st = staleness(row, e?.id);
  // Readers see stale data immediately; the worker refreshes it in the background.
  if (!computedNow && ["dirty", "stale", "outdated_model"].includes(st.state) && !row.dirty_since) {
    await db.query(`UPDATE customer360_summaries SET dirty_since = NOW() WHERE customer_id = $1 AND dirty_since IS NULL`, [customerId]);
  }
  return { row, staleness: st, computedNow };
}

/**
 * Project a stored summary onto what this admin may see: only sources they
 * hold the grant for, anomaly kinds they may read, queue topics they may see.
 * Hidden sources are omitted (not zeroed) so their existence is not implied.
 */
async function present({ row, staleness: st, computedNow }, { can, anomalyKinds = [], topics = [] }) {
  const s = row?.summary || {};
  const areas = {};
  const hidden = [];
  for (const def of Object.values(sources)) {
    if (!(await can(def))) continue;
    const c = s.sources?.[def.key];
    if (!c) { hidden.push(def.key); continue; }
    const a = (areas[def.area] ||= { area: def.area, count: 0, last30: 0, lastAt: null, sources: [] });
    a.count += c.n;
    a.last30 += c.last30 || 0;
    if (c.lastAt && (!a.lastAt || c.lastAt > a.lastAt)) a.lastAt = c.lastAt;
    a.sources.push({ key: def.key, count: c.n, lastAt: c.lastAt });
  }
  const anomalies = Object.fromEntries(Object.entries(s.anomalies || {}).filter(([k]) => anomalyKinds.includes(k)));
  const queues = Object.fromEntries(Object.entries(s.queues || {}).filter(([k]) => topics.includes(k)));
  return {
    modelVersion: row?.model_version || null,
    staleness: st,
    computedNow,
    computeMs: row?.compute_ms ?? null,
    incomplete: (row?.failed_sources || []).length > 0 || hidden.length > 0,
    areas: Object.values(areas).sort((x, y) => (y.lastAt || "").localeCompare(x.lastAt || "")),
    events: s.events || null,
    health: s.health || null,
    lifecycle: s.lifecycle || null,
    anomalies,
    queues,
  };
}

/** Backlog numbers for monitoring the worker. */
async function backlog() {
  const { rows: [r] } = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM customer360_summaries WHERE dirty_since IS NOT NULL) AS dirty,
            (SELECT EXTRACT(EPOCH FROM NOW() - MIN(dirty_since))::int FROM customer360_summaries WHERE dirty_since IS NOT NULL) AS oldest_dirty_seconds,
            (SELECT last_event_id FROM customer360_event_consumers WHERE consumer = 'summaries') AS consumer_event_id`);
  return r;
}

module.exports = { MODEL_VERSION, ttlHours, computeOne, markFromEvents, computeDirty, sweepStale, staleness, load, present, backlog };
