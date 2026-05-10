// FIX #10 & #11: Security Audit Logger Service
// Log all security-critical operations for compliance and forensics

const pool = require('../db');
const logger = require('../utils/logger');

/**
 * Log a security-critical action to the audit table
 *
 * @param {string} action - Action type (password_reset, email_change, payment_capture, etc.)
 * @param {Object} options - Logging options
 * @param {string} options.userId - User who performed the action
 * @param {string} options.resourceType - Type of resource affected (job, payment, user_account, etc.)
 * @param {string} options.resourceId - ID of the resource affected
 * @param {Object} options.details - Additional context (before/after values, reason, etc.)
 * @param {string} options.ipAddress - IP address of the request
 * @param {string} options.userAgent - User agent string
 * @param {string} options.status - Outcome (success, failure, denied)
 *
 * Fire-and-forget: failures don't block main flow
 */
async function logSecurityEvent(action, options = {}) {
  try {
    const {
      userId = null,
      resourceType = null,
      resourceId = null,
      details = {},
      ipAddress = null,
      userAgent = null,
      status = 'success'
    } = options;

    await pool.query(
      `INSERT INTO security_audit_log (user_id, action, resource_type, resource_id, details, ip_address, user_agent, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        action,
        resourceType,
        resourceId,
        details ? JSON.stringify(details) : null,
        ipAddress,
        userAgent,
        status
      ]
    );
  } catch (err) {
    // Non-fatal: don't block main flow if audit logging fails
    logger.warn('Security audit log failed', {
      action,
      userId: options.userId,
      error: err.message
    });
  }
}

/**
 * Helper to extract request details for audit logging
 *
 * @param {Object} req - Express request object
 * @returns {Object} { ipAddress, userAgent }
 */
function extractRequestDetails(req) {
  const ipAddress = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || req.ip
    || null;

  const userAgent = req.headers['user-agent'] || null;

  return { ipAddress, userAgent };
}

module.exports = {
  logSecurityEvent,
  extractRequestDetails
};
