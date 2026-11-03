"use strict";
/**
 * Customer 360 upgrade 2: transparent account health and risk scores.
 *
 * Three advisory scores (churn, payment risk, support load), each a weighted
 * sum of bounded factors. Every factor is stored with its raw value, weight
 * and contribution so the UI can explain the score line by line. Nothing in
 * this module changes an account, a payment or a limit.
 */
const db = require("../db");
const events = require("./customer360Events");

const MODEL_VERSION = "c360-health-v1";
const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

// [key, weight, normalise(raw) -> 0..1]. Weights per score sum to 100.
const MODEL = Object.freeze({
  churn: [
    ["inactivity", 45, (r) => (r.daysSinceLogin == null ? 1 : clamp01((r.daysSinceLogin - 14) / 76))],
    ["activityDrop", 35, (r) => {
      const prior = r.activityPrev60 / 2;
      if (prior <= 0) return r.activity30 > 0 ? 0 : 0.5;
      return clamp01(1 - r.activity30 / prior);
    }],
    ["newAccount", 20, (r) => (r.accountAgeDays < 30 ? 1 : 0)],
  ],
  payment: [
    ["failedPayments", 40, (r) => clamp01(r.failedPayments90 / 3)],
    ["refunds", 30, (r) => clamp01(r.refunds90 / 4)],
    ["openDisputes", 30, (r) => clamp01(r.openDisputes)],
  ],
  support: [
    ["openTickets", 40, (r) => clamp01(r.openTickets / 3)],
    ["recentTickets", 30, (r) => clamp01(r.tickets90 / 6)],
    ["slaBreaches", 30, (r) => clamp01(r.slaBreaches90 / 2)],
  ],
});
const RAW_FIELD = {
  inactivity: "daysSinceLogin", activityDrop: "activity30", newAccount: "accountAgeDays",
  failedPayments: "failedPayments90", refunds: "refunds90", openDisputes: "openDisputes",
  openTickets: "openTickets", recentTickets: "tickets90", slaBreaches: "slaBreaches90",
};
const band = (score) => (score >= 67 ? "high" : score >= 34 ? "medium" : "low");

/** Pure scoring: raw inputs -> scores, bands and explained factors. */
function score(raw) {
  const out = { modelVersion: MODEL_VERSION, factors: {} };
  for (const [name, factors] of Object.entries(MODEL)) {
    const rows = factors.map(([key, weight, normalise]) => {
      const level = clamp01(normalise(raw));
      return {
        key,
        value: raw[RAW_FIELD[key]] ?? null,
        ...(key === "activityDrop" ? { previous: raw.activityPrev60 } : {}),
        level: Math.round(level * 100) / 100,
        weight,
        contribution: Math.round(level * weight),
        explanationKey: `health.factors.${key}`,
      };
    });
    const total = Math.min(100, rows.reduce((s, f) => s + f.contribution, 0));
    out[`${name}Score`] = total;
    out[`${name}Band`] = band(total);
    out.factors[name] = rows;
  }
  return out;
}

async function rawInputs(customerId, runner = db) {
  const { rows: [r] } = await runner.query(
    `SELECT
       (SELECT EXTRACT(EPOCH FROM (NOW() - u.last_login_at)) / 86400 FROM users u WHERE u.id = $1)::float AS days_since_login,
       (SELECT EXTRACT(EPOCH FROM (NOW() - u.created_at)) / 86400 FROM users u WHERE u.id = $1)::float AS account_age_days,
       ((SELECT COUNT(*) FROM payments p WHERE p.payer_id = $1 AND p.created_at >= NOW() - INTERVAL '30 days')
        + (SELECT COUNT(*) FROM food_orders o WHERE o.customer_id = $1 AND o.created_at >= NOW() - INTERVAL '30 days'))::int AS activity30,
       ((SELECT COUNT(*) FROM payments p WHERE p.payer_id = $1 AND p.created_at >= NOW() - INTERVAL '90 days' AND p.created_at < NOW() - INTERVAL '30 days')
        + (SELECT COUNT(*) FROM food_orders o WHERE o.customer_id = $1 AND o.created_at >= NOW() - INTERVAL '90 days' AND o.created_at < NOW() - INTERVAL '30 days'))::int AS activity_prev60,
       ((SELECT COUNT(*) FROM food_orders o WHERE o.customer_id = $1 AND o.payment_status = 'failed' AND o.created_at >= NOW() - INTERVAL '90 days')
        + (SELECT COUNT(*) FROM instant_payouts ip WHERE ip.user_id = $1 AND ip.status = 'failed' AND ip.created_at >= NOW() - INTERVAL '90 days'))::int AS failed_payments90,
       ((SELECT COUNT(*) FROM payment_refund_attempts ra JOIN payments p ON p.id = ra.payment_id
          WHERE p.payer_id = $1 AND ra.created_at >= NOW() - INTERVAL '90 days')
        + (SELECT COUNT(*) FROM food_credit_refunds fr WHERE fr.customer_id = $1 AND fr.created_at >= NOW() - INTERVAL '90 days'))::int AS refunds90,
       (SELECT COUNT(*) FROM oxsteed_credit_disputes d WHERE d.customer_id = $1 AND d.resolved_at IS NULL)::int AS open_disputes,
       (SELECT COUNT(*) FROM support_tickets t WHERE t.user_id = $1 AND t.status IN ('open', 'assigned', 'in_progress', 'waiting_user'))::int AS open_tickets,
       (SELECT COUNT(*) FROM support_tickets t WHERE t.user_id = $1 AND t.created_at >= NOW() - INTERVAL '90 days')::int AS tickets90,
       (SELECT COUNT(*) FROM support_tickets t WHERE t.user_id = $1 AND t.created_at >= NOW() - INTERVAL '90 days'
          AND t.sla_due_at IS NOT NULL AND t.sla_due_at < COALESCE(t.first_response_at, t.resolved_at, NOW()))::int AS sla_breaches90`,
    [customerId],
  );
  return {
    daysSinceLogin: r.days_since_login == null ? null : Math.floor(r.days_since_login),
    accountAgeDays: Math.floor(r.account_age_days || 0),
    activity30: r.activity30, activityPrev60: r.activity_prev60,
    failedPayments90: r.failed_payments90, refunds90: r.refunds90, openDisputes: r.open_disputes,
    openTickets: r.open_tickets, tickets90: r.tickets90, slaBreaches90: r.sla_breaches90,
  };
}

