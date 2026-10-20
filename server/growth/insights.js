"use strict";
// Exact-window demand/supply computation over the daily subject sets
// (demand_subject_daily / supply_subject_daily, migration 939).
//
// Why sets: demand_daily stores only k-suppressed daily counts. Summing
// daily counts across 28 days double-counts anyone active on two days and
// can never produce "unique people in 28 days". The sets hold one row per
// (day, cell, signal, person), so a window count is COUNT(DISTINCT user_id)
// and is exact. ClickHouse uniqExact states were the alternative, but the
// ClickHouse aggregates (activity_hourly) key subjects by hour x route x
// element without entity intent, so they cannot answer per-intent cells;
// the Postgres sets are the approach the existing schema supports.
//
// Privacy: cells with fewer than K distinct people in the current window
// are dropped entirely. Supply counts and trend percentages are shown only
// when their own base is at least K, so a displayed ratio cannot be
// inverted into a sub-k headcount.
const { predicate } = require("./access");
const { gap: gapScore } = require("./recommend/score");

const K = 5;
// Spec 10.1 signal weights. Event-derived job signals keep their event
// names; domain rollup signals use dotted names. Anything unlisted is a
// full-strength transactional request (weight 1).
const SIGNAL_WEIGHTS = Object.freeze({
  "job.posted": 1.0,
  "job.published": 1.0,
  "job.completed": 1.0,
  "job.unfilled_expired": 1.5,
  search: 0.3,
  "search.zero_result": 0.8,
  planned_need: 0.7,
  saved_search: 0.5,
  "booking.requested": 1.0,
  "food.order": 1.0,
  "marketplace.order": 1.0,
  "direct.request": 1.0,
});
const weightOf = (signal) =>
  Object.hasOwn(SIGNAL_WEIGHTS, signal) ? SIGNAL_WEIGHTS[signal] : 1.0;

const WINDOW_SQL = `
WITH sig AS (
  SELECT d.postal_ref, d.node_id, d.signal_type,
    COUNT(DISTINCT d.user_id) FILTER (WHERE d.day > CURRENT_DATE - 28 AND d.day <= CURRENT_DATE)::int AS cur_subjects,
    COUNT(DISTINCT d.user_id) FILTER (WHERE d.day > CURRENT_DATE - 56 AND d.day <= CURRENT_DATE - 28)::int AS prior_subjects
  FROM demand_subject_daily d
  WHERE d.day > CURRENT_DATE - 56
  GROUP BY d.postal_ref, d.node_id, d.signal_type
),
people AS (
  SELECT postal_ref, node_id,
    COUNT(DISTINCT user_id) FILTER (WHERE day > CURRENT_DATE - 28 AND day <= CURRENT_DATE)::int AS cur,
    COUNT(DISTINCT user_id) FILTER (WHERE day > CURRENT_DATE - 56 AND day <= CURRENT_DATE - 28)::int AS prior
  FROM demand_subject_daily WHERE day > CURRENT_DATE - 56 GROUP BY postal_ref, node_id
),
supply AS (
  SELECT postal_ref, node_id,
    COUNT(DISTINCT user_id) FILTER (WHERE day > CURRENT_DATE - 28 AND day <= CURRENT_DATE)::int AS cur,
    COUNT(DISTINCT user_id) FILTER (WHERE day > CURRENT_DATE - 56 AND day <= CURRENT_DATE - 28)::int AS prior
  FROM supply_subject_daily WHERE day > CURRENT_DATE - 56 GROUP BY postal_ref, node_id
)
SELECT g.id, g.place_name, g.country, g.postal_code, g.lat, g.lng, g.h3_r5, g.h3_r7,
  n.id AS node_id, n.code, n.labels,
  p.cur AS people_cur, p.prior AS people_prior,
  COALESCE(s.cur, 0) AS supply_cur, COALESCE(s.prior, 0) AS supply_prior,
  sig.signal_type, sig.cur_subjects, sig.prior_subjects,
  af.ratio AS anomaly_ratio, af.day AS anomaly_day
FROM people p
JOIN geo_postal_centroids g ON g.id = p.postal_ref
JOIN demand_taxonomy_nodes n ON n.id = p.node_id
LEFT JOIN supply s ON s.postal_ref = p.postal_ref AND s.node_id = p.node_id
LEFT JOIN sig ON sig.postal_ref = p.postal_ref AND sig.node_id = p.node_id
LEFT JOIN LATERAL (
  SELECT ratio, day FROM growth_anomaly_flags f
  WHERE f.postal_ref = p.postal_ref AND f.node_id = p.node_id
  ORDER BY f.day DESC LIMIT 1
) af ON TRUE
WHERE p.cur >= ${K}`;

