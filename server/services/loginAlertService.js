// FIX #6: Login Alert Service - detect and alert on new/unfamiliar IPs
const pool = require('../db');
const logger = require('../utils/logger');
const { tNotif } = require('../utils/i18n');

/**
 * Check if a login is from a new/unfamiliar IP and send alert email if so.
 * This allows users to detect account compromise early.
 *
 * Fire-and-forget: failures don't block login flow.
 */
async function checkAndAlertNewLogin(userId, ipAddress, userAgent) {
  try {
    if (!userId || !ipAddress) return; // Skip if missing data

    // Query last 30 days of logins from this user
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { rows: recentLogins } = await pool.query(
      `SELECT DISTINCT ip_address FROM user_login_history
       WHERE user_id = $1 AND created_at > $2 AND success = TRUE`
      [userId, thirtyDaysAgo]
    ).catch(err => {
      logger.warn('Failed to query login history', { userId, error: err.message });
      return { rows: [] };
    });

    // Check if this IP has been seen recently
    const seenBefore = recentLogins.some(row => row.ip_address === ipAddress);

    if (seenBefore) {
      // Known IP, no alert needed
      return;
    }

    // New IP detected - fetch user language for localized alert.
    const { rows: userRows } = await pool.query(
      `SELECT email, first_name, preferred_language FROM users WHERE id = $1`,
      [userId]
    ).catch(() => ({ rows: [] }));

    if (!userRows[0]) return;

    const user = userRows[0];
    const { sendSecurityAlertEmail } = require('../utils/email');
    const notificationLanguage = user.preferred_language || 'en';
    const safeIp = ipAddress || 'Unknown';
    const safeUserAgent = userAgent ? userAgent.substring(0, 100) : 'Unknown';
    const safeTime = new Date().toLocaleString();
    const { title: alertType } = tNotif('new_login_detected', notificationLanguage);
    const details = `IP: ${safeIp}\nUser agent: ${safeUserAgent}\nTime: ${safeTime}`;

    // Send alert email (fire-and-forget)
    sendSecurityAlertEmail(
      user.email,
      alertType,
      details,
      notificationLanguage
    ).catch(emailErr => {
      logger.warn('Failed to send login alert email', {
        userId,
        email: user.email,
        error: emailErr.message,
      });
    });

  } catch (err) {
    // Log but don't block - this is a non-critical enhancement
    logger.warn('Login alert service error', { userId, error: err.message, stack: err.stack });
  }
}

module.exports = {
  checkAndAlertNewLogin
};
