const pool = require('../db');
const { sendValidationError, sendError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_CONFIRMATION_HOURS = 24;
const MIN_CONFIRMATION_HOURS = 1;
const MAX_CONFIRMATION_HOURS = 168;

/**
 * If pending and past expires_at, mark expired (single-row).
 */
async function expireIfStale(bookingRow) {
  if (!bookingRow || bookingRow.status !== 'pending') return bookingRow;
  const exp = new Date(bookingRow.expires_at);
  if (exp > new Date()) return bookingRow;

  const r = await pool.query(
    `UPDATE booking_requests
     SET status = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [bookingRow.id]
  );
  if (r.rows.length) {
    await logBookingAudit(bookingRow.id, 'expired', null, 'system', 'pending', 'expired');
    return r.rows[0];
  }
  return bookingRow;
}

/**
 * Build job wizard prefill from a booking row (client posts via normal POST /api/jobs).
 */
function buildJobPrefillPayload(booking) {
  const lines = [];
  if (booking.service_name) lines.push(booking.service_name);
  const when = `${booking.requested_date} ${booking.requested_start_time}–${booking.requested_end_time}`;
  lines.push(`Preferred time: ${when}`);
  if (booking.service_location) lines.push(`Location: ${booking.service_location}`);
  const descParts = [lines.join('\n')];
  if (booking.description) {
    descParts.push('');
    descParts.push(String(booking.description));
  }
  let description = descParts.join('\n');
  if (description.trim().length < 50) {
    description = `${description}\n\nAdd any extra details below so helpers understand the full scope of the work.`;
  }
  const titleBase = String(booking.service_name || 'Service request').slice(0, 80);
  const title = titleBase.length >= 10 ? titleBase : `${titleBase} — follow-up job`;

  return {
    title,
    description,
    locationInput: booking.service_location || '',
    notes: '',
    preferredHelperId: booking.helper_id,
    preferredHelperName: null,
    sourceBookingId: booking.id,
  };
}

/**
 * Create a new booking request
 * POST /api/bookings
 */
exports.createBookingRequest = async (req, res) => {
  try {
    const customerId = req.user.id;
    const {
      helperId,
      serviceName,
      requestedDate,
      requestedStartTime,
      requestedEndTime,
      serviceLocation,
      description,
      confirmationHours,
    } = req.body;

    const errors = {};
    if (!helperId) errors.helperId = 'Helper ID is required';
    if (!serviceName || !String(serviceName).trim()) errors.serviceName = 'Service name is required';
    if (!requestedDate) errors.requestedDate = 'Date is required';
    if (!requestedStartTime) errors.requestedStartTime = 'Start time is required';
    if (!requestedEndTime) errors.requestedEndTime = 'End time is required';

    let hours = DEFAULT_CONFIRMATION_HOURS;
    if (confirmationHours !== undefined && confirmationHours !== null && confirmationHours !== '') {
      const n = parseInt(String(confirmationHours), 10);
      if (!Number.isFinite(n) || n < MIN_CONFIRMATION_HOURS || n > MAX_CONFIRMATION_HOURS) {
        errors.confirmationHours = `Must be between ${MIN_CONFIRMATION_HOURS} and ${MAX_CONFIRMATION_HOURS}`;
      } else {
        hours = n;
      }
    }

    if (Object.keys(errors).length > 0) {
      return sendValidationError(res, errors);
    }

    if (customerId === helperId) {
      return sendValidationError(res, { helperId: 'Cannot book with yourself' });
    }

    if (requestedStartTime >= requestedEndTime) {
      return sendValidationError(res, { requestedEndTime: 'End time must be after start time' });
    }

    const reqDate = new Date(`${requestedDate}T12:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (reqDate < today) {
      return sendValidationError(res, { requestedDate: 'Cannot book in the past' });
    }

    const helperResult = await pool.query(
      'SELECT id, is_active FROM users WHERE id = $1',
      [helperId]
    );
    if (helperResult.rows.length === 0) {
      return sendError(res, 404, 'Helper not found', 'HELPER_NOT_FOUND');
    }
    if (!helperResult.rows[0].is_active) {
      return sendError(res, 400, 'Helper account is inactive', 'HELPER_INACTIVE');
    }

    const bookingId = uuidv4();
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const result = await pool.query(
      `INSERT INTO booking_requests (
        id, customer_id, helper_id, service_name, requested_date,
        requested_start_time, requested_end_time, service_location,
        description, expires_at, confirmation_hours
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        bookingId,
        customerId,
        helperId,
        String(serviceName).trim(),
        requestedDate,
        requestedStartTime,
        requestedEndTime,
        serviceLocation || null,
        description || null,
        expiresAt,
        hours,
      ]
    );

    const booking = result.rows[0];

    await logBookingAudit(bookingId, 'created', customerId, 'customer', 'pending', 'pending');
    await notifyHelperOfBooking(helperId, booking);

    logger.info('Booking request created', {
      bookingId,
      customerId,
      helperId,
      confirmationHours: hours,
    });

    res.status(201).json({
      success: true,
      data: transformBooking(booking),
    });
  } catch (err) {
    logger.error('Error creating booking request', { error: err.message, stack: err.stack });
    sendError(res, 500, 'Failed to create booking request');
  }
};

exports.getBookingRequest = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user?.id;

    const result = await pool.query(
      'SELECT * FROM booking_requests WHERE id = $1',
      [bookingId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Booking request not found');
    }

    let booking = await expireIfStale(result.rows[0]);

    if (
      userId &&
      userId !== booking.customer_id &&
      userId !== booking.helper_id
    ) {
      return sendError(res, 403, 'Not authorized to view this booking');
    }

    res.json({
      success: true,
      data: transformBooking(booking),
    });
  } catch (err) {
    logger.error('Error fetching booking request', { error: err.message });
    sendError(res, 500, 'Failed to fetch booking request');
  }
};

exports.getMyBookingRequests = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { status, helperId } = req.query;

    let query = 'SELECT * FROM booking_requests WHERE customer_id = $1';
    const params = [customerId];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    if (helperId) {
      query += ` AND helper_id = $${params.length + 1}`;
      params.push(helperId);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    const rows = [];
    for (const row of result.rows) {
      rows.push(transformBooking(await expireIfStale(row)));
    }

    res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    logger.error('Error fetching my bookings', { error: err.message });
    sendError(res, 500, 'Failed to fetch booking requests');
  }
};

exports.getIncomingBookingRequests = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { status } = req.query;

    let query = 'SELECT * FROM booking_requests WHERE helper_id = $1';
    const params = [helperId];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    const rows = [];
    for (const row of result.rows) {
      rows.push(transformBooking(await expireIfStale(row)));
    }

    res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    logger.error('Error fetching incoming bookings', { error: err.message });
    sendError(res, 500, 'Failed to fetch incoming bookings');
  }
};

exports.acceptBookingRequest = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const helperId = req.user.id;

    const result = await pool.query(
      'SELECT * FROM booking_requests WHERE id = $1',
      [bookingId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Booking request not found');
    }

    let booking = await expireIfStale(result.rows[0]);

    if (booking.helper_id !== helperId) {
      return sendError(res, 403, 'Only the assigned helper can respond to this booking');
    }

    if (booking.status !== 'pending') {
      return sendError(res, 400, `Cannot accept a ${booking.status} booking request`);
    }

    const updatedResult = await pool.query(
      `UPDATE booking_requests
       SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [bookingId]
    );

    if (!updatedResult.rows.length) {
      return sendError(res, 400, 'Booking is no longer pending');
    }

    const updated = updatedResult.rows[0];

    await logBookingAudit(bookingId, 'accepted', helperId, 'helper', 'pending', 'accepted');
    await notifyCustomerOfBookingResponse(booking.customer_id, updated, 'accepted');

    logger.info('Booking request accepted', { bookingId, helperId });

    res.json({
      success: true,
      data: transformBooking(updated),
    });
  } catch (err) {
    logger.error('Error accepting booking request', { error: err.message });
    sendError(res, 500, 'Failed to accept booking request');
  }
};

exports.declineBookingRequest = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const helperId = req.user.id;
    const { reason } = req.body;

    const result = await pool.query(
      'SELECT * FROM booking_requests WHERE id = $1',
      [bookingId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Booking request not found');
    }

    let booking = await expireIfStale(result.rows[0]);

    if (booking.helper_id !== helperId) {
      return sendError(res, 403, 'Only the assigned helper can respond to this booking');
    }

    if (booking.status !== 'pending') {
      return sendError(res, 400, `Cannot decline a ${booking.status} booking request`);
    }

    const updatedResult = await pool.query(
      `UPDATE booking_requests
       SET status = 'declined', declined_at = CURRENT_TIMESTAMP,
           helper_response_reason = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [bookingId, reason || null]
    );

    if (!updatedResult.rows.length) {
      return sendError(res, 400, 'Booking is no longer pending');
    }

    const updated = updatedResult.rows[0];

    await logBookingAudit(bookingId, 'declined', helperId, 'helper', 'pending', 'declined');
    await notifyCustomerOfBookingResponse(booking.customer_id, updated, 'declined');

    logger.info('Booking request declined', { bookingId, helperId });

    res.json({
      success: true,
      data: transformBooking(updated),
    });
  } catch (err) {
    logger.error('Error declining booking request', { error: err.message });
    sendError(res, 500, 'Failed to decline booking request');
  }
};

/**
 * Customer cancels pending or accepted booking (pending → cancelled, accepted → accepted_cancelled)
 */
exports.cancelBookingRequest = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const customerId = req.user.id;

    const result = await pool.query(
      'SELECT * FROM booking_requests WHERE id = $1',
      [bookingId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Booking request not found');
    }

    let booking = await expireIfStale(result.rows[0]);

    if (booking.customer_id !== customerId) {
      return sendError(res, 403, 'Only the customer can cancel this booking request');
    }

    if (booking.status === 'pending') {
      const updatedResult = await pool.query(
        `UPDATE booking_requests
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [bookingId]
      );
      if (!updatedResult.rows.length) {
        return sendError(res, 400, 'Booking is no longer pending');
      }
      await logBookingAudit(bookingId, 'cancelled', customerId, 'customer', 'pending', 'cancelled');
      await notifyHelperOfBookingCancellation(booking.helper_id, updatedResult.rows[0]);
      return res.json({ success: true, data: transformBooking(updatedResult.rows[0]) });
    }

    if (booking.status === 'accepted') {
      const updatedResult = await pool.query(
        `UPDATE booking_requests
         SET status = 'accepted_cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'accepted'
         RETURNING *`,
        [bookingId]
      );
      if (!updatedResult.rows.length) {
        return sendError(res, 400, 'Booking cannot be cancelled');
      }
      await logBookingAudit(
        bookingId,
        'accepted_cancelled',
        customerId,
        'customer',
        'accepted',
        'accepted_cancelled'
      );
      await notifyHelperOfBookingCancellation(booking.helper_id, updatedResult.rows[0]);
      return res.json({ success: true, data: transformBooking(updatedResult.rows[0]) });
    }

    return sendError(res, 400, `Cannot cancel a ${booking.status} booking request`);
  } catch (err) {
    logger.error('Error cancelling booking request', { error: err.message });
    sendError(res, 500, 'Failed to cancel booking request');
  }
};

