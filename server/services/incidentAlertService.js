// Incident alerting service
// Detects critical security incidents and triggers alerts

const pool = require('../db');
const crypto = require('crypto');
const logger = require('../utils/logger');
const metricsService = require('./metricsService');
const { sendSecurityAlertEmail } = require('../utils/email');
const incidentStore = require('./incidentStore');
// Item 46: one shared dispatchable set with the store and the sweeper.
const DISPATCHABLE_SEVERITIES = incidentStore.DISPATCHABLE_SEVERITIES || ['critical', 'high'];
const { hasGlobalGrant } = require('../middleware/adminAuth');

// Item 49 (one shared backoff helper for the incident dispatch path): when
// every channel fails, the next lease grows from the time since the
// incident claimed its notification window — 5 minutes, doubling every
// 5 minutes of age, capped at 4 hours — instead of a flat 5-minute lease
// that re-sent the same alert forever. No retry-count column exists (no
// migrations), so the claim timestamp is the only durable clock.
const INCIDENT_DISPATCH_BASE_LEASE_MINUTES = 5;
const INCIDENT_DISPATCH_MAX_LEASE_MINUTES = 240;

function nextIncidentDispatchLeaseMinutes(claimedAt, now = new Date()) {
  const elapsedMs = Math.max(0, now - new Date(claimedAt || now));
  const windows = Math.floor(elapsedMs / (INCIDENT_DISPATCH_BASE_LEASE_MINUTES * 60 * 1000));
  return Math.min(
    INCIDENT_DISPATCH_BASE_LEASE_MINUTES * (2 ** windows),
    INCIDENT_DISPATCH_MAX_LEASE_MINUTES
  );
}

function formatIncidentDetails(incident, maxLength = 12000) {
  const lines = [
    `Message: ${incident.message}`,
    `Detected: ${incident.timestamp}`,
  ];
  const details = incident.details && typeof incident.details === 'object'
    ? incident.details
    : {};

  Object.entries(details).forEach(([key, value]) => {
    let rendered;
    try {
      rendered = typeof value === 'string' ? value : JSON.stringify(value);
    } catch {
      rendered = '[unavailable]';
    }
    lines.push(`${key}: ${String(rendered || '').slice(0, 4000)}`);
  });

  return lines.join('\n').slice(0, maxLength);
}

class IncidentAlertService {
  constructor() {
    this.thresholds = {
      failedLoginCount: 20,        // Failed logins per hour
      rateLimitExceededCount: 100, // Rate limit hits per hour
      errorRatePercent: 5,         // 5% error rate threshold
      slangQueryMs: 5000,          // Database query p95 > 5s
      paymentFailureCount: 10,     // Payment failures per hour
      backupMissingHours: 25,      // No backup in 25 hours
    };

    this.alertChannels = [
      this._logAlert.bind(this),
      this._metricsAlert.bind(this),
      this._emailAlert.bind(this),
      this._slackAlert.bind(this),
    ];

    // Check alerts periodically
    this.startMonitoring();
  }

  /**
   * Start periodic incident monitoring
   */
  startMonitoring() {
    // Check every 5 minutes
    this.monitorTimer = setInterval(() => {
      this._checkIncidents();
    }, 5 * 60 * 1000);
    this.monitorTimer.unref?.();
  }

  /**
   * Check for active incidents
   */
  _checkIncidents() {
    const alerts = metricsService.checkAlerts();

    if (alerts.length > 0) {
      alerts.forEach(alert => {
        this._triggerAlert(alert.type, alert.severity, alert.message, alert.details || {})
          .catch((error) => logger.error('Incident alert processing failed', { error: error.message }));
      });
    }
  }

