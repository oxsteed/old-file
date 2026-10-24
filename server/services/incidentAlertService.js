// Incident alerting service
// Detects critical security incidents and triggers alerts

const pool = require('../db');
const crypto = require('crypto');
const logger = require('../utils/logger');
const metricsService = require('./metricsService');
const { sendSecurityAlertEmail } = require('../utils/email');
const incidentStore = require('./incidentStore');

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
    if (leaseToken) await pool.query(`UPDATE incident_log SET
      last_notified_at=CASE WHEN $3 THEN NOW() ELSE last_notified_at END,
      notification_count=notification_count+CASE WHEN $3 THEN 1 ELSE 0 END,
      dispatch_lease_token=NULL,
      dispatch_lease_until=CASE WHEN $3 THEN NULL ELSE NOW()+INTERVAL '5 minutes' END
      WHERE id=$1 AND dispatch_lease_token=$2`, [incident.id, leaseToken, dispatched]);
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
   * Send critical alerts through the configured transactional email provider.
   */
  async _emailAlert(incident) {
    if (incident.severity !== 'critical') return;

    const { rows } = await pool.query(`SELECT u.email FROM users u
      LEFT JOIN admin_notification_prefs p ON p.admin_id=u.id
      WHERE u.role IN ('admin','super_admin') AND u.is_active=TRUE AND u.deleted_at IS NULL
        AND (u.role='super_admin' OR EXISTS (SELECT 1 FROM admin_permission_grants g
          WHERE g.grantee_id=u.id AND g.permissions ? 'manage_operations' AND g.region_id IS NULL
            AND g.expires_at>NOW() AND g.revoked_at IS NULL))
        AND COALESCE(p.notify_incidents,TRUE) AND COALESCE(p.email_notifications,TRUE)
        AND (p.incident_types IS NULL OR '*'=ANY(p.incident_types) OR $1=ANY(p.incident_types))
      ORDER BY u.id`, [incident.type]);
    const recipients = [...new Set(rows.map(r => r.email).filter(Boolean))];
    if (!recipients.length) recipients.push(process.env.SECURITY_ALERT_EMAIL || 'security@oxsteed.com');
    const results = await Promise.allSettled(recipients.map(address =>
      sendSecurityAlertEmail(address, incident.type, formatIncidentDetails(incident))));
    const sent = results.some(r => r.status === 'fulfilled' && r.value?.success === true);
    if (!sent) throw new Error('No incident email recipient accepted delivery');
    return true;
  }

  /**
   * Send critical alerts to Slack without accepting arbitrary outbound URLs.
   */
  async _slackAlert(incident) {
    if (incident.severity !== 'critical') return;

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