async function computeCells(conn, boundary, { intent = null } = {}) {
  const params = [];
  const where = predicate(boundary, "g", params);
  let intentClause = "";
  if (intent) {
    params.push(String(intent).slice(0, 120));
    intentClause = ` AND n.code = $${params.length}`;
  }
  const { rows } = await conn.query(
    `${WINDOW_SQL} AND ${where}${intentClause}`,
    params,
  );
  const cells = new Map();
  for (const row of rows) {
    const key = `${row.id}:${row.node_id}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        id: row.id,
        place_name: row.place_name,
        country: row.country,
        postal_code: row.postal_code,
        lat: row.lat,
        lng: row.lng,
        h3_r5: row.h3_r5,
        h3_r7: row.h3_r7,
        node_id: row.node_id,
        code: row.code,
        labels: row.labels,
        people: row.people_cur,
        people_prior: row.people_prior,
        supply_people: row.supply_cur,
        supply_people_prior: row.supply_prior,
        demand: 0,
        demand_prior: 0,
        anomaly:
          row.anomaly_ratio == null
            ? null
            : { ratio: Number(row.anomaly_ratio), day: row.anomaly_day },
      };
      cells.set(key, cell);
    }
    if (row.signal_type) {
      const w = weightOf(row.signal_type);
      cell.demand += w * Number(row.cur_subjects || 0);
      cell.demand_prior += w * Number(row.prior_subjects || 0);
    }
  }
  const list = [...cells.values()];
  // Empirical-Bayes priors: the mean cell for the same intent inside the
  // same country (spec 10.3 shrink toward the country mean).
  const priors = new Map();
  for (const cell of list) {
    const key = `${cell.country}:${cell.node_id}`;
    const acc = priors.get(key) || { d: 0, s: 0, n: 0 };
    acc.d += cell.demand;
    acc.s += cell.supply_people;
    acc.n += 1;
    priors.set(key, acc);
  }
  for (const cell of list) {
    const acc = priors.get(`${cell.country}:${cell.node_id}`);
    const priorDemand = acc.n ? acc.d / acc.n : 0;
    const priorSupply = acc.n ? acc.s / acc.n : 0;
    cell.gap_raw = gapScore(
      cell.demand,
      cell.supply_people,
      priorDemand,
      priorSupply,
      1,
    );
    // Presentation rules (k-suppression on every displayed count).
    cell.demand = Math.round(cell.demand * 10) / 10;
    cell.supply = cell.supply_people >= K ? cell.supply_people : null;
    cell.gap =
      cell.supply_people >= K ? Math.round(cell.gap_raw * 100) / 100 : null;
    if (cell.people_prior >= K && cell.demand_prior > 0) {
      cell.trend_pct =
        Math.round(
          ((cell.demand - cell.demand_prior) / cell.demand_prior) * 1000,
        ) / 10;
      cell.trend_state = "ok";
    } else if (cell.people_prior === 0) {
      cell.trend_pct = null;
      cell.trend_state = "new";
    } else {
      cell.trend_pct = null;
      cell.trend_state = "suppressed";
    }
    delete cell.demand_prior;
    delete cell.people_prior;
    delete cell.supply_people;
    delete cell.supply_people_prior;
  }
  list.sort((a, b) => (b.gap_raw || 0) - (a.gap_raw || 0));
  return list;
}

async function freshness(conn) {
  const {
    rows: [d],
  } = await conn.query(
    "SELECT MAX(day) AS demand_through FROM demand_subject_daily",
  );
  const {
    rows: [s],
  } = await conn.query(
    "SELECT MAX(day) AS supply_through FROM supply_subject_daily",
  );
  const {
    rows: [run],
  } = await conn.query(
    "SELECT day, status, completed_at FROM growth_rollup_runs ORDER BY id DESC LIMIT 1",
  );
  return {
    demand_through: d?.demand_through || null,
    supply_through: s?.supply_through || null,
    last_run: run || null,
  };
}

module.exports = { K, SIGNAL_WEIGHTS, weightOf, computeCells, freshness };
