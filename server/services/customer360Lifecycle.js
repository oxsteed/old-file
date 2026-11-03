"use strict";
/**
 * Customer 360 upgrade 7: lifecycle stage and country cohort comparison.
 *
 * Stage is derived from signup date and transaction history only (model
 * c360-lifecycle-v1). It is computed set-based in batches so a full pass over
 * millions of users is a bounded series of queries, refreshed on customer
 * events and by a continuous wrap-around sweep. Cohorts are (country, signup
 * month); aggregate counts are precomputed into customer_cohort_stats and
 * any cell under MIN_CELL customers is suppressed when read.
 */
const db = require("../db");
const events = require("./customer360Events");
const AppError = require("../utils/appError");

const MODEL_VERSION = "c360-lifecycle-v1";
const STAGES = ["new", "never_activated", "active", "lapsing", "dormant", "closed"];
const MIN_CELL = 10;
const STALE_MS = 24 * 3600 * 1000;
const TX_PAYMENT = "('authorized','captured','released','refunded','partially_refunded','succeeded','completed','paid')";

/*
 * Compute and upsert lifecycle rows for a batch of user ids. Returns rows
 * whose stage changed from a previous value (first computations are not
 * "changes", so a backfill does not flood the event log).
 */
async function computeBatch(ids, runner = db) {
  if (!ids.length) return [];
  const { rows } = await runner.query(
    `WITH u AS (
       SELECT id, country, created_at, deleted_at FROM users
        WHERE id = ANY($1::uuid[]) AND role NOT IN ('admin', 'super_admin')
     ), tx AS (
       SELECT u.*, LEAST(p.first_at, o.first_at) AS first_at, GREATEST(p.last_at, o.last_at) AS last_at,
              COALESCE(p.n90, 0) + COALESCE(o.n90, 0) AS n90
         FROM u
         LEFT JOIN LATERAL (
           SELECT MIN(created_at) AS first_at, MAX(created_at) AS last_at,
                  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days') AS n90
             FROM payments WHERE payer_id = u.id AND status IN ${TX_PAYMENT}) p ON TRUE
         LEFT JOIN LATERAL (
           SELECT MIN(created_at) AS first_at, MAX(created_at) AS last_at,
                  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days') AS n90
             FROM food_orders WHERE customer_id = u.id AND payment_status IN ('paid', 'refunded')) o ON TRUE
     ), staged AS (
       SELECT tx.*, CASE
           WHEN deleted_at IS NOT NULL THEN 'closed'
           WHEN last_at IS NULL AND created_at > NOW() - INTERVAL '30 days' THEN 'new'
           WHEN last_at IS NULL THEN 'never_activated'
           WHEN last_at >= NOW() - INTERVAL '30 days' THEN 'active'
           WHEN last_at >= NOW() - INTERVAL '90 days' THEN 'lapsing'
           ELSE 'dormant' END AS stage
         FROM tx
     ), prev AS (
       SELECT customer_id, stage FROM customer_lifecycle WHERE customer_id = ANY($1::uuid[])
     ), up AS (
       INSERT INTO customer_lifecycle AS l (customer_id, model_version, stage, country, cohort_month,
              first_transaction_at, last_transaction_at, transactions_90d, stage_since, computed_at)
       SELECT id, $2, stage, upper(country), date_trunc('month', created_at)::date, first_at, last_at, n90, NOW(), NOW() FROM staged
       ON CONFLICT (customer_id) DO UPDATE SET model_version = EXCLUDED.model_version, stage = EXCLUDED.stage,
         country = EXCLUDED.country, cohort_month = EXCLUDED.cohort_month,
         first_transaction_at = EXCLUDED.first_transaction_at, last_transaction_at = EXCLUDED.last_transaction_at,
         transactions_90d = EXCLUDED.transactions_90d, computed_at = EXCLUDED.computed_at,
         stage_since = CASE WHEN l.stage = EXCLUDED.stage THEN l.stage_since ELSE NOW() END
       RETURNING l.customer_id, l.stage, l.computed_at
     )
     SELECT up.customer_id, up.stage, prev.stage AS previous, up.computed_at
       FROM up LEFT JOIN prev USING (customer_id)
      WHERE prev.stage IS NOT NULL AND prev.stage <> up.stage`,
    [ids, MODEL_VERSION],
  );
  for (const r of rows) {
    await events.append(null, {
      customerId: r.customer_id, source: "customer360", type: "lifecycle.stage_changed", actorType: "system",
      entityType: "lifecycle", entityId: r.customer_id,
      changes: { stage: { from: r.previous, to: r.stage } },
      dedupeKey: `lifecycle:${r.customer_id}:${r.computed_at.toISOString()}`,
    });
  }
  return rows;
}

