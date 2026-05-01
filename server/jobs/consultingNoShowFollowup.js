const cron = require('node-cron');
const db = require('../db');
const { sendEmail } = require('../utils/email');
const logger = require('../utils/logger');

/**
 * Every hour, check for consulting sessions that were marked as 'no_show'
 * and send follow-up emails to customers and notification to admins.
 * Only sends follow-ups once per no-show via tracking table.
 */
const startConsultingNoShowFollowup = () => {
  cron.schedule('0 * * * *', async () => {
    try {
      // Find no-show sessions that haven't been followed up yet
      const { rows: noShowSessions } = await db.query(
        `SELECT
          css.id,
          css.session_id,
          css.scheduled_date,
          css.scheduled_time,
          css.duration_minutes,
          cs.email,
          cs.first_name,
          cs.business_name,
          cons_u.first_name as consultant_first_name,
          cons_u.last_name as consultant_last_name
        FROM consulting_sessions_scheduled css
        JOIN consulting_sessions cs ON css.session_id = cs.id
        LEFT JOIN consultants c ON cs.consultant_id = c.id
        LEFT JOIN users cons_u ON c.user_id = cons_u.id
        WHERE css.status = 'no_show'
          AND NOT EXISTS (
            SELECT 1 FROM consulting_session_followups
            WHERE session_scheduled_id = css.id AND followup_type = 'no_show'
          )
        ORDER BY css.updated_at DESC
        LIMIT 50`
      );

      let sent = 0;
      let failed = 0;

      for (const session of noShowSessions) {
        try {
          const sessionDateTime = new Date(`${session.scheduled_date}T${session.scheduled_time}`);

          // Send no-show follow-up email to customer
          await sendEmail({
            to: session.email,
            subject: 'We Missed You - Your OxSteed Consulting Session',
            html: `
              <p>Hi ${session.first_name},</p>
              <p>We noticed you weren't able to make it to your scheduled consulting session on ${sessionDateTime.toLocaleDateString('en-US')} at ${sessionDateTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}.</p>
              <p>We understand that things come up! Please don't worry. Here's what you can do next:</p>
              <ul>
                <li><strong>Reschedule:</strong> Reply to this email or log into your account to schedule a new session at your convenience</li>
                <li><strong>Questions:</strong> If you have any questions or concerns, our team is here to help</li>
                <li><strong>Cancel:</strong> If you no longer need the consulting service, just let us know</li>
              </ul>
              <p>We look forward to working with you on your business goals. Please reach out at your earliest convenience to reschedule your session.</p>
              <p>Best regards,<br>The OxSteed Consulting Team</p>
            `,
          });

          // Send admin notification about no-show
          if (session.consultant_first_name) {
            await sendEmail({
              to: process.env.ADMIN_EMAIL || 'admin@oxsteed.com',
              subject: `No-Show Alert: Consulting Session on ${sessionDateTime.toLocaleDateString('en-US')}`,
              html: `
                <p>A customer did not show up for their consulting session:</p>
                <ul>
                  <li><strong>Customer:</strong> ${session.first_name} (${session.email})</li>
                  <li><strong>Scheduled Date & Time:</strong> ${sessionDateTime.toLocaleString('en-US')}</li>
                  <li><strong>Assigned Consultant:</strong> ${session.consultant_first_name} ${session.consultant_last_name}</li>
                </ul>
                <p>A follow-up email has been sent to the customer offering to reschedule.</p>
                <p>Please follow up with the consultant and customer as needed.</p>
              `,
            });
          }

          // Record that follow-up was sent
          await db.query(
            `INSERT INTO consulting_session_followups (session_scheduled_id, followup_type, sent_at)
            VALUES ($1, 'no_show', NOW())`,
            [session.id]
          );

          sent++;
        } catch (sessionErr) {
          failed++;
          logger.error('Failed to send no-show follow-up email', {
            session_id: session.session_id,
            error: sessionErr.message,
          });
        }
      }

      if (noShowSessions.length > 0) {
        logger.info('Consulting no-show follow-ups complete', {
          total: noShowSessions.length,
          sent,
          failed,
        });
      }
    } catch (err) {
      logger.error('Consulting no-show follow-up job failed', { error: err.message });
    }
  }, { timezone: 'America/New_York' });
};

module.exports = { startConsultingNoShowFollowup };