  /**
   * Trigger alert across all channels
   */
  async _triggerAlert(type, severity, message, details = {}) {
    const incident = {
      type,
      severity, // 'critical', 'warning'
      message,
      details,
      timestamp: new Date().toISOString(),
    };

    logger.warn('INCIDENT ALERT', incident);

    const durable = await incidentStore.recordIncident({
      type,
      severity,
      message,
      details,
      dedupeKey: type,
    });

    // Persist every occurrence, but dispatch only when this replica owns the
    // current notification window. If durability is unavailable during a
    // rollout, retain the previous best-effort notification behavior.
    if (durable.persisted && !durable.notificationClaimed) {
      return { ...incident, durable, notificationsSuppressed: true };
    }

    // Send to all channels
    await this.dispatchRecordedIncident({ ...incident, id: durable.incident?.id });

    return { ...incident, durable, notificationsSuppressed: false };
  }

  /**
   * Dispatch the alert channels for an incident that was already recorded
   * in the incident log by another component (e.g. a compliance SLA sweep
   * that persists its own incidents with a custom dedupe key and then
   * claims the notification window). The caller must only invoke this when
   * it owns the notification window; otherwise repeated sweeps would
   * re-notify on every run.
   */
  async dispatchRecordedIncident(incident) {
    let leaseToken = null;
    if (incident.id) {
      leaseToken = crypto.randomUUID();
      const claim = await pool.query(`UPDATE incident_log SET dispatch_lease_token=$2,
        dispatch_lease_until=NOW()+INTERVAL '2 minutes'
        WHERE id=$1 AND resolved_at IS NULL
          AND (last_notified_at IS NULL OR last_notified_at < notification_claimed_at)
          AND (dispatch_lease_until IS NULL OR dispatch_lease_until < NOW()) RETURNING id`, [incident.id, leaseToken]);
      if (!claim.rows.length) return { dispatched: false, suppressed: true };
    }
    const settled = await Promise.allSettled(this.alertChannels.map(channel =>
      Promise.resolve().then(() => channel(incident))));
    // Log/metrics alone do not count as notifying an operator. Email/Slack
    // return true only when an external provider acknowledged delivery.
    const dispatched = settled.some(r => r.status === 'fulfilled' && r.value === true);
    for (const result of settled) if (result.status === 'rejected') {
      logger.error('Incident alert channel failed', { type: incident.type, error: result.reason?.message });
    }
    if (leaseToken) {
      // Item 49: a failed dispatch re-arms a growing lease (backoff from
      // the claim time), and once the lease is at its cap the channel
      // itself is persistently failing, so escalate to the error log
      // instead of silently re-trying every few minutes forever.
      const leaseMinutes = dispatched
        ? 0
        : nextIncidentDispatchLeaseMinutes(incident.notification_claimed_at);
      if (!dispatched && leaseMinutes >= INCIDENT_DISPATCH_MAX_LEASE_MINUTES) {
        logger.error('Incident alert channel persistently failing', {
          type: incident.type,
          severity: incident.severity,
          incidentId: incident.id,
          claimedAt: incident.notification_claimed_at,
          leaseMinutes,
        });
      }
      await pool.query(`UPDATE incident_log SET
        last_notified_at=CASE WHEN $3 THEN NOW() ELSE last_notified_at END,
        notification_count=notification_count+CASE WHEN $3 THEN 1 ELSE 0 END,
        dispatch_lease_token=NULL,
        dispatch_lease_until=CASE WHEN $3 THEN NULL ELSE NOW()+($4::text || ' minutes')::interval END
        WHERE id=$1 AND dispatch_lease_token=$2`, [incident.id, leaseToken, dispatched, String(leaseMinutes)]);
    }
    return { dispatched, channels: settled.map(r => r.status) };
  }

  /**
   * Log alert
   */
  _logAlert(incident) {
    if (incident.severity === 'critical') {
      logger.error(`🚨 CRITICAL: ${incident.type} - ${incident.message}`, incident);
    } else {
      logger.warn(`⚠️ WARNING: ${incident.type} - ${incident.message}`, incident);
    }
  }

  /**
   * Send alert to metrics/monitoring system
   */
  _metricsAlert(incident) {
    metricsService.recordSecurityEvent(
      incident.type,
      incident.severity,
      'system',
      { message: incident.message }
    );
  }

