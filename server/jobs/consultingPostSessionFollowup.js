const cron = require('node-cron');
const crypto = require('crypto');
const db = require('../db');
const { sendEmailOrThrow } = require('../utils/email');
const { renderOxSteedEmail } = require('../utils/emailTemplate');
const escapeHtml = require('../utils/escapeHtml');
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
          cons_u.first_name as consultant_first_name,
          cons_u.last_name as consultant_last_name
        FROM consulting_sessions_scheduled css
        JOIN consulting_sessions cs ON css.session_id = cs.id
        LEFT JOIN consultants c ON cs.consultant_id = c.id
        LEFT JOIN users cons_u ON c.user_id = cons_u.id
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
          const feedbackToken = crypto.randomBytes(32).toString('hex');
          const feedbackTokenHash = crypto.createHash('sha256').update(feedbackToken).digest('hex');
          await db.query(
            `UPDATE consulting_sessions_scheduled
                SET feedback_token_hash = $1,
                    feedback_token_expires_at = NOW() + INTERVAL '30 days',
                    feedback_token_used_at = NULL,
                    updated_at = NOW()
              WHERE id = $2`,
            [feedbackTokenHash, session.id]
          );

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

          // Build action items as escaped HTML + plain text for the branded
          // template (P3-3-F19: no raw untemplated HTML, always a text part).
          let actionItemsHtml = '';
          let actionItemsText = '';
          if (actionItems.length > 0) {
            actionItemsHtml = '<h3>Action Items:</h3><ul>';
            actionItemsText = 'Action items:\n';
            for (const item of actionItems) {
              const dueDate = item.due_date ? new Date(item.due_date).toLocaleDateString('en-US') : 'N/A';
              const priorityLabel = item.priority
                ? item.priority.charAt(0).toUpperCase() + item.priority.slice(1)
                : 'Normal';
              actionItemsHtml += `<li><strong>${escapeHtml(item.title)}</strong> (${escapeHtml(priorityLabel)} Priority, Due: ${escapeHtml(dueDate)})${item.description ? `<br/><em>${escapeHtml(item.description)}</em>` : ''}</li>`;
              actionItemsText += `- ${item.title} (${priorityLabel} priority, due: ${dueDate})${item.description ? ` - ${item.description}` : ''}\n`;
            }
            actionItemsHtml += '</ul>';
          } else {
            actionItemsHtml = '<p>No action items assigned at this time.</p>';
            actionItemsText = 'No action items assigned at this time.\n';
          }

          const sessionDateStr = new Date(`${session.scheduled_date}T${session.scheduled_time}`).toLocaleDateString('en-US');
          const appBase = process.env.APP_URL || process.env.CLIENT_URL || 'https://oxsteed.com';
          const feedbackUrl = `${appBase}/consulting/feedback/${session.session_id}/${feedbackToken}`;
          const postSession = renderOxSteedEmail({
            language: 'en',
            eyebrow: 'OXSTEED CONSULTING',
            title: 'Thank you for your session',
            intro: `Hi ${session.first_name || 'there'},`,
            bodyText: `Thank you for participating in your consulting session with ${consultantName} on ${sessionDateStr}.\n\nWe hope you found the session valuable and actionable. Below are the action items discussed:\n\n${actionItemsText}\nNext steps:\n- Review the action items above.\n- Work on items assigned to you according to the due dates.\n- Reach out if you have any questions or need clarification.\n- Schedule your next session when you are ready for the next phase.\n\nReady to execute? Find a helper on OxSteed: ${appBase}/post-job (or browse helpers: ${appBase}/helpers). Many action items benefit from hands-on help while you focus on growing your business.\n\nWe would love to hear about your experience. Please provide your feedback here (takes less than 2 minutes): ${feedbackUrl}\n\nBest regards,\nThe OxSteed Consulting Team`,
            bodyHtml: `<p>Thank you for participating in your consulting session with ${escapeHtml(consultantName)} on ${escapeHtml(sessionDateStr)}.</p><p>We hope you found the session valuable and actionable. Below are the action items discussed:</p>${actionItemsHtml}<p><strong>Next steps:</strong></p><ul><li>Review the action items above</li><li>Work on items assigned to you according to the due dates</li><li>Reach out if you have any questions or need clarification</li><li>Schedule your next session when you are ready for the next phase</li></ul><p>Many action items benefit from hands-on help. <a href="${escapeHtml(appBase)}/post-job">Post a job</a> or <a href="${escapeHtml(appBase)}/helpers">browse helpers</a> on OxSteed while you focus on growing your business.</p><p>We would love to hear about your experience. <a href="${escapeHtml(feedbackUrl)}">Please provide your feedback here</a> (takes less than 2 minutes).</p><p>Best regards,<br>The OxSteed Consulting Team</p>`,
            footerText: 'You are receiving this message because you booked an OxSteed consulting session.',
            cta: { url: `${appBase}/consulting/feedback/${session.session_id}/${feedbackToken}`, label: 'Share your feedback' },
          });

          // Send follow-up email to customer
          await sendEmailOrThrow({
            to: session.email,
            idempotencyKey: `consulting-post-session:${session.id}`,
            subject: 'Thank You for Your OxSteed Consulting Session',
            text: postSession.text,
            html: postSession.html,
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
