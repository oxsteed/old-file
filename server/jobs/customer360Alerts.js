"use strict";
const db = require("../db");
const service = require("../services/customer360Workspace");
const { sendNotification } = require("../services/notificationService");
const logger = require("../utils/logger");
async function evaluateCustomer360Alerts() {
  const { rows: rules } = await db.query(
    `SELECT a.*,u.role,u.preferred_language FROM admin_customer_alert_rules a JOIN users u ON u.id=a.admin_id WHERE a.enabled AND u.role IN ('admin','super_admin') AND COALESCE(u.totp_enabled,false)=true AND u.is_active=true AND COALESCE(u.is_banned,false)=false AND COALESCE(u.is_suspended,false)=false ORDER BY a.last_evaluated_at ASC NULLS FIRST,a.id LIMIT 50`,
  );
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
        if (result?.success) sent++;
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
  return { sent };
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
module.exports = { evaluateCustomer360Alerts, startCustomer360Alerts };
