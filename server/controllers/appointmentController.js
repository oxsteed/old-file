// server/controllers/appointmentController.js
//
// Calendar appointment lifecycle: create / list / fetch / confirm / cancel.
//
// Notes for future maintainers:
//   * users.id and jobs.id are UUID - never parseInt them.
//   * Conflict-checks must run inside the same transaction as the INSERT
//     and lock the helper's existing rows; otherwise two simultaneous
//     requests can both pass the check then both insert.
//   * emailService.send only takes { to, subject, html, from }, so we
//     render simple HTML strings inline rather than passing a template name.

const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { validate, rules } = require('../utils/validate');
const { withTransaction } = require('../utils/transaction');
const emailService = require('../services/emailService');
const { broadcastToUser } = require('../services/socketService');
const { renderAppointmentEmail } = require('../utils/calendarEmails');
const { tNotif } = require('../utils/i18n');
const { sendSuccess, sendError } = require('../utils/apiError');

const HELPER_ROLES = ['helper', 'helper_pro', 'broker'];
const APPOINTMENT_STATUSES = ['requested', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rescheduled'];
const BOOKING_URGENCIES = ['normal', 'soon', 'urgent'];
const RECURRENCE_RULES = ['one_time', 'weekly', 'biweekly', 'monthly'];
const COMMUNICATION_CHANNELS = ['in_app', 'phone', 'sms', 'email'];
const PAYMENT_EXPECTATIONS = ['direct_to_helper', 'restaurant_credit', 'platform_checkout_pending', 'paid_off_platform'];
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

function nullableTrim(value, max = null) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return max ? text.slice(0, max) : text;
}

function parseNullableInt(value, field, errors, { min = null, max = null } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) {
    errors[field] = 'Must be an integer';
    return null;
  }
  if (min !== null && n < min) errors[field] = `Must be at least ${min}`;
  if (max !== null && n > max) errors[field] = `Must be at most ${max}`;
  return n;
}

function parseEnum(value, fallback, allowed, field, errors) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!allowed.includes(normalized)) {
    errors[field] = `Must be one of: ${allowed.join(', ')}`;
    return fallback;
  }
  return normalized;
}