/** Continuous wrap-around sweep over users (keyset by id). */
async function sweep({ batch = Number(process.env.CUSTOMER360_LIFECYCLE_BATCH) || 2000 } = {}) {
  const cursor = "lifecycle_users";
  const { rows: [cur] } = await db.query(`SELECT last_key FROM customer_event_ingest_cursors WHERE source = $1`, [cursor]);
  const after = cur?.last_key || "00000000-0000-0000-0000-000000000000";
  const { rows } = await db.query(`SELECT id FROM users WHERE id > $1::uuid ORDER BY id LIMIT $2`, [after, batch]);
  await computeBatch(rows.map((r) => r.id));
  const next = rows.length < batch ? null : rows[rows.length - 1].id;
  await db.query(
    `INSERT INTO customer_event_ingest_cursors (source, last_key, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (source) DO UPDATE SET last_key = EXCLUDED.last_key, updated_at = NOW()`, [cursor, next]);
  return { processed: rows.length, wrapped: next === null };
}

/** Recompute customers with new events (own consumer cursor). */
async function refreshFromEvents({ maxCustomers = 500 } = {}) {
  await db.query(`INSERT INTO customer360_event_consumers (consumer) VALUES ('lifecycle') ON CONFLICT DO NOTHING`);
  const { rows: [c] } = await db.query(`SELECT last_event_id FROM customer360_event_consumers WHERE consumer = 'lifecycle'`);
  const { rows } = await db.query(
    `SELECT customer_id, MAX(id) AS max_id FROM (
       SELECT id, customer_id FROM customer_events
        WHERE id > $1 AND event_type NOT LIKE 'lifecycle.%' AND event_type NOT LIKE 'health.%' AND event_type NOT LIKE 'admin.customer360\\_%'
        ORDER BY id LIMIT 10000) e
     GROUP BY customer_id ORDER BY MAX(id) LIMIT $2`, [c.last_event_id, maxCustomers]);
  await computeBatch(rows.map((r) => r.customer_id));
  if (rows.length) {
    await db.query(`UPDATE customer360_event_consumers SET last_event_id = GREATEST(last_event_id, $1), updated_at = NOW() WHERE consumer = 'lifecycle'`,
      [rows[rows.length - 1].max_id]);
  }
  return { recomputed: rows.length };
}

/** Rebuild the cohort aggregate table in one transaction. */
async function rebuildCohortStats() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE customer_cohort_stats IN EXCLUSIVE MODE");
    await client.query("DELETE FROM customer_cohort_stats");
    const { rowCount } = await client.query(
      `INSERT INTO customer_cohort_stats (country, cohort_month, stage, customers, computed_at)
       SELECT country, cohort_month, stage, COUNT(*)::int, NOW() FROM customer_lifecycle GROUP BY 1, 2, 3`);
    await client.query("COMMIT");
    return { cells: rowCount };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function current(customerId) {
  let { rows: [row] } = await db.query(`SELECT * FROM customer_lifecycle WHERE customer_id = $1`, [customerId]);
  if (!row || Date.now() - new Date(row.computed_at).getTime() > STALE_MS || row.model_version !== MODEL_VERSION) {
    await computeBatch([customerId]);
    ({ rows: [row] } = await db.query(`SELECT * FROM customer_lifecycle WHERE customer_id = $1`, [customerId]));
  }
  return row || null;
}