/** Recompute and store; records a band change in the customer event log. */
async function recompute(customerId) {
  const result = score(await rawInputs(customerId));
  const { rows: [prev] } = await db.query(
    `SELECT churn_band, payment_band, support_band FROM customer_health_scores WHERE customer_id = $1`, [customerId]);
  const { rows: [row] } = await db.query(
    `INSERT INTO customer_health_scores (customer_id, model_version, churn_score, payment_score, support_score,
       churn_band, payment_band, support_band, factors, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
     ON CONFLICT (customer_id) DO UPDATE SET model_version = EXCLUDED.model_version,
       churn_score = EXCLUDED.churn_score, payment_score = EXCLUDED.payment_score, support_score = EXCLUDED.support_score,
       churn_band = EXCLUDED.churn_band, payment_band = EXCLUDED.payment_band, support_band = EXCLUDED.support_band,
       factors = EXCLUDED.factors, computed_at = EXCLUDED.computed_at
     RETURNING *`,
    [customerId, result.modelVersion, result.churnScore, result.paymentScore, result.supportScore,
      result.churnBand, result.paymentBand, result.supportBand, JSON.stringify(result.factors)],
  );
  const changed = ["churn_band", "payment_band", "support_band"].filter((k) => prev && prev[k] !== row[k]);
  if (changed.length) {
    // Bands only: the event log is readable by manage_users, so financial
    // and support detail stays behind their own grants.
    await events.append(null, {
      customerId, source: "customer360", type: "health.band_changed", actorType: "system",
      entityType: "health", entityId: customerId,
      changes: Object.fromEntries(changed.map((k) => [k, { changed: true }])),
      dedupeKey: `health:${customerId}:${row.computed_at.toISOString()}`,
    });
  }
  return row;
}

const STALE_MS = 6 * 60 * 60 * 1000;
async function current(customerId) {
  const { rows: [row] } = await db.query(`SELECT * FROM customer_health_scores WHERE customer_id = $1`, [customerId]);
  if (row && row.model_version === MODEL_VERSION && Date.now() - new Date(row.computed_at).getTime() < STALE_MS) return row;
  return recompute(customerId);
}

/** Shape a stored row for a viewer, hiding scores whose sources they cannot read. */
function present(row, { payments, support }) {
  const view = (name, allowed) => (allowed
    ? { state: "ready", score: row[`${name}_score`], band: row[`${name}_band`], factors: row.factors[name] || [] }
    : { state: "restricted" });
  return {
    advisory: true,
    modelVersion: row.model_version,
    computedAt: row.computed_at,
    churn: view("churn", true),
    payment: view("payment", payments),
    support: view("support", support),
  };
}

/** Event consumer: rescore customers with new (non-derived) events. */
async function refreshFromEvents({ maxCustomers = 200 } = {}) {
  await db.query(`INSERT INTO customer360_event_consumers (consumer) VALUES ('health') ON CONFLICT DO NOTHING`);
  const { rows: [cursor] } = await db.query(`SELECT last_event_id FROM customer360_event_consumers WHERE consumer = 'health'`);
  const { rows } = await db.query(
    `SELECT customer_id, MAX(id) AS max_id FROM (
       SELECT id, customer_id FROM customer_events
        WHERE id > $1 AND event_type NOT LIKE 'health.%' AND event_type NOT LIKE 'admin.customer360\\_%'
        ORDER BY id LIMIT 5000) e
     GROUP BY customer_id ORDER BY MAX(id) LIMIT $2`,
    [cursor.last_event_id, maxCustomers],
  );
  for (const r of rows) await recompute(r.customer_id);
  if (rows.length) {
    await db.query(`UPDATE customer360_event_consumers SET last_event_id = GREATEST(last_event_id, $1), updated_at = NOW() WHERE consumer = 'health'`,
      [rows[rows.length - 1].max_id]);
  }
  return { rescored: rows.length };
}

/** Time-based drift (inactivity grows without events): rescore the oldest. */
async function refreshStale({ limit = 200 } = {}) {
  const { rows } = await db.query(
    `SELECT customer_id FROM customer_health_scores
      WHERE computed_at < NOW() - INTERVAL '24 hours' OR model_version <> $1
      ORDER BY computed_at LIMIT $2`, [MODEL_VERSION, limit]);
  for (const r of rows) await recompute(r.customer_id);
  return { rescored: rows.length };
}

module.exports = { MODEL_VERSION, MODEL, score, rawInputs, recompute, current, present, refreshFromEvents, refreshStale };
