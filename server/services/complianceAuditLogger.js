// Enterprise-grade compliance audit logging
// Logs all sensitive operations for SOC 2, ISO 27001, and regulatory compliance

const pool = require('../db');
const logger = require('../utils/logger');

class ComplianceAuditLogger {
  /**
   * Log a compliance audit event
   * @param {string} action - Action type (payment_capture, user_delete, admin_action, etc.)
   * @param {string} resourceType - Resource type (job, user, payment, etc.)
   * @param {string} resourceId - Resource ID
   * @param {string} userId - User performing action
   * @param {string} result - Result (success, failure)
   * @param {object} details - Additional details
   * @param {string} correlationId - Request correlation ID
   */
  static async logEvent(action, resourceType, resourceId, userId, result, details = {}, correlationId = null) {
    try {
      const eventData = {
        action,
        resourceType,
        resourceId,
        userId,
        result, // 'success' or 'failure'
        severity: this._calculateSeverity(action),
        details: JSON.stringify(details),
        correlationId: correlationId || 'unknown',
        ipAddress: details.ipAddress || 'unknown',
        userAgent: details.userAgent || null,
        timestamp: new Date().toISOString(),
      };

      // Non-blocking: queue to background job
      setImmediate(async () => {
        try {
          await pool.query(
            `INSERT INTO compliance_audit_log
             (action, resource_type, resource_id, user_id, result, severity, details, correlation_id, ip_address, user_agent, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
            [action, resourceType, resourceId, userId, result, eventData.severity, eventData.details, correlationId, eventData.ipAddress, eventData.userAgent]
          );
        } catch (dbErr) {
          logger.error('Compliance audit log insert failed', { action, error: dbErr.message });
        }
      });

      // Log critical events immediately
      if (['critical', 'high'].includes(eventData.severity) && result === 'failure') {
        logger.warn('COMPLIANCE EVENT', eventData);
      }

      return eventData;
    } catch (err) {
      logger.error('Compliance audit logger error', { error: err.message });
    }
  }

  // ── SPECIFIC EVENT LOGGERS ──────────────────────────────────

  static async logPaymentCapture(paymentId, userId, amountCents, result, error = null, ipAddress = null) {
    return this.logEvent(
      'payment_capture',
      'payment',
      paymentId,
      userId,
      result,
      { amountCents, error, ipAddress },
      null
    );
  }

  static async logUserDeletion(targetUserId, adminId, details = {}, ipAddress = null) {
    return this.logEvent(
      'user_deletion',
      'user',
      targetUserId,
      adminId,
      'success',
      { ...details, ipAddress },
      null
    );
  }

  static async logPrivilegeEscalation(userId, previousRole, newRole, adminId, ipAddress = null) {
    return this.logEvent(
      'privilege_escalation',
      'user',
      userId,
      adminId,
      'success',
      { previousRole, newRole, ipAddress },
      null
    );
  }

  static async logDataExport(userId, dataType, recordCount, ipAddress = null) {
    return this.logEvent(
      'data_export',
      'user_data',
      userId,
      userId,
      'success',
      { dataType, recordCount, ipAddress },
      null
    );
  }

  static async logFailedAuthentication(email, reason, ipAddress = null) {
    return this.logEvent(
      'failed_authentication',
      'user',
      email,
      'unknown',
      'failure',
      { reason, ipAddress },
      null
    );
  }

  static async logConfigurationChange(configKey, oldValue, newValue, adminId, ipAddress = null) {
    return this.logEvent(
      'configuration_change',
      'config',
      configKey,
      adminId,
      'success',
      { oldValue, newValue, ipAddress },
      null
    );
  }

  static async logAccessDenied(userId, resourceType, resourceId, reason, ipAddress = null) {
    return this.logEvent(
      'access_denied',
      resourceType,
      resourceId,
      userId,
      'failure',
      { reason, ipAddress },
      null
    );
  }

  static async logDisputeCreated(disputeId, userId, jobId, reason, ipAddress = null) {
    return this.logEvent(
      'dispute_created',
      'dispute',
      disputeId,
      userId,
      'success',
      { jobId, reason, ipAddress },
      null
    );
  }

  static async logRefund(paymentId, refundAmount, reason, adminId, ipAddress = null) {
    return this.logEvent(
      'refund_issued',
      'payment',
      paymentId,
      adminId,
      'success',
      { refundAmount, reason, ipAddress },
      null
    );
  }

  static async logMassAction(action, resourceType, count, adminId, ipAddress = null) {
    return this.logEvent(
      'mass_action',
      resourceType,
      'batch',
      adminId,
      'success',
      { action, count, ipAddress },
      null
    );
  }

  // ── SEVERITY LEVELS ────────────────────────────────────────
  static _calculateSeverity(action) {
    const criticalActions = [
      'privilege_escalation',
      'user_deletion',
      'data_export',
      'configuration_change',
      'refund_issued',
    ];
    const highActions = [
      'payment_capture',
      'dispute_created',
      'access_denied',
    ];

    if (criticalActions.includes(action)) return 'critical';
    if (highActions.includes(action)) return 'high';
    return 'medium';
  }

  // ── QUERIES ────────────────────────────────────────────────

  /**
   * Coerce a caller-supplied day window to a finite non-negative integer.
   * Garbage (NaN, Infinity, non-numeric) falls back to the caller's default;
   * the result is clamped to a sane upper bound. The value is always passed
   * as a bound parameter, never interpolated into SQL text.
   */
  static coerceDays(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(3650, Math.max(0, Math.floor(n)));
  }

  static async getAuditTrail(userId, limit = 100) {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM compliance_audit_log
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      );
      return rows;
    } catch (err) {
      logger.error('Audit trail query failed', { error: err.message });
      return [];
    }
  }

  static async getEventsByAction(action, days = 7) {
    const safeDays = ComplianceAuditLogger.coerceDays(days, 7);
    try {
      const { rows } = await pool.query(
        `SELECT * FROM compliance_audit_log
         WHERE action = $1
         AND created_at > NOW() - ($2 * INTERVAL '1 day')
         ORDER BY created_at DESC`,
        [action, safeDays]
      );
      return rows;
    } catch (err) {
      logger.error('Action query failed', { error: err.message });
      return [];
    }
  }

  static async getFailuresByUser(userId, days = 30) {
    const safeDays = ComplianceAuditLogger.coerceDays(days, 30);
    try {
      const { rows } = await pool.query(
        `SELECT * FROM compliance_audit_log
         WHERE user_id = $1
         AND result = 'failure'
         AND created_at > NOW() - ($2 * INTERVAL '1 day')
         ORDER BY created_at DESC`,
        [userId, safeDays]
      );
      return rows;
    } catch (err) {
      logger.error('Failure query failed', { error: err.message });
      return [];
    }
  }
}

module.exports = ComplianceAuditLogger;
