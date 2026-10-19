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
 *  - Idempotency: each fire is claimed durably (metric_alert_fires +
 *    last_fired_at, committed) before any channel is contacted, so a crash
 *    mid-delivery cannot repeat the alert in a later cooldown bucket. The
 *    notification delivery key is derived from the claimed fire, and SMS
 *    keeps its own at-most-once claim ('sending' -> 'sent'/'failed', or
 *    'uncertain' when the outcome is unknown; uncertain is never resent).
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
const { regionScopedDb } = require('../analytics/regionScope');

async function getAdminAlertPrefs(adminId) {
  const { rows } = await db.query(
    `SELECT notify_metric_alerts, notify_disputes, notify_incidents, notify_payout_failures,
            email_notifications, sms_notifications
     FROM admin_notification_prefs WHERE admin_id = $1`,
    [adminId]
  );
  return rows[0] || null;
}

// A 'sending' SMS claim older than this was interrupted mid-delivery. The
// provider may already have accepted it, so it becomes 'uncertain' and is
// never resent automatically.
const STALE_SMS_CLAIM_MINUTES = 10;

async function markStaleSmsClaims() {
  await db.query(
    `UPDATE metric_alert_sms_claims SET status='uncertain', updated_at=NOW()
      WHERE status='sending' AND updated_at < NOW() - make_interval(mins => $1)`,
    [STALE_SMS_CLAIM_MINUTES]
  );
}

/**
 * Claim one fire for a rule before contacting any channel. The claim is a
 * committed row plus last_fired_at, so the cooldown holds even if this
 * process dies mid-delivery: an interrupted fire is never repeated in a
 * later cooldown bucket (at-most-once per cooldown). Returns null when the
 * rule was edited, deactivated, or already fired within its cooldown.
 */
async function claimFire(rule, value) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      `UPDATE metric_alert_rules SET last_fired_at = date_trunc('milliseconds', NOW())
        WHERE id = $1 AND is_active
          AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
          AND (last_fired_at IS NULL OR last_fired_at <= NOW() - make_interval(mins => cooldown_minutes))
        RETURNING last_fired_at`,
      [rule.id, rule.updated_at]
    );
    if (!claimed.rows.length) { await client.query('ROLLBACK'); return null; }
    const fire = await client.query(
      `INSERT INTO metric_alert_fires(rule_id, rule_updated_at, claimed_at, value)
       VALUES ($1, $2, $3, $4) RETURNING id, claimed_at`,
      [rule.id, rule.updated_at, claimed.rows[0].last_fired_at, value]
    );
    await client.query('COMMIT');
    return { id: fire.rows[0].id, claimedAt: fire.rows[0].claimed_at, previousFiredAt: rule.last_fired_at || null };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function resolveFire(rule, fire, delivered) {
  await db.query(
    `UPDATE metric_alert_fires SET status=$2, resolved_at=NOW() WHERE id=$1`,
    [fire.id, delivered ? 'delivered' : 'not_delivered']
  );
  // Nothing reached the admin on any channel (every channel was disabled by
  // preference or definitively rejected): release the cooldown so the next
  // evaluation can try again. An exception keeps the claim (fail safe).
  if (!delivered) {
    await db.query(
      `UPDATE metric_alert_rules SET last_fired_at = $3
        WHERE id = $1 AND last_fired_at = $2`,
      [rule.id, fire.claimedAt, fire.previousFiredAt]
    );
  }
}