function parseBool(value) {
  if (value === true || value === false) return value;
  if (value === undefined || value === null || value === '') return false;
  return ['true', '1', 'yes', 'y'].includes(String(value).trim().toLowerCase());
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
exports.createAppointment = async (req, res, next) => {
  try {
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
      service_package_id = null,
      service_package_name = null,
      service_category = null,
      service_price_cents = null,
      currency_code = 'USD',
      booking_urgency = 'normal',
      recurrence_rule = 'one_time',
      preferred_communication_channel = 'in_app',
      phone_contact_allowed = false,
      address_unit = null,
      access_instructions = null,
      parking_notes = null,
      promo_code = null,
      payment_expectation = 'direct_to_helper',
      attachment_count = 0,
      booking_metadata = null,
    } = req.body || {};

    const errors = validate(req.body || {}, {
      helper_id:           [rules.required],
      service_description: [rules.required, rules.minLen(5), rules.maxLen(2000), rules.noScript],
      scheduled_start_time:[rules.required],
      scheduled_end_time:  [rules.required],
      estimated_duration_minutes: [rules.integer],
      customer_notes:      [rules.maxLen(2000), rules.noScript],
      location_address:    [rules.maxLen(500), rules.noScript],
      service_package_name:[rules.maxLen(255), rules.noScript],
      service_category:    [rules.maxLen(100), rules.noScript],
      address_unit:        [rules.maxLen(120), rules.noScript],
      access_instructions: [rules.maxLen(2000), rules.noScript],
      parking_notes:       [rules.maxLen(1000), rules.noScript],
      promo_code:          [rules.maxLen(80), rules.noScript],
    });
    if (errors) throw new AppError('Validation failed', 400, 'validation_failed', errors);

    const fieldErrors = {};
    const normalizedServicePackageId = parseNullableInt(
      service_package_id, 'service_package_id', fieldErrors, { min: 1 }
    );
    const normalizedServicePriceCents = parseNullableInt(
      service_price_cents, 'service_price_cents', fieldErrors, { min: 0 }
    );
    const normalizedAttachmentCount = parseNullableInt(
      attachment_count, 'attachment_count', fieldErrors, { min: 0, max: 50 }
    ) ?? 0;
    const normalizedCurrencyCode = String(currency_code || 'USD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrencyCode)) {
      fieldErrors.currency_code = 'Must be a 3-letter ISO currency code';
    }
    const normalizedUrgency = parseEnum(booking_urgency, 'normal', BOOKING_URGENCIES, 'booking_urgency', fieldErrors);
    const normalizedRecurrence = parseEnum(recurrence_rule, 'one_time', RECURRENCE_RULES, 'recurrence_rule', fieldErrors);
    const normalizedCommunication = parseEnum(
      preferred_communication_channel, 'in_app', COMMUNICATION_CHANNELS, 'preferred_communication_channel', fieldErrors
    );
    const normalizedPaymentExpectation = parseEnum(
      payment_expectation, 'direct_to_helper', PAYMENT_EXPECTATIONS, 'payment_expectation', fieldErrors
    );
    const normalizedMetadata = (
      booking_metadata && typeof booking_metadata === 'object' && !Array.isArray(booking_metadata)
    ) ? booking_metadata : {};
    if (Object.keys(fieldErrors).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fieldErrors);
    }

    if (!isUuid(helper_id)) {
      throw new AppError('helper_id must be a valid UUID', 400, 'validation_failed', { helper_id: 'Invalid UUID format' });
    }
    if (helper_id === customer_id) {
      throw new AppError('Cannot request an appointment with yourself', 400, 'invalid_state');
    }
    if (job_id !== null && !isUuid(job_id)) {
      throw new AppError('job_id must be a valid UUID or null', 400, 'validation_failed', { job_id: 'Invalid UUID format' });
    }

    const start = parseDate(scheduled_start_time);
    const end = parseDate(scheduled_end_time);
    if (!start || !end) {
      throw new AppError('Invalid scheduled_start_time or scheduled_end_time', 400, 'validation_failed', { scheduled_start_time: 'Invalid date format', scheduled_end_time: 'Invalid date format' });
    }
    if (end <= start) {
      throw new AppError('End time must be after start time', 400, 'validation_failed', { scheduled_end_time: 'Must be after start time' });
    }
    const minAdvanceMs = 15 * 60 * 1000;
    if (start.getTime() - Date.now() < minAdvanceMs) {
      throw new AppError('Appointments must be scheduled at least 15 minutes in advance', 400, 'invalid_state');
    }
    // Cap duration safety net (DB also enforces 15..480)
    const duration = clampInt(estimated_duration_minutes, 60, 15, 480);

    // 1. Verify helper is a real, active helper-role user (cheap, no lock)
    const helperPre = await pool.query(
      `SELECT id, role, is_active, deleted_at
         FROM users
        WHERE id = $1`,
      [helper_id]
    );
    if (helperPre.rows.length === 0 || !helperPre.rows[0].is_active || helperPre.rows[0].deleted_at) {
      throw new AppError('Helper not found or inactive', 404, 'not_found');
    }
    if (!HELPER_ROLES.includes(helperPre.rows[0].role)) {
      throw new AppError('User is not a helper', 400, 'invalid_state');
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
            customer_notes,
            service_package_id, service_package_name, service_category,
            service_price_cents, currency_code, booking_urgency,
            recurrence_rule, preferred_communication_channel,
            phone_contact_allowed, address_unit, access_instructions,
            parking_notes, promo_code, payment_expectation,
            attachment_count, booking_metadata,
            status, created_by_user_id
         ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10,
            $11,
            $12, $13, $14,
            $15, $16, $17,
            $18, $19,
            $20, $21, $22,
            $23, $24, $25,
            $26, $27::jsonb,
            'requested', $1
         )
         RETURNING *`,
        [
          customer_id, helper_id, job_id, service_description,
          start, end, duration,
          location_address, location_lat, location_lng,
          customer_notes,
          normalizedServicePackageId,
          nullableTrim(service_package_name, 255),
          nullableTrim(service_category, 100),
          normalizedServicePriceCents,
          normalizedCurrencyCode,
          normalizedUrgency,
          normalizedRecurrence,
          normalizedCommunication,
          parseBool(phone_contact_allowed),
          nullableTrim(address_unit, 120),
          nullableTrim(access_instructions, 2000),
          nullableTrim(parking_notes, 1000),
          nullableTrim(promo_code, 80),
          normalizedPaymentExpectation,
          normalizedAttachmentCount,
          JSON.stringify(normalizedMetadata),
        ]
      );
      const appointment = apptInsert.rows[0];

      if (normalizedRecurrence !== 'one_time') {
        await client.query(
          `INSERT INTO appointment_recurrence_rules
             (appointment_id, recurrence_rule, starts_at, next_occurrence_at, metadata)
           VALUES ($1, $2, $3, $3, $4::jsonb)
           ON CONFLICT (appointment_id) DO UPDATE
             SET recurrence_rule = EXCLUDED.recurrence_rule,
                 starts_at = EXCLUDED.starts_at,
                 next_occurrence_at = EXCLUDED.next_occurrence_at,
                 metadata = EXCLUDED.metadata,
                 updated_at = now()`,
          [
            appointment.id,
            normalizedRecurrence,
            start,
            JSON.stringify({ source: 'appointment_create', first_appointment_id: appointment.id }),
          ]
        );
      }

      await client.query(
        `INSERT INTO appointment_payment_agreements
           (appointment_id, payer_user_id, payee_user_id, payment_expectation,
            quoted_amount_cents, currency_code, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7::jsonb)
         ON CONFLICT (appointment_id) DO UPDATE
           SET payment_expectation = EXCLUDED.payment_expectation,
               quoted_amount_cents = EXCLUDED.quoted_amount_cents,
               currency_code = EXCLUDED.currency_code,
               metadata = EXCLUDED.metadata,
               updated_at = now()`,
        [
          appointment.id,
          customer_id,
          helper_id,
          normalizedPaymentExpectation,
          normalizedServicePriceCents,
          normalizedCurrencyCode,
          JSON.stringify({
            source: 'appointment_create',
            service_package_id: normalizedServicePackageId,
            service_package_name: nullableTrim(service_package_name, 255),
          }),
        ]
      );

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
        [customer_id, appointment.id, JSON.stringify({
          service: service_description,
          service_package_id: normalizedServicePackageId,
          booking_urgency: normalizedUrgency,
          recurrence_rule: normalizedRecurrence,
          payment_expectation: normalizedPaymentExpectation,
        })]
      );

      return appointment;
    }, 'appointment_create');

    // Best-effort email + websocket notify (non-fatal)
    Promise.all([
      pool.query('SELECT email, first_name, preferred_language FROM users WHERE id = $1', [customer_id]),
      pool.query('SELECT email, first_name, preferred_language FROM users WHERE id = $1', [helper_id]),
    ]).then(([custRes, helpRes]) => {
      const customer = custRes.rows[0];
      const helper = helpRes.rows[0];
      if (!helper?.email) return;
      const html = renderAppointmentEmail('appointment_requested', {
        recipientName: displayName(helper),
        otherName: displayName(customer),
        service: service_description,
        when: start,
      }, helper?.preferred_language || 'en');
      const helperLang = helper?.preferred_language || 'en';
      const requestTitle = tNotif('appointment_requested', helperLang).title;
      return emailService.send({
        to: helper.email,
        subject: requestTitle,
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
    if (err instanceof AppError) {
      return next(err);
    }
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
    // JOIN jobs so frontend can display job title in badge / "View Job" link
    const rowsResult = await pool.query(
      `SELECT a.*,
              CASE
                WHEN a.source = 'ai_chat' THEN COALESCE(NULLIF(a.guest_name, ''), 'Guest visitor')
                ELSE TRIM(CONCAT_WS(' ', c.first_name, c.last_name))
              END AS customer_name,
              CASE WHEN a.source = 'ai_chat' THEN a.guest_email ELSE c.email END AS customer_email,
              CASE WHEN a.source = 'ai_chat' THEN NULL ELSE c.profile_photo_url END AS customer_avatar,
              h.first_name AS helper_name,    h.profile_photo_url AS helper_avatar,
              j.title AS job_title
         FROM appointments a
         LEFT JOIN users c ON c.id = a.customer_id
         LEFT JOIN users h ON h.id = a.helper_id
         LEFT JOIN jobs  j ON j.id = a.job_id
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
              CASE
                WHEN a.source = 'ai_chat' THEN COALESCE(NULLIF(a.guest_name, ''), 'Guest visitor')
                ELSE TRIM(CONCAT_WS(' ', c.first_name, c.last_name))
              END AS customer_name,
              CASE WHEN a.source = 'ai_chat' THEN a.guest_email ELSE c.email END AS customer_email,
              CASE WHEN a.source = 'ai_chat' THEN NULL ELSE c.profile_photo_url END AS customer_avatar,
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

      const isAiGuestAppointment = appt.source === 'ai_chat';
      if (!isAiGuestAppointment) {
        await client.query(
          `INSERT INTO calendar_notifications
             (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
           VALUES ($1, $2, 'appointment_confirmed', 'in_app', now(), 'pending')`,
          [appt.customer_id, id]
        );
      }

      // Reminder notifications for both parties (only those still in the future)
      const apptStart = new Date(appt.scheduled_start_time);
      const reminders = [
        ...(isAiGuestAppointment ? [] : [['reminder_24h', appt.customer_id]]),
        ['reminder_24h', appt.helper_id],
        ...(isAiGuestAppointment ? [] : [['reminder_same_day', appt.customer_id]]),
        ['reminder_same_day', appt.helper_id],
        ...(isAiGuestAppointment ? [] : [['reminder_2h', appt.customer_id]]),
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

    // Best-effort customer / guest email + websocket
    pool.query('SELECT email, first_name, preferred_language FROM users WHERE id = $1', [updated.customer_id])
      .then(r => {
        const customer = r.rows[0];
        const recipientEmail = updated.source === 'ai_chat' ? updated.guest_email : customer?.email;
        if (!recipientEmail) return;
        const html = renderAppointmentEmail('appointment_confirmed', {
          recipientName: updated.source === 'ai_chat'
            ? (updated.guest_name || 'there')
            : displayName(customer),
          when: new Date(updated.scheduled_start_time),
        }, updated.source === 'ai_chat' ? 'en' : (customer?.preferred_language || 'en'));
        const confirmLang = updated.source === 'ai_chat' ? 'en' : (customer?.preferred_language || 'en');
        const confirmTitle = tNotif('appointment_confirmed', confirmLang).title;
        return emailService.send({
          to: recipientEmail,
          subject: confirmTitle,
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

      const otherUserId = appt.customer_id === userId ? appt.helper_id : appt.customer_id;
      if (!(appt.source === 'ai_chat' && otherUserId === appt.customer_id)) {
        await client.query(
          `INSERT INTO calendar_notifications
             (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
           VALUES ($1, $2, 'appointment_cancelled', 'in_app', now(), 'pending')`,
          [otherUserId, id]
        );
      }

      return { appointment: upd.rows[0], otherUserId };
    }, 'appointment_cancel');

    if (result.appointment.source === 'ai_chat' && result.appointment.guest_email) {
      emailService.send({
        to: result.appointment.guest_email,
        subject: tNotif('appointment_cancelled', 'en').title,
        html: renderAppointmentEmail('appointment_cancelled', {
          recipientName: result.appointment.guest_name || 'there',
          when: new Date(result.appointment.scheduled_start_time),
        }),
      }).catch(err => logger.warn('AI guest cancellation email failed', { error: err?.message }));
    }

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

// ─── requestReschedule ────────────────────────────────────────
// POST /api/calendar/appointments/:id/reschedule-request
exports.requestReschedule = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { proposed_start, proposed_end, message = null } = req.body || {};

  const pStart = parseDate(proposed_start);
  const pEnd   = parseDate(proposed_end);
  if (!pStart || !pEnd) {
    return sendError(res, 400, 'proposed_start and proposed_end are required ISO timestamps', 'VALIDATION_FAILED');
  }
  if (pEnd <= pStart) {
    return sendError(res, 400, 'proposed_end must be after proposed_start', 'VALIDATION_FAILED');
  }

  try {
    // Verify the appointment exists and the caller is involved
    const apptRes = await pool.query(
      'SELECT * FROM appointments WHERE id = $1',
      [id]
    );
    if (!apptRes.rows.length) return sendError(res, 404, 'Appointment not found', 'NOT_FOUND');
    const appt = apptRes.rows[0];

    if (appt.customer_id !== userId && appt.helper_id !== userId) {
      return sendError(res, 403, 'Not authorized', 'FORBIDDEN');
    }
    if (!['confirmed', 'requested'].includes(appt.status)) {
      return sendError(res, 409, 'Can only reschedule confirmed or requested appointments', 'INVALID_STATE');
    }

    const role = appt.customer_id === userId ? 'customer' : 'helper';
    const otherUserId = role === 'customer' ? appt.helper_id : appt.customer_id;

    // Expire any existing pending reschedule requests
    await pool.query(
      `UPDATE appointment_reschedule_requests
          SET status = 'expired'
        WHERE appointment_id = $1 AND status = 'pending'`,
      [id]
    );

    const { rows: [req_row] } = await pool.query(
      `INSERT INTO appointment_reschedule_requests
         (appointment_id, requested_by, requested_by_role, proposed_start, proposed_end, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, userId, role, pStart, pEnd, message]
    );

    // Notify the other party
    await pool.query(
      `INSERT INTO calendar_notifications
         (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
       VALUES ($1, $2, 'appointment_rescheduled', 'in_app', now(), 'pending')`,
      [otherUserId, id]
    );

    try {
      broadcastToUser(otherUserId, 'appointment:reschedule_requested', {
        appointmentId: id,
        requestId: req_row.id,
        proposedStart: pStart,
        proposedEnd: pEnd,
        requestedByRole: role,
        message,
      });
    } catch { /* ignore socket errors */ }

    logger.info('Reschedule request created', { appointmentId: id, requestId: req_row.id, role });
    return sendSuccess(res, req_row, 201);
  } catch (err) {
    logger.error('Failed to create reschedule request', { appointmentId: id, error: err.message });
    return sendError(res, 500, 'Failed to request reschedule', 'INTERNAL_ERROR');
  }
};

// ─── respondToReschedule ─────────────────────────────────────
// PUT /api/calendar/appointments/:id/reschedule-request/:reqId
// Body: { action: 'accept' | 'decline' }
exports.respondToReschedule = async (req, res) => {
  const { id, reqId } = req.params;
  const userId = req.user.id;
  const { action } = req.body || {};

  if (!['accept', 'decline'].includes(action)) {
    return sendError(res, 400, 'action must be "accept" or "decline"', 'VALIDATION_FAILED');
  }

  try {
    const result = await withTransaction(pool, async (client) => {
      // Load appointment + reschedule request together
      const apptRes = await client.query(
        'SELECT * FROM appointments WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (!apptRes.rows.length) throw Object.assign(new Error('Not found'), { code: 'NOT_FOUND' });
      const appt = apptRes.rows[0];

      if (appt.customer_id !== userId && appt.helper_id !== userId) {
        throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
      }

      const reqRes = await client.query(
        `SELECT * FROM appointment_reschedule_requests
          WHERE id = $1 AND appointment_id = $2 AND status = 'pending'
          FOR UPDATE`,
        [reqId, id]
      );
      if (!reqRes.rows.length) throw Object.assign(new Error('Request not found or expired'), { code: 'REQUEST_NOT_FOUND' });
      const reschedReq = reqRes.rows[0];

      // Responder must be the *other* party (not the one who requested it)
      if (reschedReq.requested_by === userId) {
        throw Object.assign(new Error('Cannot respond to your own request'), { code: 'OWN_REQUEST' });
      }

      await client.query(
        `UPDATE appointment_reschedule_requests
            SET status = $1, responded_at = now()
          WHERE id = $2`,
        [action === 'accept' ? 'accepted' : 'declined', reqId]
      );

      let updatedAppt = appt;
      if (action === 'accept') {
        const upd = await client.query(
          `UPDATE appointments
              SET scheduled_start_time = $1,
                  scheduled_end_time   = $2,
                  status               = 'confirmed',
                  updated_at           = now()
            WHERE id = $3
            RETURNING *`,
          [reschedReq.proposed_start, reschedReq.proposed_end, id]
        );
        updatedAppt = upd.rows[0];

        // Cancel pending reminder rows that point to the OLD scheduled time.
        // Without this, the cron would still fire reminder_24h / reminder_2h
        // for the previous slot (and may even fire them immediately if the
        // OLD send-at moved into the past after the reschedule).
        await client.query(
          `UPDATE calendar_notifications
              SET status = 'cancelled'
            WHERE appointment_id = $1
              AND status = 'pending'
              AND notification_type IN ('reminder_24h','reminder_2h','reminder_same_day')`,
          [id]
        );

        // Re-issue reminders anchored to the NEW scheduled_start_time, only
        // for offsets that are still in the future.
        const apptStart = new Date(updatedAppt.scheduled_start_time);
        const reminders = [
          ['reminder_24h',      updatedAppt.customer_id],
          ['reminder_24h',      updatedAppt.helper_id],
          ['reminder_same_day', updatedAppt.customer_id],
          ['reminder_same_day', updatedAppt.helper_id],
          ['reminder_2h',       updatedAppt.customer_id],
          ['reminder_2h',       updatedAppt.helper_id],
        ];
        for (const [type, uid] of reminders) {
          const offsetMin = REMINDER_OFFSETS_MINUTES[type];
          const sendAt = new Date(apptStart.getTime() + offsetMin * 60_000);
          if (sendAt > new Date()) {
            await client.query(
              `INSERT INTO calendar_notifications
                 (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
               VALUES ($1, $2, $3, 'in_app', $4, 'pending')`,
              [uid, id, type, sendAt]
            );
          }
        }
      }

      // Notify the requester of the response
      const notifyUserId = reschedReq.requested_by;
      await client.query(
        `INSERT INTO calendar_notifications
           (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
         VALUES ($1, $2, $3, 'in_app', now(), 'pending')`,
        [notifyUserId, id, action === 'accept' ? 'appointment_confirmed' : 'appointment_cancelled']
      );

      return { appointment: updatedAppt, reschedReq, notifyUserId };
    });

    try {
      broadcastToUser(result.notifyUserId, 'appointment:reschedule_responded', {
        action,
        appointmentId: id,
        requestId: reqId,
        appointment: result.appointment,
      });
    } catch { /* ignore */ }

    logger.info('Reschedule request responded', { appointmentId: id, requestId: reqId, action });
    return sendSuccess(res, { action, appointment: result.appointment });
  } catch (err) {
    if (err.code === 'NOT_FOUND')         return sendError(res, 404, 'Appointment not found', 'NOT_FOUND');
    if (err.code === 'FORBIDDEN')         return sendError(res, 403, 'Not authorized', 'FORBIDDEN');
    if (err.code === 'REQUEST_NOT_FOUND') return sendError(res, 404, 'Reschedule request not found or already handled', 'NOT_FOUND');
    if (err.code === 'OWN_REQUEST')       return sendError(res, 409, 'Cannot respond to your own reschedule request', 'OWN_REQUEST');
    logger.error('Failed to respond to reschedule', { appointmentId: id, error: err.message });
    return sendError(res, 500, 'Failed to respond to reschedule request', 'INTERNAL_ERROR');
  }
};

// ─── getRescheduleRequests ───────────────────────────────────
// GET /api/calendar/appointments/:id/reschedule-requests
exports.getRescheduleRequests = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const apptRes = await pool.query('SELECT customer_id, helper_id FROM appointments WHERE id = $1', [id]);
    if (!apptRes.rows.length) return sendError(res, 404, 'Appointment not found', 'NOT_FOUND');
    const { customer_id, helper_id } = apptRes.rows[0];
    if (customer_id !== userId && helper_id !== userId) {
      return sendError(res, 403, 'Not authorized', 'FORBIDDEN');
    }

    const { rows } = await pool.query(
      `SELECT * FROM appointment_reschedule_requests
        WHERE appointment_id = $1
        ORDER BY created_at DESC
        LIMIT 10`,
      [id]
    );
    return sendSuccess(res, rows);
  } catch (err) {
    logger.error('Failed to get reschedule requests', { appointmentId: id, error: err.message });
    return sendError(res, 500, 'Failed to load reschedule requests', 'INTERNAL_ERROR');
  }
};

// ─── getIcal ─────────────────────────────────────────────────
// GET /api/calendar/appointments/:id/ical
// Returns a valid RFC 5545 .ics file for the appointment.
exports.getIcal = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
      `SELECT a.*,
              c.first_name AS customer_name, c.email AS customer_email,
              h.first_name AS helper_name,   h.email AS helper_email,
              j.title AS job_title
         FROM appointments a
         LEFT JOIN users c ON c.id = a.customer_id
         LEFT JOIN users h ON h.id = a.helper_id
         LEFT JOIN jobs  j ON j.id = a.job_id
        WHERE a.id = $1`,
      [id]
    );
    if (!rows.length) return sendError(res, 404, 'Appointment not found', 'NOT_FOUND');
    const appt = rows[0];

    if (appt.customer_id !== userId && appt.helper_id !== userId) {
      return sendError(res, 403, 'Not authorized', 'FORBIDDEN');
    }

    const start  = new Date(appt.scheduled_start_time);
    const end    = new Date(appt.scheduled_end_time);
    const title  = appt.job_title || appt.service_description || 'OxSteed Appointment';
    const loc    = appt.location_address || '';
    const uid    = `oxsteed-appt-${appt.id}@oxsteed.com`;

    function icsDate(d) {
      return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    }
    function icsEscape(text) {
      return String(text || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g,  '\\;')
        .replace(/,/g,  '\\,')
        .replace(/\r\n|\r|\n/g, '\\n');
    }

    const description = `OxSteed appointment. Customer: ${appt.customer_name || ''}. Helper: ${appt.helper_name || ''}.`;
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//OxSteed//Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape(title)}`,
      loc ? `LOCATION:${icsEscape(loc)}` : '',
      `DESCRIPTION:${icsEscape(description)}`,
      `STATUS:${appt.status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`,
      `DTSTAMP:${icsDate(new Date())}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="oxsteed-appointment-${id}.ics"`);
    res.send(ics);
  } catch (err) {
    logger.error('Failed to generate iCal', { appointmentId: id, error: err.message });
    return sendError(res, 500, 'Failed to generate calendar file', 'INTERNAL_ERROR');
  }
};
