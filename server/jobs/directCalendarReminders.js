'use strict';

const db = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');
const escapeHtml = require('../utils/escapeHtml');

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
        await sendEmail({
          to: recipient,
          subject: `OxSteed Direct reminder: ${request.service_category || 'scheduled service'}`,
          html: `<p>Hi ${escapeHtml(request.first_name || 'there')},</p><p>Your OxSteed Direct service is scheduled ${lead}.</p><p><strong>Service:</strong> ${escapeHtml(request.service_category || 'Direct service')}<br /><strong>When:</strong> ${escapeHtml(when)}<br /><strong>Location:</strong> ${escapeHtml(request.service_location || 'On file')}</p><p>Reference: #${escapeHtml(request.id)}</p>`,
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

function startDirectCalendarReminderJob() {
  const interval = setInterval(() => {
    processDirectCalendarReminders().catch((err) => logger.error('Direct calendar reminder job failed', { error: err.message }));
  }, 5 * 60 * 1000);
  logger.info('Direct calendar reminder job started');
  return { stop: () => clearInterval(interval) };
}

module.exports = { processDirectCalendarReminders, startDirectCalendarReminderJob };
