const pool = require('../db');
const { AppError, sendValidationError, sendError } = require('../utils/apiError');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

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
      description
    } = req.body;

    // Validation
    const errors = {};
    if (!helperId) errors.helperId = 'Helper ID is required';
    if (!serviceName) errors.serviceName = 'Service name is required';
    if (!requestedDate) errors.requestedDate = 'Date is required';
    if (!requestedStartTime) errors.requestedStartTime = 'Start time is required';
    if (!requestedEndTime) errors.requestedEndTime = 'End time is required';

    if (Object.keys(errors).length > 0) {
      return sendValidationError(res, errors);
    }

    if (customerId === helperId) {
      return sendValidationError(res, { helperId: 'Cannot book with yourself' });
    }

    // Validate time range
    if (requestedStartTime >= requestedEndTime) {
      return sendValidationError(res, { requestedEndTime: 'End time must be after start time' });
    }

    // Validate date is in the future
    const reqDate = new Date(requestedDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (reqDate < today) {
      return sendValidationError(res, { requestedDate: 'Cannot book in the past' });
    }

    // Check that helper exists and is active
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

    // Create booking request
    const bookingId = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    const result = await pool.query(
      `INSERT INTO booking_requests (
        id, customer_id, helper_id, service_name, requested_date,
        requested_start_time, requested_end_time, service_location,
        description, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        bookingId, customerId, helperId, serviceName, requestedDate,
        requestedStartTime, requestedEndTime, serviceLocation,
        description, expiresAt
      ]
    );

    const booking = result.rows[0];

    // Log audit
    await logBookingAudit(bookingId, 'created', customerId, 'customer', 'pending', 'pending');

    // Send notification to helper
    await notifyHelperOfBooking(helperId, booking);

    logger.info('Booking request created', {
      bookingId,
      customerId,
      helperId,
      requestedDate,
      requestedStartTime,
      requestedEndTime
    });

    res.status(201).json({
      success: true,
      data: transformBooking(booking)
    });
  } catch (err) {
    logger.error('Error creating booking request', { error: err.message, stack: err.stack });
    sendError(res, 500, 'Failed to create booking request');
  }
};

/**
 * Get booking request by ID
 * GET /api/bookings/:bookingId
 */
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

    const booking = result.rows[0];

    // Check access: customer, helper, or admin can view
    if (userId && userId !== booking.customer_id && userId !== booking.helper_id) {
      return sendError(res, 403, 'Not authorized to view this booking');
    }

    res.json({
      success: true,
      data: transformBooking(booking)
    });
  } catch (err) {
    logger.error('Error fetching booking request', { error: err.message });
    sendError(res, 500, 'Failed to fetch booking request');
  }
};

/**
 * Get customer's booking requests
 * GET /api/bookings (with customer_id context from auth)
 */
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

    res.json({
      success: true,
      data: result.rows.map(transformBooking)
    });
  } catch (err) {
    logger.error('Error fetching my bookings', { error: err.message });
    sendError(res, 500, 'Failed to fetch booking requests');
  }
};

/**
 * Get helper's incoming booking requests
 * GET /api/bookings/incoming (with helper_id context from auth)
 */
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

    res.json({
      success: true,
      data: result.rows.map(transformBooking)
    });
  } catch (err) {
    logger.error('Error fetching incoming bookings', { error: err.message });
    sendError(res, 500, 'Failed to fetch incoming bookings');
  }
};

/**
 * Helper accepts a booking request
 * POST /api/bookings/:bookingId/accept
 */
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

    const booking = result.rows[0];

    if (booking.helper_id !== helperId) {
      return sendError(res, 403, 'Only the assigned helper can respond to this booking');
    }

    if (booking.status !== 'pending') {
      return sendError(res, 400, `Cannot accept a ${booking.status} booking request`);
    }

    // Update status
    const updatedResult = await pool.query(
      `UPDATE booking_requests
       SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [bookingId]
    );

    const updated = updatedResult.rows[0];

    // Log audit
    await logBookingAudit(bookingId, 'accepted', helperId, 'helper', 'pending', 'accepted');

    // Notify customer
    await notifyCustomerOfBookingResponse(booking.customer_id, updated, 'accepted');

    logger.info('Booking request accepted', { bookingId, helperId });

    res.json({
      success: true,
      data: transformBooking(updated)
    });
  } catch (err) {
    logger.error('Error accepting booking request', { error: err.message });
    sendError(res, 500, 'Failed to accept booking request');
  }
};

