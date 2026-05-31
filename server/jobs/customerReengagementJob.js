/**
 * customerReengagementJob.js
 *
 * Runs daily at 10am Eastern.
 * Finds customers whose last completed job was 7–30 days ago
 * and who have posted no new job since, then sends a nudge
 * notification + email to bring them back into the flywheel.
 *
 * Idle window: 7 days (configurable via REENGAGEMENT_IDLE_DAYS env var).
 * Upper cap: 30 days — beyond that the user is likely churned; a separate
 * win-back campaign should handle them to avoid spam complaints.
 */

const cron = require('node-cron');
const db   = require('../db');
const { sendNotification } = require('../services/notificationService');
const { sendEmail }        = require('../utils/email');
const { tNotif, tNotifEmail } = require('../utils/i18n');
const logger               = require('../utils/logger');

const IDLE_DAYS = parseInt(process.env.REENGAGEMENT_IDLE_DAYS || '7',  10);
const CAP_DAYS  = parseInt(process.env.REENGAGEMENT_CAP_DAYS  || '30', 10);
const APP_URL   = process.env.APP_URL || process.env.CLIENT_URL || 'https://oxsteed.com';

async function runCustomerReengagement() {
  try {
    // Find customers idle for IDLE_DAYS–CAP_DAYS since their last completed job,
    // with no new job posted after that completion.
    const { rows: customers } = await db.query(`
      SELECT DISTINCT ON (u.id)
        u.id,
        u.first_name,
        u.email,
        u.preferred_language,
        j.id        AS last_job_id,
        j.title     AS last_job_title,
        j.completed_at
      FROM users u
      JOIN jobs j ON j.client_id = u.id
        AND j.status = 'completed'
        AND j.completed_at IS NOT NULL
      WHERE u.deleted_at IS NULL
        AND u.role IN ('customer', 'business_owner')
        -- Last completed job is within our idle window
        AND j.completed_at > NOW() - INTERVAL '${CAP_DAYS} days'
        AND j.completed_at < NOW() - INTERVAL '${IDLE_DAYS} days'
        -- No new job posted after that completion
        AND NOT EXISTS (
          SELECT 1 FROM jobs newer
           WHERE newer.client_id = u.id
             AND newer.created_at > j.completed_at
             AND newer.status NOT IN ('cancelled', 'closed')
        )
        -- Don't spam the same user more than once per week
        AND NOT EXISTS (
          SELECT 1 FROM reengagement_log rl
           WHERE rl.user_id = u.id
             AND rl.sent_at > NOW() - INTERVAL '7 days'
        )
      ORDER BY u.id, j.completed_at DESC
    `);

    if (!customers.length) return;

    logger.info(`[reengagement] ${customers.length} idle customer(s) to nudge`);

    let sent = 0;
    let failed = 0;

    for (const c of customers) {
      const notificationLang = c.preferred_language || 'en';
      const { title: reengagementTitle, body: reengagementBody } = tNotif('reengagement_nudge', notificationLang);
      const emailTranslations = tNotifEmail('reengagement_nudge', notificationLang);
      const reengagementBodyWithContext = `${reengagementBody}${c.last_job_title ? ` ("${c.last_job_title}")` : ''}`;
      const ctaText = emailTranslations.buttonText || 'Post a New Job';
      const manageNotificationsText = emailTranslations.manageNotificationsText || 'Manage notifications';
      const footerPrefixText = emailTranslations.footerPrefix || 'You are receiving this because you have an OxSteed account.';
      const footerFallbackText = emailTranslations.footerFallbackText || 'You received this notification from OxSteed.';
      try {
        // In-app push notification
        await sendNotification({
          userId:     c.id,
          type:       'reengagement_nudge',
          title:      `👋 ${reengagementTitle}`,
          body:       `${reengagementBody} ${c.last_job_title ? `("${c.last_job_title}")` : ''}`,
          data:       { last_job_id: c.last_job_id },
          action_url: '/post-job',
        });

        // Email nudge (best-effort — don't fail the loop if email is missing)
        if (c.email) {
          await sendEmail({
            to:      c.email,
            subject: `${c.first_name}, ${reengagementTitle}`,
            html: `
              <p>Hi ${c.first_name},</p>
              <p>${reengagementBodyWithContext}.</p>
              <div style="margin:24px 0;">
                <a href="${APP_URL}/post-job"
                   style="display:inline-block;padding:12px 24px;background:#7c3aed;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">
                  ${ctaText} →
                </a>
              </div>
              <p style="color:#6b7280;font-size:13px;">
                ${footerPrefixText}
                <a href="${APP_URL}/helpers" style="color:#7c3aed;">${APP_URL}/helpers</a>
              </p>
              <p>${footerFallbackText}</p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
              <p style="color:#9ca3af;font-size:11px;">
                ${manageNotificationsText}:
                <a href="${APP_URL}/settings/notifications" style="color:#9ca3af;">${manageNotificationsText}</a>
              </p>
            `,
            text: `${reengagementBodyWithContext} ${ctaText}: ${APP_URL}/post-job`,
          });
        }

        // Record that we sent this nudge so we don't double-send
        await db.query(
          `INSERT INTO reengagement_log (user_id, sent_at, trigger_job_id)
           VALUES ($1, NOW(), $2)
           ON CONFLICT DO NOTHING`,
          [c.id, c.last_job_id]
        );

        sent++;
      } catch (userErr) {
        failed++;
        logger.error('[reengagement] Failed to nudge customer', {
          user_id: c.id,
          error:   userErr.message,
        });
      }
    }

    logger.info('[reengagement] Done', {
      total:  customers.length,
      sent,
      failed,
    });
  } catch (err) {
    logger.error('[reengagement] Job failed', { error: err.message });
  }
}

function startCustomerReengagementJob() {
  // Daily at 10:00am Eastern
  cron.schedule('0 10 * * *', runCustomerReengagement, { timezone: 'America/New_York' });
  logger.info('[reengagement] Customer re-engagement job scheduled (daily 10am ET)');
}

module.exports = { startCustomerReengagementJob };
