"use strict";
/**
 * Customer 360 upgrade 11: the customer-facing "your data" view and the
 * Customer 360 part of the self-serve export and erasure.
 *
 * Categories mirror the admin workspace areas exactly: they are derived from
 * the same source definitions (customer360Sources), so a new admin source
 * appears here automatically. Staff-internal records (admin actions, staff
 * tasks, fraud/anomaly reviews, duplicate-account signals) are disclosed as a
 * category without counts or contents, because itemizing them would reveal
 * fraud-prevention work; they are retained under that legal basis.
 */
const db = require("../db");
const { sources } = require("./customer360Sources");

const INTERNAL_SOURCES = new Set(["adminActions", "tasks", "anomaliesFinancial", "anomaliesSecurity"]);
const EXPORT_ROW_CAP = 100000;
const CONCURRENCY = 6;
// What happens to each area when the account is erased (privacyRetentionService.eraseUser).
const ON_ERASURE = {
  work: "anonymized", finance: "retained", restaurants: "retained", commerce: "retained", business: "retained",
  devices: "retained", credit: "retained", restaurantCredit: "retained", documents: "retained", subscriptions: "retained",
  logistics: "retained", support: "anonymized", communications: "anonymized", privacy: "retained", trust: "retained",
  security: "retained", cases: "retained",
  events: "retained", scores: "removed", lifecycle: "removed", contactHistory: "anonymized", playbooks: "anonymized",
  queues: "anonymized", summaries: "removed", securityReviews: "retained",
};
const HIDDEN_EVENT = /^(anomaly|link_review|links|signal|queue|admin)[._]/;

