// server/controllers/appointmentController.js
//
// Calendar appointment lifecycle: create / list / fetch / confirm / cancel.
//
// Notes for future maintainers:
//   * users.id and jobs.id are UUID — never parseInt them.
//   * Conflict-checks must run inside the same transaction as the INSERT
//     and lock the helper's existing rows; otherwise two simultaneous
//     requests can both pass the check then both insert.
//   * emailService.send only takes { to, subject, html, from }, so we
//     render simple HTML strings inline rather than passing a template name.

const pool = require('../db');
const logger = require('../utils/logger');
const { validate, rules } = require('../utils/validate');
const { sendError, sendSuccess } = require('../utils/apiError');
const { withTransaction } = require('../utils/transaction');
const emailService = require('../services/emailService');
const { broadcastToUser } = require('../services/socketService');
const { renderAppointmentEmail } = require('../utils/calendarEmails');

const HELPER_ROLES = ['helper', 'helper_pro', 'broker'];
const APPOINTMENT_STATUSES = ['requested', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rescheduled'];
const REMINDER_OFFSETS_MINUTES = {
  reminder_24h: -24 * 60,
  reminder_same_day: -6 * 60,
  reminder_2h: -2 * 60,
};

// ─── helpers ─────────────────────────────────────────────────
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function isUuid(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Build "<name>" or fallback to email local-part
function displayName(row) {
  if (!row) return 'there';
  if (row.first_name) return row.first_name;
  if (row.email) return String(row.email).split('@')[0];
  return 'there';
}

// ─── createAppointment ───────────────────────────────────────
exports.createAppointment = async (req, res) => {
  const customer_id = req.user.id;
  const {
    helper_id,
    job_id = null,
    service_description,
    scheduled_start_time,
    scheduled_end_time,
    location_address = null,
    location_lat = null,
    location_lng = null,
    estimated_duration_minutes = 60,
    customer_notes = null,
  } = req.body || {};

  const errors = validate(req.body || {}, {
    helper_id:           [rules.required],
    service_description: [rules.required, rules.minLen(5), rules.maxLen(2000), rules.noScript],
    scheduled_start_time:[rules.required],
    scheduled_end_time:  [rules.required],
    estimated_duration_minutes: [rules.integer],
    customer_notes:      [rules.maxLen(2000), rules.noScript],
    location_address:    [rules.maxLen(500), rules.noScript],
  });
  if (errors) return sendError(res, 400, 'Validation failed', 'VALIDATION_ERROR', { fields: errors });

  if (!isUuid(helper_id)) {
    return sendError(res, 400, 'helper_id must be a valid UUID', 'VALIDATION_ERROR');
  }
  if (helper_id === customer_id) {
    return sendError(res, 400, 'Cannot request an appointment with yourself', 'INVALID_PARTY');
  }
  if (job_id !== null && !isUuid(job_id)) {
    return sendError(res, 400, 'job_id must be a valid UUID or null', 'VALIDATION_ERROR');
  }

  const start = parseDate(scheduled_start_time);
  const end = parseDate(scheduled_end_time);
  if (!start || !end) {
    return sendError(res, 400, 'Invalid scheduled_start_time or scheduled_end_time', 'INVALID_TIME');
  }
  if (end <= start) {
    return sendError(res, 400, 'End time must be after start time', 'INVALID_TIME_RANGE');
  }
  const minAdvanceMs = 15 * 60 * 1000;
  if (start.getTime() - Date.now() < minAdvanceMs) {
    return sendError(res, 400, 'Appointments must be scheduled at least 15 minutes in advance', 'INSUFFICIENT_ADVANCE_TIME');
  }
  // Cap duration safety net (DB also enforces 15..480)
  const duration = clampInt(estimated_duration_minutes, 60, 15, 480);

  try {
    // 1. Verify helper is a real, active helper-role user (cheap, no lock)
    const helperPre = await pool.query(
      `SELECT id, role, is_active, deleted_at
         FROM users
        WHERE id = $1`,
      [helper_id]
    );
    if (helperPre.rows.length === 0 || !helperPre.rows[0].is_active || helperPre.rows[0].deleted_at) {
      return sendError(res, 404, 'Helper not found or inactive', 'HELPER_NOT_FOUND');
    }
    if (!HELPER_ROLES.includes(helperPre.rows[0].role)) {
      return sendError(res, 400, 'User is not a helper', 'NOT_A_HELPER');
    }

    // 2. Atomic: re-check conflict + insert in one transaction.
    //    We use an advisory lock keyed off the helper UUID so two concurrent
    //    requests serialize at the helper level (not at the whole table level).
    const advisoryKey = `appointments:${helper_id}`;
    const created = await withTransaction(pool, async (client) => {
      // Hash the key into a bigint for pg_advisory_xact_lock
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [advisoryKey]);

      const conflict = await client.query(
        `SELECT 1
           FROM appointments
          WHERE helper_id = $1
            AND status IN ('requested','confirmed','in_progress')
            AND scheduled_start_time < $3
            AND scheduled_end_time   > $2
          LIMIT 1`,
        [helper_id, start, end]
      );
      if (conflict.rows.length > 0) {
        const e = new Error('SCHEDULING_CONFLICT');
        e.code = 'SCHEDULING_CONFLICT';
        throw e;
      }

      const blockedBy = await client.query(
        `SELECT 1
           FROM availability_blocks
          WHERE helper_id = $1
            AND type IN ('unavailable','busy')
            AND start_time < $3
            AND end_time   > $2
          LIMIT 1`,
        [helper_id, start, end]
      );
      if (blockedBy.rows.length > 0) {
        const e = new Error('HELPER_UNAVAILABLE');
        e.code = 'HELPER_UNAVAILABLE';
        throw e;
      }

      const apptInsert = await client.query(
        `INSERT INTO appointments (
            customer_id, helper_id, job_id, service_description,
            scheduled_start_time, scheduled_end_time, estimated_duration_minutes,
            location_address, location_lat, location_lng,
            customer_notes, status, created_by_user_id
         ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10,
            $11, 'requested', $1
         )
         RETURNING *`,
        [
          customer_id, helper_id, job_id, service_description,
          start, end, duration,
          location_address, location_lat, location_lng,
          customer_notes,
        ]
      );
      const appointment = apptInsert.rows[0];

      // In-app notification for the helper (immediate)
      await client.query(
        `INSERT INTO calendar_notifications
           (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
         VALUES ($1, $2, 'appointment_requested', 'in_app', now(), 'pending')`,
        [helper_id, appointment.id]
      );

      await client.query(
        `INSERT INTO calendar_audit_log (user_id, appointment_id, action, details)
         VALUES ($1, $2, 'appointment_created', $3::jsonb)`,
        [customer_id, appointment.id, JSON.stringify({ service: service_description })]
      );

      return appointment;
    }, 'appointment_create');

    // Best-effort email + websocket notify (non-fatal)
    Promise.all([
      pool.query('SELECT email, first_name FROM users WHERE id = $1', [customer_id]),
      pool.query('SELECT email, first_name FROM users WHERE id = $1', [helper_id]),
    ]).then(([custRes, helpRes]) => {
      const customer = custRes.rows[0];
      const helper = helpRes.rows[0];
      if (!helper?.email) return;
      const html = renderAppointmentEmail('appointment_requested', {
        recipientName: displayName(helper),
        otherName: displayName(customer),
        service: service_description,
        when: start,
      });
      return emailService.send({
        to: helper.email,
        subject: `New appointment request from ${displayName(customer)}`,
        html,
      });
    }).catch(err => logger.warn('Appointment request email failed', { error: err?.message }));

    try {
      broadcastToUser(helper_id, 'appointment:requested', {
        appointment: created,
      });
    } catch (e) { /* socket layer should never fail the request */ }

    return sendSuccess(res, created, 201);
  } catch (err) {
    if (err.code === 'SCHEDULING_CONFLICT') {
      return sendError(res, 409, 'Helper has a conflicting appointment', 'SCHEDULING_CONFLICT');
    }
    if (err.code === 'HELPER_UNAVAILABLE') {
      return sendError(res, 409, 'Helper is unavailable during the requested time', 'HELPER_UNAVAILABLE');
    }
    logger.error('Failed to create appointment', { customerId: customer_id, helperId: helper_id, error: err.message });
    return sendError(res, 500, 'Failed to create appointment', 'INTERNAL_ERROR');
  }
};

// ─── getAppointments ─────────────────────────────────────────
exports.getAppointments = async (req, res) => {
  const userId = req.user.id;
  const { status, role, from_date, to_date } = req.query;
  const limit = clampInt(req.query.limit, 50, 1, 100);
  const offset = clampInt(req.query.offset, 0, 0, 100000);

  const conditions = [];
  const params = [];

  if (role === 'helper') {
    params.push(userId);
    conditions.push(`a.helper_id = $${params.length}`);
  } else {
    params.push(userId);
    conditions.push(`a.customer_id = $${params.length}`);
  }

  if (status && APPOINTMENT_STATUSES.includes(status)) {
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }

  const fromDate = parseDate(from_date);
  if (fromDate) {
    params.push(fromDate);
    conditions.push(`a.scheduled_end_time   >= $${params.length}`);
  }
  const toDate = parseDate(to_date);
  if (toDate) {
    params.push(toDate);
    conditions.push(`a.scheduled_start_time <= $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM appointments a ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.count || 0;

    const dataParams = params.slice();
    dataParams.push(limit);
    dataParams.push(offset);
    const rowsResult = await pool.query(
      `SELECT a.*,
              c.first_name AS customer_name,  c.profile_photo_url AS customer_avatar,
              h.first_name AS helper_name,    h.profile_photo_url AS helper_avatar
         FROM appointments a
         LEFT JOIN users c ON c.id = a.customer_id
         LEFT JOIN users h ON h.id = a.helper_id
         ${whereClause}
         ORDER BY a.scheduled_start_time DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    return sendSuccess(res, {
      appointments: rowsResult.rows,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (err) {
    logger.error('Failed to fetch appointments', { userId, error: err.message });
    return sendError(res, 500, 'Failed to fetch appointments', 'INTERNAL_ERROR');
  }
};

// ─── getAppointment (single) ─────────────────────────────────
exports.getAppointment = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  if (!/^\d+$/.test(String(id))) {
    return sendError(res, 400, 'Invalid appointment id', 'VALIDATION_ERROR');
  }

  try {
    const result = await pool.query(
      `SELECT a.*,
              c.first_name AS customer_name, c.profile_photo_url AS customer_avatar,
              h.first_name AS helper_name,   h.profile_photo_url AS helper_avatar
         FROM appointments a
         LEFT JOIN users c ON c.id = a.customer_id
         LEFT JOIN users h ON h.id = a.helper_id
         WHERE a.id = $1
           AND (a.customer_id = $2 OR a.helper_id = $2)`,
      [id, userId]
    );
    if (result.rows.length === 0) {
      return sendError(res, 404, 'Appointment not found', 'NOT_FOUND');
    }
    return sendSuccess(res, result.rows[0]);
  } catch (err) {
    logger.error('Failed to fetch appointment', { appointmentId: id, userId, error: err.message });
    return sendError(res, 500, 'Failed to fetch appointment', 'INTERNAL_ERROR');
  }
};

// ─── confirmAppointment (helper-only) ────────────────────────
exports.confirmAppointment = async (req, res) => {
  const { id } = req.params;
  const helperId = req.user.id;

  if (!/^\d+$/.test(String(id))) {
    return sendError(res, 400, 'Invalid appointment id', 'VALIDATION_ERROR');
  }

  try {
    const updated = await withTransaction(pool, async (client) => {
      const cur = await client.query(
        `SELECT * FROM appointments
          WHERE id = $1 AND helper_id = $2 AND status = 'requested'
          FOR UPDATE`,
        [id, helperId]
      );
      if (cur.rows.length === 0) {
        const e = new Error('APPOINTMENT_NOT_FOUND');
        e.code = 'APPOINTMENT_NOT_FOUND';
        throw e;
      }
      const appt = cur.rows[0];

      const upd = await client.query(
        `UPDATE appointments
            SET status = 'confirmed',
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [id]
      );

      await client.query(
        `INSERT INTO calendar_audit_log (user_id, appointment_id, action, details)
         VALUES ($1, $2, 'appointment_confirmed', $3::jsonb)`,
        [helperId, id, JSON.stringify({ confirmed_at: new Date().toISOString() })]
      );

      // In-app notification to customer
      await client.query(
        `INSERT INTO calendar_notifications
           (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
         VALUES ($1, $2, 'appointment_confirmed', 'in_app', now(), 'pending')`,
        [appt.customer_id, id]
      );

      // Reminder notifications for both parties (only those still in the future)
      const apptStart = new Date(appt.scheduled_start_time);
      const reminders = [
        ['reminder_24h', appt.customer_id],
        ['reminder_24h', appt.helper_id],
        ['reminder_same_day', appt.customer_id],
        ['reminder_same_day', appt.helper_id],
        ['reminder_2h', appt.customer_id],
        ['reminder_2h', appt.helper_id],
      ];
      for (const [type, uid] of reminders) {
        const offset = REMINDER_OFFSETS_MINUTES[type];
        const sendAt = new Date(apptStart.getTime() + offset * 60_000);
        if (sendAt > new Date()) {
          await client.query(
            `INSERT INTO calendar_notifications
               (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
             VALUES ($1, $2, $3, 'in_app', $4, 'pending')`,
            [uid, id, type, sendAt]
          );
        }
      }

      return upd.rows[0];
    }, 'appointment_confirm');

    // Best-effort customer email + websocket
    pool.query('SELECT email, first_name FROM users WHERE id = $1', [updated.customer_id])
      .then(r => {
        const customer = r.rows[0];
        if (!customer?.email) return;
        const html = renderAppointmentEmail('appointment_confirmed', {
          recipientName: displayName(customer),
          when: new Date(updated.scheduled_start_time),
        });
        return emailService.send({
          to: customer.email,
          subject: 'Your appointment has been confirmed',
          html,
        });
      })
      .catch(err => logger.warn('Confirmation email failed', { error: err?.message }));

    try {
      broadcastToUser(updated.customer_id, 'appointment:confirmed', { appointment: updated });
    } catch (e) { /* ignore */ }

    return sendSuccess(res, updated);
  } catch (err) {
    if (err.code === 'APPOINTMENT_NOT_FOUND') {
      return sendError(res, 404, 'Appointment not found or cannot be confirmed', 'NOT_FOUND');
    }
    logger.error('Failed to confirm appointment', { appointmentId: id, helperId, error: err.message });
    return sendError(res, 500, 'Failed to confirm appointment', 'INTERNAL_ERROR');
  }
};

// ─── cancelAppointment ───────────────────────────────────────
exports.cancelAppointment = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { cancellation_reason = null } = req.body || {};

  if (!/^\d+$/.test(String(id))) {
    return sendError(res, 400, 'Invalid appointment id', 'VALIDATION_ERROR');
  }

  if (cancellation_reason && String(cancellation_reason).length > 2000) {
    return sendError(res, 400, 'cancellation_reason is too long', 'VALIDATION_ERROR');
  }

  try {
    const result = await withTransaction(pool, async (client) => {
      const cur = await client.query(
        `SELECT * FROM appointments
          WHERE id = $1 AND (customer_id = $2 OR helper_id = $2)
          FOR UPDATE`,
        [id, userId]
      );
      if (cur.rows.length === 0) {
        const e = new Error('APPOINTMENT_NOT_FOUND');
        e.code = 'APPOINTMENT_NOT_FOUND';
        throw e;
      }
      const appt = cur.rows[0];
      if (appt.status === 'cancelled' || appt.status === 'completed') {
        const e = new Error('APPOINTMENT_NOT_CANCELLABLE');
        e.code = 'APPOINTMENT_NOT_CANCELLABLE';
        throw e;
      }

      const cancelledBy = appt.customer_id === userId ? 'customer' : 'helper';

      const upd = await client.query(
        `UPDATE appointments
            SET status = 'cancelled',
                cancelled_by = $1,
                cancellation_reason = $2,
                cancelled_at = now(),
                updated_at  = now()
          WHERE id = $3
          RETURNING *`,
        [cancelledBy, cancellation_reason, id]
      );

      await client.query(
        `UPDATE calendar_notifications
            SET status = 'cancelled'
          WHERE appointment_id = $1 AND status = 'pending'`,
        [id]
      );

      await client.query(
        `INSERT INTO calendar_audit_log (user_id, appointment_id, action, details)
         VALUES ($1, $2, 'appointment_cancelled', $3::jsonb)`,
        [userId, id, JSON.stringify({ cancelled_by: cancelledBy, reason: cancellation_reason })]
      );

      // In-app notification to the *other* party
      const otherUserId = appt.customer_id === userId ? appt.helper_id : appt.customer_id;
      await client.query(
        `INSERT INTO calendar_notifications
           (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
         VALUES ($1, $2, 'appointment_cancelled', 'in_app', now(), 'pending')`,
        [otherUserId, id]
      );

      return { appointment: upd.rows[0], otherUserId };
    }, 'appointment_cancel');

    try {
      broadcastToUser(result.otherUserId, 'appointment:cancelled', {
        appointment: result.appointment,
        reason: cancellation_reason,
      });
    } catch (e) { /* ignore */ }

    return sendSuccess(res, result.appointment);
  } catch (err) {
    if (err.code === 'APPOINTMENT_NOT_FOUND') {
      return sendError(res, 404, 'Appointment not found', 'NOT_FOUND');
    }
    if (err.code === 'APPOINTMENT_NOT_CANCELLABLE') {
      return sendError(res, 409, 'Appointment cannot be cancelled in its current state', 'NOT_CANCELLABLE');
    }
    logger.error('Failed to cancel appointment', { appointmentId: id, userId, error: err.message });
    return sendError(res, 500, 'Failed to cancel appointment', 'INTERNAL_ERROR');
  }
};
