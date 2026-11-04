"use strict";
/**
 * Customer 360 upgrade 4: anomaly detection with bundling and snooze.
 *
 * Detectors (run by the C360 worker):
 *   refund_spike       refunds in 7 days >= REFUND_MIN and >= REFUND_RATIO x
 *                      the customer's weekly average over the prior 90 days
 *   payout_failures    failed instant payouts in 7 days >= PAYOUT_MIN
 *   new_country_login  a successful sign-in from a country not seen in the
 *                      previous 180 days, for customers with earlier sign-ins
 * One live (open/snoozed) row per customer and kind bundles repeats; each
 * detection key is counted once. Delivery goes through the existing alert
 * rules (sources anomaliesFinancial / anomaliesSecurity), per customer or
 * platform-wide. Nothing here blocks, limits or changes an account.
 */
const db = require("../db");
const AppError = require("../utils/appError");
const { withTransaction } = require("../utils/transaction");
const { logAdminAction } = require("./auditService");

const KINDS = ["refund_spike", "payout_failures", "new_country_login"];
const FINANCIAL = ["refund_spike", "payout_failures"];
const SECURITY = ["new_country_login"];
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const thresholds = (env = process.env) => ({
  refundMin: num(env.CUSTOMER360_ANOMALY_REFUND_MIN, 3),
  refundRatio: num(env.CUSTOMER360_ANOMALY_REFUND_RATIO, 3),
  payoutMin: num(env.CUSTOMER360_ANOMALY_PAYOUT_MIN, 2),
  countryLookbackDays: num(env.CUSTOMER360_ANOMALY_COUNTRY_DAYS, 180),
});

/** Record one detection into the customer's live bundle (idempotent per key). */
async function detect(runner, { customerId, kind, evidence, key }) {
  if (!KINDS.includes(kind)) throw new Error(`unknown anomaly kind ${kind}`);
  const { rows } = await (runner || db).query(
    `INSERT INTO customer_anomalies (customer_id, kind, evidence, detection_keys)
     VALUES ($1, $2, $3::jsonb, ARRAY[$4]::text[])
     ON CONFLICT (customer_id, kind) WHERE status IN ('open', 'snoozed')
     DO UPDATE SET occurrences = customer_anomalies.occurrences + 1,
       last_detected_at = NOW(), evidence = EXCLUDED.evidence, updated_at = NOW(),
       detection_keys = (ARRAY[$4]::text[] || customer_anomalies.detection_keys)[1:50]
     WHERE NOT (customer_anomalies.detection_keys @> ARRAY[$4]::text[])
     RETURNING id, occurrences, (xmax = 0) AS created`,
    [customerId, kind, JSON.stringify(evidence), String(key).slice(0, 200)],
  );
  return rows[0] || null;
}

// Time cursors start 7 days back (the detection window) instead of scanning
// all history on first run; event cursors start at the beginning of the log.
async function cursor(name, { time = false } = {}) {
  await db.query(
    `INSERT INTO customer360_event_consumers (consumer, last_event_id)
     VALUES ($1, CASE WHEN $2 THEN (EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days') * 1000000)::bigint ELSE 0 END)
     ON CONFLICT DO NOTHING`, [name, time]);
  const { rows: [r] } = await db.query(`SELECT last_event_id FROM customer360_event_consumers WHERE consumer = $1`, [name]);
  return Number(r.last_event_id);
}
const advance = (name, value) => db.query(
  `UPDATE customer360_event_consumers SET last_event_id = GREATEST(last_event_id, $2), updated_at = NOW() WHERE consumer = $1`, [name, value]);

/** New-country sign-ins, read from the event log. */
async function scanLogins({ limit = 2000, env } = {}) {
  const t = thresholds(env);
  const from = await cursor("anomalies_login");
  const { rows } = await db.query(
    `SELECT id, customer_id, entity_id, occurred_at, changes->>'country' AS country
       FROM customer_events WHERE id > $1 AND event_type = 'login.succeeded' ORDER BY id LIMIT $2`, [from, limit]);
  const candidates = rows.filter((e) => /^[A-Z]{2}$/.test(String(e.country || "")));
  let found = 0;
  if (candidates.length) {
    // One grouped history lookup for the whole batch instead of one query
    // per candidate event (same window, same exclusion, same country match).
    const { rows: histories } = await db.query(
      `SELECT v.user_id, v.entity_id,
              COUNT(h.id)::int AS prior,
              COUNT(*) FILTER (WHERE h.country_code = v.country)::int AS same,
              ARRAY(SELECT DISTINCT h2.country_code FROM user_login_history h2
                     WHERE h2.user_id = v.user_id AND h2.success AND h2.id <> v.entity_id AND h2.country_code IS NOT NULL
                       AND COALESCE(h2.login_at, h2.created_at) BETWEEN v.occurred_at - ($5 * INTERVAL '1 day') AND v.occurred_at
                     LIMIT 5) AS previous
         FROM (SELECT * FROM unnest($1::uuid[], $2::bigint[], $3::text[], $4::timestamptz[]))
           AS v(user_id, entity_id, country, occurred_at)
         LEFT JOIN user_login_history h
           ON h.user_id = v.user_id AND h.success AND h.id <> v.entity_id AND h.country_code IS NOT NULL
          AND COALESCE(h.login_at, h.created_at) BETWEEN v.occurred_at - ($5 * INTERVAL '1 day') AND v.occurred_at
        GROUP BY v.user_id, v.entity_id, v.country, v.occurred_at`,
      [candidates.map((e) => e.customer_id), candidates.map((e) => Number(e.entity_id)),
       candidates.map((e) => e.country), candidates.map((e) => e.occurred_at), t.countryLookbackDays]);
    const byEntity = new Map(histories.map((h) => [String(h.entity_id), h]));
    for (const e of candidates) {
      const h = byEntity.get(String(e.entity_id));
      if (h && h.prior > 0 && h.same === 0) {
        await detect(null, { customerId: e.customer_id, kind: "new_country_login",
          evidence: { country: e.country, previousCountries: (h.previous || []).sort() }, key: `login:${e.entity_id}` });
        found += 1;
      }
    }
  }
  if (rows.length) await advance("anomalies_login", rows[rows.length - 1].id);
  return { scanned: rows.length, found };
}

