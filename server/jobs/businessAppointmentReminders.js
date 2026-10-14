'use strict';

// Review P2-3-F04: setupReminderSchedule wrote business_appointment_reminders
// rows that no worker ever read, so appointment reminders never sent. This
// job drains those rows every 15 minutes: due reminders go to the customer
// (in-app + email via the notification service, or direct email for guest
// bookings) and to the business owner. Delivery is claimed with an atomic
// UPDATE ... WHERE delivery_status='pending' so concurrent workers cannot
// double-send. Reminders whose appointment already started are marked failed
// as superseded instead of being sent late.

const db = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('../services/notificationService');
const { sendEmailOrThrow } = require('../utils/email');
const { renderOxSteedEmail } = require('../utils/emailTemplate');
const escapeHtml = require('../utils/escapeHtml');

function reminderSubject(hoursBefore) {
  if (hoursBefore >= 24) return 'Reminder: your appointment is tomorrow';
  if (hoursBefore >= 2) return 'Reminder: your appointment is in a few hours';
  return 'Reminder: your appointment is coming up soon';
}

async function processDueReminders() {
  // Retire reminders for appointments that already started: sending them now
  // would be noise, and 'pending' rows must not accumulate forever.
  await db.query(
    `UPDATE business_appointment_reminders r
        SET delivery_status = 'failed',
            failure_reason = 'superseded: appointment already started'
      WHERE r.delivery_status = 'pending'
        AND EXISTS (
          SELECT 1 FROM business_appointments ba
          WHERE ba.id = r.appointment_id AND ba.start_time <= NOW()
        )`
  ).catch((err) => logger.warn('Business appointment reminder supersede sweep failed', { error: err.message }));

  const { rows: due } = await db.query(
    `SELECT r.id AS reminder_id, r.hours_before, r.scheduled_at,
            ba.id AS appointment_id, ba.business_id, ba.service_id,
            ba.start_time, ba.end_time, ba.status,
            ba.customer_id, ba.customer_name, ba.customer_email,
            b.business_name, b.user_id AS owner_id,
            bs.name AS service_name
       FROM business_appointment_reminders r
       JOIN business_appointments ba ON ba.id = r.appointment_id
       JOIN businesses b ON b.id = ba.business_id
  LEFT JOIN business_services bs ON bs.id = ba.service_id
      WHERE r.delivery_status = 'pending'
        AND r.sent_at IS NULL
        AND r.scheduled_at <= NOW()
        AND ba.start_time > NOW()
        AND ba.status NOT IN ('cancelled', 'completed', 'no_show')
      ORDER BY r.scheduled_at ASC
      LIMIT 100`
  );

  let sent = 0;
  let failed = 0;

  for (const row of due) {
    // Atomic claim: only one worker processes a reminder.
    const { rows: claimed } = await db.query(
      `UPDATE business_appointment_reminders
          SET delivery_status = 'sent', sent_at = NOW()
        WHERE id = $1 AND delivery_status = 'pending'
        RETURNING id`,
      [row.reminder_id]
    );
    if (!claimed.length) continue;

    const when = new Date(row.start_time).toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const subject = reminderSubject(Number(row.hours_before) || 0);
    const bodyText = `This is a reminder for your upcoming appointment.\n\n`
      + `Service: ${row.service_name || 'Appointment'}\n`
      + `Business: ${row.business_name || ''}\n`
      + `When: ${when}\n\n`
      + `Please arrive a few minutes early. Reply to this email if you need to reschedule.`;
    const idempotencyKey = `business-appointment-reminder:${row.reminder_id}`;

    try {
      const recipientIds = [...new Set(
        [row.customer_id, row.owner_id].filter(Boolean).map(String)
      )];
      await Promise.allSettled(recipientIds.map((userId) => sendNotification({
        userId,
        type: 'appointment_reminder',
        title: subject,
        body: `${row.service_name || 'Appointment'} on ${when}.`,
        data: {
          appointment_id: String(row.appointment_id),
          business_id: String(row.business_id),
        },
        action_url: `/businesses/${row.business_id}/calendar`,
        idempotencyKey: `${idempotencyKey}:${userId}`,
      })));

      // Guest bookings have no customer_id: email the contact address directly.
      if (!row.customer_id && row.customer_email) {
        const rendered = renderOxSteedEmail({
          language: 'en',
          eyebrow: 'APPOINTMENT REMINDER',
          title: subject,
          intro: `Hi ${row.customer_name || 'there'},`,
          bodyText,
          bodyHtml: `<p>${escapeHtml(bodyText).replace(/\n/g, '<br>')}</p>`,
          footerText: 'You are receiving this message because you booked an appointment.',
        });
        await sendEmailOrThrow({
          to: row.customer_email,
          idempotencyKey: `${idempotencyKey}:guest`,
          subject,
          text: rendered.text,
          html: rendered.html,
        });
      }
      sent++;
    } catch (err) {
      failed++;
      logger.error('Failed to send business appointment reminder', {
        reminderId: row.reminder_id,
        appointmentId: row.appointment_id,
        error: err.message,
      });
      await db.query(
        `UPDATE business_appointment_reminders
            SET delivery_status = 'failed', failure_reason = $2
          WHERE id = $1`,
        [row.reminder_id, String(err.message || 'send failed').slice(0, 500)]
      ).catch(() => {});
    }
  }

  if (sent || failed) {
    logger.info('Business appointment reminder sweep complete', { sent, failed });
  }
  return { sent, failed };
}

// Run every 15 minutes to process due appointment reminders.
function startBusinessAppointmentReminderJob() {
  const interval = setInterval(async () => {
    try {
      await processDueReminders();
    } catch (err) {
      logger.error('Business appointment reminder job failed', { error: err.message });
    }
  }, 15 * 60 * 1000);

  logger.info('Business appointment reminder job started');
  return { stop: () => clearInterval(interval) };
}

module.exports = { startBusinessAppointmentReminderJob, processDueReminders };