/**
 * Helper cancels after accepting (e.g. conflict) → accepted_cancelled
 */
exports.helperCancelAcceptedBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const helperId = req.user.id;
    const { reason } = req.body;

    const result = await pool.query(
      'SELECT * FROM booking_requests WHERE id = $1',
      [bookingId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Booking request not found');
    }

    const booking = result.rows[0];

    if (booking.helper_id !== helperId) {
      return sendError(res, 403, 'Only the assigned helper can cancel this booking');
    }

    if (booking.status !== 'accepted') {
      return sendError(res, 400, 'Only accepted bookings can be cancelled by the helper here');
    }

    const updatedResult = await pool.query(
      `UPDATE booking_requests
       SET status = 'accepted_cancelled',
           helper_response_reason = COALESCE($2, helper_response_reason),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'accepted'
       RETURNING *`,
      [bookingId, reason || null]
    );

    const updated = updatedResult.rows[0];

    await logBookingAudit(
      bookingId,
      'helper_accepted_cancel',
      helperId,
      'helper',
      'accepted',
      'accepted_cancelled'
    );
    await notifyCustomerOfBookingResponse(booking.customer_id, updated, 'accepted_cancelled');

    res.json({
      success: true,
      data: transformBooking(updated),
    });
  } catch (err) {
    logger.error('Error helper-cancelling booking', { error: err.message });
    sendError(res, 500, 'Failed to cancel booking');
  }
};

