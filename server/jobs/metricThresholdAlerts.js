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
  computeMetricObservation,
  compareValues,
  formatValue,
  ALERTABLE_METRICS,
} = require("../analytics/metricAlerts");
const { formatAlertBody } = require("../utils/metricAlertNotificationCopy");
const logger = require("../utils/logger");
const { assertMetricAccess } = require('../analytics/metricAccess');

async function getAdminAlertPrefs(adminId) {
  const { rows } = await db.query(
    `SELECT notify_metric_alerts, notify_disputes, notify_incidents, notify_payout_failures,
            email_notifications, sms_notifications
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
    threshold: formatValue(rule.metric_name, threshold, rule.params, rule.preferred_language),
    value: formatValue(rule.metric_name, value, rule.params, rule.preferred_language),
    comparison: rule.params?.comparison,
  });
  const bucket = deliveryWindowBucket(rule.cooldown_minutes);
  const deliveryKey = `metric-alert:${rule.id}:${new Date(rule.updated_at).getTime()}:${bucket}`;

  const emailAllowed =
    rule.channel_email === true && prefs?.email_notifications !== false;

  let delivered = false;
  if (rule.channel_in_app === true || emailAllowed) {
    const daysPeriod = { 1:'1d',7:'7d',30:'30d',90:'90d' }[rule.params?.days];
    const evidenceQuery = { metric:rule.metric_name,period:daysPeriod || rule.params?.period || '30d',evidence:true };
    const result = await sendNotification({
      userId: rule.admin_id,
      type: "metric_threshold_alert",
      title,
      body,
      action_url: rule.params?.days && !daysPeriod ? '/admin/settings?tab=metric-alerts'
        : `/admin/analytics/query-builder?q=${encodeURIComponent(JSON.stringify(evidenceQuery))}`,
      data: {
        rule_id: rule.id,
        metric_name: rule.metric_name,
        operator: rule.operator,
        threshold,
        value, comparison: rule.params?.comparison || 'absolute',
      },
      idempotencyKey: deliveryKey,
      emailChannel: emailAllowed,
      inAppChannel: rule.channel_in_app === true,
      pushChannel: rule.channel_in_app === true,
    });
    if (result?.success && result.delivered !== false) delivered = true;
  }

  // SMS is a supplementary channel: best-effort, never fails the rule.
  if (
    rule.channel_sms === true &&
    prefs?.sms_notifications === true &&
    rule.phone &&
    smsNotificationService.isTwilioConfigured()
  ) {
    const claim = await db.query(`INSERT INTO metric_alert_sms_claims(delivery_key,rule_id,status)
      VALUES($1,$2,'sending') ON CONFLICT DO NOTHING RETURNING delivery_key`, [deliveryKey, rule.id]);
    if (!claim.rows.length) return delivered;
    try {
      const sms = await smsNotificationService.sendConfiguredSMS(
        rule.phone,
        body
      );
      if (sms?.success) delivered = true;
      await db.query(`UPDATE metric_alert_sms_claims SET status=$2,updated_at=NOW() WHERE delivery_key=$1`,
        [deliveryKey, sms?.success ? 'sent' : 'uncertain']);
    } catch (error) {
      await db.query(`UPDATE metric_alert_sms_claims SET status='uncertain',updated_at=NOW() WHERE delivery_key=$1`, [deliveryKey]);
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
    let lockClient = null;
    let locked = false;
    try {
      // Hold a session lock across external delivery. A second worker skips
      // this rule, then reloads its cooldown on the next evaluation.
      lockClient = await db.connect();
      const lock = await lockClient.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [`metric-alert:${rule.id}`]);
      locked = lock.rows[0]?.locked === true;
      if (!locked) continue;
      const fresh = await db.query('SELECT last_fired_at, is_active, updated_at FROM metric_alert_rules WHERE id=$1', [rule.id]);
      if (!fresh.rows[0]?.is_active || new Date(fresh.rows[0].updated_at).getTime() !== new Date(rule.updated_at).getTime()) continue;
      rule.last_fired_at = fresh.rows[0].last_fired_at;
      if (!["admin", "super_admin"].includes(rule.role)) continue;
      await assertMetricAccess({ id: rule.admin_id, role: rule.role }, rule.metric_name);

      // Wire the dead admin_notification_prefs toggles: the master
      // notify_metric_alerts switch gates the rule; missing row = defaults
      // (opt-out semantics, matching the existing !== false convention).
      const prefs = await getAdminAlertPrefs(rule.admin_id);
      const category = ALERTABLE_METRICS[rule.metric_name]?.preference;
      if (prefs?.notify_metric_alerts === false || (category && prefs?.[category] === false)) {
        skippedByPrefs++;
        continue;
      }

      await lockClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await lockClient.query("SET LOCAL statement_timeout='30s'");
      const observation = await computeMetricObservation(lockClient, rule.metric_name, rule.params || {});
      await lockClient.query('COMMIT');
      value = observation.compared;
      const crossed = value != null && compareValues(rule.operator, value, Number(rule.threshold));
      await db.query(`INSERT INTO metric_alert_observations(rule_id,value,previous_value,compared_value,crossed,metric_name,params,rule_updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [rule.id, observation.value, observation.previous, value, crossed,
          rule.metric_name,JSON.stringify(rule.params || {}),rule.updated_at]);
      if (value == null) continue; // e.g. NULL take-rate on zero GMV: no comparison possible
      if (!crossed) continue;

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
      if (lockClient) await lockClient.query('ROLLBACK').catch(() => {});
      logger.warn("Metric threshold alert evaluation will retry", {
        ruleId: rule.id,
        metric: rule.metric_name,
        code: error.code,
      });
    } finally {
      try { if (locked) await db.query(
        `UPDATE metric_alert_rules
         SET last_evaluated_at = now(),
             last_value = $2,
             last_fired_at = CASE WHEN $3 THEN now() ELSE last_fired_at END
         WHERE id = $1`,
        [rule.id, value, fired]
      ); } finally {
        try {
          if (locked) await lockClient.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`metric-alert:${rule.id}`]);
        } finally { lockClient?.release(); }
      }
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