/** Refund spikes, from both refund tables, by time cursor (µs since epoch). */
async function scanRefunds({ env } = {}) {
  const t = thresholds(env);
  const since = await cursor("anomalies_refund", { time: true });
  const { rows } = await db.query(
    `WITH recent AS (
       SELECT p.payer_id AS customer_id, ra.created_at FROM payment_refund_attempts ra JOIN payments p ON p.id = ra.payment_id
        WHERE ra.created_at > (TIMESTAMPTZ 'epoch' + $1::bigint * INTERVAL '1 microsecond') AND p.payer_id IS NOT NULL
       UNION ALL
       SELECT customer_id, created_at FROM food_credit_refunds WHERE created_at > (TIMESTAMPTZ 'epoch' + $1::bigint * INTERVAL '1 microsecond') AND customer_id IS NOT NULL)
     SELECT customer_id, MAX(created_at) AS latest, (EXTRACT(EPOCH FROM MAX(created_at)) * 1000000)::bigint AS latest_us
       FROM recent GROUP BY customer_id ORDER BY MAX(created_at) LIMIT 500`,
    [since]);
  let found = 0;
  if (rows.length) {
    // One grouped baseline lookup for all candidate customers instead of
    // one query per customer.
    const { rows: baselines } = await db.query(
      `WITH all_refunds AS (
         SELECT ra.created_at, p.payer_id AS customer_id FROM payment_refund_attempts ra JOIN payments p ON p.id = ra.payment_id WHERE p.payer_id = ANY($1)
         UNION ALL SELECT created_at, customer_id FROM food_credit_refunds WHERE customer_id = ANY($1))
       SELECT customer_id,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS week,
              COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days' AND created_at > NOW() - INTERVAL '97 days')::int AS prior
         FROM all_refunds GROUP BY customer_id`,
      [rows.map((r) => r.customer_id)]);
    const byCustomer = new Map(baselines.map((b) => [b.customer_id, b]));
    for (const r of rows) {
      const c = byCustomer.get(r.customer_id) || { week: 0, prior: 0 };
      const baseline = c.prior / (90 / 7);
      if (c.week >= t.refundMin && c.week >= t.refundRatio * Math.max(baseline, 1 / t.refundRatio)) {
        await detect(null, { customerId: r.customer_id, kind: "refund_spike",
          evidence: { refunds7d: c.week, baselineWeekly: Math.round(baseline * 100) / 100 },
          key: `refund:${r.customer_id}:${r.latest_us}` });
        found += 1;
      }
    }
  }
  if (rows.length) await advance("anomalies_refund", rows[rows.length - 1].latest_us);
  return { scanned: rows.length, found };
}

/** Payout failures by time cursor on instant_payouts.updated_at. */
async function scanPayouts({ env } = {}) {
  const t = thresholds(env);
  const since = await cursor("anomalies_payout", { time: true });
  const { rows } = await db.query(
    `SELECT user_id, MAX(updated_at) AS latest, (EXTRACT(EPOCH FROM MAX(updated_at)) * 1000000)::bigint AS latest_us FROM instant_payouts
      WHERE status = 'failed' AND updated_at > (TIMESTAMPTZ 'epoch' + $1::bigint * INTERVAL '1 microsecond')
      GROUP BY user_id ORDER BY MAX(updated_at) LIMIT 500`, [since]);
  let found = 0;
  if (rows.length) {
    // One grouped count for all candidate customers instead of one query
    // per customer.
    const { rows: counts } = await db.query(
      `SELECT user_id, COUNT(*)::int AS week FROM instant_payouts
        WHERE user_id = ANY($1) AND status = 'failed' AND updated_at > NOW() - INTERVAL '7 days'
        GROUP BY user_id`,
      [rows.map((r) => r.user_id)]);
    const byUser = new Map(counts.map((c) => [c.user_id, c.week]));
    for (const r of rows) {
      const week = byUser.get(r.user_id) || 0;
      if (week >= t.payoutMin) {
        await detect(null, { customerId: r.user_id, kind: "payout_failures", evidence: { failures7d: week },
          key: `payout:${r.user_id}:${r.latest_us}` });
        found += 1;
      }
    }
  }
  if (rows.length) await advance("anomalies_payout", rows[rows.length - 1].latest_us);
  return { scanned: rows.length, found };
}

