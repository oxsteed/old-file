const pool = require('../db');
const logger = require('../utils/logger');

// Email digest batch processor
// Runs daily at 8 AM UTC and weekly on Mondays at 8 AM UTC
// Compiles queued notifications into digest emails grouped by user

async function processEmailDigest(digestType = 'daily') {
  const startTime = Date.now();

  try {
    logger.info(`Starting ${digestType} email digest batch`, { digestType });

    // Get users with pending digest emails
    const usersResult = await pool.query(`
      SELECT DISTINCT edq.user_id, np.email_frequency
      FROM email_digest_queue edq
      JOIN notification_preferences np ON np.user_id = edq.user_id
      WHERE edq.sent_at IS NULL
        AND np.email_frequency = $1
        AND np.unsubscribe_all = FALSE
        AND np.email_notifications = TRUE
      LIMIT 1000
    `, [digestType === 'daily' ? 'daily' : 'weekly']);

    if (!usersResult.rows.length) {
      logger.info(`No ${digestType} digest users found`, { digestType });
      return { processed: 0, failed: 0 };
    }

    let processed = 0;
    let failed = 0;

    // Process each user's digest
    for (const { user_id } of usersResult.rows) {
      try {
        const success = await processSingleUserDigest(user_id, digestType);
        if (success) {
          processed++;
        } else {
          failed++;
        }
      } catch (error) {
        logger.error('Error processing user digest', { error, userId: user_id });
        failed++;
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`${digestType} email digest batch completed`, {
      digestType,
      processed,
      failed,
      duration
    });

    return { processed, failed };
  } catch (error) {
    logger.error('Error in email digest batch', { error, digestType });
    throw error;
  }
}

async function processSingleUserDigest(userId, digestType) {
  try {
    // Get user email
    const userResult = await pool.query(
      'SELECT email, first_name FROM users WHERE id = $1',
      [userId]
    );

    if (!userResult.rows.length) {
      logger.warn('User not found for digest', { userId });
      return false;
    }

    const { email, first_name } = userResult.rows[0];

    // Get queued notifications
    const notificationsResult = await pool.query(`
      SELECT edq.id, n.type, n.title, n.message, n.created_at
      FROM email_digest_queue edq
      JOIN notifications n ON n.id = edq.notification_id
      WHERE edq.user_id = $1
        AND edq.sent_at IS NULL
      ORDER BY n.created_at DESC
      LIMIT 50
    `, [userId]);

    if (!notificationsResult.rows.length) {
      logger.debug('No pending notifications for user', { userId });
      return true;
    }

    const notifications = notificationsResult.rows;

    // Build digest email (placeholder - actual sending would use email service)
    const digestHtml = buildDigestEmailHtml(first_name, notifications, digestType);

    // Log digest creation (actual implementation would send via Resend/SendGrid)
    logger.info('Email digest compiled and ready to send', {
      userId,
      email,
      notificationCount: notifications.length,
      digestType
    });

    // Mark as sent
    const queueIds = notifications.map(n => n.id);
    if (queueIds.length > 0) {
      await pool.query(`
        UPDATE email_digest_queue
        SET sent_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1)
      `, [queueIds]);
    }

    return true;
  } catch (error) {
    logger.error('Error processing single user digest', { error, userId });
    return false;
  }
}

function buildDigestEmailHtml(firstName, notifications, digestType) {
  const notificationsHtml = notifications.map(n => `
    <div style="margin: 15px 0; padding: 15px; border-left: 4px solid #3b82f6; background-color: #f0f9ff;">
      <p style="margin: 0; font-weight: bold; color: #333;">${escapeHtml(n.title)}</p>
      <p style="margin: 5px 0 0; color: #666;">${escapeHtml(n.message)}</p>
      <p style="margin: 5px 0 0; font-size: 12px; color: #999;">
        ${new Date(n.created_at).toLocaleString()}
      </p>
    </div>
  `).join('');

  const frequencyText = digestType === 'daily' ? 'daily' : 'weekly';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; color: #333;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="margin: 0; color: #1f2937;">Your ${frequencyText} digest from OxSteed</h1>
        </div>

        <p>Hi ${escapeHtml(firstName)},</p>

        <p>Here's your ${frequencyText} summary of updates:</p>

        <div style="margin: 20px 0;">
          ${notificationsHtml}
        </div>

        <p>Visit your <a href="https://oxsteed.com/notifications" style="color: #3b82f6;">notification center</a> to manage your preferences.</p>

        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">

        <p style="font-size: 12px; color: #999; text-align: center;">
          © 2026 OxSteed. <a href="https://oxsteed.com/email-preferences" style="color: #3b82f6; text-decoration: none;">Manage your preferences</a>
        </p>
      </div>
    </body>
    </html>
  `;
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

module.exports = {
  processEmailDigest,
  processSingleUserDigest
};
