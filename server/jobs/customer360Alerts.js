"use strict";
const db = require("../db");
const service = require("../services/customer360Workspace");
const { sendNotification } = require("../services/notificationService");
const logger = require("../utils/logger");
const { withFencedJobLock } = require("./jobLockingService");
const { mapBounded } = require("../utils/boundedBatch");
// Item 39: rules used to evaluate serially, one rule at a time, so 50
// rules x up to 25 anomaly sends each could take the whole minute. The
// per-rule evaluation now runs with bounded concurrency (5 by default);
// the per-row sends inside one rule stay serial, and the shared tick
// budget is claimed atomically (see claimSend) so the cap stays exact.
const ruleConcurrency = () => Math.max(1, Number(process.env.CUSTOMER360_ALERT_RULE_CONCURRENCY) || 5);
// Item 39: the job never consulted admin_notification_prefs, so an admin
// who turned off incident alerts still got every anomaly alert and its
// digest. Mirror server/jobs/metricThresholdAlerts.js getAdminAlertPrefs:
// the same table, the same opt-out semantics (missing row = defaults ON).
// The customer360 anomaly watch is incident detection, so the gate is
// notify_incidents. There is no customer360-specific column; adding one
// would be a migration plus a Settings UI change, out of scope here.
async function getAdminAlertPrefs(adminId) {
  const { rows } = await db.query(
    `SELECT notify_metric_alerts, notify_disputes, notify_incidents, notify_payout_failures,
            email_notifications, sms_notifications
     FROM admin_notification_prefs WHERE admin_id = $1`,
    [adminId]
  );
  return rows[0] || null;
}
const ANOMALY_KINDS = {
  anomaliesFinancial: ["refund_spike", "payout_failures"],
  anomaliesSecurity: ["new_country_login"],
};
// Global per-tick send cap across all alert rules: without it, 50 rules x
// 25 anomalies could emit 1,250 notifications per minute for as long as a
// storm lasts. Overflow is not dropped: it is rolled into one digest
// notification per admin, and the undelivered anomalies keep their
// not-yet-notified guard, so the next tick retries them.
const tickCap = () => Math.max(1, Number(process.env.CUSTOMER360_ALERT_TICK_CAP) || 100);
function newBudget() {
  return { remaining: tickCap(), overflowByAdmin: new Map() };
}
// Notifications audit item 55: overflow used to be a bare count, so the
// digest could say nothing about what it stood for. Keep the first few
// overflowed records per admin (bounded) so the digest names them.
const MAX_DIGEST_TOP = 5;
function noteOverflow(budget, adminId, detail = null) {
  const entry = budget.overflowByAdmin.get(adminId) || { count: 0, top: [] };
  entry.count += 1;
  if (detail && entry.top.length < MAX_DIGEST_TOP) entry.top.push(detail);
  budget.overflowByAdmin.set(adminId, entry);
}
// Claim one send from the tick budget, synchronously, so concurrent
// rule workers cannot both pass the check and overshoot the cap: the
// check and the decrement happen in one synchronous block, before any
// await. A failed send refunds the claim (the old code decremented
// only on success; claim + refund has the same net effect).
function claimSend(budget) {
  if (!budget) return true;
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  return true;
}
function refundSend(budget) {
  if (budget) budget.remaining += 1;
}
// Platform-wide anomaly watch (customer_id IS NULL): one notification per
// bundled anomaly and status, never per repeat detection.
async function evaluatePlatformAnomalyRule(rule, def, budget = null) {
  const kinds = ANOMALY_KINDS[rule.source];
  if (!kinds) return 0;
  const { rows } = await db.query(
    `SELECT a.id::text AS id, a.status, a.customer_id, a.kind FROM customer_anomalies a JOIN users u ON u.id = a.customer_id
      WHERE a.kind = ANY($1::text[]) AND a.status = ANY($2::text[]) AND a.first_detected_at <= now() - ($3 * interval '1 minute')
        AND lower(u.email) NOT LIKE '%@oxsteed.internal' AND ($4 = 'super_admin' OR u.role NOT IN ('admin', 'super_admin'))
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = $5 AND n.delivery_key = 'customer360-rule:' || $6::text || ':' || a.id || ':' || a.status)
      ORDER BY a.first_detected_at, a.id LIMIT 25`,
    [kinds, rule.statuses, rule.min_age_minutes, rule.role, rule.admin_id, rule.id],
  );
  let sent = 0;
  for (const row of rows) {
    if (!claimSend(budget)) {
      noteOverflow(budget, rule.admin_id, { customer_id: row.customer_id, source: rule.source, kind: row.kind, status: row.status });
      continue;
    }
    const result = await sendNotification({
      userId: rule.admin_id,
      type: "customer360_attention",
      title: "Customer 360 anomaly",
      // Item 55: the per-anomaly notices used to send body "" — the
      // admin got a title and a link and nothing about which anomaly
      // it was. The overflow digest already names its records (see
      // noteOverflow/topText below); name this one the same way.
      body: `Anomaly ${row.kind} is ${row.status} for customer ${row.customer_id} (source: ${rule.source}). Open the anomalies workspace to review it.`,
      action_url: `/admin/customers/${row.customer_id}/360?tab=workspace&area=anomalies`,
      data: { customer_id: row.customer_id, source: rule.source, record_id: row.id, status: row.status, kind: row.kind, area: def.area },
      idempotencyKey: `customer360-rule:${rule.id}:${row.id}:${row.status}`,
    });
    if (result?.success) {
      sent++;
    } else {
      refundSend(budget);
    }
  }
  return sent;
}
// One rule's evaluation. Runs under mapBounded in the tick, so it must
// not assume it is the only rule running: the tick budget is claimed
// atomically (claimSend) and per-admin prefs are read through the
// tick-scoped getPrefs cache, never re-queried per rule.
async function evaluateRule(rule, budget, getPrefs) {
  let sent = 0;
  let skippedByPrefs = 0;
  try {
    if (!["admin", "super_admin"].includes(rule.role)) return { sent, skippedByPrefs };
    // Item 39: honour admin_notification_prefs before doing any work
    // for the rule. A prefs lookup failure fails open (null = defaults
    // ON): a prefs-table outage must not silence anomaly alerts.
    const prefs = await getPrefs(rule.admin_id);
    if (prefs?.notify_incidents === false) {
      skippedByPrefs = 1;
      return { sent, skippedByPrefs };
    }
    const def = service.sources[rule.source],
      req = {
        user: { id: rule.admin_id, role: rule.role },
        params: { userId: rule.customer_id },
      };
    if (!def || !(await service.access(req)(def))) return { sent, skippedByPrefs };
    if (!rule.customer_id) {
      sent += await evaluatePlatformAnomalyRule(rule, def, budget);
      return { sent, skippedByPrefs };
    }
    await service.target(req);
    const { rows } = await db.query(
      `WITH scoped AS (${def.sql}) SELECT s.id,s.status FROM scoped s WHERE s.status=ANY($2::text[]) AND s.occurred_at<=now()-($3*interval '1 minute')
    AND EXISTS(SELECT 1 FROM admin_customer_alert_rules a WHERE a.id=$4 AND a.enabled)
    AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.user_id=$5 AND n.delivery_key='customer360-rule:'||$4::text||':'||s.id||':'||s.status)
    ORDER BY s.occurred_at ASC,s.id LIMIT 25`,
      [
        rule.customer_id,
        rule.statuses,
        rule.min_age_minutes,
        rule.id,
        rule.admin_id,
      ],
    );
    for (const row of rows) {
      if (!claimSend(budget)) {
        noteOverflow(budget, rule.admin_id, { customer_id: rule.customer_id, source: rule.source, status: row.status });
        continue;
      }
      const result = await sendNotification({
        userId: rule.admin_id,
        type: "customer360_attention",
        title: "Customer 360 attention",
        // Item 55: same empty-body gap as the platform path above — name
        // the record (source + status) so the admin knows what it is
        // without opening the link first.
        body: `A ${rule.source} record for this customer is ${row.status}. Open the anomalies workspace to review it.`,
        action_url: `/admin/customers/${rule.customer_id}/360?tab=workspace&area=${encodeURIComponent(def.area)}&source=${rule.source}`,
        data: {
          customer_id: rule.customer_id,
          source: rule.source,
          record_id: row.id,
          status: row.status,
        },
        idempotencyKey: `customer360-rule:${rule.id}:${row.id}:${row.status}`,
      });
      if (result?.success) {
        sent++;
      } else {
        refundSend(budget);
      }
    }
  } catch (error) {
    logger.warn("Customer 360 watch evaluation will retry", {
      source: rule.source,
      code: error.code,
    });
  } finally {
    await db.query(
      "UPDATE admin_customer_alert_rules SET last_evaluated_at=now() WHERE id=$1",
      [rule.id],
    );
  }
  return { sent, skippedByPrefs };
}
async function evaluateCustomer360Alerts() {
  const { rows: rules } = await db.query(
    `SELECT a.*,u.role,u.preferred_language FROM admin_customer_alert_rules a JOIN users u ON u.id=a.admin_id WHERE a.enabled AND u.role IN ('admin','super_admin') AND COALESCE(u.totp_enabled,false)=true AND u.is_active=true AND COALESCE(u.is_banned,false)=false AND COALESCE(u.is_suspended,false)=false ORDER BY a.last_evaluated_at ASC NULLS FIRST,a.id LIMIT 50`,
  );
  const budget = newBudget();
  // Per-tick prefs cache: one admin's rules share one lookup, and the
  // digest below reuses the same answers instead of querying again.
  // The PROMISE is cached, not the resolved row: concurrent rules for
  // one admin would otherwise each fire a lookup before the first one
  // resolves (cache stampede).
  const prefsCache = new Map();
  const getPrefs = (adminId) => {
    if (!prefsCache.has(adminId)) {
      prefsCache.set(adminId, getAdminAlertPrefs(adminId).catch((error) => {
        logger.warn("Customer 360 admin prefs lookup failed, using defaults", { adminId, code: error.code });
        return null;
      }));
    }
    return prefsCache.get(adminId);
  };
  // Item 39: per-rule evaluation runs with bounded concurrency instead
  // of serially. The per-row sends inside one rule stay serial, and the
  // shared budget is claimed atomically, so the cap stays exact.
  const results = await mapBounded(rules, ruleConcurrency(), (rule) => evaluateRule(rule, budget, getPrefs));
  let sent = 0;
  let skippedByPrefs = 0;
  for (const result of results) {
    sent += result.sent;
    skippedByPrefs += result.skippedByPrefs;
  }
  // One digest per admin for everything the cap held back this tick. The
  // minute-bucketed key keeps it to one digest per admin per tick while a
  // storm lasts, instead of one notification per held-back anomaly.
  // Notifications audit item 55: the digest used to carry an empty body,
  // no link, and data of only {overflow, digest:true}. It now names the
  // held-back count and the top overflowed records, and links to the
  // anomalies workspace.
  let digested = 0;
  for (const [adminId, overflow] of budget.overflowByAdmin) {
    // Item 39: the digest honours admin_notification_prefs too — an
    // admin who opted out of incident alerts gets no digest either.
    // Re-checked fresh here, not from the rule-phase cache, so an
    // opt-out flipped mid-tick is honoured before the summary goes
    // out. A lookup failure fails open (defaults ON), as above.
    let prefs = null;
    try {
      prefs = await getAdminAlertPrefs(adminId);
    } catch (error) {
      logger.warn("Customer 360 digest prefs lookup failed, using defaults", { adminId, code: error.code });
    }
    if (prefs?.notify_incidents === false) {
      skippedByPrefs++;
      continue;
    }
    const count = overflow.count;
    const top = overflow.top || [];
    const topText = top
      .map((t) => [t.kind || t.status, t.customer_id ? `customer ${t.customer_id}` : null, t.source].filter(Boolean).join(' '))
      .join('; ');
    const body = `${count} anomal${count === 1 ? 'y was' : 'ies were'} held back by the per-tick cap${topText ? `. Top: ${topText}` : ''}. They will be retried on the next tick.`;
    const result = await sendNotification({
      userId: adminId,
      type: "customer360_attention",
      title: "Customer 360 anomaly digest",
      body,
      action_url: "/admin/customer360/anomalies",
      data: { overflow: count, digest: true, top },
      idempotencyKey: `customer360-digest:${adminId}:${Math.floor(Date.now() / 60000)}`,
    });
    if (result?.success) digested++;
  }
  return { sent, digested, overflow: [...budget.overflowByAdmin.values()].reduce((a, b) => a + b.count, 0), skippedByPrefs };
}
const JOB_NAME = "customer360-alerts";