  /**
   * Send critical and high alerts through the configured transactional email provider.
   */
  async _emailAlert(incident) {
    if (!DISPATCHABLE_SEVERITIES.includes(incident.severity)) return;

    const { rows } = await pool.query(`SELECT u.id, u.email, u.role FROM users u
      LEFT JOIN admin_notification_prefs p ON p.admin_id=u.id
      WHERE u.role IN ('admin','super_admin') AND u.is_active=TRUE AND u.deleted_at IS NULL
        AND COALESCE(p.notify_incidents,TRUE) AND COALESCE(p.email_notifications,TRUE)
        AND (p.incident_types IS NULL OR '*'=ANY(p.incident_types) OR $1=ANY(p.incident_types))
      ORDER BY u.id`, [incident.type]);
    const authorizedRows = await Promise.all(rows.map(async (row) => {
      if (row.role === 'super_admin') return row;
      try {
        return await hasGlobalGrant(row.id, 'manage_operations') ? row : null;
      } catch (error) {
        logger.warn('Incident recipient grant lookup unavailable', { adminId: row.id, error: error.message });
        return null;
      }
    }));
    const recipients = [...new Set(authorizedRows.map(row => row?.email).filter(Boolean))];
    if (!recipients.length) recipients.push(process.env.SECURITY_ALERT_EMAIL || 'security@oxsteed.com');
    const results = await Promise.allSettled(recipients.map(address =>
      sendSecurityAlertEmail(address, incident.type, formatIncidentDetails(incident))));
    const sent = results.some(r => r.status === 'fulfilled' && r.value?.success === true);
    if (!sent) throw new Error('No incident email recipient accepted delivery');
    return true;
  }

  /**
   * Send critical and high alerts to Slack without accepting arbitrary outbound URLs.
   */
  async _slackAlert(incident) {
    if (!DISPATCHABLE_SEVERITIES.includes(incident.severity)) return;

    const configuredWebhook = String(process.env.SLACK_SECURITY_WEBHOOK || '').trim();
    if (!configuredWebhook) return;

    let slackWebhook;
    try {
      const parsed = new URL(configuredWebhook);
      if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'hooks.slack.com') {
        throw new Error('Slack security webhook must use the hooks.slack.com HTTPS endpoint');
      }
      slackWebhook = parsed.toString();
    } catch (error) {
      logger.error('Slack security webhook rejected', { error: error.message });
      return;
    }

    const message = {
      text: `🚨 ${incident.type}`,
      attachments: [
        {
          color: incident.severity === 'critical' ? 'danger' : 'warning',
          fields: [
            { title: 'Type', value: incident.type, short: true },
            { title: 'Severity', value: incident.severity, short: true },
            { title: 'Message', value: incident.message, short: false },
            { title: 'Time', value: incident.timestamp, short: true },
            ...(Object.keys(incident.details || {}).length > 0
              ? [{ title: 'Details', value: formatIncidentDetails(incident, 3000), short: false }]
              : []),
          ],
        },
      ],
    };

    const response = await fetch(slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook returned HTTP ${response.status}`);
    }

    logger.info('Slack security alert sent', { type: incident.type });
    return true;
  }

  /**
   * Manual incident report
   */
  async reportIncident(type, severity, message, details = {}) {
    const incident = {
      type,
      severity,
      message,
      details,
      timestamp: new Date().toISOString(),
      reporter: 'system',
    };

    logger.warn('INCIDENT REPORT', incident);

    // Trigger alerts
    await this._triggerAlert(type, severity, message, details);

    return incident;
  }

  /**
   * Get recent incidents
   */
  async getRecentIncidents(hours = 24) {
    try {
      return await incidentStore.listIncidents({ hours, limit: 500 });
    } catch (err) {
      logger.error('Failed to fetch incidents', { error: err.message });
      return [];
    }
  }
}

module.exports = new IncidentAlertService();
module.exports.nextIncidentDispatchLeaseMinutes = nextIncidentDispatchLeaseMinutes;
module.exports.INCIDENT_DISPATCH_MAX_LEASE_MINUTES = INCIDENT_DISPATCH_MAX_LEASE_MINUTES;
