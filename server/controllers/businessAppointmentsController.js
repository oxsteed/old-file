// Business appointments controller
// Handle appointment bookings, updates, cancellations, and customer interactions

const pool = require('../db');
const { AppError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');

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
       WHERE service_id = $1 AND status <> 'cancelled'
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
       WHERE staff_id = $1 AND status <> 'cancelled'
         AND start_time < $3 AND end_time > $2 LIMIT 1`;
    if (excludeAppointmentId) {
      staffParams.push(excludeAppointmentId);
      staffSql = `SELECT id FROM business_appointments
       WHERE staff_id = $1 AND status <> 'cancelled'
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

    const appointment = await withTransaction(pool, async (client) => {
      // Check service exists and take a row-level claim so concurrent
      // creates for the same service serialize instead of racing.
      const serviceResult = await client.query(
        'SELECT * FROM business_services WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [service_id, businessId]
      );

      if (!serviceResult.rows.length) {
        throw new AppError('Service not found', 404);
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
        [businessId, service_id, staff_id || null, customer_id || null, customer_name || null,
         customer_email || null, customer_phone || null, customer_notes || null,
         start_time, end_time, base_price_cents, base_price_cents]
      );
      return appointmentResult.rows[0];
    });

    // Set up reminders
    await setupReminderSchedule(appointment.id, start_time);

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

    const result = await pool.query(
      `UPDATE business_appointments
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3
       RETURNING *`,
      [status, appointmentId, businessId]
    );

    if (!result.rows.length) {
      return next(new AppError('Appointment not found', 404));
    }

    // Add note if provided
    if (notes) {
      await pool.query(
        `INSERT INTO business_appointment_notes
         (appointment_id, created_by_id, note_type, content)
         VALUES ($1, $2, 'internal', $3)`,
        [appointmentId, req.user.id, notes]
      );
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error updating appointment', { error });
    next(new AppError('Failed to update appointment', 500));
  }
}

// Cancel appointment
async function cancelAppointment(req, res, next) {
  try {
    const { businessId, appointmentId } = req.params;
    const { reason, cancelled_by = 'business' } = req.body;

    const result = await pool.query(
      `UPDATE business_appointments
       SET status = 'cancelled', cancellation_reason = $1, cancelled_by = $2, cancelled_at = NOW()
       WHERE id = $3 AND business_id = $4
       RETURNING *`,
      [reason || null, cancelled_by, appointmentId, businessId]
    );

    if (!result.rows.length) {
      return next(new AppError('Appointment not found', 404));
    }

    // Send cancellation notification
    await sendNotification(appointmentId, 'cancellation_notice');

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error cancelling appointment', { error });
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
      if (orig.status === 'cancelled') {
        throw new AppError('Cannot reschedule a cancelled appointment', 409);
      }

      await client.query(
        'SELECT id FROM business_services WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [orig.service_id, businessId]
      );

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

async function sendNotification(appointmentId, notificationType) {
  // Placeholder - integrate with notification service
  logger.info('Sending notification', { appointmentId, notificationType });
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