/** Snoozes end on time; the bundle reopens and keeps its history. */
async function expireSnoozes() {
  const { rowCount } = await db.query(
    `UPDATE customer_anomalies SET status = 'open', snoozed_until = NULL, revision = revision + 1, updated_at = NOW()
      WHERE status = 'snoozed' AND snoozed_until <= NOW()`);
  return { reopened: rowCount };
}

function kindsFor(allowed) {
  return [...(allowed.financial ? FINANCIAL : []), ...(allowed.security ? SECURITY : [])];
}

async function list({ customerId = null, kinds, statuses = ["open", "snoozed", "acknowledged"], limit = 50, before = null }) {
  if (!kinds.length) return [];
  const { rows } = await db.query(
    `SELECT a.id::text, a.customer_id, a.kind, a.status, a.occurrences, a.first_detected_at, a.last_detected_at,
            a.evidence, a.snoozed_until, a.handled_at, a.revision
       FROM customer_anomalies a
      WHERE ($1::uuid IS NULL OR a.customer_id = $1) AND a.kind = ANY($2::text[]) AND a.status = ANY($3::text[])
        AND ($4::bigint IS NULL OR a.id < $4::bigint)
      ORDER BY a.last_detected_at DESC, a.id DESC LIMIT $5`,
    [customerId, kinds, statuses, before, Math.min(Math.max(1, limit), 200)]);
  return rows;
}

const TRANSITIONS = {
  snooze: { from: ["open", "snoozed"], to: "snoozed" },
  unsnooze: { from: ["snoozed"], to: "open" },
  acknowledge: { from: ["open", "snoozed"], to: "acknowledged" },
  resolve: { from: ["open", "snoozed", "acknowledged"], to: "resolved" },
};

/** Staff action on one anomaly (audited in the same transaction). */
async function act({ id, action, adminId, kinds, revision, reason, until, req, customerId = null }) {
  const t = TRANSITIONS[action];
  if (!t) throw new AppError("Invalid action", 400, "invalid_request");
  if (typeof reason !== "string" || reason.trim().length < 3 || reason.length > 500) throw new AppError("Reason required", 400, "reason_required");
  if (!/^\d{1,19}$/.test(String(id))) throw new AppError("Invalid anomaly", 400, "invalid_request");
  let snoozedUntil = null;
  if (action === "snooze") {
    const ms = Date.parse(until);
    if (!Number.isFinite(ms) || ms <= Date.now() || ms > Date.now() + 30 * 86400000) throw new AppError("Snooze must end within 30 days", 400, "invalid_snooze");
    snoozedUntil = new Date(ms).toISOString();
  }
  return withTransaction(db, async (client) => {
    const { rows: [before] } = await client.query(`SELECT * FROM customer_anomalies WHERE id = $1 FOR UPDATE`, [id]);
    if (!before || !kinds.includes(before.kind) || (customerId && before.customer_id !== customerId)) throw new AppError("Anomaly not found", 404, "not_found");
    if (Number(revision) !== before.revision) throw new AppError("Anomaly changed", 409, "revision_conflict");
    if (!t.from.includes(before.status)) throw new AppError("Action not allowed in this state", 409, "invalid_state");
    const { rows: [after] } = await client.query(
      `UPDATE customer_anomalies SET status = $2::text, snoozed_until = $3::timestamptz, snoozed_by = CASE WHEN $2::text = 'snoozed' THEN $4::uuid ELSE NULL END,
         handled_by = CASE WHEN $2::text IN ('acknowledged', 'resolved') THEN $4::uuid ELSE handled_by END,
         handled_at = CASE WHEN $2::text IN ('acknowledged', 'resolved') THEN NOW() ELSE handled_at END,
         revision = revision + 1, updated_at = NOW()
       WHERE id = $1 RETURNING id::text, customer_id, kind, status, occurrences, snoozed_until, revision`,
      [id, t.to, snoozedUntil, adminId]);
    await logAdminAction({
      adminId, action: `customer360_anomaly_${action}`, targetType: "user", targetId: before.customer_id,
      before: { status: before.status, revision: before.revision }, after: { status: after.status, revision: after.revision, kind: after.kind },
      description: JSON.stringify({ anomalyId: String(id), reason: reason.trim(), until: snoozedUntil }), req, client,
    });
    return after;
  }, "customer360_anomaly_action");
}

module.exports = { KINDS, FINANCIAL, SECURITY, thresholds, detect, scanLogins, scanRefunds, scanPayouts, expireSnoozes, kindsFor, list, act };
