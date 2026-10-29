const { calendarScopeClause } = require('../middleware/requireBusinessCalendarAccess');
// Business appointments controller
// Handle appointment bookings, updates, cancellations, and customer interactions
const { attributePromotionConversion } = require('../analytics/promotionAttribution');

const pool = require('../db');
const { AppError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { sendNotification } = require('../services/notificationService');
// P3-8-F12: the accept path (bookingRequestLifecycle.acceptBookingRequest)
// serializes on this per-business advisory lock, so direct creates and
// reschedules must take it too (before any conflict check), or a racing
// create+accept pair can both pass their checks and double-book.
const { lockBusinessAppointments } = require('../services/bookingRequestLifecycle');
const { isStaffBlocked } = require('../services/businessAvailability'); // Review P2-3-F08

// Cancellation policy enforcement (P3-8-F05). The service's
// cancellation_policy_hours / cancellation_fee_percent (falling back to the
// business-level cancellation_allowed_hours_before for the window) are
// otherwise dead config. Returns { feeCents, late }: the recorded late-cancel
// amount. Recording only: the server never charges the fee automatically;
// the business collects it directly. Money code fails closed.
async function computeLateCancellationFee(client, { businessId, serviceId, startTime, finalPriceCents }) {
  const { rows } = await client.query(
    `SELECT COALESCE(s.cancellation_policy_hours, r.cancellation_allowed_hours_before, 24) AS policy_hours,
            COALESCE(s.cancellation_fee_percent, 0) AS fee_percent
       FROM business_services s
       LEFT JOIN business_booking_rules r ON r.business_id = s.business_id
      WHERE s.id = $1 AND s.business_id = $2`,
    [serviceId, businessId]
  );
  const policyHours = Number(rows[0]?.policy_hours) || 0;
  const feePercent = Number(rows[0]?.fee_percent) || 0;
  if (!policyHours || !feePercent) return { feeCents: 0, late: false };
  const hoursUntilStart = (new Date(startTime).getTime() - Date.now()) / 3600000;
  if (hoursUntilStart >= policyHours) return { feeCents: 0, late: false };
  return {
    feeCents: Math.round((Number(finalPriceCents) || 0) * feePercent / 100),
    late: true,
  };
}

// Waitlist auto-offer (P3-8-F16). When a slot frees up, offer it to the
// longest-waiting entry whose preferred window covers the freed time, flip
// it to 'offered', and write the waitlist_notifications row the manual-only
// flow never wrote. Returns the offered entry ({ id, customer_id }) or null.
async function offerFreedSlotToWaitlist(client, { businessId, appointment }) {
  const { rows } = await client.query(
    `SELECT w.id, w.customer_id
       FROM appointment_waitlist w
       JOIN business_services bs ON bs.id = w.service_id
      WHERE w.status = 'waiting'
        AND bs.id = $1 AND bs.business_id = $2
        AND (w.preferred_date_start IS NULL OR DATE($3) >= w.preferred_date_start)
        AND (w.preferred_date_end IS NULL OR DATE($3) <= w.preferred_date_end)
        AND (w.preferred_time_start IS NULL OR w.preferred_time_start::time <= ($3::timestamptz)::time)
        AND (w.preferred_time_end IS NULL OR ($3::timestamptz)::time < w.preferred_time_end::time)
        AND (w.staff_id IS NULL OR ($4::uuid IS NOT NULL AND w.staff_id = $4))
      ORDER BY w.position_in_queue ASC NULLS LAST, w.created_at ASC
      LIMIT 1`,
    [appointment.service_id, businessId, appointment.start_time, appointment.staff_id]
  );
  if (!rows.length) return null;
  const entry = rows[0];
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
  await client.query(
    `UPDATE appointment_waitlist
        SET status = 'offered', offer_made_at = NOW(), offer_expires_at = $2, updated_at = NOW()
      WHERE id = $1`,
    [entry.id, expiresAt.toISOString()]
  );
  await client.query(
    `INSERT INTO waitlist_notifications (waitlist_id, notification_type, channel, sent_at)
     VALUES ($1, 'slot_available', 'both', NOW())`,
    [entry.id]
  );
  return entry;
}

async function notifyWaitlistOffer(entry, appointment) {
  if (!entry?.customer_id) return;
  try {
    await sendNotification({
      userId: entry.customer_id,
      type: 'waitlist_slot_available',
      title: 'A slot opened up',
      body: 'A time you were waiting for is now available. It is held for you for 24 hours.',
      data: {
        waitlist_id: String(entry.id),
        appointment_id: String(appointment.id),
        business_id: String(appointment.business_id || ''),
        start_time: appointment.start_time,
      },
      action_url: `/businesses/${appointment.business_id}/book`,
      idempotencyKey: `waitlist-offer:${entry.id}`,
    });
  } catch (error) {
    logger.warn('Waitlist offer notification failed', { waitlistId: entry.id, error: error.message });
  }
}

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
    // authoritative "do not book" signal. Review P2-3-F08: use the shared
    // predicate so the writer agrees with the slots listing and the booking
    // gate.
    if (await isStaffBlocked(staffId, startTime, endTime, client)) {
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
    // P3-8-F15: the enforceBookingRules middleware already validated and
    // normalized these; use its result instead of re-deriving from the body
    // (drift risk). Standalone callers (no middleware) fall back to the body.
    const bv = req.bookingValidation || null;
    const {
      customer_id, customer_name, customer_email,
      customer_phone, customer_notes, base_price_cents
    } = req.body;
    const service_id = bv?.service?.id ?? req.body.service_id;
    const staff_id = bv ? bv.staffId : req.body.staff_id;
    const start_time = bv?.startTimeIso ?? req.body.start_time;
    const end_time = bv?.endTimeIso ?? req.body.end_time;

    // Validate required fields
    if (!service_id || !start_time || !end_time || base_price_cents === undefined) {
      return next(new AppError('Service, start time, end time, and price are required', 400));
    }
    if (new Date(end_time) <= new Date(start_time)) {
      return next(new AppError('End time must be after start time', 400));
    }

    // P3-8-F10: staff-created (walk-in) appointments record the customer
    // from the body only; never bind the staff member's own user id.
    const effectiveCustomerId = req.staffCreated ? (customer_id || null) : (req.user?.id || customer_id || null);
    const appointment = await withTransaction(pool, async (client) => {
      // P3-8-F12: take the per-business advisory lock FIRST (same mutex the
      // accept path holds), before the service row claim and the conflict
      // check, so a racing direct create and booking accept serialize.
      await lockBusinessAppointments(client, businessId);
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
      if (!req.staffCreated && effectiveCustomerId) {
        const { emitDomainEvent, serviceEventProps } = require('../growth/emit');
        await emitDomainEvent(client, 'appointment.booked', serviceEventProps({ service_id }), { userId: effectiveCustomerId, req });
      }
      return appointmentResult.rows[0];
    });

    // Set up reminders
    await setupReminderSchedule(appointment.id, start_time);
    await notifyAppointmentParticipants(appointment, 'appointment_created');

    // P3-8-F05: require_payment_upfront was dead config; surface it on the
    // created appointment so the hub and the customer know payment is due
    // before the service. The server never charges on its own.
    const rulesRes = await pool.query(
      'SELECT require_payment_upfront FROM business_booking_rules WHERE business_id = $1 LIMIT 1',
      [businessId]
    );
    const requiresPaymentUpfront = rulesRes.rows[0]?.require_payment_upfront !== false;

    res.status(201).json({ ...appointment, requires_payment_upfront: requiresPaymentUpfront });
    // Staff-created appointments are not customer conversions.
    if (!req.staffCreated) attributePromotionConversion(req, { businessId, conversionType: 'appointment', referenceId: appointment.id });
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
    const recordParams = [appointmentId, businessId];
    const recordScope = calendarScopeClause(req, recordParams, 'ba.staff_id');

    const result = await pool.query(
      `SELECT ba.*, bs.name as service_name, bs.duration_minutes,
              (SELECT json_agg(json_build_object('content', content, 'created_at', created_at, 'created_by', created_by_id) ORDER BY created_at DESC)
               FROM business_appointment_notes WHERE appointment_id = ba.id) as notes
       FROM business_appointments ba
       LEFT JOIN business_services bs ON ba.service_id = bs.id
       WHERE ba.id = $1 AND ba.business_id = $2${recordScope}`,
      recordParams
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
    query += calendarScopeClause(req, params, 'ba.staff_id');

    if (status !== 'all') {
      query += ` AND ba.status = $${params.length + 1}`;
      params.push(status);
    }

    if (start_date) {
      query += ` AND ba.end_time > $${params.length + 1}`;
      params.push(start_date);
    }

    if (end_date) {
      query += ` AND ba.start_time < $${params.length + 1}`;
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

    const countQuery = `SELECT COUNT(*) FROM (${query}) visible_appointments`;
    const countParams = [...params];
    query += ` ORDER BY ba.start_time DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    const countResult = await pool.query(
      countQuery,
      countParams
    );

    res.json({
      appointments: result.rows,
      permissions: req.calendarAccess || { canManageAll: false, canManageSelf: false, canCreate: false, canRecordPayment: false },
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
    const recordParams = [appointmentId, businessId];
    const recordScope = calendarScopeClause(req, recordParams, 'staff_id');
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
      // P3-8-F12: same mutex as the accept path and direct creates.
      await lockBusinessAppointments(client, businessId);
      const currentResult = await client.query(
        `SELECT * FROM business_appointments WHERE id = $1 AND business_id = $2${recordScope} FOR UPDATE`,
        recordParams
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
      let lateCancellation = false;
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
        // P3-8-F05: enforce the late-cancel fee on this path too.
        const { feeCents, late } = await computeLateCancellationFee(client, {
          businessId,
          serviceId: current.service_id,
          startTime: current.start_time,
          finalPriceCents: current.final_price_cents,
        });
        lateCancellation = late;
        params.push(feeCents);
        setFragments.push(`cancellation_fee_cents = $${params.length}`);
      }
      const result = await client.query(
        `UPDATE business_appointments SET ${setFragments.join(', ')}
         WHERE id = $2 AND business_id = $3 AND status = $4 RETURNING *`,
        params
      );
      if (!result.rows.length) throw new AppError('Appointment status changed; please refresh', 409, 'stale_appointment');
      // P3-8-F16: the freed slot is offered to the waitlist automatically.
      const waitlistOffer = status === 'cancelled'
        ? await offerFreedSlotToWaitlist(client, { businessId, appointment: result.rows[0] })
        : null;
      return { row: { ...result.rows[0], late_cancellation: lateCancellation }, waitlistOffer };
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

    const { row: updatedAppointment, waitlistOffer } = appointment;
    await notifyAppointmentParticipants(updatedAppointment, `appointment_${status}`);
    if (waitlistOffer) await notifyWaitlistOffer(waitlistOffer, updatedAppointment);
    res.json(updatedAppointment);
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
    const recordParams = [appointmentId, businessId];
    const recordScope = calendarScopeClause(req, recordParams, 'staff_id');
    const { reason, cancelled_by } = req.body;
    // cancelled_by is CHECK-constrained to customer/business/system; coerce
    // anything else to the default instead of 500ing on the constraint.
    const cancelledBy = ['customer', 'business', 'system'].includes(cancelled_by) ? cancelled_by : 'business';
    const cancelReason = reason ? String(reason).slice(0, 500) : null;

    // Terminal states are locked, matching updateAppointmentStatus's
    // transition table: a completed or no-show appointment cannot be
    // cancelled through this path either.
    const cancellableFrom = ['pending', 'confirmed', 'in_progress'];
    const { appointment, waitlistOffer } = await withTransaction(pool, async (client) => {
      // P3-8-F12: same mutex as the accept path and direct creates.
      await lockBusinessAppointments(client, businessId);
      const currentResult = await client.query(
        `SELECT * FROM business_appointments WHERE id = $1 AND business_id = $2${recordScope} FOR UPDATE`,
        recordParams
      );
      if (!currentResult.rows.length) throw new AppError('Appointment not found', 404);
      const current = currentResult.rows[0];
      if (!cancellableFrom.includes(current.status)) {
        throw new AppError(`Cannot cancel appointment with status ${current.status}`, 409, 'invalid_status_transition');
      }
      // P3-8-F05: enforce the service's cancellation policy. A late
      // cancellation records the fee as an amount due; the server never
      // charges it automatically.
      const { feeCents, late } = await computeLateCancellationFee(client, {
        businessId,
        serviceId: current.service_id,
        startTime: current.start_time,
        finalPriceCents: current.final_price_cents,
      });
      const result = await client.query(
        `UPDATE business_appointments
         SET status = 'cancelled', cancellation_reason = $1, cancelled_by = $2, cancelled_at = NOW(),
             cancellation_fee_cents = $5, updated_at = NOW()
         WHERE id = $3 AND business_id = $4
         RETURNING *`,
        [cancelReason, cancelledBy, appointmentId, businessId, feeCents]
      );
      // P3-8-F16: a freed slot is offered to the waitlist automatically.
      const offer = await offerFreedSlotToWaitlist(client, { businessId, appointment: result.rows[0] });
      return { appointment: { ...result.rows[0], late_cancellation: late }, waitlistOffer: offer };
    }, 'cancel_appointment');

    // Send cancellation notification
    await notifyAppointmentParticipants(appointment, 'appointment_cancelled');
    if (waitlistOffer) await notifyWaitlistOffer(waitlistOffer, appointment);

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
    const recordParams = [appointmentId, businessId];
    const recordScope = calendarScopeClause(req, recordParams, 'staff_id');
    const { new_start_time, new_end_time } = req.body;

    if (!new_start_time || !new_end_time) {
      return next(new AppError('New start and end times are required', 400));
    }
    if (new Date(new_end_time) <= new Date(new_start_time)) {
      return next(new AppError('End time must be after start time', 400));
    }

    const updated = await withTransaction(pool, async (client) => {
      // P3-8-F12: take the per-business advisory lock FIRST (same mutex the
      // accept path holds), before the row claims and conflict checks.
      await lockBusinessAppointments(client, businessId);
      // Get original appointment and take a claim on the service row so
      // concurrent reschedules/creates for the same service serialize.
      const origResult = await client.query(
        `SELECT * FROM business_appointments WHERE id = $1 AND business_id = $2${recordScope} FOR UPDATE`,
        recordParams
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
        service: svcRows[0] || null,
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

      // Log reschedule. P3-8-F14: rescheduled_by_type reflects who acted:
      // the appointment's customer, or business staff. The route is
      // staff-only today, but the label stays correct if it ever opens to
      // customers.
      const rescheduledByType = orig.customer_id && req.user?.id &&
        String(orig.customer_id) === String(req.user.id) ? 'customer' : 'business';
      await client.query(
        `INSERT INTO business_appointment_reschedule_history
         (appointment_id, original_start_time, original_end_time, new_start_time, new_end_time, rescheduled_by_id, rescheduled_by_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [appointmentId, orig.start_time, orig.end_time, new_start_time, new_end_time, req.user.id, rescheduledByType]
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

    const params = [appointmentId, req.user.id, note_type, content, businessId];
    const scope = calendarScopeClause(req, params, 'a.staff_id');
    const result = await pool.query(
      `INSERT INTO business_appointment_notes
       (appointment_id, created_by_id, note_type, content)
       SELECT a.id, $2, $3, $4 FROM business_appointments a
        WHERE a.id = $1 AND a.business_id = $5${scope}
       RETURNING *`,
      params
    );

    if (!result.rows.length) return next(new AppError('Appointment not found', 404));
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Error adding note', { error });
    next(new AppError('Failed to add note', 500));
  }
}

// Reassign an appointment to a different staff member (P3-8-F07).
// Previously the only path was cancel + recreate, which destroyed notes and
// reschedule history. This updates staff_id in place, re-validating the
// service assignment and the appointment window for the new staff member,
// and records an internal note for the audit trail.
async function reassignAppointmentStaff(req, res, next) {
  try {
    const { businessId, appointmentId } = req.params;
    const recordParams = [appointmentId, businessId];
    const recordScope = calendarScopeClause(req, recordParams, 'staff_id');
    const { staff_id } = req.body || {};

    const appointment = await withTransaction(pool, async (client) => {
      // P3-8-F12: same mutex as the accept path and direct creates.
      await lockBusinessAppointments(client, businessId);
      const currentResult = await client.query(
        `SELECT * FROM business_appointments WHERE id = $1 AND business_id = $2${recordScope} FOR UPDATE`,
        recordParams
      );
      if (!currentResult.rows.length) throw new AppError('Appointment not found', 404);
      const current = currentResult.rows[0];
      if (['cancelled', 'completed', 'no_show'].includes(current.status)) {
        throw new AppError(
          `Cannot reassign an appointment with status ${current.status}`,
          409,
          'invalid_status_transition'
        );
      }
      const newStaffId = staff_id || null;
      if (newStaffId && String(newStaffId) === String(current.staff_id)) {
        return current;
      }
      if (newStaffId) {
        // The new staff member must be assigned to the service and available,
        // mirroring enforceBookingRules step 3.
        const staffRes = await client.query(
          `SELECT 1 FROM business_service_staff
            WHERE service_id = $1 AND staff_id = $2 AND is_available = TRUE`,
          [current.service_id, newStaffId]
        );
        if (!staffRes.rows.length) {
          throw new AppError('Staff member is not assigned to this service', 400, 'staff_not_assigned');
        }
        // The new staff member must be free in the appointment's window.
        await assertAppointmentWindowFree(client, {
          businessId,
          serviceId: current.service_id,
          staffId: newStaffId,
          startTime: current.start_time,
          endTime: current.end_time,
          excludeAppointmentId: appointmentId,
        });
      }
      const result = await client.query(
        `UPDATE business_appointments
         SET staff_id = $1, updated_at = NOW()
         WHERE id = $2 AND business_id = $3
         RETURNING *`,
        [newStaffId, appointmentId, businessId]
      );
      await client.query(
        `INSERT INTO business_appointment_notes
         (appointment_id, created_by_id, note_type, content)
         VALUES ($1, $2, 'internal', $3)`,
        [appointmentId, req.user.id, `Staff reassigned to ${newStaffId || 'unassigned'}`]
      );
      return result.rows[0];
    }, 'reassign_appointment_staff');

    await notifyAppointmentParticipants(appointment, 'appointment_staff_reassigned');
    res.json(appointment);
  } catch (error) {
    // DB-level backstop (ba_no_staff_double_booking exclusion) fired.
    if (error && error.code === '23P01') {
      return next(new AppError('Staff member is no longer available at this time', 409));
    }
    if (error instanceof AppError) return next(error);
    logger.error('Error reassigning appointment staff', { error });
    next(new AppError('Failed to reassign appointment', 500));
  }
}

// Record an off-platform payment collection for an appointment (P3-8-F05).
// require_payment_upfront is now surfaced on create; this gives staff the
// matching path to mark the payment collected (cash/card at the door).
// Recording only: the server moves no money. pending -> paid is the only
// allowed transition; anything else fails closed.
async function recordAppointmentPayment(req, res, next) {
  try {
    const { businessId, appointmentId } = req.params;
    const recordParams = [appointmentId, businessId];
    const recordScope = calendarScopeClause(req, recordParams, 'staff_id');
    const { amount_cents, payment_method } = req.body || {};

    if (!Number.isSafeInteger(amount_cents) || amount_cents <= 0) {
      return next(new AppError('A positive amount_cents is required', 400, 'validation_failed'));
    }
    const method = ['cash', 'card', 'transfer', 'other'].includes(payment_method) ? payment_method : 'other';

    const appointment = await withTransaction(pool, async (client) => {
      const currentResult = await client.query(
        `SELECT * FROM business_appointments WHERE id = $1 AND business_id = $2${recordScope} FOR UPDATE`,
        recordParams
      );
      if (!currentResult.rows.length) throw new AppError('Appointment not found', 404);
      const current = currentResult.rows[0];
      if (current.payment_status !== 'pending') {
        throw new AppError(`Payment is already ${current.payment_status}`, 409, 'invalid_payment_transition');
      }
      if (['cancelled', 'no_show'].includes(current.status)) {
        throw new AppError(`Cannot record payment for a ${current.status} appointment`, 409, 'invalid_status_transition');
      }
      const result = await client.query(
        `UPDATE business_appointments
         SET payment_status = 'paid', updated_at = NOW()
         WHERE id = $1 AND business_id = $2 AND payment_status = 'pending'
         RETURNING *`,
        [appointmentId, businessId]
      );
      if (!result.rows.length) throw new AppError('Payment was already recorded; please refresh', 409, 'stale_appointment');
      await client.query(
        `INSERT INTO business_appointment_notes
         (appointment_id, created_by_id, note_type, content)
         VALUES ($1, $2, 'internal', $3)`,
        [appointmentId, req.user.id, `Payment collected: ${(amount_cents / 100).toFixed(2)} via ${method}`]
      );
      return result.rows[0];
    }, 'record_appointment_payment');

    await notifyAppointmentParticipants(appointment, 'appointment_payment_recorded');
    res.json(appointment);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    logger.error('Error recording appointment payment', { error });
    next(new AppError('Failed to record payment', 500));
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
  reassignAppointmentStaff,
  recordAppointmentPayment,
  addAppointmentNote
};
