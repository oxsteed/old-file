"use strict";
const db = require("../db");
const service = require("../services/customer360Workspace");
const { sendNotification } = require("../services/notificationService");
const logger = require("../utils/logger");
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
function noteOverflow(budget, adminId, count = 1) {
  budget.overflowByAdmin.set(adminId, (budget.overflowByAdmin.get(adminId) || 0) + count);
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
    if (budget && budget.remaining <= 0) {
      noteOverflow(budget, rule.admin_id);
      continue;
    }
    const result = await sendNotification({
      userId: rule.admin_id,
      type: "customer360_attention",
      title: "Customer 360 anomaly",
      body: "",
      action_url: `/admin/customers/${row.customer_id}/360?tab=workspace&area=anomalies`,
      data: { customer_id: row.customer_id, source: rule.source, record_id: row.id, status: row.status, kind: row.kind, area: def.area },
      idempotencyKey: `customer360-rule:${rule.id}:${row.id}:${row.status}`,
    });
    if (result?.success) {
      sent++;
      if (budget) budget.remaining -= 1;
    }
  }
  return sent;
}
async function evaluateCustomer360Alerts() {
  const { rows: rules } = await db.query(
    `SELECT a.*,u.role,u.preferred_language FROM admin_customer_alert_rules a JOIN users u ON u.id=a.admin_id WHERE a.enabled AND u.role IN ('admin','super_admin') AND COALESCE(u.totp_enabled,false)=true AND u.is_active=true AND COALESCE(u.is_banned,false)=false AND COALESCE(u.is_suspended,false)=false ORDER BY a.last_evaluated_at ASC NULLS FIRST,a.id LIMIT 50`,
  );
  const budget = newBudget();
  let sent = 0;
  for (const rule of rules) {
    try {
      if (!["admin", "super_admin"].includes(rule.role)) continue;
      const def = service.sources[rule.source],
        req = {
          user: { id: rule.admin_id, role: rule.role },
          params: { userId: rule.customer_id },
        };
      if (!def || !(await service.access(req)(def))) continue;
      if (!rule.customer_id) {
        sent += await evaluatePlatformAnomalyRule(rule, def, budget);
        continue;
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
        if (budget.remaining <= 0) {
          noteOverflow(budget, rule.admin_id);
          continue;
        }
        const result = await sendNotification({
          userId: rule.admin_id,
          type: "customer360_attention",
          title: "Customer 360 attention",
          body: "",
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
          budget.remaining -= 1;
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
  }
  // One digest per admin for everything the cap held back this tick. The
  // minute-bucketed key keeps it to one digest per admin per tick while a
  // storm lasts, instead of one notification per held-back anomaly.
  let digested = 0;
  for (const [adminId, overflow] of budget.overflowByAdmin) {
    const result = await sendNotification({
      userId: adminId,
      type: "customer360_attention",
      title: "Customer 360 anomaly digest",
      body: "",
      data: { overflow, digest: true },
      idempotencyKey: `customer360-digest:${adminId}:${Math.floor(Date.now() / 60000)}`,
    });
    if (result?.success) digested++;
  }
  return { sent, digested, overflow: [...budget.overflowByAdmin.values()].reduce((a, b) => a + b, 0) };
}
function startCustomer360Alerts() {
  if (process.env.CUSTOMER360_ALERTS_ENABLED === "false") return { stop() {} };
  let stopped = false,
    running = null;
  const tick = () => {
    if (stopped || running) return;
    running = evaluateCustomer360Alerts()
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
module.exports = { evaluateCustomer360Alerts, evaluatePlatformAnomalyRule, startCustomer360Alerts };