/**
 * Returns prefill payload for Post Job wizard (does not create a job row).
 */
exports.convertBookingToJob = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const customerId = req.user.id;

    const result = await pool.query(
      'SELECT * FROM booking_requests WHERE id = $1',
      [bookingId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Booking request not found');
    }

    let booking = await expireIfStale(result.rows[0]);

    if (booking.customer_id !== customerId) {
      return sendError(res, 403, 'Only the customer can use this booking for a job post');
    }

    const ok =
      booking.status === 'declined' ||
      booking.status === 'expired' ||
      booking.status === 'cancelled' ||
      booking.status === 'accepted_cancelled';

    if (!ok) {
      return sendError(
        res,
        400,
        'You can open Post Job from this booking after it expires, is declined, or is cancelled.'
      );
    }

    const prefill = buildJobPrefillPayload(booking);

    logger.info('Booking prefill for job wizard', { bookingId, customerId });

    res.json({
      success: true,
      data: {
        bookingId,
        prefill,
        message: 'Complete the job post to reach all helpers.',
      },
    });
  } catch (err) {
    logger.error('Error building booking prefill', { error: err.message });
    sendError(res, 500, 'Failed to prepare job posting');
  }
};

/**
 * Available slots from helper_availability + appointments for one day.
 */
exports.getHelperAvailableSlots = async (req, res) => {
  try {
    const { helperId } = req.params;
    const { date } = req.query;

    if (!date) {
      return sendValidationError(res, { date: 'Date is required' });
    }

    const helperCheck = await pool.query(
      'SELECT 1 FROM users u JOIN helper_profiles hp ON hp.user_id = u.id WHERE u.id = $1 AND u.deleted_at IS NULL',
      [helperId]
    );
    if (!helperCheck.rows.length) {
      return sendError(res, 404, 'Helper not found');
    }

    const dateObj = new Date(`${date}T12:00:00`);
    if (Number.isNaN(dateObj.getTime())) {
      return sendValidationError(res, { date: 'Invalid date' });
    }

    const dow = dateObj.getDay();

    const weekly = await pool.query(
      `SELECT start_time, end_time FROM helper_availability
       WHERE helper_id = $1 AND day_of_week = $2 AND is_active = TRUE
       ORDER BY start_time`,
      [helperId, dow]
    );

    let dayBlocks = [];
    for (const row of weekly.rows) {
      dayBlocks.push({
        start: row.start_time,
        end: row.end_time,
      });
    }

    if (dayBlocks.length === 0) {
      dayBlocks.push({ start: '09:00:00', end: '17:00:00' });
    }

    // Whole-day block overrides
    const overrides = await pool.query(
      `SELECT is_blocked, start_time, end_time FROM helper_availability_overrides
       WHERE helper_id = $1 AND override_date = $2::date`,
      [helperId, date]
    );

    let effectiveBlocks = dayBlocks;
    for (const ov of overrides.rows) {
      if (ov.is_blocked && ov.start_time == null && ov.end_time == null) {
        effectiveBlocks = [];
        break;
      }
    }

    const appointmentsResult = await pool.query(
      `SELECT scheduled_start_time, scheduled_end_time
       FROM appointments
       WHERE helper_id = $1
         AND scheduled_start_time::date = $2::date
         AND status IN ('requested','confirmed','in_progress')
       ORDER BY scheduled_start_time`,
      [helperId, date]
    );

    const appointments = appointmentsResult.rows.map((apt) => ({
      start: timeFromTimestamptz(apt.scheduled_start_time),
      end: timeFromTimestamptz(apt.scheduled_end_time),
    }));

    const slots = [];
    for (const block of effectiveBlocks) {
      slots.push(...sliceWindowToHourSlots(block.start, block.end, appointments));
    }

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    res.json({
      success: true,
      data: {
        date,
        dayOfWeek: dayNames[dow],
        slots,
      },
    });
  } catch (err) {
    logger.error('Error fetching available slots', { error: err.message, stack: err.stack });
    sendError(res, 500, 'Failed to fetch available slots');
  }
};