/**
 * Helper declines a booking request
 * POST /api/bookings/:bookingId/decline
 */
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

    const booking = result.rows[0];

    if (booking.helper_id !== helperId) {
      return sendError(res, 403, 'Only the assigned helper can respond to this booking');
    }

    if (booking.status !== 'pending') {
      return sendError(res, 400, `Cannot decline a ${booking.status} booking request`);
    }

    // Update status
    const updatedResult = await pool.query(
      `UPDATE booking_requests
       SET status = 'declined', declined_at = CURRENT_TIMESTAMP,
           helper_response_reason = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [bookingId, reason || null]
    );

    const updated = updatedResult.rows[0];

    // Log audit
    await logBookingAudit(bookingId, 'declined', helperId, 'helper', 'pending', 'declined');

    // Notify customer
    await notifyCustomerOfBookingResponse(booking.customer_id, updated, 'declined');

    logger.info('Booking request declined', { bookingId, helperId });

    res.json({
      success: true,
      data: transformBooking(updated)
    });
  } catch (err) {
    logger.error('Error declining booking request', { error: err.message });
    sendError(res, 500, 'Failed to decline booking request');
  }
};

/**
 * Customer cancels a pending booking request
 * POST /api/bookings/:bookingId/cancel
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

    const booking = result.rows[0];

    if (booking.customer_id !== customerId) {
      return sendError(res, 403, 'Only the customer can cancel this booking request');
    }

    if (booking.status !== 'pending') {
      return sendError(res, 400, `Cannot cancel a ${booking.status} booking request`);
    }

    // Update status
    const updatedResult = await pool.query(
      `UPDATE booking_requests
       SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [bookingId]
    );

    const updated = updatedResult.rows[0];

    // Log audit
    await logBookingAudit(bookingId, 'cancelled', customerId, 'customer', 'pending', 'cancelled');

    // Notify helper
    await notifyHelperOfBookingCancellation(booking.helper_id, updated);

    logger.info('Booking request cancelled', { bookingId, customerId });

    res.json({
      success: true,
      data: transformBooking(updated)
    });
  } catch (err) {
    logger.error('Error cancelling booking request', { error: err.message });
    sendError(res, 500, 'Failed to cancel booking request');
  }
};

/**
 * Convert booking request to a job posting
 * POST /api/bookings/:bookingId/convert-to-job
 *
 * This creates a new job with pre-filled fields from the booking
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

    const booking = result.rows[0];

    if (booking.customer_id !== customerId) {
      return sendError(res, 403, 'Only the customer can convert this booking');
    }

    if (booking.status !== 'declined' && booking.status !== 'expired' && booking.status !== 'cancelled') {
      return sendError(res, 400, 'Can only convert failed or expired bookings to jobs');
    }

    // Create the job with pre-filled data
    const jobId = uuidv4();

    // Determine budget style from the booking
    // For now, we'll leave budget fields for the customer to fill, but pre-fill service/location/description
    const jobResult = await pool.query(
      `INSERT INTO jobs (
        id, client_id, title, description, category, location_lat, location_lng,
        service_area_name, budget_type, min_budget_cents, max_budget_cents,
        estimated_hours, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, 'not_specified', NULL, NULL, NULL, 'draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        jobId, customerId, booking.service_name,
        booking.description, 'local_services',
        booking.service_location
      ]
    );

    const job = jobResult.rows[0];

    // Update booking to track conversion
    await pool.query(
      'UPDATE booking_requests SET converted_to_job_id = $1 WHERE id = $2',
      [jobId, bookingId]
    );

    // Log audit
    await logBookingAudit(bookingId, 'converted_to_job', customerId, 'customer', booking.status, 'converted');

    logger.info('Booking converted to job', { bookingId, jobId, customerId });

    res.json({
      success: true,
      data: {
        bookingId,
        jobId,
        job: job,
        message: 'Booking converted to job posting. Complete the form and post to receive bids.'
      }
    });
  } catch (err) {
    logger.error('Error converting booking to job', { error: err.message });
    sendError(res, 500, 'Failed to convert booking to job');
  }
};

/**
 * Get helper's available slots for a given date
 * GET /api/bookings/helper/:helperId/available-slots?date=YYYY-MM-DD
 */
