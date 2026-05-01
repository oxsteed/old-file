// server/controllers/calendarNotificationController.js
//
// Three responsibilities:
//   * HTTP endpoints: list / mark-read / stats for the current user.
//   * Cron worker: processReminderNotifications() - fired by jobs/calendarReminders.
//   * Helper: respect quiet-hours and notification_preferences.

const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const emailService = require('../services/emailService');
const { sendSMS } = require('../utils/sms');
const { broadcastToUser } = require('../services/socketService');
const { renderAppointmentEmail, renderAppointmentSms } = require('../utils/calendarEmails');

const REMINDER_TYPES = new Set([
  'appointment_requested',
  'appointment_confirmed',
  'appointment_cancelled',
  'appointment_rescheduled',
  'reminder_24h',
  'reminder_2h',
  'reminder_same_day',
  'appointment_completed',
]);

const SUBJECT_BY_TYPE = {
  appointment_requested:  'New appointment request',
  appointment_confirmed:  'Your appointment is confirmed',
  appointment_cancelled:  'Your appointment has been cancelled',
  reminder_24h:           'Reminder: your appointment is tomorrow',
  reminder_2h:            'Reminder: your appointment is in 2 hours',
  reminder_same_day:      'Reminder: your appointment is today',
  appointment_completed:  'Appointment completed',
};

// ─── HTTP: list pending + sent notifications ─────────────────
exports.getPendingNotifications = async (req, res, next) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT cn.*,
              a.scheduled_start_time,
              a.service_description,
              a.customer_id,
              a.helper_id,
              other.first_name        AS other_name,
              other.profile_photo_url AS other_avatar
         FROM calendar_notifications cn
         JOIN appointments a ON cn.appointment_id = a.id
         LEFT JOIN users other ON other.id = CASE
              WHEN cn.user_id = a.customer_id THEN a.helper_id
              ELSE a.customer_id
            END
        WHERE cn.user_id = $1
          AND cn.status IN ('pending','sent')
        ORDER BY cn.created_at DESC
        LIMIT 50`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

// ─── HTTP: mark as read ──────────────────────────────────────
exports.markNotificationAsRead = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    if (!/^\d+$/.test(String(id))) {
      throw new AppError('Invalid notification id', 400, 'validation_failed', { id: 'Must be a numeric ID' });
    }

    const r = await pool.query(
      `UPDATE calendar_notifications
          SET opened_at = COALESCE(opened_at, now())
        WHERE id = $1 AND user_id = $2
        RETURNING *`,
      [id, userId]
    );
    if (r.rows.length === 0) {
      throw new AppError('Notification not found', 404, 'not_found');
    }
    res.json(r.rows[0]);
  } catch (err) {
    next(err);
  }
};

// ─── HTTP: stats (last 30 days) ──────────────────────────────
exports.getNotificationStats = async (req, res, next) => {
  const userId = req.user.id;
  try {
    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int                                 AS pending_count,
         COUNT(*) FILTER (WHERE opened_at IS NULL AND status = 'sent')::int              AS unread_count,
         COUNT(*)::int                                                                    AS total_count
       FROM calendar_notifications
       WHERE user_id = $1
         AND created_at > now() - interval '30 days'`,
      [userId]
    );
    res.json(r.rows[0]);
  } catch (err) {
    next(err);
  }
};

// ─── CRON: dispatch due notifications ────────────────────────
exports.processReminderNotifications = async () => {
  let dueRows;
  try {
    const result = await pool.query(
      `SELECT cn.id                AS notification_id,
              cn.user_id,
              cn.appointment_id,
              cn.notification_type,
              cn.channel,
              a.customer_id, a.helper_id, a.service_description,
              a.scheduled_start_time, a.location_address,
              cust.email AS customer_email, cust.first_name AS customer_name, cust.phone AS customer_phone,
              hlp.email  AS helper_email,   hlp.first_name  AS helper_name,   hlp.phone  AS helper_phone,
              np.appointment_confirmed_channels,
              np.appointment_cancelled_channels,
              np.reminder_24h_channels,
              np.reminder_2h_channels,
              np.reminder_same_day_channels,
              np.quiet_hours_start,
              np.quiet_hours_end,
              np.timezone
         FROM calendar_notifications cn
         JOIN appointments a   ON a.id = cn.appointment_id
         LEFT JOIN users cust  ON cust.id = a.customer_id
         LEFT JOIN users hlp   ON hlp.id  = a.helper_id
         LEFT JOIN notification_preferences np ON np.user_id = cn.user_id
        WHERE cn.status = 'pending'
          AND cn.scheduled_send_at <= now()
          AND a.status IN ('requested','confirmed','in_progress')
        ORDER BY cn.scheduled_send_at
        LIMIT 100`
    );
    dueRows = result.rows;
  } catch (err) {
    logger.error('processReminderNotifications: query failed', { err: err.message });
    return;
  }

  for (const row of dueRows) {
    try {
      await dispatchNotification(row);
    } catch (err) {
      // dispatchNotification already updates cn.status = 'failed';
      // this catch is the outer safety net.
      logger.warn('Calendar notification dispatch threw', {
        notification_id: row.notification_id,
        err: err.message,
      });
    }
  }

  if (dueRows.length > 0) {
    logger.info('Calendar reminders processed', { count: dueRows.length });
  }
};