function timeFromTimestamptz(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}:00`;
}

function timeToMinutes(t) {
  if (!t) return 0;
  if (t instanceof Date) {
    return t.getHours() * 60 + t.getMinutes();
  }
  const s = String(t);
  const parts = s.match(/(\d{1,2}):(\d{2})/);
  if (!parts) return 0;
  return parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function sliceWindowToHourSlots(windowStart, windowEnd, busyRanges) {
  const slots = [];
  let cur = timeToMinutes(windowStart);
  const endMin = timeToMinutes(windowEnd);
  const busy = busyRanges
    .map((r) => ({
      a: timeToMinutes(r.start),
      b: timeToMinutes(r.end),
    }))
    .filter((r) => r.b > r.a);

  while (cur + 60 <= endMin) {
    const slotStart = cur;
    const slotEnd = cur + 60;
    const overlaps = busy.some((b) => slotStart < b.b && slotEnd > b.a);
    slots.push({
      startTime: minutesToTime(slotStart),
      endTime: minutesToTime(slotEnd),
      available: !overlaps,
    });
    cur += 60;
  }
  return slots;
}

function transformBooking(booking) {
  return {
    id: booking.id,
    customerId: booking.customer_id,
    helperId: booking.helper_id,
    serviceName: booking.service_name,
    requestedDate: booking.requested_date,
    requestedStartTime: booking.requested_start_time,
    requestedEndTime: booking.requested_end_time,
    serviceLocation: booking.service_location,
    description: booking.description,
    status: booking.status,
    expiresAt: booking.expires_at,
    confirmationHours: booking.confirmation_hours,
    acceptedAt: booking.accepted_at,
    declinedAt: booking.declined_at,
    helperResponseReason: booking.helper_response_reason,
    convertedToJobId: booking.converted_to_job_id,
    createdAt: booking.created_at,
    updatedAt: booking.updated_at,
  };
}

async function logBookingAudit(bookingId, action, actorId, actorType, oldStatus, newStatus) {
  try {
    await pool.query(
      `INSERT INTO booking_request_audit_log (booking_request_id, action, actor_id, actor_type, old_status, new_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [bookingId, action, actorId, actorType, oldStatus, newStatus]
    );
  } catch (err) {
    logger.warn('Failed to log booking audit', { error: err.message });
  }
}

