// FIX #6: Login Alert Service - detect and alert on new/unfamiliar IPs
const pool = require('../db');
const logger = require('../utils/logger');

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
       WHERE user_id = $1 AND created_at > $2 AND success = TRUE
       ORDER BY created_at DESC`,
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

    // New IP detected - fetch user for email and name
    const { rows: userRows } = await pool.query(
      `SELECT email, first_name FROM users WHERE id = $1`,
      [userId]
    ).catch(() => ({ rows: [] }));

    if (!userRows[0]) return;

    const user = userRows[0];
    const { sendEmail } = require('../utils/email');

    // Send alert email (fire-and-forget)
    sendEmail({
      to: user.email,
      template: 'login_alert',
      subject: 'New login detected on your OxSteed account',
      data: {
        name: user.first_name || 'there',
        ip: ipAddress,
        userAgent: userAgent ? userAgent.substring(0, 100) : 'Unknown',
        time: new Date().toLocaleString(),
        action_url: `${process.env.APP_URL || 'https://oxsteed.com'}/security/login-activity`
      }
    }).catch(emailErr => {
      logger.warn('Failed to send login alert email', { userId, email: user.email, error: emailErr.message });
    });

  } catch (err) {
    // Log but don't block - this is a non-critical enhancement
    logger.warn('Login alert service error', { userId, error: err.message, stack: err.stack });
  }
}

module.exports = {
  checkAndAlertNewLogin
};