/** Stage counts → distribution with small-cell suppression. */
function distribution(counts) {
  const total = STAGES.reduce((s, k) => s + (counts[k] || 0), 0);
  if (total < MIN_CELL) return { total: null, suppressed: true, stages: Object.fromEntries(STAGES.map((k) => [k, null])) };
  return {
    total, suppressed: false,
    stages: Object.fromEntries(STAGES.map((k) => {
      const n = counts[k] || 0;
      return [k, n > 0 && n < MIN_CELL ? { count: null, share: null, suppressed: true } : { count: n, share: Math.round((n / total) * 1000) / 10 }];
    })),
  };
}

async function cohortFor(row) {
  const { rows } = await db.query(
    `SELECT country, stage, customers, computed_at FROM customer_cohort_stats WHERE cohort_month = $1`, [row.cohort_month]);
  const own = {}, all = {};
  let computedAt = null;
  for (const r of rows) {
    all[r.stage] = (all[r.stage] || 0) + r.customers;
    if (r.country === row.country) own[r.stage] = (own[r.stage] || 0) + r.customers;
    computedAt = computedAt && computedAt > r.computed_at ? computedAt : r.computed_at;
  }
  return { country: row.country, cohortMonth: row.cohort_month, computedAt, countryCohort: distribution(own), platformCohort: distribution(all) };
}

function present(row) {
  if (!row) return { state: "none" };
  const days = (t) => (t ? Math.floor((Date.now() - new Date(t).getTime()) / 86400000) : null);
  return {
    state: "ready", modelVersion: row.model_version, stage: row.stage, stageSince: row.stage_since, computedAt: row.computed_at,
    country: row.country, cohortMonth: row.cohort_month,
    factors: {
      daysSinceFirstTransaction: days(row.first_transaction_at), daysSinceLastTransaction: days(row.last_transaction_at),
      transactions90d: row.transactions_90d,
    },
  };
}

/** Country comparison: up to 6 countries × up to 24 signup months. */
async function compare({ countries, months = 12 }) {
  const list = [...new Set((Array.isArray(countries) ? countries : String(countries || "").split(","))
    .map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
  if (!list.length || list.length > 6 || !list.every((c) => /^[A-Z]{2}$/.test(c))) {
    throw new AppError("Choose 1 to 6 two-letter country codes", 400, "invalid_countries");
  }
  const m = Math.min(Math.max(Number.parseInt(months, 10) || 12, 1), 24);
  const { rows } = await db.query(
    `SELECT country, cohort_month, stage, customers, computed_at FROM customer_cohort_stats
      WHERE country = ANY($1::text[]) AND cohort_month >= (date_trunc('month', NOW()) - ($2::int - 1) * INTERVAL '1 month')::date
      ORDER BY cohort_month DESC`, [list, m]);
  const key = (c, mo) => `${c}|${mo.toISOString().slice(0, 10)}`;
  const cells = new Map();
  const overall = Object.fromEntries(list.map((c) => [c, {}]));
  let computedAt = null;
  for (const r of rows) {
    const k = key(r.country, r.cohort_month);
    if (!cells.has(k)) cells.set(k, { country: r.country, cohortMonth: r.cohort_month.toISOString().slice(0, 10), counts: {} });
    cells.get(k).counts[r.stage] = r.customers;
    overall[r.country][r.stage] = (overall[r.country][r.stage] || 0) + r.customers;
    computedAt = computedAt && computedAt > r.computed_at ? computedAt : r.computed_at;
  }
  return {
    modelVersion: MODEL_VERSION, minCell: MIN_CELL, months: m, computedAt, stages: STAGES,
    countries: list.map((c) => ({ country: c, ...distribution(overall[c]) })),
    cohorts: [...cells.values()].map((x) => ({ country: x.country, cohortMonth: x.cohortMonth, ...distribution(x.counts) })),
  };
}

module.exports = { MODEL_VERSION, STAGES, MIN_CELL, computeBatch, sweep, refreshFromEvents, rebuildCohortStats, current, cohortFor, present, distribution, compare };
