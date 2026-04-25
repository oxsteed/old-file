const db = require('../db');
const logger = require('../utils/logger');
const { validateInput, rules } = require('../utils/validate');
const { sendError, sendSuccess } = require('../utils/apiError');
const { withTransaction } = require('../utils/transaction');
const emailService = require('../services/emailService');
const { broadcastToUser } = require('../services/socketService');

const APPOINTMENT_STATUSES = ['requested', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rescheduled'];

// Create appointment request
exports.createAppointment = async (req, res) => {
  const { helper_id, job_id, service_description, scheduled_start_time, scheduled_end_time, location_address, location_lat, location_lng, estimated_duration_minutes, customer_notes } = req.body;
  const customer_id = req.user.id;

  const validation = validateInput(req.body, {
    helper_id: [rules.required(), rules.isNumber()],
    service_description: [rules.required(), rules.minLen(5), rules.maxLen(500)],
    scheduled_start_time: [rules.required()],
    scheduled_end_time: [rules.required()],
    estimated_duration_minutes: [rules.required(), rules.isNumber(), rules.min(15), rules.max(480)],
  });

  if (!validation.valid) return sendError(res, 400, 'Validation failed', 'VALIDATION_ERROR', validation.errors);

  const start = new Date(scheduled_start_time);
  const end = new Date(scheduled_end_time);

  if (end <= start) {
    return sendError(res, 400, 'End time must be after start time', 'INVALID_TIME_RANGE');
  }

  const minAdvanceMinutes = 15;
  const minTime = new Date(Date.now() + minAdvanceMinutes * 60000);
  if (start < minTime) {
    return sendError(res, 400, `Appointments must be scheduled at least ${minAdvanceMinutes} minutes in advance`, 'INSUFFICIENT_ADVANCE_TIME');
  }

  try {
    // Verify helper exists and is active
    const helperResult = await db.query(
      `SELECT id, role, is_active FROM users WHERE id = $1 AND is_active = TRUE`,
      [helper_id]
    );

    if (helperResult.rows.length === 0) {
      return sendError(res, 404, 'Helper not found or inactive', 'HELPER_NOT_FOUND');
    }

    const helper = helperResult.rows[0];
    if (!['helper', 'helper_pro', 'broker'].includes(helper.role)) {
      return sendError(res, 400, 'User is not a helper', 'NOT_A_HELPER');
    }

    // Check for conflicts with existing appointments (including pending requests)
    const conflictResult = await db.query(
      `SELECT id FROM appointments
       WHERE helper_id = $1
       AND status IN ('requested', 'confirmed', 'in_progress')
       AND scheduled_start_time < $3
       AND scheduled_end_time > $2
       LIMIT 1`,
      [helper_id, start, end]
    );

    if (conflictResult.rows.length > 0) {
      return sendError(res, 409, 'Helper has conflicting appointment', 'SCHEDULING_CONFLICT');
    }

    // Check availability blocks (unavailable or busy)
    const unavailableResult = await db.query(
      `SELECT id FROM availability_blocks
       WHERE helper_id = $1
       AND type IN ('unavailable', 'busy')
       AND start_time < $3
       AND end_time > $2
       LIMIT 1`,
      [helper_id, start, end]
    );

    if (unavailableResult.rows.length > 0) {
      return sendError(res, 409, 'Helper is unavailable during requested time', 'HELPER_UNAVAILABLE');
    }

    // Create appointment
    const result = await withTransaction(async (client) => {
      const appointmentResult = await client.query(
        `INSERT INTO appointments (
          customer_id, helper_id, job_id, service_description,
          scheduled_start_time, scheduled_end_time, estimated_duration_minutes,
          location_address, location_lat, location_lng, customer_notes, status, created_by_user_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'requested', $12)
        RETURNING *`,
        [
          customer_id, helper_id, job_id, service_description,
          start, end, estimated_duration_minutes,
          location_address, location_lat, location_lng,
          customer_notes, customer_id
        ]
      );

      const appointment = appointmentResult.rows[0];

      // Create immediate notification for helper (non-reminder)
      await client.query(
        `INSERT INTO calendar_notifications
        (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
        VALUES ($1, $2, 'appointment_requested', 'in_app', CURRENT_TIMESTAMP, 'pending')`,
        [helper_id, appointment.id]
      );

      // Log audit
      await client.query(
        `INSERT INTO calendar_audit_log (user_id, appointment_id, action, details)
        VALUES ($1, $2, 'appointment_created', $3)`,
        [customer_id, appointment.id, JSON.stringify({ service: service_description })]
      );

      return appointment;
    });

    // Send notification email
    const [customerResult, helperResult] = await Promise.all([
      db.query('SELECT email, first_name FROM users WHERE id = $1', [customer_id]),
      db.query('SELECT email, first_name FROM users WHERE id = $1', [helper_id]),
    ]);

    const customer = customerResult.rows[0];
    const helperEmail = helperResult.rows[0];

    await emailService.send({
      to: helperEmail.email,
      subject: `New appointment request from ${customer.first_name}`,
      template: 'appointment_requested',
      data: {
        helperName: helperEmail.first_name,
        customerName: customer.first_name,
        date: start.toLocaleDateString(),
        time: start.toLocaleTimeString(),
        service: service_description,
        appointmentId: result.id,
      }
    }).catch(err => logger.warn('Appointment email send failed', { err }));

    // Broadcast to helper
    broadcastToUser(helper_id, 'appointment:requested', {
      appointment: result,
      customerName: customer.first_name,
    });

    return sendSuccess(res, result, 201);
  } catch (err) {
    logger.error('Failed to create appointment', { err, customer_id, helper_id });
    return sendError(res, 500, 'Failed to create appointment', 'INTERNAL_ERROR');
  }
};

// Get appointments for user
exports.getAppointments = async (req, res) => {
  const user_id = req.user.id;
  const { status, role, from_date, to_date, limit = 50, offset = 0 } = req.query;

  const limit_int = Math.min(parseInt(limit) || 50, 100);
  const offset_int = Math.max(0, parseInt(offset) || 0);

  try {
    let query = `SELECT a.*,
      u_customer.first_name as customer_name, u_customer.avatar_url as customer_avatar,
      u_helper.first_name as helper_name, u_helper.avatar_url as helper_avatar
      FROM appointments a
      LEFT JOIN users u_customer ON a.customer_id = u_customer.id
      LEFT JOIN users u_helper ON a.helper_id = u_helper.id
      WHERE 1=1`;
    const params = [];

    // Role-based filtering
    if (role === 'helper') {
      query += ` AND a.helper_id = $${params.length + 1}`;
      params.push(user_id);
    } else {
      query += ` AND a.customer_id = $${params.length + 1}`;
      params.push(user_id);
    }

    // Status filter
    if (status && APPOINTMENT_STATUSES.includes(status)) {
      query += ` AND a.status = $${params.length + 1}`;
      params.push(status);
    }

    // Date range filter
    if (from_date) {
      query += ` AND a.scheduled_start_time >= $${params.length + 1}`;
      params.push(new Date(from_date));
    }

    if (to_date) {
      query += ` AND a.scheduled_end_time <= $${params.length + 1}`;
      params.push(new Date(to_date));
    }

    // Get total count with same filters
    let countQuery = `SELECT COUNT(*) as count FROM appointments a LEFT JOIN users u_customer ON a.customer_id = u_customer.id LEFT JOIN users u_helper ON a.helper_id = u_helper.id WHERE 1=1`;
    const countParams = [];

    if (role === 'helper') {
      countQuery += ` AND a.helper_id = $${countParams.length + 1}`;
      countParams.push(user_id);
    } else {
      countQuery += ` AND a.customer_id = $${countParams.length + 1}`;
      countParams.push(user_id);
    }

    if (status && APPOINTMENT_STATUSES.includes(status)) {
      countQuery += ` AND a.status = $${countParams.length + 1}`;
      countParams.push(status);
    }

    if (from_date) {
      countQuery += ` AND a.scheduled_start_time >= $${countParams.length + 1}`;
      countParams.push(new Date(from_date));
    }

    if (to_date) {
      countQuery += ` AND a.scheduled_end_time <= $${countParams.length + 1}`;
      countParams.push(new Date(to_date));
    }

    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    query += ` ORDER BY a.scheduled_start_time DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit_int, offset_int);

    const result = await db.query(query, params);

    return sendSuccess(res, {
      appointments: result.rows,
      total,
      limit: limit_int,
      offset: offset_int,
      hasMore: offset_int + limit_int < total
    });
  } catch (err) {
    logger.error('Failed to fetch appointments', { err, user_id });
    return sendError(res, 500, 'Failed to fetch appointments', 'INTERNAL_ERROR');
  }
};

// Get single appointment
exports.getAppointment = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  try {
    const result = await db.query(
      `SELECT a.*,
        u_customer.first_name as customer_name, u_customer.avatar_url as customer_avatar,
        u_helper.first_name as helper_name, u_helper.avatar_url as helper_avatar
       FROM appointments a
       LEFT JOIN users u_customer ON a.customer_id = u_customer.id
       LEFT JOIN users u_helper ON a.helper_id = u_helper.id
       WHERE a.id = $1 AND (a.customer_id = $2 OR a.helper_id = $2)`,
      [id, user_id]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Appointment not found', 'NOT_FOUND');
    }

    return sendSuccess(res, result.rows[0]);
  } catch (err) {
    logger.error('Failed to fetch appointment', { err, id, user_id });
    return sendError(res, 500, 'Failed to fetch appointment', 'INTERNAL_ERROR');
  }
};

// Confirm appointment (helper only)
exports.confirmAppointment = async (req, res) => {
  const { id } = req.params;
  const helper_id = req.user.id;

  try {
    const result = await withTransaction(async (client) => {
      // Fetch appointment
      const appointmentResult = await client.query(
        `SELECT * FROM appointments WHERE id = $1 AND helper_id = $2 AND status = 'requested'`,
        [id, helper_id]
      );

      if (appointmentResult.rows.length === 0) {
        throw new Error('APPOINTMENT_NOT_FOUND');
      }

      const appointment = appointmentResult.rows[0];

      // Update status
      const updateResult = await client.query(
        `UPDATE appointments SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [id]
      );

      // Log audit
      await client.query(
        `INSERT INTO calendar_audit_log (user_id, appointment_id, action, details)
        VALUES ($1, $2, 'appointment_confirmed', $3)`,
        [helper_id, id, JSON.stringify({ confirmed_at: new Date().toISOString() })]
      );

      const updatedAppointment = updateResult.rows[0];
      const appointmentStart = new Date(updatedAppointment.scheduled_start_time);

      // Create confirmation notification for customer
      await client.query(
        `INSERT INTO calendar_notifications
        (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
        VALUES ($1, $2, 'appointment_confirmed', 'in_app', CURRENT_TIMESTAMP, 'pending')`,
        [appointment.customer_id, id]
      );

      // Create reminder notifications (for both customer and helper)
      const reminderTimes = [
        { type: 'reminder_24h', offset: -24 * 60, user_id: appointment.customer_id },
        { type: 'reminder_24h', offset: -24 * 60, user_id: helper_id },
        { type: 'reminder_2h', offset: -2 * 60, user_id: appointment.customer_id },
        { type: 'reminder_2h', offset: -2 * 60, user_id: helper_id },
        { type: 'reminder_same_day', offset: -6 * 60, user_id: appointment.customer_id },
        { type: 'reminder_same_day', offset: -6 * 60, user_id: helper_id },
      ];

      for (const reminder of reminderTimes) {
        const sendAt = new Date(appointmentStart.getTime() + reminder.offset * 60000);
        if (sendAt > new Date()) {
          await client.query(
            `INSERT INTO calendar_notifications
            (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
            VALUES ($1, $2, $3, 'in_app', $4, 'pending')`,
            [reminder.user_id, id, reminder.type, sendAt.toISOString()]
          );
        }
      }

      return updatedAppointment;
    });

    // Fetch customer and send email
    const customerResult = await db.query('SELECT email, first_name FROM users WHERE id = $1', [result.customer_id]);
    const customer = customerResult.rows[0];

    await emailService.send({
      to: customer.email,
      subject: 'Your appointment has been confirmed',
      template: 'appointment_confirmed',
      data: {
        customerName: customer.first_name,
        date: new Date(result.scheduled_start_time).toLocaleDateString(),
        time: new Date(result.scheduled_start_time).toLocaleTimeString(),
      }
    }).catch(err => logger.warn('Appointment confirmation email failed', { err }));

    // Broadcast to customer
    broadcastToUser(result.customer_id, 'appointment:confirmed', { appointment: result });

    return sendSuccess(res, result);
  } catch (err) {
    if (err.message === 'APPOINTMENT_NOT_FOUND') {
      return sendError(res, 404, 'Appointment not found or cannot be confirmed', 'NOT_FOUND');
    }
    logger.error('Failed to confirm appointment', { err, id, helper_id });
    return sendError(res, 500, 'Failed to confirm appointment', 'INTERNAL_ERROR');
  }
};

