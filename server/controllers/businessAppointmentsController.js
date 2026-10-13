// Business appointments controller
// Handle appointment bookings, updates, cancellations, and customer interactions

const pool = require('../db');
const { AppError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { sendNotification } = require('../services/notificationService');

// Shared appointment-window guards (audit M11): capacity per service, no
// staff double-booking across services, and no booking over the staff
// member's blocked time. excludeAppointmentId skips one row (reschedule).
async function assertAppointmentWindowFree(client, { businessId, serviceId, staffId, startTime, endTime, excludeAppointmentId = null }) {
  // Capacity: overlapping non-cancelled appointments for this service.
  const serviceRes = await client.query(
    'SELECT max_capacity FROM business_services WHERE id = $1 AND business_id = $2',
    [serviceId, businessId]
  );
  const maxCapacity = serviceRes.rows[0] ? Number(serviceRes.rows[0].max_capacity) || 1 : 1;
  const overlapParams = [serviceId, startTime, endTime];
  let overlapSql = `SELECT COUNT(*)::int AS n FROM business_appointments
       WHERE service_id = $1 AND status NOT IN ('cancelled', 'no_show')
         AND start_time < $3 AND end_time > $2`;
  if (excludeAppointmentId) {
    overlapParams.push(excludeAppointmentId);
    overlapSql += ` AND id <> $${overlapParams.length}`;
  }
  const overlapRes = await client.query(overlapSql, overlapParams);
  if (Number(overlapRes.rows[0].n) >= maxCapacity) {
    throw new AppError('No availability at this time', 409);
  }

  if (staffId) {
    // Staff double-booking: the same staff member cannot hold two
    // non-cancelled appointments at overlapping times, even across services.
    const staffParams = [staffId, startTime, endTime];
    let staffSql = `SELECT id FROM business_appointments
       WHERE staff_id = $1 AND status NOT IN ('cancelled', 'no_show')
         AND start_time < $3 AND end_time > $2 LIMIT 1`;
    if (excludeAppointmentId) {
      staffParams.push(excludeAppointmentId);
      staffSql = `SELECT id FROM business_appointments
       WHERE staff_id = $1 AND status NOT IN ('cancelled', 'no_show')
         AND start_time < $3 AND end_time > $2 AND id <> $4 LIMIT 1`;
    }
    const staffRes = await client.query(staffSql, staffParams);
    if (staffRes.rows.length) {
      throw new AppError('Staff member is already booked at this time', 409);
    }

    // Blocked time: the staff member's availability blocks are the
    // authoritative "do not book" signal.
    const blockRes = await client.query(
      `SELECT id FROM availability_blocks
       WHERE helper_id = $1 AND type IN ('unavailable', 'busy')
         AND start_time < $3 AND end_time > $2 LIMIT 1`,
      [staffId, startTime, endTime]
    );
    if (blockRes.rows.length) {
      throw new AppError('Staff member is unavailable at this time', 409);
    }
  }
}

// Reschedule-time booking rules (audit P3-8-F08). The enforceBookingRules
// middleware only runs on the create route, so the reschedule path must
// enforce the same window rules itself: service bookable, duration match,
// min/max advance notice, business blocked times, and no past times.
// Capacity, staff double-booking, and staff availability blocks are covered
// by assertAppointmentWindowFree, which runs separately.
async function assertRescheduleBookingRules(client, { businessId, service, staffId, startTime, endTime }) {
  if (!service) throw new AppError('Service not found', 404, 'service_not_found');
  if (service.deleted_at) throw new AppError('Service has been deleted', 410, 'service_deleted');
  if (service.is_active === false) throw new AppError('Service is inactive', 409, 'service_inactive');

  const start = new Date(startTime);
  const end = new Date(endTime);
  const serviceDuration = Number(service.duration_minutes);
  if (serviceDuration && Math.abs(Math.round((end - start) / 60000) - serviceDuration) > 1) {
    throw new AppError(
      `Rescheduled duration must equal service duration (${serviceDuration} min)`,
      400,
      'duration_mismatch'
    );
  }

  const rulesRes = await client.query(
    `SELECT min_advance_booking_hours, max_advance_booking_days
       FROM business_booking_rules WHERE business_id = $1 LIMIT 1`,
    [businessId]
  );
  const rules = rulesRes.rows[0] || {};
  const minNotice = Math.max(Number(service.min_notice_hours) || 0, Number(rules.min_advance_booking_hours) || 0);
  const maxAdvanceDays = Number(rules.max_advance_booking_days) || 365;
  const now = new Date();
  if (start < now) {
    throw new AppError('Cannot reschedule to a time in the past', 400, 'past_time');
  }
  if (start < new Date(now.getTime() + minNotice * 3600 * 1000)) {
    throw new AppError(
      `Rescheduling requires at least ${minNotice}h advance notice`,
      400,
      'min_notice_violated'
    );
  }
  if (start > new Date(now.getTime() + maxAdvanceDays * 24 * 3600 * 1000)) {
    throw new AppError(
      `Rescheduled time is past the max advance window of ${maxAdvanceDays} days`,
      400,
      'max_advance_violated'
    );
  }

  // Business blocked times (service-wide or per-staff), mirroring the
  // middleware's blocked-time check.
  const blockRes = await client.query(
    `SELECT 1 FROM business_service_blocked_times
      WHERE business_id = $1
        AND (service_id = $2 OR service_id IS NULL)
        ${staffId ? 'AND (staff_id = $3 OR staff_id IS NULL)' : ''}
        AND start_time < ${staffId ? '$5' : '$4'}
        AND end_time   > ${staffId ? '$4' : '$3'}
      LIMIT 1`,
    staffId
      ? [businessId, service.id, String(staffId), start.toISOString(), end.toISOString()]
      : [businessId, service.id, start.toISOString(), end.toISOString()]
  );
  if (blockRes.rows.length) {
    throw new AppError('This time is blocked', 409, 'time_blocked');
  }
}

// Create appointment (booking)
async function createAppointment(req, res, next) {
  try {
    const { businessId } = req.params;
    const {
      service_id, staff_id, customer_id, customer_name, customer_email,
      customer_phone, customer_notes, start_time, end_time, base_price_cents
    } = req.body;

    // Validate required fields
    if (!service_id || !start_time || !end_time || base_price_cents === undefined) {
      return next(new AppError('Service, start time, end time, and price are required', 400));
    }
    if (new Date(end_time) <= new Date(start_time)) {
      return next(new AppError('End time must be after start time', 400));
    }

    const effectiveCustomerId = req.user?.id || customer_id || null;
    const appointment = await withTransaction(pool, async (client) => {
      // Check service exists and take a row-level claim so concurrent
      // creates for the same service serialize instead of racing.
      // Audit fix (P2-3-F12): soft-deleted services must not accept new
      // appointments (matches enforceBookingRules' 410 contract).
      const serviceResult = await client.query(
        'SELECT * FROM business_services WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [service_id, businessId]
      );

      if (!serviceResult.rows.length) {
        throw new AppError('Service not found', 404);
      }
      if (serviceResult.rows[0].deleted_at) {
        throw new AppError('Service has been deleted', 410, 'service_deleted');
      }
      if (serviceResult.rows[0].is_active === false) {
        throw new AppError('Service is inactive', 409, 'service_inactive');
      }

      // Conflict / capacity / staff double-booking / blocked-time guards.
      await assertAppointmentWindowFree(client, {
        businessId,
        serviceId: service_id,
        staffId: staff_id || null,
        startTime: start_time,
        endTime: end_time,
      });

      // Create appointment
      const appointmentResult = await client.query(
        `INSERT INTO business_appointments
         (business_id, service_id, staff_id, customer_id, customer_name, customer_email,
          customer_phone, customer_notes, start_time, end_time, base_price_cents, final_price_cents, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
         RETURNING *`,
        [businessId, service_id, staff_id || null, effectiveCustomerId, customer_name || null,
         customer_email || null, customer_phone || null, customer_notes || null,
         start_time, end_time, base_price_cents, base_price_cents]
      );
      return appointmentResult.rows[0];
    });

    // Set up reminders
    await setupReminderSchedule(appointment.id, start_time);
    await notifyAppointmentParticipants(appointment, 'appointment_created');

    res.status(201).json(appointment);
  } catch (error) {
    // DB-level backstop (ba_no_staff_double_booking exclusion) fired: the
    // window was taken between check and insert.
    if (error && error.code === '23P01') {
      return next(new AppError('Time slot is no longer available', 409));
    }
    if (error instanceof AppError) return next(error);
    logger.error('Error creating appointment', { error });
    next(new AppError('Failed to create appointment', 500));
  }
}

// Get appointment details
async function getAppointment(req, res, next) {
  try {
    const { businessId, appointmentId } = req.params;

    const result = await pool.query(
      `SELECT ba.*, bs.name as service_name, bs.duration_minutes,
              (SELECT json_agg(json_build_object('content', content, 'created_at', created_at, 'created_by', created_by_id))
               FROM business_appointment_notes WHERE appointment_id = ba.id ORDER BY created_at DESC) as notes
       FROM business_appointments ba
       LEFT JOIN business_services bs ON ba.service_id = bs.id
       WHERE ba.id = $1 AND ba.business_id = $2`,
      [appointmentId, businessId]
    );

    if (!result.rows.length) {
      return next(new AppError('Appointment not found', 404));
    }

    // Audit fix (P2-3-F04): reading an appointment must not notify
    // participants. Lifecycle notifications fire on create, status change
    // (incl. no-show), cancel, and reschedule only.
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error getting appointment', { error });
    next(new AppError('Failed to get appointment', 500));
  }
}

// List appointments for business
async function listAppointments(req, res, next) {
  try {
    const { businessId } = req.params;
    const { status = 'all', staff_id, customer_id, limit = 50, offset = 0 } = req.query;
    const start_date = req.query.start_date || req.query.startDate;
    const end_date = req.query.end_date || req.query.endDate;

    let query = `
      SELECT ba.id, ba.service_id, ba.staff_id, ba.customer_id, ba.customer_name,
             ba.start_time, ba.end_time, ba.status, ba.payment_status,
             ba.base_price_cents, ba.final_price_cents, ba.created_at,
             bs.name as service_name
      FROM business_appointments ba
      LEFT JOIN business_services bs ON ba.service_id = bs.id
      WHERE ba.business_id = $1
    `;

    const params = [businessId];

    if (status !== 'all') {
      query += ` AND ba.status = $${params.length + 1}`;
      params.push(status);
    }

    if (start_date) {
      query += ` AND ba.start_time >= $${params.length + 1}`;
      params.push(start_date);
    }

    if (end_date) {
      query += ` AND ba.end_time <= $${params.length + 1}`;
      params.push(end_date);
    }

    if (staff_id) {
      query += ` AND ba.staff_id = $${params.length + 1}`;
      params.push(staff_id);
    }

    if (customer_id) {
      query += ` AND ba.customer_id = $${params.length + 1}`;
      params.push(customer_id);
    }

    query += ` ORDER BY ba.start_time DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM business_appointments WHERE business_id = $1',
      [businessId]
    );

    res.json({
      appointments: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    logger.error('Error listing appointments', { error });
    next(new AppError('Failed to list appointments', 500));
  }
}

// Update appointment status
async function updateAppointmentStatus(req, res, next) {
  try {
    const { businessId, appointmentId } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];
    if (!validStatuses.includes(status)) {
      return next(new AppError('Invalid status', 400));
    }

    const allowedTransitions = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['in_progress', 'cancelled', 'no_show'],
      in_progress: ['completed', 'cancelled'],
      completed: [],
      cancelled: [],
      no_show: [],
    };
    const appointment = await withTransaction(pool, async (client) => {
      const currentResult = await client.query(
        'SELECT * FROM business_appointments WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [appointmentId, businessId]
      );
      if (!currentResult.rows.length) throw new AppError('Appointment not found', 404);
      const current = currentResult.rows[0];
      if (!allowedTransitions[current.status]?.includes(status)) {
        throw new AppError(`Cannot change appointment from ${current.status} to ${status}`, 409, 'invalid_status_transition');
      }
      // The hub Cancel buttons drive this endpoint with status='cancelled',
      // so a cancellation through here must record the same audit fields as
      // the dedicated cancel path (cancelled_at / cancelled_by).
      const setFragments = ['status = $1', 'updated_at = NOW()'];
      const params = [status, appointmentId, businessId, current.status];
      if (status === 'cancelled') {
        setFragments.push('cancelled_at = NOW()');
        const cancelledBy = ['customer', 'business', 'system'].includes(req.body?.cancelled_by)
          ? req.body.cancelled_by
          : 'business';
        params.push(cancelledBy);
        setFragments.push(`cancelled_by = $${params.length}`);
        const reason = req.body?.cancellation_reason || req.body?.reason || null;
        if (reason) {
          params.push(String(reason).slice(0, 500));
          setFragments.push(`cancellation_reason = $${params.length}`);
        }
      }
      const result = await client.query(
        `UPDATE business_appointments SET ${setFragments.join(', ')}
         WHERE id = $2 AND business_id = $3 AND status = $4 RETURNING *`,
        params
      );
      if (!result.rows.length) throw new AppError('Appointment status changed; please refresh', 409, 'stale_appointment');
      return result.rows[0];
    }, 'update_appointment_status');

    // Add note if provided
    if (notes) {
      await pool.query(
        `INSERT INTO business_appointment_notes
         (appointment_id, created_by_id, note_type, content)
         VALUES ($1, $2, 'internal', $3)`,
        [appointmentId, req.user.id, notes]
      );
    }

    await notifyAppointmentParticipants(appointment, `appointment_${status}`);
    res.json(appointment);
  } catch (error) {
    logger.error('Error updating appointment', { error });
    if (error.status) return next(error);
    next(new AppError('Failed to update appointment', 500));
  }
}

// Cancel appointment
async function cancelAppointment(req, res, next) {
  try {
    const { businessId, appointmentId } = req.params;
    const { reason, cancelled_by } = req.body;
    // cancelled_by is CHECK-constrained to customer/business/system; coerce
    // anything else to the default instead of 500ing on the constraint.
    const cancelledBy = ['customer', 'business', 'system'].includes(cancelled_by) ? cancelled_by : 'business';
    const cancelReason = reason ? String(reason).slice(0, 500) : null;

    // Terminal states are locked, matching updateAppointmentStatus's
    // transition table: a completed or no-show appointment cannot be
    // cancelled through this path either.
    const cancellableFrom = ['pending', 'confirmed', 'in_progress'];
    const appointment = await withTransaction(pool, async (client) => {
      const currentResult = await client.query(
        'SELECT * FROM business_appointments WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [appointmentId, businessId]
      );
      if (!currentResult.rows.length) throw new AppError('Appointment not found', 404);
      const current = currentResult.rows[0];
      if (!cancellableFrom.includes(current.status)) {
        throw new AppError(`Cannot cancel appointment with status ${current.status}`, 409, 'invalid_status_transition');
      }
      const result = await client.query(
        `UPDATE business_appointments
         SET status = 'cancelled', cancellation_reason = $1, cancelled_by = $2, cancelled_at = NOW(), updated_at = NOW()
         WHERE id = $3 AND business_id = $4
         RETURNING *`,
        [cancelReason, cancelledBy, appointmentId, businessId]
      );
      return result.rows[0];
    }, 'cancel_appointment');

    // Send cancellation notification
    await notifyAppointmentParticipants(appointment, 'appointment_cancelled');

    res.json(appointment);
  } catch (error) {
    logger.error('Error cancelling appointment', { error });
    if (error.status) return next(error);
    next(new AppError('Failed to cancel appointment', 500));
  }
}

// Reschedule appointment
async function rescheduleAppointment(req, res, next) {
  try {
    const { businessId, appointmentId } = req.params;
    const { new_start_time, new_end_time } = req.body;

    if (!new_start_time || !new_end_time) {
      return next(new AppError('New start and end times are required', 400));
    }
    if (new Date(new_end_time) <= new Date(new_start_time)) {
      return next(new AppError('End time must be after start time', 400));
    }

    const updated = await withTransaction(pool, async (client) => {
      // Get original appointment and take a claim on the service row so
      // concurrent reschedules/creates for the same service serialize.
      const origResult = await client.query(
        'SELECT * FROM business_appointments WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [appointmentId, businessId]
      );

      if (!origResult.rows.length) {
        throw new AppError('Appointment not found', 404);
      }

      const orig = origResult.rows[0];
      // Terminal states are locked: a cancelled, completed, or no-show
      // appointment is history and cannot be moved to a new window.
      if (['cancelled', 'completed', 'no_show'].includes(orig.status)) {
        throw new AppError(
          `Cannot reschedule an appointment with status ${orig.status}`,
          409,
          'invalid_status_transition'
        );
      }

      const { rows: svcRows } = await client.query(
        `SELECT id, duration_minutes, min_notice_hours, is_active, deleted_at
           FROM business_services WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [orig.service_id, businessId]
      );
      if (!svcRows.length) {
        throw new AppError('Service not found', 404);
      }
      // Audit fix (P2-3-F12): a soft-deleted service cannot receive
      // rescheduled appointments.
      if (svcRows[0].deleted_at) {
        throw new AppError('Service has been deleted', 410, 'service_deleted');
      }

      // Same window rules as create (enforceBookingRules does not run on
      // this route): service bookable, duration match, min/max advance,
      // business blocked times, no past times.
      await assertRescheduleBookingRules(client, {
        businessId,
        service: serviceResult.rows[0] || null,
        staffId: orig.staff_id,
        startTime: new_start_time,
        endTime: new_end_time,
      });

      // Conflict / capacity / staff double-booking / blocked-time guards,
      // excluding the appointment being moved.
      await assertAppointmentWindowFree(client, {
        businessId,
        serviceId: orig.service_id,
        staffId: orig.staff_id,
        startTime: new_start_time,
        endTime: new_end_time,
        excludeAppointmentId: appointmentId,
      });

      // Update appointment
      const updateResult = await client.query(
        `UPDATE business_appointments
         SET start_time = $1, end_time = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [new_start_time, new_end_time, appointmentId]
      );

      // Log reschedule
      await client.query(
        `INSERT INTO business_appointment_reschedule_history
         (appointment_id, original_start_time, original_end_time, new_start_time, new_end_time, rescheduled_by_id, rescheduled_by_type)
         VALUES ($1, $2, $3, $4, $5, $6, 'business')`,
        [appointmentId, orig.start_time, orig.end_time, new_start_time, new_end_time, req.user.id]
      );

      return updateResult.rows[0];
    });

    await notifyAppointmentParticipants(updated, 'appointment_rescheduled');
    res.json(updated);
  } catch (error) {
    // DB-level backstop (ba_no_staff_double_booking exclusion) fired.
    if (error && error.code === '23P01') {
      return next(new AppError('Time slot is no longer available', 409));
    }
    if (error instanceof AppError) return next(error);
    logger.error('Error rescheduling appointment', { error });
    next(new AppError('Failed to reschedule appointment', 500));
  }
}

// Add note to appointment
async function addAppointmentNote(req, res, next) {
  try {
    const { businessId, appointmentId } = req.params;
    const { content, note_type = 'internal' } = req.body;

    if (!content) {
      return next(new AppError('Note content is required', 400));
    }

    const result = await pool.query(
      `INSERT INTO business_appointment_notes
       (appointment_id, created_by_id, note_type, content)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [appointmentId, req.user.id, note_type, content]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Error adding note', { error });
    next(new AppError('Failed to add note', 500));
  }
}

// Helper functions
async function setupReminderSchedule(appointmentId, startTime) {
  // Set up reminders for 24h, 2h, and same-day
  const reminders = [
    { hours_before: 24, type: 'reminder_24h' },
    { hours_before: 2, type: 'reminder_2h' },
    { hours_before: 0.5, type: 'reminder_same_day' }
  ];

  for (const reminder of reminders) {
    const scheduledAt = new Date(startTime);
    scheduledAt.setHours(scheduledAt.getHours() - reminder.hours_before);

    await pool.query(
      `INSERT INTO business_appointment_reminders
       (appointment_id, reminder_type, scheduled_at, hours_before)
       VALUES ($1, 'email', $2, $3)`,
      [appointmentId, scheduledAt.toISOString(), reminder.hours_before]
    );
  }
}

async function notifyAppointmentParticipants(appointment, notificationType) {
  const appointmentId = appointment?.id;
  if (!appointmentId) return;
  try {
    const { rows } = await pool.query(
      `SELECT ba.customer_id, b.user_id AS business_owner_id
         FROM business_appointments ba
         JOIN businesses b ON b.id = ba.business_id
        WHERE ba.id = $1`,
      [appointmentId]
    );
    const recipientIds = [...new Set(rows.flatMap((row) => [row.customer_id, row.business_owner_id]).filter(Boolean).map(String))];
    await Promise.allSettled(recipientIds.map((userId) => sendNotification({
      userId,
      type: notificationType,
      title: 'Appointment update',
      body: `Appointment ${notificationType.replace(/^appointment_/, '').replace(/_/g, ' ')}.`,
      data: { appointment_id: String(appointmentId), business_id: String(appointment.business_id || '') },
      action_url: `/businesses/${appointment.business_id}/calendar`,
      idempotencyKey: `business-appointment:${appointmentId}:${notificationType}:${appointment.updated_at || appointment.status || 'created'}`,
    })));
  } catch (error) {
    logger.warn('Appointment notification failed', { appointmentId, notificationType, error: error.message });
  }
}

module.exports = {
  createAppointment,
  getAppointment,
  listAppointments,
  updateAppointmentStatus,
  cancelAppointment,
  rescheduleAppointment,
  addAppointmentNote
};
