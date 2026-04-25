const db = require('../db');
const logger = require('../utils/logger');
const { sendError, sendSuccess } = require('../utils/apiError');
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');
const { broadcastToUser } = require('../services/socketService');

// Fetch pending notifications
exports.getPendingNotifications = async (req, res) => {
  const user_id = req.user.id;

  try {
    const result = await db.query(
      `SELECT cn.*, a.scheduled_start_time, a.service_description,
        u.first_name, u.avatar_url
       FROM calendar_notifications cn
       JOIN appointments a ON cn.appointment_id = a.id
       LEFT JOIN users u ON (CASE WHEN cn.user_id = a.customer_id THEN a.helper_id ELSE a.customer_id END) = u.id
       WHERE cn.user_id = $1 AND cn.status IN ('pending', 'sent')
       ORDER BY cn.created_at DESC
       LIMIT 50`,
      [user_id]
    );

    return sendSuccess(res, result.rows);
  } catch (err) {
    logger.error('Failed to fetch notifications', { err, user_id });
    return sendError(res, 500, 'Failed to fetch notifications', 'INTERNAL_ERROR');
  }
};

// Mark notification as read
exports.markNotificationAsRead = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  try {
    const result = await db.query(
      `UPDATE calendar_notifications SET opened_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, user_id]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Notification not found', 'NOT_FOUND');
    }

    return sendSuccess(res, result.rows[0]);
  } catch (err) {
    logger.error('Failed to mark notification as read', { err, id, user_id });
    return sendError(res, 500, 'Failed to mark notification as read', 'INTERNAL_ERROR');
  }
};

// Process reminder notifications (cron job)
exports.processReminderNotifications = async () => {
  try {
    // Fetch pending notifications that are due
    const pendingResult = await db.query(
      `SELECT cn.*, a.customer_id, a.helper_id, a.service_description,
        a.scheduled_start_time, a.location_address,
        u_cust.email as customer_email, u_cust.first_name as customer_name,
        u_helper.email as helper_email, u_helper.first_name as helper_name,
        np.appointment_confirmed_channels, np.reminder_24h_channels,
        np.reminder_2h_channels, np.reminder_same_day_channels, np.quiet_hours_start, np.quiet_hours_end
       FROM calendar_notifications cn
       JOIN appointments a ON cn.appointment_id = a.id
       LEFT JOIN users u_cust ON a.customer_id = u_cust.id
       LEFT JOIN users u_helper ON a.helper_id = u_helper.id
       LEFT JOIN notification_preferences np ON cn.user_id = np.user_id
       WHERE cn.status = 'pending'
       AND cn.scheduled_send_at <= CURRENT_TIMESTAMP
       AND a.status IN ('requested', 'confirmed')
       LIMIT 100`
    );

    for (const notification of pendingResult.rows) {
      try {
        await sendNotification(notification);
      } catch (err) {
        logger.warn('Failed to send individual notification', {
          notification_id: notification.id,
          err
        });
      }
    }

    logger.info('Reminder notification processing complete', {
      count: pendingResult.rows.length
    });
  } catch (err) {
    logger.error('Failed to process reminder notifications', { err });
  }
};

// Send a single notification
async function sendNotification(notification) {
  const {
    id: notification_id,
    user_id,
    appointment_id,
    notification_type,
    channel,
    customer_id,
    helper_id,
    customer_email,
    customer_name,
    helper_email,
    helper_name,
    service_description,
    scheduled_start_time,
    location_address,
    appointment_confirmed_channels,
    reminder_24h_channels,
    reminder_2h_channels,
    reminder_same_day_channels,
    quiet_hours_start,
    quiet_hours_end
  } = notification;

  // Check quiet hours
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();
  if (quiet_hours_start && quiet_hours_end) {
    const [startHour, startMin] = quiet_hours_start.split(':').map(Number);
    const [endHour, endMin] = quiet_hours_end.split(':').map(Number);
    const quietStart = startHour * 60 + startMin;
    const quietEnd = endHour * 60 + endMin;

    if (currentTime >= quietStart && currentTime < quietEnd) {
      logger.debug('Notification skipped due to quiet hours', { notification_id, user_id });
      return;
    }
  }

  const isCustomer = user_id === customer_id;
  const recipientEmail = isCustomer ? customer_email : helper_email;
  const recipientName = isCustomer ? customer_name : helper_name;
  const otherName = isCustomer ? helper_name : customer_name;

  let sent = false;
  let error_message = null;

  try {
    // Determine channels based on notification type
    let channels = [channel];
    if (notification_type === 'appointment_confirmed' && appointment_confirmed_channels) {
      channels = appointment_confirmed_channels;
    } else if (notification_type === 'reminder_24h' && reminder_24h_channels) {
      channels = reminder_24h_channels;
    } else if (notification_type === 'reminder_2h' && reminder_2h_channels) {
      channels = reminder_2h_channels;
    } else if (notification_type === 'reminder_same_day' && reminder_same_day_channels) {
      channels = reminder_same_day_channels;
    }

    // Send via email if in channels
    if (channels.includes('email') && recipientEmail) {
      const emailTemplate = getEmailTemplate(notification_type);
      await emailService.send({
        to: recipientEmail,
        subject: getEmailSubject(notification_type, recipientName),
        template: emailTemplate,
        data: {
          name: recipientName,
          otherName,
          serviceDescription: service_description,
          date: new Date(scheduled_start_time).toLocaleDateString(),
          time: new Date(scheduled_start_time).toLocaleTimeString(),
          location: location_address,
          appointmentId: appointment_id
        }
      }).catch(err => {
        throw new Error(`Email send failed: ${err.message}`);
      });
    }

    // Send via SMS if in channels
    if (channels.includes('sms') && user_id) {
      const userResult = await db.query('SELECT phone FROM users WHERE id = $1', [user_id]);
      if (userResult.rows[0]?.phone) {
        await smsService.send({
          to: userResult.rows[0].phone,
          message: getSMSMessage(notification_type, recipientName, new Date(scheduled_start_time)),
        }).catch(err => {
          throw new Error(`SMS send failed: ${err.message}`);
        });
      }
    }

    sent = true;
  } catch (err) {
    error_message = err.message;
    logger.warn('Failed to send notification', {
      notification_id,
      notification_type,
      err
    });
  }

  // Update notification status
  await db.query(
    `UPDATE calendar_notifications SET
      status = $1,
      sent_at = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE sent_at END,
      error_message = $3
     WHERE id = $4`,
    [sent ? 'sent' : 'failed', sent, error_message, notification_id]
  );

  // Send in-app notification
  if (channels.includes('in_app')) {
    broadcastToUser(user_id, 'calendar:notification', {
      type: notification_type,
      appointment_id,
      otherName,
      service: service_description,
      startTime: scheduled_start_time
    });
  }
};

function getEmailTemplate(notificationType) {
  const templates = {
    'appointment_requested': 'appointment_requested',
    'appointment_confirmed': 'appointment_confirmed',
    'appointment_cancelled': 'appointment_cancelled',
    'reminder_24h': 'appointment_reminder_24h',
    'reminder_2h': 'appointment_reminder_2h',
    'reminder_same_day': 'appointment_reminder_same_day',
    'appointment_completed': 'appointment_completed'
  };
  return templates[notificationType] || 'appointment_notification';
}

function getEmailSubject(notificationType, name) {
  const subjects = {
    'appointment_requested': 'New appointment request',
    'appointment_confirmed': 'Your appointment has been confirmed',
    'appointment_cancelled': 'Your appointment has been cancelled',
    'reminder_24h': 'Reminder: Your appointment is coming up',
    'reminder_2h': 'Your appointment is in 2 hours',
    'reminder_same_day': 'Your appointment is today',
    'appointment_completed': 'Appointment completed'
  };
  return subjects[notificationType] || 'Appointment notification';
}

function getSMSMessage(notificationType, name, date) {
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = date.toLocaleDateString();

  const messages = {
    'reminder_24h': `Hi ${name}, reminder: your appointment is tomorrow at ${time}. Reply or call if you need to reschedule.`,
    'reminder_2h': `Hi ${name}, your appointment is in 2 hours at ${time}.`,
    'reminder_same_day': `Hi ${name}, your appointment is today at ${time}. See you soon!`,
    'appointment_confirmed': `Your appointment has been confirmed for ${dateStr} at ${time}.`,
    'appointment_cancelled': `Your appointment for ${dateStr} at ${time} has been cancelled.`
  };

  return messages[notificationType] || `Reminder: appointment on ${dateStr} at ${time}`;
}

// Get notification stats
exports.getNotificationStats = async (req, res) => {
  const user_id = req.user.id;

  try {
    const result = await db.query(
      `SELECT
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN opened_at IS NULL AND status = 'sent' THEN 1 END) as unread_count,
        COUNT(*) as total_count
       FROM calendar_notifications
       WHERE user_id = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '30 days'`,
      [user_id]
    );

    return sendSuccess(res, result.rows[0]);
  } catch (err) {
    logger.error('Failed to fetch notification stats', { err, user_id });
    return sendError(res, 500, 'Failed to fetch notification stats', 'INTERNAL_ERROR');
  }
};
