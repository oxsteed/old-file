// Incident alerting service
// Detects critical security incidents and triggers alerts

const logger = require('../utils/logger');
const metricsService = require('./metricsService');
const { sendSecurityAlertEmail } = require('../utils/email');

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
    setInterval(() => {
      this._checkIncidents();
    }, 5 * 60 * 1000);
  }

  /**
   * Check for active incidents
   */
  _checkIncidents() {
    const alerts = metricsService.checkAlerts();

    if (alerts.length > 0) {
      alerts.forEach(alert => {
        this._triggerAlert(alert.type, alert.severity, alert.message);
      });
    }
  }

  /**
   * Trigger alert across all channels
   */
  _triggerAlert(type, severity, message) {
    const incident = {
      type,
      severity, // 'critical', 'warning'
      message,
      timestamp: new Date().toISOString(),
    };

    logger.warn('INCIDENT ALERT', incident);

    // Send to all channels
    this.alertChannels.forEach(channel => {
      Promise.resolve()
        .then(() => channel(incident))
        .catch((err) => {
          logger.error('Alert channel failed', { channel: channel.name, error: err.message });
        });
    });
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

    // Store in database for audit trail
    try {
      const pool = require('../db');
      await pool.query(
        `INSERT INTO incident_log (type, severity, message, details, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [type, severity, message, JSON.stringify(details)]
      );
    } catch (err) {
      logger.error('Failed to log incident', { error: err.message });
    }

    // Trigger alerts
    this._triggerAlert(type, severity, message);

    return incident;
  }

  /**
   * Get recent incidents
   */
  async getRecentIncidents(hours = 24) {
    try {
      const pool = require('../db');
      const { rows } = await pool.query(
        `SELECT * FROM incident_log
         WHERE created_at > NOW() - INTERVAL '${hours} hours'
         ORDER BY created_at DESC`,
        []
      );
      return rows;
    } catch (err) {
      logger.error('Failed to fetch incidents', { error: err.message });
      return [];
    }
  }
}

module.exports = new IncidentAlertService();