// Cancel appointment
exports.cancelAppointment = async (req, res) => {
  const { id } = req.params;
  const { cancellation_reason } = req.body;
  const user_id = req.user.id;

  try {
    const result = await withTransaction(async (client) => {
      // Fetch appointment
      const appointmentResult = await client.query(
        `SELECT * FROM appointments WHERE id = $1 AND (customer_id = $2 OR helper_id = $2)`,
        [id, user_id]
      );

      if (appointmentResult.rows.length === 0) {
        throw new Error('APPOINTMENT_NOT_FOUND');
      }

      const appointment = appointmentResult.rows[0];

      // Determine who cancelled
      const cancelled_by = appointment.customer_id === user_id ? 'customer' : 'helper';

      // Update appointment
      const updateResult = await client.query(
        `UPDATE appointments SET status = 'cancelled', cancelled_by = $1,
         cancellation_reason = $2, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 RETURNING *`,
        [cancelled_by, cancellation_reason, id]
      );

      // Cancel pending notifications
      await client.query(
        `UPDATE calendar_notifications SET status = 'cancelled'
         WHERE appointment_id = $1 AND status = 'pending'`,
        [id]
      );

      // Log audit
      await client.query(
        `INSERT INTO calendar_audit_log (user_id, appointment_id, action, details)
        VALUES ($1, $2, 'appointment_cancelled', $3)`,
        [user_id, id, JSON.stringify({ cancelled_by, reason: cancellation_reason })]
      );

      return updateResult.rows[0];
    });

    // Notify both parties
    const otherUserId = result.customer_id === user_id ? result.helper_id : result.customer_id;
    await db.query(
      `INSERT INTO calendar_notifications
      (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
      VALUES ($1, $2, 'appointment_cancelled', 'in_app', CURRENT_TIMESTAMP, 'pending')`,
      [otherUserId, id]
    );

    broadcastToUser(otherUserId, 'appointment:cancelled', {
      appointment: result,
      reason: cancellation_reason
    });

    return sendSuccess(res, result);
  } catch (err) {
    if (err.message === 'APPOINTMENT_NOT_FOUND') {
      return sendError(res, 404, 'Appointment not found', 'NOT_FOUND');
    }
    logger.error('Failed to cancel appointment', { err, id, user_id });
    return sendError(res, 500, 'Failed to cancel appointment', 'INTERNAL_ERROR');
  }
};
