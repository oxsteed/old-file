const pool = require('../db');
const { checkScheduleAgreementGate } = require('../services/chatAgreements');
const availabilityService = require('../services/helperAvailabilityService');
const { sendValidationError, sendError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { uuidv4 } = require('../utils/uuid');
const { sendNotification } = require('../services/notificationService');
const { broadcastToUser } = require('../services/socketService');
const bookingLifecycle = require('../services/bookingRequestLifecycle');

const DEFAULT_CONFIRMATION_HOURS = 24;
const MIN_CONFIRMATION_HOURS = 1;
const MAX_CONFIRMATION_HOURS = 168;
const WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * If pending and past expires_at, mark expired (single-row).
 */
async function expireIfStale(bookingRow) {
  if (!bookingRow || bookingRow.status !== 'pending') return bookingRow;
  const exp = new Date(bookingRow.expires_at);
  if (exp > new Date()) return bookingRow;

  if (bookingRow.auto_post_on_expiry && bookingRow.customer_id) {
    try {
      const posted = await autoPostExpiredBooking(bookingRow.id);
      if (posted?.booking) return posted.booking;
    } catch (err) {
      logger.warn('Failed to auto-post stale booking during read', {
        bookingId: bookingRow.id,
        error: err.message,
      });
    }
  }

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
 * Build job wizard prefill from a booking row.
 * Returns structured fields — the client assembles any locale-specific description text.
 */
function buildJobPrefillPayload(booking) {
  return {
    // The client uses serviceName as the job title (truncated if needed)
    title: String(booking.service_name || '').slice(0, 80) || null,
    // Pass structured fields so the client can build the description in the right language
    serviceName: booking.service_name || null,
    requestedDate: booking.requested_date || null,
    requestedStartTime: booking.requested_start_time || null,
    requestedEndTime: booking.requested_end_time || null,
    locationInput: booking.service_location || '',
    description: booking.description || '',
    notes: '',
    preferredHelperId: booking.helper_id,
    preferredHelperName: null,
    sourceBookingId: booking.id,
  };
}

function nextDateForPreferredDay(day) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const key = String(day || '').trim().toLowerCase();
  const target = WEEKDAY_INDEX[key];
  if (target === undefined) return today.toISOString().slice(0, 10);
  let delta = (target - today.getDay() + 7) % 7;
  if (delta === 0) delta = 7;
  const next = new Date(today);
  next.setDate(today.getDate() + delta);
  return next.toISOString().slice(0, 10);
}

/**
 * Create a new booking request
 * POST /api/bookings
 */
exports.createBookingRequest = async (req, res) => {
  try {
    const customerId = req.user.id;
    const {
      helperId: helperIdInput,
      businessId,
      serviceName,
      requestedDate,
      requestedStartTime,
      requestedEndTime,
      serviceLocation,
      description,
      confirmationHours,
      availabilityMode = 'scheduled',
      autoPostOnExpiry = false,
      conversationId,
      guestSessionId,
      serviceId,
      timezone,
      source,
    } = req.body;

    // A booking now targets either a specific helper, a business (which routes
    // to its owner as the default acceptor), or both. Per migration 214, the
    // business_id column on booking_requests preserves the link to the business
    // even when the request is dispatched to the owner helper for confirmation.
    let helperId = helperIdInput;
    let business = null;
    if (businessId) {
      const bizRes = await pool.query(
        `SELECT id, user_id, business_name, is_active, is_listed
           FROM businesses
          WHERE id = $1`,
        [businessId]
      );
      business = bizRes.rows[0];
      if (!business) return sendError(res, 404, 'Business not found', 'BUSINESS_NOT_FOUND');
      if (!business.is_active || business.is_listed === false) {
        return sendError(res, 400, 'Business is not accepting bookings', 'BUSINESS_INACTIVE');
      }
      if (!helperId) helperId = business.user_id;
    }

    const errors = {};
    const normalizedAvailabilityMode = String(availabilityMode || 'scheduled').trim().toLowerCase();
    const requestOnly = normalizedAvailabilityMode === 'request_only';
    if (!['scheduled', 'request_only'].includes(normalizedAvailabilityMode)) {
      errors.availabilityMode = 'Invalid availability mode';
    }
    if (!helperId && !businessId) errors.helperId = 'Helper ID or Business ID is required';
    if (!serviceName || !String(serviceName).trim()) errors.serviceName = 'Service name is required';
    if (!requestedDate) errors.requestedDate = 'Date is required';
    if (!requestOnly && !requestedStartTime) errors.requestedStartTime = 'Start time is required';
    if (!requestOnly && !requestedEndTime) errors.requestedEndTime = 'End time is required';

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

    if (!requestOnly && requestedStartTime >= requestedEndTime) {
      return sendValidationError(res, { requestedEndTime: 'End time must be after start time' });
    }

    const reqDate = new Date(`${requestedDate}T12:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (reqDate < today) {
      return sendValidationError(res, { requestedDate: 'Cannot book in the past' });
    }

    // The confirmation deadline cannot extend beyond the requested service
    // date (or selected start time). This keeps the deadline usable for
    // next-day requests while still allowing longer windows for later dates.
    const deadlineTarget = requestOnly
      ? new Date(`${requestedDate}T23:59:00`)
      : new Date(`${requestedDate}T${requestedStartTime}:00`);
    const deadlineLimitHours = Math.max(
      MIN_CONFIRMATION_HOURS,
      Math.min(MAX_CONFIRMATION_HOURS, Math.floor((deadlineTarget.getTime() - Date.now()) / 3600000)),
    );
    if (Number.isNaN(deadlineTarget.getTime())) {
      return sendValidationError(res, { requestedDate: 'Invalid date' });
    }
    if (!requestOnly && deadlineTarget <= new Date()) {
      return sendValidationError(res, { requestedStartTime: 'Requested start time must be in the future' });
    }
    if (confirmationHours === undefined || confirmationHours === null || confirmationHours === '') {
      hours = Math.min(DEFAULT_CONFIRMATION_HOURS, deadlineLimitHours);
    }
    if (hours > deadlineLimitHours) {
      return sendValidationError(res, {
        confirmationHours: `Deadline must be no later than ${deadlineLimitHours} hours before the requested service date`,
      });
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

    // A scheduled request commits to a concrete time: verify it is truly free
    // (schedule, blocks, existing appointments) before the request exists.
    // Request-only bookings carry no agreed time yet and skip this check.
    if (!requestOnly) {
      const slotCheck = await bookingLifecycle.validateBookingSlot({
        helperId: business ? null : helperId,
        businessId: business ? business.id : null,
        date: requestedDate,
        start: requestedStartTime,
        end: requestedEndTime,
      });
      if (!slotCheck.ok) {
        return sendError(res, 409, slotCheck.message || 'Requested time is not available', slotCheck.code, {
          reason: slotCheck.reason,
        });
      }
    }

    
    if (conversationId || guestSessionId) {
      const agreementGate = await checkScheduleAgreementGate(pool, {
        conversationId: conversationId || null,
        guestSessionId: guestSessionId || null,
      });
      if (agreementGate.blocked) {
        return sendError(res, 409, 'Accept the required agreement before scheduling', 'agreement_required', {
          agreements: agreementGate.agreements,
        });
      }
    }

const bookingId = uuidv4();
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const result = await pool.query(
      `INSERT INTO booking_requests (
        id, customer_id, helper_id, business_id, service_name, requested_date,
        requested_start_time, requested_end_time, service_location,
        description, expires_at, confirmation_hours,
        availability_mode, auto_post_on_expiry,
        conversation_id, guest_session_id, source, service_id, timezone
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [
        bookingId,
        customerId,
        helperId,
        businessId || null,
        String(serviceName).trim(),
        requestedDate,
        requestOnly ? null : requestedStartTime,
        requestOnly ? null : requestedEndTime,
        serviceLocation || null,
        description || null,
        expiresAt,
        hours,
        normalizedAvailabilityMode,
        requestOnly && Boolean(autoPostOnExpiry),
        conversationId || null,
        guestSessionId || null,
        source || (conversationId || guestSessionId ? 'messenger_picker' : 'calendar'),
        serviceId != null ? String(serviceId) : null,
        timezone || null,
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

    const booking = result.rows[0];

    const isCustomer = userId && String(userId) === String(booking.customer_id);
    const isProvider = userId && (await bookingLifecycle.isProviderForBooking(userId, booking));
    if (userId && !isCustomer && !isProvider) {
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
    const providerUserId = req.user.id;
    const { status, statuses } = req.query;
    let statusList;
    if (statuses) {
      statusList = String(statuses)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const rows = await bookingLifecycle.listIncomingForProvider(providerUserId, {
      status: statusList ? undefined : status,
      statuses: statusList,
    });

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
    const actorId = req.user.id;

    const booking = await bookingLifecycle.loadBooking(bookingId);
    if (!booking) {
      return sendError(res, 404, 'Booking request not found');
    }
    if (!(await bookingLifecycle.isProviderForBooking(actorId, booking))) {
      return sendError(res, 403, 'Only the provider can accept this booking', 'forbidden');
    }

    let result;
    try {
      result = await bookingLifecycle.acceptBookingRequest({
        booking,
        actorId,
        actorType: 'helper',
        appointmentSource: 'calendar_accept',
      });
    } catch (e) {
      const status = e.status || 400;
      return sendError(res, status, e.message || 'Cannot accept booking', e.code);
    }

    const updated = result.booking;
    await notifyCustomerOfBookingResponse(booking.customer_id, updated, 'accepted');

    // Post chat status when linked to a conversation (glue: calendar → messenger)
    if (updated.conversation_id || updated.guest_session_id) {
      try {
        const chatCtrl = require('./chatBookingRequestsController');
        if (typeof chatCtrl.postStatusToThreadForLifecycle === 'function') {
          const actorName =
            [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Provider';
          await chatCtrl.postStatusToThreadForLifecycle({
            booking: updated,
            event: 'accepted',
            actorId,
            actorName,
          });
        }
      } catch (e) {
        logger.warn('Calendar accept chat status post skipped', { error: e.message });
      }
    }

    logger.info('Booking request accepted', { bookingId, actorId });

    res.json({
      success: true,
      data: transformBooking(updated),
      appointmentId: result.appointment?.id || updated.appointment_id || null,
    });
  } catch (err) {
    logger.error('Error accepting booking request', { error: err.message });
    sendError(res, 500, 'Failed to accept booking request');
  }
};


exports.declineBookingRequest = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const actorId = req.user.id;
    const { reason } = req.body || {};

    const booking = await bookingLifecycle.loadBooking(bookingId);
    if (!booking) {
      return sendError(res, 404, 'Booking request not found');
    }
    if (!(await bookingLifecycle.isProviderForBooking(actorId, booking))) {
      return sendError(res, 403, 'Only the provider can decline this booking', 'forbidden');
    }

    let result;
    try {
      result = await bookingLifecycle.declineBookingRequest({
        booking,
        actorId,
        actorType: 'helper',
        reason: reason || null,
      });
    } catch (e) {
      const status = e.status || 400;
      return sendError(res, status, e.message || 'Cannot decline booking', e.code);
    }

    const updated = result.booking;
    await notifyCustomerOfBookingResponse(booking.customer_id, updated, 'declined');

    if (updated.conversation_id || updated.guest_session_id) {
      try {
        const chatCtrl = require('./chatBookingRequestsController');
        if (typeof chatCtrl.postStatusToThreadForLifecycle === 'function') {
          const actorName =
            [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Provider';
          await chatCtrl.postStatusToThreadForLifecycle({
            booking: updated,
            event: 'declined',
            actorId,
            actorName,
            reason: reason || '',
          });
        }
      } catch (e) {
        logger.warn('Calendar decline chat status post skipped', { error: e.message });
      }
    }

    logger.info('Booking request declined', { bookingId, actorId });

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

    const booking = result.rows[0];

    if (booking.customer_id !== customerId) {
      return sendError(res, 403, 'Only the customer can cancel this booking request');
    }

    if (booking.status === 'pending') {
      const updatedResult = await pool.query(
        `UPDATE booking_requests
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status IN ('pending', 'expired')
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
      // Cancelling an accepted booking must also cancel the confirmed
      // appointment it created (helper or business calendar).
      try {
        await bookingLifecycle.cancelLinkedAppointment(updatedResult.rows[0], updatedResult.rows[0].helper_id);
      } catch (e) {
        logger.warn('Failed to cancel linked appointment on customer cancel', { error: e.message });
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

    if (!(await bookingLifecycle.isProviderForBooking(helperId, booking))) {
      return sendError(res, 403, 'Only the provider can cancel this booking', 'forbidden');
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

    // Cancelling an accepted booking must also cancel the confirmed
    // appointment it created (helper or business calendar).
    try {
      await bookingLifecycle.cancelLinkedAppointment(updated, updated.helper_id);
    } catch (e) {
      logger.warn('Failed to cancel linked appointment on helper cancel', { error: e.message });
    }

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

    const booking = result.rows[0];

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
exports.getHelperAvailableSlots = async (req, res, next) => {
  try {
    const { helperId } = req.params;
    const { date } = req.query;

    if (!date) {
      return sendValidationError(res, { date: 'Date is required' });
    }

    const helperCheck = await pool.query(
      'SELECT 1 FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL',
      [helperId]
    );
    if (!helperCheck.rows.length) {
      return sendError(res, 404, 'Helper not found');
    }

    const dateObj = new Date(`${date}T12:00:00`);
    if (Number.isNaN(dateObj.getTime())) {
      return sendValidationError(res, { date: 'Invalid date' });
    }
    const dateISO = dateObj.toISOString().split('T')[0];
    const dow = dateObj.getUTCDay();

    // Single-system computation: weekly template − dated blocks − appointments.
    const { slots, hasTemplate, dayHasAvailability, dayStatus, bookingBufferMinutes } =
      await availabilityService.getHourSlots(helperId, dateISO, 60);

    const pad = (n) => String(n).padStart(2, '0');
    // BookingCalendar expects { startTime, endTime, available }; every slot
    // here survived the busy-range filter in getHourSlots, so all are free.
    const out = slots.map((sl) => ({
      startTime: `${pad(Math.floor(sl.startMin / 60))}:${pad(sl.startMin % 60)}`,
      endTime: `${pad(Math.floor(sl.endMin / 60))}:${pad(sl.endMin % 60)}`,
      available: true,
    }));

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    res.json({
      success: true,
      data: {
        date: dateISO,
        dayOfWeek: dayNames[dow],
        slots: out,
        scheduleConfigured: hasTemplate,
        dayHasAvailability,
        dayStatus,
        bookingBufferMinutes,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Public business availability. Businesses may publish hours at the business
 * level, independently from the owner's helper profile. An empty schedule is
 * returned as a valid request-only state so the booking UI can offer the
 * request-only fallback instead of showing a server error.
 */
exports.getBusinessAvailableSlots = async (req, res) => {
  try {
    const businessId = Number.parseInt(req.params.businessId, 10);
    const { date, serviceId } = req.query;
    if (!Number.isInteger(businessId) || businessId <= 0) {
      return sendValidationError(res, { businessId: 'Invalid business ID' });
    }
    if (!date) return sendValidationError(res, { date: 'Date is required' });

    const dateObj = new Date(`${date}T12:00:00`);
    if (Number.isNaN(dateObj.getTime())) return sendValidationError(res, { date: 'Invalid date' });

    const businessResult = await pool.query(
      `SELECT id, is_active, is_listed FROM businesses
        WHERE id = $1 AND business_kind = 'service'`,
      [businessId]
    );
    const business = businessResult.rows[0];
    if (!business) return sendError(res, 404, 'Business not found', 'BUSINESS_NOT_FOUND');
    if (!business.is_active || business.is_listed === false) {
      return sendError(res, 400, 'Business is not accepting bookings', 'BUSINESS_INACTIVE');
    }

    const scheduleResult = await pool.query(
      `SELECT (
        EXISTS (
          SELECT 1 FROM business_hours
           WHERE business_id = $1
             AND is_closed = FALSE
             AND start_time IS NOT NULL
             AND end_time IS NOT NULL
        ) OR EXISTS (
          SELECT 1
            FROM business_service_availability bsa
            JOIN business_services bs ON bs.id = bsa.service_id
           WHERE bs.business_id = $1
             AND bsa.is_available = TRUE
        )
      ) AS schedule_configured`,
      [businessId]
    );
    const scheduleConfigured = Boolean(scheduleResult.rows[0]?.schedule_configured);
    const dow = dateObj.getDay();

    const hoursResult = await pool.query(
      `SELECT start_time, end_time
         FROM business_hours
        WHERE business_id = $1
          AND day_of_week = $2
          AND is_closed = FALSE
          AND start_time IS NOT NULL
          AND end_time IS NOT NULL
        ORDER BY start_time`,
      [businessId, dow]
    );

    let effectiveHours = hoursResult.rows;
    if (effectiveHours.length === 0 && serviceId) {
      const serviceHours = await pool.query(
        `SELECT start_time, end_time
           FROM business_service_availability
          WHERE service_id = $1
            AND day_of_week = $2
            AND is_available = TRUE
          ORDER BY start_time`,
        [String(serviceId), dow]
      );
      effectiveHours = serviceHours.rows;
    }

    let durationMinutes = 60;
    if (serviceId) {
      const serviceResult = await pool.query(
        `SELECT duration_minutes, duration
           FROM business_services
          WHERE id = $1 AND business_id = $2 AND is_active = TRUE`,
        [String(serviceId), businessId]
      );
      if (serviceResult.rows[0]) {
        const service = serviceResult.rows[0];
        const parsed = Number.parseInt(service.duration_minutes || service.duration, 10);
        if (Number.isFinite(parsed) && parsed > 0) durationMinutes = Math.min(480, parsed);
      }
    }

    const appointmentsResult = await pool.query(
      `SELECT start_time::time AS start_time, end_time::time AS end_time
         FROM business_appointments
        WHERE business_id = $1
          AND start_time::date = $2::date
          AND status NOT IN ('cancelled', 'no_show')
        ORDER BY start_time`,
      [businessId, date]
    );
    const busy = appointmentsResult.rows.map((row) => ({ start: row.start_time, end: row.end_time }));
    const slots = [];
    for (const block of effectiveHours) {
      slots.push(...sliceWindowToHourSlots(block.start_time, block.end_time, busy, durationMinutes, 30));
    }

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return res.json({
      success: true,
      data: {
        date,
        dayOfWeek: dayNames[dow],
        slots,
        scheduleConfigured,
        dayHasAvailability: effectiveHours.length > 0,
        durationMinutes,
      },
    });
  } catch (err) {
    logger.error('Error fetching business available slots', {
      businessId: req.params?.businessId,
      error: err.message,
      stack: err.stack,
    });
    sendError(res, 500, 'Failed to fetch business availability');
  }
};

exports.listRecurringBookings = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT r.*,
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS helper_name,
              u.profile_photo_url AS helper_avatar_url
         FROM recurring_booking_subscriptions r
         JOIN users u ON u.id = r.helper_id
        WHERE r.customer_id = $1
        ORDER BY
          CASE r.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
          r.next_date NULLS LAST,
          r.created_at DESC`,
      [userId]
    );
    res.json({ subscriptions: result.rows.map(transformRecurringBooking) });
  } catch (err) {
    logger.error('Error listing recurring bookings', { userId: req.user?.id, error: err.message });
    sendError(res, 500, 'Failed to load recurring bookings');
  }
};

exports.createRecurringBooking = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { helper_id, service_name, frequency, preferred_day, preferred_time, notes } = req.body || {};
    const safeFrequency = String(frequency || '').toLowerCase();
    const errors = {};
    if (!helper_id) errors.helper_id = 'Helper is required';
    if (!service_name || !String(service_name).trim()) errors.service_name = 'Service name is required';
    if (!['weekly', 'biweekly', 'monthly'].includes(safeFrequency)) errors.frequency = 'Frequency must be weekly, biweekly, or monthly';
    if (String(customerId) === String(helper_id)) errors.helper_id = 'Cannot subscribe to yourself';
    if (Object.keys(errors).length) return sendValidationError(res, errors);

    const helperResult = await pool.query(
      `SELECT id, is_active, role FROM users WHERE id = $1`,
      [helper_id]
    );
    const helper = helperResult.rows[0];
    if (!helper || !helper.is_active) return sendError(res, 404, 'Helper not found', 'HELPER_NOT_FOUND');
    if (!['helper', 'helper_pro', 'broker'].includes(helper.role)) {
      return sendError(res, 400, 'User is not accepting recurring services', 'INVALID_HELPER');
    }

    const nextDate = nextDateForPreferredDay(preferred_day);
    const result = await pool.query(
      `INSERT INTO recurring_booking_subscriptions
         (customer_id, helper_id, service_name, frequency, preferred_day, preferred_time, notes, next_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        customerId,
        helper_id,
        String(service_name).trim(),
        safeFrequency,
        preferred_day || null,
        preferred_time || null,
        notes || null,
        nextDate,
      ]
    );

    const subscription = transformRecurringBooking(result.rows[0]);
    await sendNotification({
      userId: helper_id,
      type: 'recurring_booking_new',
      body: `${subscription.service_name} ${subscription.frequency}`,
      data: { subscriptionId: subscription.id },
      action_url: '/calendar?tab=recurring',
    }).catch((err) => logger.warn('Failed recurring booking notification', { error: err.message }));

    res.status(201).json({ subscription, message: 'Recurring booking created' });
  } catch (err) {
    logger.error('Error creating recurring booking', { userId: req.user?.id, error: err.message });
    sendError(res, 500, 'Failed to create recurring booking');
  }
};

exports.updateRecurringBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const action = String(req.params.action || req.path || '').split('/').filter(Boolean).pop();
    const nextStatus = action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused' : 'active';
    const result = await pool.query(
      `UPDATE recurring_booking_subscriptions
          SET status = $3, updated_at = now()
        WHERE id = $1 AND customer_id = $2
        RETURNING *`,
      [id, req.user.id, nextStatus]
    );
    if (!result.rows.length) return sendError(res, 404, 'Recurring booking not found');
    res.json({ subscription: transformRecurringBooking(result.rows[0]), message: `Subscription ${nextStatus}` });
  } catch (err) {
    logger.error('Error updating recurring booking', { userId: req.user?.id, error: err.message });
    sendError(res, 500, 'Failed to update recurring booking');
  }
};

exports.counterProposeBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const helperId = req.user.id;
    const body = req.body || {};
    const counter_date = body.counter_date || body.requestedDate || body.date;
    const counter_start_time = body.counter_start_time || body.requestedStartTime || body.start;
    const counter_end_time = body.counter_end_time || body.requestedEndTime || body.end;
    const counter_message = body.counter_message || body.note || body.reason || null;

    const errors = {};
    if (!counter_date) errors.counter_date = 'Date is required';
    if (!counter_start_time) errors.counter_start_time = 'Start time is required';
    if (!counter_end_time) errors.counter_end_time = 'End time is required';
    if (
      counter_start_time &&
      counter_end_time &&
      String(counter_start_time) >= String(counter_end_time)
    ) {
      errors.counter_end_time = 'End time must be after start time';
    }
    if (Object.keys(errors).length) return sendValidationError(res, errors);

    const booking = await bookingLifecycle.loadBooking(bookingId);
    if (!booking) return sendError(res, 404, 'Booking request not found');
    if (!(await bookingLifecycle.isProviderForBooking(helperId, booking))) {
      return sendError(res, 403, 'Only the provider can propose a different time', 'forbidden');
    }

    let result;
    try {
      result = await bookingLifecycle.proposeBookingTime({
        booking,
        actorId: helperId,
        actorType: 'helper',
        date: counter_date,
        start: counter_start_time,
        end: counter_end_time,
        note: counter_message,
      });
    } catch (e) {
      const status = e.status || 400;
      return sendError(res, status, e.message || 'Cannot counter-propose', e.code);
    }

    const updated = result.booking;
    if (updated.customer_id) {
      await sendNotification({
        userId: updated.customer_id,
        type: 'booking_counter_proposed',
        body: `${updated.service_name} — ${counter_date} ${counter_start_time}-${counter_end_time}`,
        data: { bookingId },
        action_url: '/my-bookings',
      }).catch((err) => logger.warn('Failed counter-propose notification', { error: err.message }));
    }

    if (updated.conversation_id || updated.guest_session_id) {
      try {
        const chatCtrl = require('./chatBookingRequestsController');
        if (typeof chatCtrl.postStatusToThreadForLifecycle === 'function') {
          const actorName =
            [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Provider';
          await chatCtrl.postStatusToThreadForLifecycle({
            booking: updated,
            event: 'counter_proposed',
            actorId: helperId,
            actorName,
            reason: counter_message || '',
          });
        }
      } catch (e) {
        logger.warn('Calendar counter-propose chat status post skipped', { error: e.message });
      }
    }

    res.json({ booking: transformBooking(updated), message: 'Counter-proposal sent' });
  } catch (err) {
    logger.error('Error counter-proposing booking', { error: err.message });
    sendError(res, 500, 'Failed to send counter-proposal');
  }
};


exports.respondToCounterPropose = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const customerId = req.user.id;
    const action = String(req.body?.action || '').toLowerCase();
    if (!['accept', 'decline'].includes(action)) {
      return sendValidationError(res, { action: 'Use accept or decline' });
    }

    const booking = await bookingLifecycle.loadBooking(bookingId);
    if (!booking) return sendError(res, 404, 'Booking request not found');
    if (String(booking.customer_id) !== String(customerId)) {
      return sendError(res, 403, 'Only the customer can respond to this counter-proposal');
    }

    let result;
    try {
      if (action === 'accept') {
        result = await bookingLifecycle.customerAcceptBookingRequest({
          booking,
          actorId: customerId,
          actorType: 'customer',
          appointmentSource: 'calendar_customer_accept',
        });
      } else {
        result = await bookingLifecycle.customerDeclineBookingRequest({
          booking,
          actorId: customerId,
          actorType: 'customer',
          reason: req.body?.reason || null,
        });
      }
    } catch (e) {
      const status = e.status || 400;
      return sendError(res, status, e.message || 'Cannot respond to counter-proposal', e.code);
    }

    const updated = result.booking;
    await sendNotification({
      userId: booking.helper_id,
      type: action === 'accept' ? 'booking_counter_accepted' : 'booking_counter_declined',
      body: `${booking.service_name} — ${
        action === 'accept' ? 'counter-proposal accepted' : 'counter-proposal declined'
      }`,
      data: { bookingId },
      action_url: '/calendar?tab=bookingRequests',
    }).catch((err) => logger.warn('Failed counter response notification', { error: err.message }));

    if (updated.conversation_id || updated.guest_session_id) {
      try {
        const chatCtrl = require('./chatBookingRequestsController');
        if (typeof chatCtrl.postStatusToThreadForLifecycle === 'function') {
          const actorName =
            [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Customer';
          await chatCtrl.postStatusToThreadForLifecycle({
            booking: updated,
            event: action === 'accept' ? 'accepted' : 'declined',
            actorId: customerId,
            actorName,
            senderType: 'customer',
          });
        }
      } catch (e) {
        logger.warn('Calendar counter-respond chat status post skipped', { error: e.message });
      }
    }

    res.json({
      booking: transformBooking(updated),
      message:
        action === 'accept' ? 'Counter-proposal accepted' : 'Counter-proposal declined',
      appointmentId: result.appointment?.id || updated.appointment_id || null,
    });
  } catch (err) {
    logger.error('Error responding to counter-proposal', { error: err.message });
    sendError(res, 500, 'Failed to respond to counter-proposal');
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
  const safe = Math.max(0, Math.min(1440, mins));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function sliceWindowToHourSlots(windowStart, windowEnd, busyRanges, durationMinutes = 60, incrementMinutes = durationMinutes) {
  const slots = [];
  let cur = timeToMinutes(windowStart);
  const endMin = timeToMinutes(windowEnd);
  const busy = busyRanges
    .map((r) => ({
      a: timeToMinutes(r.start),
      b: timeToMinutes(r.end),
    }))
    .filter((r) => r.b > r.a);

  const duration = Math.max(15, Math.min(480, Number(durationMinutes) || 60));
  const increment = Math.max(15, Math.min(duration, Number(incrementMinutes) || duration));
  while (cur + duration <= endMin) {
    const slotStart = cur;
    const slotEnd = cur + duration;
    const overlaps = busy.some((b) => slotStart < b.b && slotEnd > b.a);
    slots.push({
      startTime: minutesToTime(slotStart),
      endTime: minutesToTime(slotEnd),
      available: !overlaps,
    });
    cur += increment;
  }
  return slots;
}

function transformBooking(booking) {
  // Prefer shared calendar shape when row already transformed / has snake_case DB fields
  if (booking && booking.customerId != null && booking.conversationId !== undefined) {
    return booking;
  }
  const base = bookingLifecycle.toCalendarBooking(booking);
  return base || {
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
    availabilityMode: booking.availability_mode || 'scheduled',
    autoPostOnExpiry: Boolean(booking.auto_post_on_expiry),
    marketplacePostedAt: booking.marketplace_posted_at || null,
    acceptedAt: booking.accepted_at,
    declinedAt: booking.declined_at,
    helperResponseReason: booking.helper_response_reason,
    convertedToJobId: booking.converted_to_job_id,
    conversationId: booking.conversation_id || null,
    guestSessionId: booking.guest_session_id || null,
    appointmentId: booking.appointment_id != null ? String(booking.appointment_id) : null,
    source: booking.source || 'direct',
    counter_proposed_at: booking.counter_proposed_at,
    counter_date: booking.counter_date,
    counter_start_time: booking.counter_start_time,
    counter_end_time: booking.counter_end_time,
    counter_message: booking.counter_message,
    counter_status: booking.counter_status,
    createdAt: booking.created_at,
    updatedAt: booking.updated_at,
  };
}

function transformRecurringBooking(row) {
  return {
    id: row.id,
    helper_id: row.helper_id,
    service_name: row.service_name,
    frequency: row.frequency,
    preferred_day: row.preferred_day,
    preferred_time: row.preferred_time,
    status: row.status,
    next_date: row.next_date,
    created_at: row.created_at,
    helper_name: row.helper_name || null,
    helper_avatar_url: row.helper_avatar_url || null,
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
    // Real-time: makes the BookingRequestsView in HelperCalendarView refresh immediately
    broadcastToUser(helperId, 'booking:new', { bookingId: booking.id });

    await sendNotification({
      userId: helperId,
      type: 'booking_request_new',
      body: `${booking.service_name} — ${booking.requested_date} ${booking.requested_start_time}–${booking.requested_end_time}`,
      data: { bookingId: booking.id },
      action_url: '/calendar?tab=bookingRequests',
    });
  } catch (err) {
    logger.warn('Failed to notify helper of booking', { error: err.message });
  }
}

async function notifyCustomerOfBookingResponse(customerId, booking, response) {
  try {
    broadcastToUser(customerId, 'booking:updated', {
      bookingId: booking.id,
      status: booking.status,
    });

    const isAccepted = response === 'accepted';
    const isDeclined = response === 'declined';
    const isAcceptedCancelled = response === 'accepted_cancelled';

    let type, body, action_url;

    if (isAccepted) {
      type = 'booking_accepted';
      body = `${booking.service_name} — ${booking.requested_date}`;
      action_url = '/calendar';
    } else if (isDeclined) {
      type = 'booking_declined';
      body = `${booking.service_name} — ${booking.requested_date}${booking.helper_response_reason ? ` (${booking.helper_response_reason})` : ''}`;
      action_url = '/my-bookings';
    } else if (isAcceptedCancelled) {
      type = 'booking_cancelled';
      body = `${booking.service_name} — ${booking.requested_date}`;
      action_url = '/my-bookings';
    } else {
      return;
    }

    await sendNotification({ userId: customerId, type, body, data: { bookingId: booking.id }, action_url });
  } catch (err) {
    logger.warn('Failed to notify customer of booking response', { error: err.message });
  }
}

async function notifyHelperOfBookingCancellation(helperId, booking) {
  try {
    broadcastToUser(helperId, 'booking:updated', {
      bookingId: booking.id,
      status: booking.status,
    });

    await sendNotification({
      userId: helperId,
      type: 'booking_cancelled',
      body: `${booking.service_name} — ${booking.requested_date}`,
      data: { bookingId: booking.id },
      action_url: '/calendar?tab=bookingRequests',
    });
  } catch (err) {
    logger.warn('Failed to notify helper of booking cancellation', { error: err.message });
  }
}

/**
 * Marketplace fallback for expired bookings. The DB work lives in
 * bookingLifecycle.autoPostExpiredBooking so read-side expiry (expireIfStale)
 * and this worker share one implementation; this wrapper keeps the
 * socket/push notifications that belong to the worker.
 */
async function autoPostExpiredBooking(bookingId) {
  return bookingLifecycle.autoPostExpiredBooking(bookingId);
}

/** Pending bookings past expires_at → expired. Notifies customer via socket. */
exports.expirePendingBookingRequests = async () => {
  try {
    const autoCandidates = await pool.query(
      `SELECT id
         FROM booking_requests
        WHERE status = 'pending'
          AND expires_at < NOW()
          AND auto_post_on_expiry = TRUE
          AND customer_id IS NOT NULL
        ORDER BY expires_at
        LIMIT 100`
    );
    let postedCount = 0;
    for (const candidate of autoCandidates.rows) {
      try {
        const result = await autoPostExpiredBooking(candidate.id);
        if (!result) continue;
        postedCount += 1;
        const { booking, jobId } = result;
        broadcastToUser(booking.customer_id, 'booking:updated', {
          bookingId: booking.id,
          status: 'expired',
          marketplaceJobId: jobId,
        });
        broadcastToUser(booking.helper_id, 'booking:updated', {
          bookingId: booking.id,
          status: 'expired',
          marketplaceJobId: jobId,
        });
        sendNotification({
          userId: booking.customer_id,
          type: 'booking_auto_posted',
          body: `${booking.service_name} is now open for bids`,
          data: { bookingId: booking.id, jobId },
          action_url: `/jobs/${jobId}`,
        }).catch((err) => logger.warn('Failed marketplace fallback notification', { error: err.message }));
      } catch (err) {
        logger.error('Failed to publish expired booking as job', {
          bookingId: candidate.id,
          error: err.message,
        });
      }
    }

    const r = await pool.query(
      `UPDATE booking_requests
       SET status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'pending' AND expires_at < NOW()
         AND (COALESCE(auto_post_on_expiry, FALSE) = FALSE OR customer_id IS NULL)
       RETURNING id, customer_id, helper_id, service_name, requested_date`
    );
    if (r.rowCount > 0 || postedCount > 0) {
      logger.info('Expired pending booking requests', { count: r.rowCount, autoPosted: postedCount });
      for (const row of r.rows) {
        await logBookingAudit(row.id, 'expired', null, 'system', 'pending', 'expired');
        broadcastToUser(row.customer_id, 'booking:updated', {
          bookingId: row.id,
          status: 'expired',
        });
        // The provider also needs to know the request lapsed.
        broadcastToUser(row.helper_id, 'booking:updated', {
          bookingId: row.id,
          status: 'expired',
        });
        // Fire-and-forget — don't block the cron if one notification fails
        sendNotification({
          userId: row.customer_id,
          type: 'booking_auto_released',
          body: `${row.service_name} — ${row.requested_date}`,
          data: { bookingId: row.id },
          action_url: '/my-bookings',
        }).catch((err) => logger.warn('Failed expiry notification', { error: err.message }));
        sendNotification({
          userId: row.helper_id,
          type: 'booking_expired',
          body: `${row.service_name} — ${row.requested_date}`,
          data: { bookingId: row.id },
          action_url: '/calendar?tab=bookingRequests',
        }).catch((err) => logger.warn('Failed provider expiry notification', { error: err.message }));
      }
    }
    return (r.rowCount || 0) + postedCount;
  } catch (err) {
    logger.warn('expirePendingBookingRequests failed', { error: err.message });
    return 0;
  }
};

/**
 * After scheduled end (date + end time in server TZ), release accepted bookings so customer can post publicly.
 * Also releases request-only bookings that were accepted but never got an agreed time (stranded),
 * and cancels the linked appointment (helper or business) for every released booking.
 * Notifies both parties.
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
         AND (
           (requested_end_time IS NOT NULL
             AND (requested_date::timestamp + requested_end_time::interval) < NOW())
           OR (requested_end_time IS NULL
             AND updated_at < NOW() - INTERVAL '7 days')
         )
       RETURNING id, customer_id, helper_id, business_id, service_name, requested_date,
                 appointment_id, business_appointment_id`
    );
    if (r.rowCount > 0) {
      logger.info('Released accepted bookings past scheduled end', { count: r.rowCount });
      for (const row of r.rows) {
        // The linked appointment must not outlive the released booking.
        try {
          await bookingLifecycle.cancelLinkedAppointment(row, row.helper_id);
        } catch (e) {
          logger.warn('Failed to cancel linked appointment on auto-release', { error: e.message });
        }
        await logBookingAudit(row.id, 'auto_released', null, 'system', 'accepted', 'accepted_cancelled');
        broadcastToUser(row.customer_id, 'booking:updated', { bookingId: row.id, status: 'accepted_cancelled' });
        broadcastToUser(row.helper_id, 'booking:updated', { bookingId: row.id, status: 'accepted_cancelled' });

        sendNotification({
          userId: row.customer_id,
          type: 'booking_auto_released',
          body: `${row.service_name} — ${row.requested_date}`,
          data: { bookingId: row.id },
          action_url: '/my-bookings',
        }).catch((err) => logger.warn('Failed auto-release customer notification', { error: err.message }));

        sendNotification({
          userId: row.helper_id,
          type: 'booking_auto_released',
          body: `${row.service_name} — ${row.requested_date}`,
          data: { bookingId: row.id },
          action_url: '/calendar',
        }).catch((err) => logger.warn('Failed auto-release helper notification', { error: err.message }));
      }
    }
    return r.rowCount || 0;
  } catch (err) {
    logger.warn('releaseStaleAcceptedBookings failed', { error: err.message });
    return 0;
  }
};