async function deliverRule(rule, prefs, value, fire) {
  const threshold = Number(rule.threshold);
  const title = null; // tNotif('metric_threshold_alert') resolves the localized title
  const body = formatAlertBody(rule.preferred_language, {
    metric: rule.metric_name,
    operator: rule.operator,
    threshold: formatValue(rule.metric_name, threshold, rule.params, rule.preferred_language),
    value: formatValue(rule.metric_name, value, rule.params, rule.preferred_language),
    comparison: rule.params?.comparison,
  });
  // One key per claimed fire: stable for retries of this fire, distinct for
  // the next fire after the cooldown.
  const deliveryKey = `metric-alert:${rule.id}:${new Date(rule.updated_at).getTime()}:${fire.id}`;

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
    // Another worker still mid-send for this rule (or a crashed send not yet
    // swept to 'uncertain') blocks a parallel SMS.
    const inFlight = await db.query(
      `SELECT 1 FROM metric_alert_sms_claims WHERE rule_id=$1 AND status='sending' LIMIT 1`, [rule.id]);
    if (inFlight.rows.length) return delivered;
    const claim = await db.query(`INSERT INTO metric_alert_sms_claims(delivery_key,rule_id,status)
      VALUES($1,$2,'sending') ON CONFLICT DO NOTHING RETURNING delivery_key`, [deliveryKey, rule.id]);
    if (!claim.rows.length) return delivered;
    try {
      const sms = await smsNotificationService.sendConfiguredSMS(
        rule.phone,
        body
      );
      if (sms?.success) delivered = true;
      // success:false is a definitive provider answer: nothing was sent.
      await db.query(`UPDATE metric_alert_sms_claims SET status=$2,updated_at=NOW() WHERE delivery_key=$1`,
        [deliveryKey, sms?.success ? 'sent' : 'failed']);
    } catch (error) {
      // A thrown send may have reached the provider: never resend it.
      await db.query(`UPDATE metric_alert_sms_claims SET status='uncertain',updated_at=NOW() WHERE delivery_key=$1`, [deliveryKey]);
      delivered = true;
      logger.warn("Metric alert SMS outcome uncertain; it will not be resent", {
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
  await markStaleSmsClaims().catch((error) =>
    logger.warn("Metric alert SMS claim sweep will retry", { code: error.code }));
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
      // Re-resolved every evaluation: revoked/expired grants stop the rule and
      // a regional-only admin's rule evaluates region-filtered rows.
      const accessScope = await assertMetricAccess({ id: rule.admin_id, role: rule.role }, rule.metric_name);

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
      const observation = await computeMetricObservation(regionScopedDb(lockClient, accessScope), rule.metric_name, rule.params || {});
      await lockClient.query('COMMIT');
      value = observation.compared;
      const crossed = value != null && compareValues(rule.operator, value, Number(rule.threshold));
      await db.query(`INSERT INTO metric_alert_observations(rule_id,value,previous_value,compared_value,crossed,metric_name,params,rule_updated_at,scope_kind,region_ids)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [rule.id, observation.value, observation.previous, value, crossed,
          rule.metric_name,JSON.stringify(rule.params || {}),rule.updated_at,
          accessScope.global ? 'global' : 'regional', accessScope.global ? null : accessScope.regionIds]);
      if (value == null) continue; // e.g. NULL take-rate on zero GMV: no comparison possible
      if (!crossed) continue;

      // Cooldown: at most one fire per cooldown_minutes, claimed durably
      // in the database before any channel is contacted.
      const fire = await claimFire(rule, value);
      if (!fire) continue;
      let delivered = false;
      try {
        delivered = await deliverRule(rule, prefs, value, fire);
      } catch (deliveryError) {
        // Delivery state is unknown: keep the claim so it is not repeated.
        await db.query(`UPDATE metric_alert_fires SET resolved_at=NOW() WHERE id=$1`, [fire.id]).catch(() => {});
        throw deliveryError;
      }
      await resolveFire(rule, fire, delivered);
      if (delivered) {
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
             last_value = $2
         WHERE id = $1`,
        [rule.id, value]
      ); } finally {
        try {
          if (locked) await lockClient.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`metric-alert:${rule.id}`]);
        } finally { lockClient?.release(); }
      }
    }
  }
  return { sent, evaluated: rules.length, skippedByPrefs };
}

// Alert history retention. Observations, resolved fires and settled SMS
// claims older than the window are pruned once a day. In-flight ('sending')
// SMS claims and unresolved fires are never pruned. The analytics query
// ledger (analytics_query_audit) is append-only and is not touched here.
function historyRetentionDays() {
  const days = Number.parseInt(process.env.METRIC_ALERT_HISTORY_RETENTION_DAYS || '400', 10);
  return Number.isFinite(days) && days >= 30 ? Math.min(days, 3650) : 400;
}

async function pruneMetricAlertHistory(days = historyRetentionDays()) {
  const observations = await db.query(
    `DELETE FROM metric_alert_observations WHERE observed_at < NOW() - make_interval(days => $1)`, [days]);
  const fires = await db.query(
    `DELETE FROM metric_alert_fires WHERE resolved_at IS NOT NULL AND claimed_at < NOW() - make_interval(days => $1)`, [days]);
  const claims = await db.query(
    `DELETE FROM metric_alert_sms_claims WHERE status <> 'sending' AND created_at < NOW() - make_interval(days => $1)`, [days]);
  return { observations: observations.rowCount, fires: fires.rowCount, smsClaims: claims.rowCount, days };
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
  const prune = () => {
    if (stopped) return;
    pruneMetricAlertHistory().catch((error) =>
      logger.warn("Metric alert history retention will retry", { code: error.code }));
  };
  const retentionTimer = setInterval(prune, 24 * 60 * 60000);
  retentionTimer.unref?.();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      clearInterval(retentionTimer);
      return running;
    },
  };
}

module.exports = { evaluateMetricThresholdAlerts, startMetricThresholdAlerts, pruneMetricAlertHistory, STALE_SMS_CLAIM_MINUTES };
