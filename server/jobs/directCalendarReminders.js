'use strict';

const db = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');
const escapeHtml = require('../utils/escapeHtml');
const { renderOxSteedEmail } = require('../utils/emailTemplate');

function reminderTypeFor(startAt) {
  const hoursUntil = (new Date(startAt).getTime() - Date.now()) / (60 * 60 * 1000);
  if (hoursUntil >= 23 && hoursUntil < 25) return '24_hour';
  if (hoursUntil >= 1 && hoursUntil < 3) return '2_hour';
  return null;
}

async function claimDelivery(requestId, reminderType, recipientEmail) {
  const { rows } = await db.query(
    `INSERT INTO direct_calendar_reminder_deliveries
       (request_id, reminder_type, recipient_email, status, attempts, created_at, updated_at)
     VALUES ($1, $2, $3, 'processing', 1, NOW(), NOW())
     ON CONFLICT (request_id, reminder_type, recipient_email) DO UPDATE SET
       status = 'processing',
       attempts = direct_calendar_reminder_deliveries.attempts + 1,
       last_error = NULL,
       updated_at = NOW()
     WHERE direct_calendar_reminder_deliveries.status <> 'sent'
       AND direct_calendar_reminder_deliveries.attempts < 3
       AND direct_calendar_reminder_deliveries.updated_at < NOW() - INTERVAL '10 minutes'
     RETURNING id`,
    [requestId, reminderType, recipientEmail]
  );
  return rows[0]?.id || null;
}

async function processDirectCalendarReminders() {
  const { rows: requests } = await db.query(
    `SELECT quote_requests.id, quote_requests.first_name, quote_requests.email,
            quote_requests.service_category, quote_requests.service_location,
            quote_requests.scheduled_start_at,
            assignee.email AS assignee_email
       FROM quote_requests
       LEFT JOIN users assignee ON assignee.id = quote_requests.assigned_to
      WHERE COALESCE(quote_requests.metadata->>'flow', 'direct') = 'direct'
        AND quote_requests.status NOT IN ('cancelled', 'closed', 'completed')
        AND quote_requests.scheduled_start_at >= NOW() + INTERVAL '1 hour'
        AND quote_requests.scheduled_start_at < NOW() + INTERVAL '25 hours'
        AND quote_requests.email IS NOT NULL
      ORDER BY quote_requests.scheduled_start_at ASC
      LIMIT 200`
  );
  let sent = 0;
  let failed = 0;
  for (const request of requests) {
    const reminderType = reminderTypeFor(request.scheduled_start_at);
    if (!reminderType) continue;
    const recipients = Array.from(new Set([request.email, request.assignee_email].filter(Boolean).map((email) => String(email).trim().toLowerCase())));
    for (const recipient of recipients) {
      const deliveryId = await claimDelivery(request.id, reminderType, recipient);
      if (!deliveryId) continue;
      try {
        const when = new Date(request.scheduled_start_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });
        const lead = reminderType === '24_hour' ? 'tomorrow' : 'in about 2 hours';
        const safeService = escapeHtml(request.service_category || 'Direct service');
        const safeWhen = escapeHtml(when);
        const safeLocation = escapeHtml(request.service_location || 'On file');
        const safeRequestId = escapeHtml(request.id);
        const bodyText = `Your OxSteed Direct service is scheduled ${lead}.\nService: ${request.service_category || 'Direct service'}\nWhen: ${when}\nLocation: ${request.service_location || 'On file'}\nReference: #${request.id}`;
        const rendered = renderOxSteedEmail({
          language: 'en',
          eyebrow: 'OXSTEED DIRECT',
          title: 'Scheduled service reminder',
          intro: `Hi ${request.first_name || 'there'},`,
          bodyText,
          bodyHtml: `<p>Your OxSteed Direct service is scheduled ${lead}.</p><p><strong>Service:</strong> ${safeService}<br /><strong>When:</strong> ${safeWhen}<br /><strong>Location:</strong> ${safeLocation}</p><p>Reference: #${safeRequestId}</p>`,
          footerText: 'OxSteed - local trades marketplace',
        });
        await sendEmail({
          to: recipient,
          subject: `OxSteed Direct reminder: ${request.service_category || 'scheduled service'}`,
          text: rendered.text,
          html: rendered.html,
          idempotencyKey: `direct-calendar-reminder:${request.id}:${reminderType}:${recipient}`,
        });
        await db.query('UPDATE direct_calendar_reminder_deliveries SET status = \'sent\', sent_at = NOW(), updated_at = NOW() WHERE id = $1', [deliveryId]);
        sent++;
      } catch (err) {
        failed++;
        await db.query('UPDATE direct_calendar_reminder_deliveries SET status = \'failed\', last_error = $2, updated_at = NOW() WHERE id = $1', [deliveryId, String(err.message || 'send failed').slice(0, 500)]);
        logger.error('Direct calendar reminder delivery failed', { requestId: request.id, recipient, error: err.message });
      }
    }
  }
  return { sent, failed };
}

// Review P1-183: paid, scheduled Direct visits used to sit in `scheduled`
// forever. Complete them once the visit window has ended.
async function completeFinishedDirectVisits() {
  const { rows } = await db.query(
    `WITH done AS (
       UPDATE quote_requests
          SET status = 'completed', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
        WHERE COALESCE(metadata->>'flow', 'direct') = 'direct'
          AND status = 'scheduled'
          AND payment_status IN ('paid', 'confirmed')
          AND COALESCE(scheduled_end_at, scheduled_start_at) < NOW() - INTERVAL '1 hour'
        RETURNING id)
     INSERT INTO direct_request_events (quote_request_id, actor_role, event_type, title, details, payload)
     SELECT id, 'system', 'request_completed', 'Visit completed', 'The visit window ended and payment is settled.', '{}'::jsonb
       FROM done
     RETURNING quote_request_id`
  );
  return rows.length;
}

function startDirectCalendarReminderJob() {
  const interval = setInterval(() => {
    processDirectCalendarReminders().catch((err) => logger.error('Direct calendar reminder job failed', { error: err.message }));
    completeFinishedDirectVisits().catch((err) => logger.error('Direct auto-complete sweep failed', { error: err.message }));
  }, 5 * 60 * 1000);
  logger.info('Direct calendar reminder job started');
  return { stop: () => clearInterval(interval) };
}

module.exports = { processDirectCalendarReminders, completeFinishedDirectVisits, startDirectCalendarReminderJob };