async function notifyHelperOfBooking(helperId, booking) {
  try {
    logger.info('Booking notification sent to helper', { helperId, bookingId: booking.id });
  } catch (err) {
    logger.warn('Failed to notify helper', { error: err.message });
  }
}

async function notifyCustomerOfBookingResponse(customerId, booking, response) {
  try {
    logger.info('Booking response notification sent to customer', {
      customerId,
      bookingId: booking.id,
      response,
    });
  } catch (err) {
    logger.warn('Failed to notify customer', { error: err.message });
  }
}

async function notifyHelperOfBookingCancellation(helperId, booking) {
  try {
    logger.info('Booking cancellation notification sent to helper', { helperId, bookingId: booking.id });
  } catch (err) {
    logger.warn('Failed to notify helper of cancellation', { error: err.message });
  }
}

/** Pending bookings past expires_at → expired */
exports.expirePendingBookingRequests = async () => {
  try {
    const r = await pool.query(
      `UPDATE booking_requests
       SET status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'pending' AND expires_at < NOW()
       RETURNING id`
    );
    if (r.rowCount > 0) {
      logger.info('Expired pending booking requests', { count: r.rowCount });
    }
    return r.rowCount || 0;
  } catch (err) {
    logger.warn('expirePendingBookingRequests failed', { error: err.message });
    return 0;
  }
};

/**
 * After scheduled end (date + end time in server TZ), release accepted bookings so customer can post publicly.
 */
exports.releaseStaleAcceptedBookings = async () => {
  try {
    const r = await pool.query(
      `UPDATE booking_requests
       SET status = 'accepted_cancelled',
           helper_response_reason = COALESCE(
             helper_response_reason,
             'Automatically released after scheduled time passed'
           ),
           updated_at = CURRENT_TIMESTAMP
       WHERE status = 'accepted'
         AND (requested_date::timestamp + requested_end_time::interval) < NOW()
       RETURNING id`
    );
    if (r.rowCount > 0) {
      logger.info('Released accepted bookings past scheduled end', { count: r.rowCount });
    }
    return r.rowCount || 0;
  } catch (err) {
    logger.warn('releaseStaleAcceptedBookings failed', { error: err.message });
    return 0;
  }
};