// ─── internal: dispatch one notification ─────────────────────
async function dispatchNotification(row) {
  const {
    notification_id,
    user_id,
    appointment_id,
    notification_type,
    channel,
    customer_id,
    customer_email, customer_name, customer_phone,
    helper_email,   helper_name,   helper_phone,
    service_description,
    scheduled_start_time,
    location_address,
    appointment_confirmed_channels,
    appointment_cancelled_channels,
    reminder_24h_channels,
    reminder_2h_channels,
    reminder_same_day_channels,
    quiet_hours_start, quiet_hours_end, timezone,
  } = row;

  // Quiet hours - return without sending; we leave status as 'pending' so the
  // notification fires on the next cron tick after the quiet window ends.
  if (quiet_hours_start && quiet_hours_end) {
    if (isInQuietHours(timezone || 'UTC', quiet_hours_start, quiet_hours_end)) {
      logger.debug('Calendar notification deferred - quiet hours', {
        notification_id, user_id, timezone,
      });
      return;
    }
  }

  const isCustomer = user_id === customer_id;
  const recipientEmail = isCustomer ? customer_email : helper_email;
  const recipientName  = isCustomer ? customer_name  : helper_name;
  const recipientPhone = isCustomer ? customer_phone : helper_phone;
  const otherName      = isCustomer ? helper_name    : customer_name;

  // Resolve channels:
  //   * Each row has its own `channel` (we usually create rows with channel='in_app');
  //   * For email/sms reminders we look at the user's preference array and broadcast
  //     in-app + email + sms as appropriate. If no prefs row exists yet, fall back
  //     to the row's `channel`.
  const prefMap = {
    appointment_confirmed: appointment_confirmed_channels,
    appointment_cancelled: appointment_cancelled_channels,
    reminder_24h:          reminder_24h_channels,
    reminder_2h:           reminder_2h_channels,
    reminder_same_day:     reminder_same_day_channels,
  };
  const channels = (prefMap[notification_type] && prefMap[notification_type].length)
    ? prefMap[notification_type]
    : [channel];

  let sent = false;
  let lastError = null;

  // In-app via Socket.IO
  if (channels.includes('in_app')) {
    try {
      broadcastToUser(user_id, 'calendar:notification', {
        type: notification_type,
        appointmentId: appointment_id,
        otherName,
        service: service_description,
        startTime: scheduled_start_time,
      });
      sent = true;
    } catch (err) {
      lastError = err.message;
    }
  }

  // Email
  if (channels.includes('email') && recipientEmail) {
    try {
      const html = renderAppointmentEmail(notification_type, {
        recipientName: recipientName || 'there',
        otherName,
        service: service_description,
        when: scheduled_start_time,
        location: location_address,
      });
      await emailService.send({
        to: recipientEmail,
        subject: SUBJECT_BY_TYPE[notification_type] || 'Appointment notification',
        html,
      });
      sent = true;
    } catch (err) {
      lastError = `email: ${err.message}`;
    }
  }

  // SMS
  if (channels.includes('sms') && recipientPhone) {
    try {
      const body = renderAppointmentSms(notification_type, {
        recipientName: recipientName || '',
        when: scheduled_start_time,
      });
      const result = await sendSMS(recipientPhone, body);
      if (result && result.success) sent = true;
      else lastError = `sms: ${result?.error || 'unknown'}`;
    } catch (err) {
      lastError = `sms: ${err.message}`;
    }
  }

  await pool.query(
    `UPDATE calendar_notifications
        SET status        = $1,
            sent_at       = CASE WHEN $1 = 'sent' THEN now() ELSE sent_at END,
            error_message = $2
      WHERE id = $3`,
    [sent ? 'sent' : 'failed', lastError, notification_id]
  );
}

// ─── internal: quiet-hours check ─────────────────────────────
function isInQuietHours(timezone, startHHMM, endHHMM) {
  try {
    const [sh, sm] = String(startHHMM).split(':').map(Number);
    const [eh, em] = String(endHHMM).split(':').map(Number);
    if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return false;

    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
    });
    const parts = formatter.formatToParts(new Date());
    const hr = Number(parts.find(p => p.type === 'hour')?.value || 0);
    const mn = Number(parts.find(p => p.type === 'minute')?.value || 0);
    const cur = hr * 60 + mn;
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    return start <= end
      ? (cur >= start && cur < end)
      : (cur >= start || cur < end);
  } catch (err) {
    logger.warn('Quiet-hours evaluation failed; treating as not-quiet', {
      timezone, err: err.message,
    });
    return false;
  }
}
