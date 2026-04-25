const cron = require('node-cron');
const db = require('../db');
const { sendEmail } = require('../utils/email');
const logger = require('../utils/logger');

/**
 * Every day at 6pm Eastern
 * Check for consulting sessions completed today and send follow-up emails
 * with action items and feedback request to customers.
 */
const startConsultingPostSessionFollowup = () => {
  cron.schedule('0 18 * * *', async () => {
    try {
      // Find sessions marked as completed today
      const { rows: completedSessions } = await db.query(
        `SELECT
          css.id,
          css.session_id,
          css.scheduled_date,
          css.scheduled_time,
          css.duration_minutes,
          cs.email,
          cs.first_name,
          cs.business_name,
          c.first_name as consultant_first_name,
          c.last_name as consultant_last_name
        FROM consulting_sessions_scheduled css
        JOIN consulting_sessions cs ON css.session_id = cs.id
        LEFT JOIN consultants c ON cs.consultant_assigned_id = c.user_id
        WHERE css.status = 'completed'
          AND DATE(css.updated_at) = CURRENT_DATE
          AND NOT EXISTS (
            SELECT 1 FROM consulting_session_followups
            WHERE session_scheduled_id = css.id
          )
        ORDER BY css.scheduled_date, css.scheduled_time`
      );

      let sent = 0;
      let failed = 0;

      for (const session of completedSessions) {
        try {
          // Fetch action items for this session that are visible to client
          const { rows: actionItems } = await db.query(
            `SELECT id, title, description, due_date, priority, assigned_to_type
            FROM consulting_action_items
            WHERE session_id = $1 AND client_visible = true
            ORDER BY priority DESC, due_date ASC`,
            [session.session_id]
          );

          const consultantName = session.consultant_first_name
            ? `${session.consultant_first_name} ${session.consultant_last_name}`
            : 'Your Consultant';

          // Build action items HTML
          let actionItemsHtml = '';
          if (actionItems.length > 0) {
            actionItemsHtml = '<h3>Action Items:</h3><ul>';
            for (const item of actionItems) {
              const dueDate = item.due_date ? new Date(item.due_date).toLocaleDateString('en-US') : 'N/A';
              actionItemsHtml += `
                <li>
                  <strong>${item.title}</strong> (${item.priority.charAt(0).toUpperCase() + item.priority.slice(1)} Priority, Due: ${dueDate})
                  ${item.description ? `<br/><em>${item.description}</em>` : ''}
                </li>
              `;
            }
            actionItemsHtml += '</ul>';
          } else {
            actionItemsHtml = '<p>No action items assigned at this time.</p>';
          }

          // Send follow-up email to customer
          await sendEmail({
            to: session.email,
            subject: 'Thank You for Your OxSteed Consulting Session',
            html: `
              <p>Hi ${session.first_name},</p>
              <p>Thank you for participating in your consulting session with ${consultantName} on ${new Date(`${session.scheduled_date}T${session.scheduled_time}`).toLocaleDateString('en-US')}!</p>
              <p>We hope you found the session valuable and actionable. Below are the action items discussed:</p>
              ${actionItemsHtml}
              <p><strong>Next Steps:</strong></p>
              <ul>
                <li>Review the action items above</li>
                <li>Work on items assigned to you according to the due dates</li>
                <li>Reach out if you have any questions or need clarification</li>
                <li>Schedule your next session when you're ready for the next phase</li>
              </ul>
              <p>We'd love to hear about your experience! <a href="https://oxsteed.com/consulting/feedback/${session.session_id}">Please provide feedback here</a>.</p>
              <p>Best regards,<br>The OxSteed Consulting Team</p>
            `,
          });

          // Record that follow-up was sent
          await db.query(
            `INSERT INTO consulting_session_followups (session_scheduled_id, followup_type, sent_at)
            VALUES ($1, 'post_session', NOW())`,
            [session.id]
          );

          sent++;
        } catch (sessionErr) {
          failed++;
          logger.error('Failed to send post-session follow-up email', {
            session_id: session.session_id,
            error: sessionErr.message,
          });
        }
      }

      if (completedSessions.length > 0) {
        logger.info('Consulting post-session follow-ups complete', {
          total: completedSessions.length,
          sent,
          failed,
        });
      }
    } catch (err) {
      logger.error('Consulting post-session follow-up job failed', { error: err.message });
    }
  }, { timezone: 'America/New_York' });
};

module.exports = { startConsultingPostSessionFollowup };