function customerSources() {
  return Object.entries(sources).filter(([key]) => !INTERNAL_SOURCES.has(key));
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function countSource(def, userId) {
  try {
    const { rows: [r] } = await db.query(`SELECT COUNT(*)::int AS n, MAX(occurred_at) AS last_at FROM (${def.sql}) s`, [userId]);
    return { n: r.n, lastAt: r.last_at, ok: true };
  } catch {
    return { n: 0, lastAt: null, ok: false };
  }
}

async function derivedCounts(userId) {
  const { rows: [r] } = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM customer_events WHERE customer_id = $1) AS events,
            (SELECT MAX(occurred_at) FROM customer_events WHERE customer_id = $1) AS events_at,
            (SELECT COUNT(*)::int FROM customer_health_scores WHERE customer_id = $1) AS scores,
            (SELECT MAX(computed_at) FROM customer_health_scores WHERE customer_id = $1) AS scores_at,
            (SELECT COUNT(*)::int FROM customer_lifecycle WHERE customer_id = $1) AS lifecycle,
            (SELECT MAX(computed_at) FROM customer_lifecycle WHERE customer_id = $1) AS lifecycle_at,
            (SELECT COUNT(*)::int FROM customer_outbound_messages WHERE customer_id = $1) AS contact,
            (SELECT MAX(created_at) FROM customer_outbound_messages WHERE customer_id = $1) AS contact_at,
            (SELECT COUNT(*)::int FROM customer_playbook_runs WHERE customer_id = $1) AS playbooks,
            (SELECT MAX(created_at) FROM customer_playbook_runs WHERE customer_id = $1) AS playbooks_at,
            (SELECT COUNT(*)::int FROM customer360_queue_items WHERE customer_id = $1) AS queues,
            (SELECT MAX(created_at) FROM customer360_queue_items WHERE customer_id = $1) AS queues_at,
            ${summaryTableSql()}`, [userId]);
  return r;
}
// Upgrade 12 adds customer360_summaries; tolerate its absence during rollout.
let summariesExist = null;
function summaryTableSql() {
  return summariesExist
    ? `(SELECT COUNT(*)::int FROM customer360_summaries WHERE customer_id = $1) AS summaries,
       (SELECT MAX(computed_at) FROM customer360_summaries WHERE customer_id = $1) AS summaries_at`
    : `0 AS summaries, NULL::timestamptz AS summaries_at`;
}
async function probeSummaries(runner = db) {
  if (summariesExist !== null) return;
  try {
    const result = await runner.query(`SELECT to_regclass('public.customer360_summaries') IS NOT NULL AS ok`);
    if (result?.rows?.[0]?.ok === true) summariesExist = true;
    else return false;
  } catch {
    return false;
  }
}

/** The categories shown on the customer's "your data" page. */
async function categories(userId) {
  const list = customerSources();
  const counts = await mapLimit(list, CONCURRENCY, ([, def]) => countSource(def, userId));
  const areas = new Map();
  list.forEach(([, def], i) => {
    const a = areas.get(def.area) || { key: def.area, group: "account", count: 0, lastAt: null, complete: true };
    a.count += counts[i].n;
    a.complete = a.complete && counts[i].ok;
    if (counts[i].lastAt && (!a.lastAt || new Date(counts[i].lastAt) > new Date(a.lastAt))) a.lastAt = counts[i].lastAt;
    areas.set(def.area, a);
  });
  await probeSummaries();
  const d = await derivedCounts(userId);
  const derived = [
    ["events", d.events, d.events_at], ["scores", d.scores, d.scores_at], ["lifecycle", d.lifecycle, d.lifecycle_at],
    ["contactHistory", d.contact, d.contact_at], ["playbooks", d.playbooks, d.playbooks_at], ["queues", d.queues, d.queues_at],
    ["summaries", d.summaries, d.summaries_at],
  ].map(([key, count, lastAt]) => ({ key, group: "derived", count, lastAt, complete: true }));
  // Areas made only of staff-internal sources are described, never counted.
  for (const def of Object.values(sources)) {
    if (!areas.has(def.area)) areas.set(def.area, { key: def.area, group: "internal", count: null, lastAt: null, complete: true });
  }
  return [
    ...[...areas.values()],
    ...derived,
    { key: "securityReviews", group: "internal", count: null, lastAt: null, complete: true },
  ].map((c) => ({ ...c, export: c.group === "internal" ? "described" : "included", onErasure: ON_ERASURE[c.key] || "retained" }));
}

function capped(section, rows) {
  if (rows.length > EXPORT_ROW_CAP) {
    throw Object.assign(new Error("privacy_export_result_limit_exceeded"), { code: "EXPORT_RESULT_LIMIT_EXCEEDED", section });
  }
  return rows;
}

/** Customer 360 sections of the verified self-serve export (routes/privacy.js). */
async function exportData(conn, userId) {
  const records = {};
  for (const [key, def] of customerSources()) {
    let rows;
    try {
      ({ rows } = await conn.query(
        `SELECT id, label, status, occurred_at FROM (${def.sql}) s ORDER BY occurred_at NULLS LAST, id LIMIT ${EXPORT_ROW_CAP + 1}`, [userId]));
    } catch {
      continue;
    }
    if (!rows.length) continue;
    (records[def.area] = records[def.area] || {})[key] = capped(`customer360.${key}`, rows);
  }
  const q = async (section, sql) => capped(section, (await conn.query(sql, [userId])).rows);
  const events = (await q("customer360_events",
    `SELECT occurred_at, source, event_type, actor_type, entity_type FROM customer_events
      WHERE customer_id = $1 AND source <> 'admin_audit' ORDER BY occurred_at, id LIMIT ${EXPORT_ROW_CAP + 1}`))
    .filter((e) => !HIDDEN_EVENT.test(e.event_type));
  return {
    customer360_records: records,
    customer360_events: events,
    customer360_scores: await q("customer360_scores",
      `SELECT model_version, churn_score, payment_score, support_score, churn_band, payment_band, support_band, factors, computed_at
         FROM customer_health_scores WHERE customer_id = $1`),
    customer360_lifecycle: await q("customer360_lifecycle",
      `SELECT model_version, stage, country, cohort_month, first_transaction_at, last_transaction_at, transactions_90d, stage_since, computed_at
         FROM customer_lifecycle WHERE customer_id = $1`),
    customer360_contact_history: await q("customer360_contact_history",
      `SELECT channel, language, subject, COALESCE(body, body_preview) AS body, recipient_masked, status, created_at
         FROM customer_outbound_messages WHERE customer_id = $1 ORDER BY created_at LIMIT ${EXPORT_ROW_CAP + 1}`),
    customer360_playbooks: await q("customer360_playbooks",
      `SELECT r.playbook_key, r.status, r.created_at, r.closed_at,
              COALESCE(json_agg(json_build_object('step', s.step_key, 'status', s.status, 'completedAt', s.completed_at) ORDER BY s.position)
                FILTER (WHERE s.run_id IS NOT NULL), '[]') AS steps
         FROM customer_playbook_runs r LEFT JOIN customer_playbook_run_steps s ON s.run_id = r.id
        WHERE r.customer_id = $1 GROUP BY r.id ORDER BY r.created_at LIMIT ${EXPORT_ROW_CAP + 1}`),
    customer360_queue_items: await q("customer360_queue_items",
      `SELECT q.name AS queue, i.status, i.created_at, i.due_at, i.resolved_at, i.resolution
         FROM customer360_queue_items i JOIN customer360_queues q ON q.id = i.queue_id
        WHERE i.customer_id = $1 AND i.topic = 'general' ORDER BY i.created_at LIMIT ${EXPORT_ROW_CAP + 1}`),
    customer360_internal_records:
      "Fraud-prevention and staff review records are kept under that legal basis and are not itemized. Contact support to ask about them.",
  };
}

/** Customer 360 part of erasure. Runs inside the caller's transaction. */
async function erase(conn, userId) {
  const n = async (sql) => (await conn.query(sql, [userId])).rowCount;
  const summary = {
    customer_identity_signals: await n(`DELETE FROM customer_identity_signals WHERE user_id = $1`),
    customer_health_scores: await n(`DELETE FROM customer_health_scores WHERE customer_id = $1`),
    customer_lifecycle: await n(`DELETE FROM customer_lifecycle WHERE customer_id = $1`),
    customer_outbound_messages: await n(
      `UPDATE customer_outbound_messages SET subject = NULL, body = NULL, body_preview = '[erased]', recipient_masked = '[erased]', erased_at = NOW()
        WHERE customer_id = $1 AND erased_at IS NULL`),
    customer_playbook_run_steps: await n(
      `UPDATE customer_playbook_run_steps SET note = NULL, result = '{}'::jsonb
        WHERE run_id IN (SELECT id FROM customer_playbook_runs WHERE customer_id = $1) AND (note IS NOT NULL OR result <> '{}'::jsonb)`),
    customer360_queue_items: await n(
      `UPDATE customer360_queue_items SET reason = NULL, resolution_note = NULL
        WHERE customer_id = $1 AND (reason IS NOT NULL OR resolution_note IS NOT NULL)`),
    customer_anomalies: await n(`UPDATE customer_anomalies SET evidence = '{}'::jsonb WHERE customer_id = $1 AND evidence <> '{}'::jsonb`),
  };
  await probeSummaries(conn);
  if (summariesExist) summary.customer360_summaries = await n(`DELETE FROM customer360_summaries WHERE customer_id = $1`);
  return summary;
}

module.exports = { INTERNAL_SOURCES, ON_ERASURE, categories, exportData, erase, customerSources };