// Notifications audit item 29: the starter ran bare with only an
// in-process guard, so two replicas could evaluate the same tick and
// double-notify (the cap is per-process). Each tick now runs under the
// fenced job lock, like the outboxes: a tick that cannot acquire the lock
// is skipped (the lock helper logs it), and a lease lost mid-run fences
// the rest of that tick. TTL 60s matches the 60s cadence.
async function runCustomer360AlertsTick() {
  return withFencedJobLock(JOB_NAME, async () => evaluateCustomer360Alerts(), 60);
}

function startCustomer360Alerts() {
  if (process.env.CUSTOMER360_ALERTS_ENABLED === "false") return { stop() {} };
  let stopped = false,
    running = null;
  const tick = () => {
    if (stopped) return;
    if (running) {
      // Notifications audit item 39: an overrun tick used to return
      // silently, so a stalled evaluation was invisible. Log the skip
      // (the in-process guard stays: the fence in item 29 covers the
      // cross-replica case, this covers the overlap inside one process).
      logger.warn('Customer 360 alerts tick skipped: previous tick still running');
      return;
    }
    running = runCustomer360AlertsTick()
      .catch((error) =>
        logger.warn("Customer 360 alerts will retry", { code: error.code }),
      )
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(tick, 60000);
  timer.unref?.();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      return running;
    },
  };
}
module.exports = { evaluateCustomer360Alerts, evaluatePlatformAnomalyRule, startCustomer360Alerts, runCustomer360AlertsTick };
