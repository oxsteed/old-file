// Incident alerting service
// Detects critical security incidents and triggers alerts

const logger = require('../utils/logger');
const metricsService = require('./metricsService');
const { sendSecurityAlertEmail } = require('../utils/email');
const incidentStore = require('./incidentStore');

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
        this._triggerAlert(alert.type, alert.severity, alert.message)
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
    this.alertChannels.forEach(channel => {
      Promise.resolve()
        .then(() => channel(incident))
        .catch((err) => {
          logger.error('Alert channel failed', { channel: channel.name, error: err.message });
        });
    });

    return { ...incident, durable, notificationsSuppressed: false };
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
   * Email alert (stub - integrate with Resend/SendGrid)
   */
  async _emailAlert(incident) {
    if (incident.severity !== 'critical') return;

    const adminEmail = process.env.SECURITY_ALERT_EMAIL || 'security@oxsteed.com';
    await sendSecurityAlertEmail(adminEmail, incident.type, incident.message);
    logger.info('Security incident email sent', { type: incident.type, recipient: adminEmail });
  }

  /**
   * Slack alert (stub - integrate with Slack webhook)
   */
  _slackAlert(incident) {
    if (incident.severity !== 'critical') return;

    const slackWebhook = process.env.SLACK_SECURITY_WEBHOOK;
    if (!slackWebhook) return;

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
          ],
        },
      ],
    };

    // TODO: Post to Slack
    logger.info('Slack alert queued', { incident });
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
