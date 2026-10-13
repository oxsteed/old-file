const cron = require('node-cron');
const db = require('../db');
const { sendEmailOrThrow } = require('../utils/email');
const { renderOxSteedEmail } = require('../utils/emailTemplate');
const escapeHtml = require('../utils/escapeHtml');
const logger = require('../utils/logger');

/**
 * Every hour, check for consulting sessions scheduled in the next 1-24 hours
 * and send reminder emails if not already sent.
 * Sends two reminder emails:
 * - 24 hours before: "Your session is coming up"
 * - 1 hour before: "Your session starts in 1 hour"
 */
const startConsultingSessionReminders = () => {
  cron.schedule('0 * * * *', async () => {
    try {
      // Find sessions scheduled in the next 24 hours that haven't been reminded yet
      const { rows: sessionsDue } = await db.query(
        `SELECT
          css.id,
          css.session_id,
          css.scheduled_date,
          css.scheduled_time,
          css.meeting_url,
          css.duration_minutes,
          css.meeting_type,
          cs.email,
          cs.first_name,
          cs.business_name
        FROM consulting_sessions_scheduled css
        JOIN consulting_sessions cs ON css.session_id = cs.id
        WHERE css.status = 'confirmed'
          AND css.reminder_sent_at IS NULL
          AND (
            -- 24-hour reminder: session is between 23 and 25 hours away
            (scheduled_date::timestamp + scheduled_time::time >= NOW() + INTERVAL '23 hours'
             AND scheduled_date::timestamp + scheduled_time::time < NOW() + INTERVAL '25 hours')
            OR
            -- 1-hour reminder: session is between 55 minutes and 65 minutes away
            (scheduled_date::timestamp + scheduled_time::time >= NOW() + INTERVAL '55 minutes'
             AND scheduled_date::timestamp + scheduled_time::time < NOW() + INTERVAL '65 minutes')
          )
        ORDER BY css.scheduled_date, css.scheduled_time`
      );

      let sent = 0;
      let failed = 0;

      for (const session of sessionsDue) {
        try {
          const sessionDateTime = new Date(`${session.scheduled_date}T${session.scheduled_time}`);
          const timeUntil = sessionDateTime.getTime() - Date.now();
          const hoursUntil = Math.round(timeUntil / (1000 * 60 * 60));

          let subject, body;
          if (hoursUntil >= 23 && hoursUntil <= 25) {
            subject = 'Reminder: Your OxSteed Consulting Session is Tomorrow';
            body = `Your consulting session is scheduled for tomorrow at ${sessionDateTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}.`;
          } else {
            subject = 'Reminder: Your OxSteed Consulting Session Starts in 1 Hour';
            body = `Your consulting session will start in approximately 1 hour at ${sessionDateTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}.`;
          }

          // P3-3-F19: render through the branded OxSteed template with a text
          // part instead of raw inline HTML.
          const timeStr = sessionDateTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          const dateTimeStr = sessionDateTime.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          const rendered = renderOxSteedEmail({
            language: 'en',
            eyebrow: 'OXSTEED CONSULTING',
            title: subject,
            intro: `Hi ${session.first_name || 'there'},`,
            bodyText: `${body}\n\nSession details:\nDate and time: ${dateTimeStr}\nDuration: ${session.duration_minutes || 120} minutes\nType: ${session.meeting_type || 'zoom'}\nMeeting link: ${session.meeting_url || 'On file'}\n\nPlease be ready to join 5 minutes early.\n\nBest regards,\nThe OxSteed Consulting Team`,
            bodyHtml: `<p>${escapeHtml(body)}</p><p><strong>Session details:</strong></p><ul><li><strong>Date and time:</strong> ${escapeHtml(dateTimeStr)}</li><li><strong>Duration:</strong> ${escapeHtml(String(session.duration_minutes || 120))} minutes</li><li><strong>Type:</strong> ${escapeHtml(session.meeting_type || 'zoom')}</li><li><strong>Meeting link:</strong> ${session.meeting_url ? `<a href="${escapeHtml(session.meeting_url)}">${escapeHtml(session.meeting_url)}</a>` : 'On file'}</li></ul><p>Please be ready to join 5 minutes early.</p><p>Best regards,<br>The OxSteed Consulting Team</p>`,
            footerText: 'You are receiving this message because you booked an OxSteed consulting session.',
          });
          await sendEmailOrThrow({
            to: session.email,
            idempotencyKey: `consulting-session-reminder:${session.id}:${hoursUntil >= 23 && hoursUntil <= 25 ? '24h' : '1h'}`,
            subject,
            text: rendered.text,
            html: rendered.html,
          });

          // Mark reminder as sent
          await db.query(
            'UPDATE consulting_sessions_scheduled SET reminder_sent_at = NOW() WHERE id = $1',
            [session.id]
          );

          sent++;
        } catch (sessionErr) {
          failed++;
          logger.error('Failed to send consulting session reminder', {
            session_id: session.session_id,
            error: sessionErr.message,
          });
        }
      }

      if (sessionsDue.length > 0) {
        logger.info('Consulting session reminders complete', {
          total: sessionsDue.length,
          sent,
          failed,
        });
      }
    } catch (err) {
      logger.error('Consulting session reminder job failed', { error: err.message });
    }
  }, { timezone: 'America/New_York' });
};

module.exports = { startConsultingSessionReminders };
