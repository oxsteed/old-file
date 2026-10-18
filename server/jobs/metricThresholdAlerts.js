"use strict";

/**
 * Metric threshold alerts (analytics platform, Phase 2, Item 9).
 *
 * Scheduled evaluator over metric_alert_rules. Structure mirrors
 * server/jobs/customer360Alerts.js: per-admin loop with try/catch, skip
 * disabled admins, last_evaluated_at bookkeeping, and delivery_key
 * idempotency on the notifications table.
 *
 * Semantics per rule:
 *  - Compute the metric through the registry's canonical definition
 *    (server/analytics/metricAlerts.js).
 *  - If the value crosses (operator, threshold) and the rule has not fired
 *    within cooldown_minutes, deliver on the rule's enabled channels.
 *  - Idempotency: one notification per (rule_id, cooldown window). The
 *    window bucket is derived from the cooldown, so a crash/restart between
 *    evaluation and the notifications INSERT cannot double-deliver: the
 *    uq_notifications_delivery_key unique index dedupes the retry.
 *  - Admin prefs gate (wires the dead admin_notification_prefs toggles):
 *    notify_metric_alerts === false skips the rule entirely (opt-out,
 *    default TRUE for admins with no row); channel_email requires
 *    email_notifications !== false; channel_sms requires
 *    sms_notifications === true.
 *  - v1 evaluates platform-wide for every admin. Per-admin data scoping
 *    (scopeModel.js) is NOT applied: the registry's canonical definitions
 *    have no per-admin dimension, so there is nothing to scope a platform
 *    admin's rule to. Documented in docs/analytics-platform/PROGRESS.md.
 */

const db = require("../db");
const { sendNotification } = require("../services/notificationService");
const smsNotificationService = require("../services/smsNotificationService");
const {
  computeMetricValue,
  compareValues,
  formatValue,
} = require("../analytics/metricAlerts");
const { formatAlertBody } = require("../utils/metricAlertNotificationCopy");
const logger = require("../utils/logger");

async function getAdminAlertPrefs(adminId) {
  const { rows } = await db.query(
    `SELECT notify_metric_alerts, email_notifications, sms_notifications
     FROM admin_notification_prefs WHERE admin_id = $1`,
    [adminId]
  );
  return rows[0] || null;
}

function deliveryWindowBucket(cooldownMinutes) {
  const windowMs = Math.max(1, cooldownMinutes) * 60000;
  return Math.floor(Date.now() / windowMs);
}

async function deliverRule(rule, prefs, value) {
  const threshold = Number(rule.threshold);
  const title = null; // tNotif('metric_threshold_alert') resolves the localized title
  const body = formatAlertBody(rule.preferred_language, {
    metric: rule.metric_name,
    operator: rule.operator,
    threshold: formatValue(rule.metric_name, threshold),
    value: formatValue(rule.metric_name, value),
  });
  const bucket = deliveryWindowBucket(rule.cooldown_minutes);
  const deliveryKey = `metric-alert:${rule.id}:${bucket}`;

  const emailAllowed =
    rule.channel_email === true && prefs?.email_notifications !== false;

  let delivered = false;
  if (rule.channel_in_app === true || emailAllowed) {
    const result = await sendNotification({
      userId: rule.admin_id,
      type: "metric_threshold_alert",
      title,
      body,
      action_url: "/admin/settings?tab=metric-alerts",
      data: {
        rule_id: rule.id,
        metric_name: rule.metric_name,
        operator: rule.operator,
        threshold,
        value,
      },
      idempotencyKey: deliveryKey,
      emailChannel: emailAllowed,
    });
    if (result?.success) delivered = true;
  }

  // SMS is a supplementary channel: best-effort, never fails the rule.
  if (
    rule.channel_sms === true &&
    prefs?.sms_notifications === true &&
    rule.phone &&
    smsNotificationService.isTwilioConfigured()
  ) {
    try {
      const sms = await smsNotificationService.sendConfiguredSMS(
        rule.phone,
        body
      );
      if (sms?.success) delivered = true;
    } catch (error) {
      logger.warn("Metric alert SMS skipped", {
        ruleId: rule.id,
        code: error.code || error.message,
      });
    }
  }
  return delivered;
}

async function evaluateMetricThresholdAlerts() {
  const { rows: rules } = await db.query(
    `SELECT r.*, u.role, u.preferred_language, u.phone
     FROM metric_alert_rules r
     JOIN users u ON u.id = r.admin_id
     WHERE r.is_active
       AND u.role IN ('admin','super_admin')
       AND COALESCE(u.totp_enabled, false) = true
       AND u.is_active = true
       AND COALESCE(u.is_banned, false) = false
       AND COALESCE(u.is_suspended, false) = false
     ORDER BY r.last_evaluated_at ASC NULLS FIRST, r.id
     LIMIT 50`
  );
  let sent = 0;
  let skippedByPrefs = 0;
  for (const rule of rules) {
    let fired = false;
    let value = null;
    try {
      if (!["admin", "super_admin"].includes(rule.role)) continue;

      // Wire the dead admin_notification_prefs toggles: the master
      // notify_metric_alerts switch gates the rule; missing row = defaults
      // (opt-out semantics, matching the existing !== false convention).
      const prefs = await getAdminAlertPrefs(rule.admin_id);
      if (prefs?.notify_metric_alerts === false) {
        skippedByPrefs++;
        continue;
      }

      value = await computeMetricValue(db, rule.metric_name, rule.params || {});
      if (value == null) continue; // e.g. NULL take-rate on zero GMV: no comparison possible
      if (!compareValues(rule.operator, value, Number(rule.threshold))) continue;

      // Cooldown: at most one fire per cooldown_minutes.
      if (rule.last_fired_at) {
        const sinceFire = Date.now() - new Date(rule.last_fired_at).getTime();
        if (sinceFire < rule.cooldown_minutes * 60000) continue;
      }

      if (await deliverRule(rule, prefs, value)) {
        fired = true;
        sent++;
      }
    } catch (error) {
      logger.warn("Metric threshold alert evaluation will retry", {
        ruleId: rule.id,
        metric: rule.metric_name,
        code: error.code,
      });
    } finally {
      await db.query(
        `UPDATE metric_alert_rules
         SET last_evaluated_at = now(),
             last_value = $2,
             last_fired_at = CASE WHEN $3 THEN now() ELSE last_fired_at END
         WHERE id = $1`,
        [rule.id, value, fired]
      );
    }
  }
  return { sent, evaluated: rules.length, skippedByPrefs };
}

function startMetricThresholdAlerts() {
  if (process.env.METRIC_ALERTS_ENABLED === "false") return { stop() {} };
  let stopped = false,
    running = null;
  const tick = () => {
    if (stopped || running) return;
    running = evaluateMetricThresholdAlerts()
      .catch((error) =>
        logger.warn("Metric threshold alerts will retry", { code: error.code })
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

module.exports = { evaluateMetricThresholdAlerts, startMetricThresholdAlerts };