exports.getHelperAvailableSlots = async (req, res) => {
  try {
    const { helperId } = req.params;
    const { date } = req.query;

    if (!date) {
      return sendValidationError(res, { date: 'Date is required' });
    }

    // Fetch helper's business hours
    const helperResult = await pool.query(
      `SELECT h.id, h.business_hours
       FROM helper_profiles h
       WHERE h.id = $1`,
      [helperId]
    );

    if (helperResult.rows.length === 0) {
      return sendError(res, 404, 'Helper not found');
    }

    const helper = helperResult.rows[0];
    const businessHours = helper.business_hours || {};

    // Get day of week for the requested date
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'lowercase' });

    const dayHours = businessHours[dayOfWeek];
    if (!dayHours || dayHours.closed) {
      return res.json({
        success: true,
        data: {
          date,
          dayOfWeek,
          slots: []
        }
      });
    }

    // Fetch existing appointments for this helper on this date
    const appointmentsResult = await pool.query(
      `SELECT scheduled_start_at, scheduled_end_at
       FROM appointments
       WHERE assigned_helper_id = $1 AND DATE(scheduled_start_at) = $2 AND status IN ('confirmed', 'in_progress')
       ORDER BY scheduled_start_at`,
      [helperId, date]
    );

    // Calculate available slots (1-hour slots)
    const slots = calculateAvailableSlots(dayHours, appointmentsResult.rows);

    res.json({
      success: true,
      data: {
        date,
        dayOfWeek,
        businessHours: dayHours,
        slots
      }
    });
  } catch (err) {
    logger.error('Error fetching available slots', { error: err.message });
    sendError(res, 500, 'Failed to fetch available slots');
  }
};

// ============== Helper Functions ==============

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
    acceptedAt: booking.accepted_at,
    declinedAt: booking.declined_at,
    helperResponseReason: booking.helper_response_reason,
    convertedToJobId: booking.converted_to_job_id,
    createdAt: booking.created_at,
    updatedAt: booking.updated_at
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
    // TODO: Implement actual notification (email, socket, push)
    logger.info('Booking notification sent to helper', { helperId, bookingId: booking.id });
  } catch (err) {
    logger.warn('Failed to notify helper', { error: err.message });
  }
}

async function notifyCustomerOfBookingResponse(customerId, booking, response) {
  try {
    // TODO: Implement actual notification (email, socket, push)
    logger.info('Booking response notification sent to customer', { customerId, bookingId: booking.id, response });
  } catch (err) {
    logger.warn('Failed to notify customer', { error: err.message });
  }
}

async function notifyHelperOfBookingCancellation(helperId, booking) {
  try {
    // TODO: Implement actual notification
    logger.info('Booking cancellation notification sent to helper', { helperId, bookingId: booking.id });
  } catch (err) {
    logger.warn('Failed to notify helper of cancellation', { error: err.message });
  }
}

function calculateAvailableSlots(dayHours, appointments) {
  // Parse business hours
  const [startHour, startMin] = dayHours.start.split(':').map(Number);
  const [endHour, endMin] = dayHours.end.split(':').map(Number);

  const slots = [];
  let currentHour = startHour;
  let currentMin = startMin;

  while (currentHour < endHour || (currentHour === endHour && currentMin < endMin)) {
    const nextHour = currentMin + 60 >= 60 ? currentHour + 1 : currentHour;
    const nextMin = (currentMin + 60) % 60;

    // Format times
    const startTime = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;
    const endTime = `${String(nextHour).padStart(2, '0')}:${String(nextMin).padStart(2, '0')}`;

    // Check if slot overlaps with any appointment
    const isBooked = appointments.some(apt => {
      const aptStart = apt.scheduled_start_at;
      const aptEnd = apt.scheduled_end_at;
      // Simple overlap check
      return aptStart < endTime && aptEnd > startTime;
    });

    if (!isBooked) {
      slots.push({ startTime, endTime, available: true });
    }

    currentHour = nextHour;
    currentMin = nextMin;
  }

  return slots;
}
