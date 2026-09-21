/**
 * Booking System Controller
 * Handles customer appointment booking, availability management, and confirmation workflow
 *
 * Features:
 * - Self-serve appointment booking by customers
 * - Service availability calendar integration
 * - Booking confirmation and cancellation
 * - Automatic confirmation reminders
 * - Booking history and management
 * - Calendar synchronization (Google Calendar, Outlook ready)
 *
 * Database:
 * - bookings: Main booking/appointment records
 * - booking_slots: Available time slots per service
 * - booking_confirmations: Confirmation workflow tracking
 * - booking_reminders: Automated reminder scheduling
 */

const { pool } = require('../db');
const { AppError } = require('../utils/apiError');
const { logger } = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');

// ============================================================================
// Availability Management
// ============================================================================

/**
 * Get available time slots for a service
 * GET /api/businesses/{businessId}/services/{serviceId}/availability
 * Query params: date (YYYY-MM-DD), staffId (optional)
 */
async function getServiceAvailability(req, res, next) {
  try {
    const { businessId, serviceId } = req.params;
    const { date, staffId } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new AppError('Valid date required (YYYY-MM-DD)', 400, 'validation_failed');
    }

    // Verify service exists and belongs to business
    const serviceCheck = await pool.query(
      `SELECT duration_minutes FROM business_services WHERE id = $1 AND business_id = $2`,
      [serviceId, businessId]
    );
    if (!serviceCheck.rows.length) {
      throw new AppError('Service not found', 404, 'not_found');
    }

    const duration = serviceCheck.rows[0].duration_minutes;

    // Get available slots for the date
    let query = `
      SELECT
        slot_start, slot_end, staff_id, staff_name, is_available
      FROM booking_slots
      WHERE service_id = $1 AND slot_date = $2::date
    `;
    const params = [serviceId, date];

    if (staffId) {
      query += ` AND staff_id = $3`;
      params.push(staffId);
    }

    query += ` ORDER BY slot_start ASC`;

    const slotsResult = await pool.query(query, params);

    // Filter out booked slots
    const bookedSlots = await pool.query(
      `
      SELECT DISTINCT slot_start, slot_end FROM booking_slots bs
      JOIN bookings b ON bs.id = b.slot_id
      WHERE bs.service_id = $1 AND bs.slot_date = $2::date
      AND b.status IN ('confirmed', 'in_progress')
      `,
      [serviceId, date]
    );

    const bookedTimes = new Set(
      bookedSlots.rows.map(row => `${row.slot_start}-${row.slot_end}`)
    );

    const availableSlots = slotsResult.rows
      .filter(slot => !bookedTimes.has(`${slot.slot_start}-${slot.slot_end}`))
      .map(slot => ({
        slotId: `${slot.slot_start}-${slot.slot_end}`,
        startTime: slot.slot_start,
        endTime: slot.slot_end,
        staffId: slot.staff_id,
        staffName: slot.staff_name,
        duration: duration,
      }));

    res.json({
      success: true,
      data: {
        date,
        serviceId,
        slots: availableSlots,
        totalSlots: availableSlots.length,
      },
    });
  } catch (error) {
    logger.error('bookingController.getServiceAvailability', { error, params: req.params });
    next(error);
  }
}

/**
 * Get business availability summary (calendar heatmap)
 * GET /api/businesses/{businessId}/availability
 * Query params: month (YYYY-MM), includeServices (comma-separated service IDs)
 */
async function getBusinessAvailability(req, res, next) {
  try {
    const { businessId } = req.params;
    const { month, includeServices } = req.query;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new AppError('Valid month required (YYYY-MM)', 400, 'validation_failed');
    }

    // Get days with available slots
    let servicesFilter = '';
    const params = [businessId, `${month}-%`];

    if (includeServices) {
      const serviceIds = includeServices.split(',');
      const placeholders = serviceIds.map((_, i) => `$${i + 3}`).join(',');
      servicesFilter = ` AND service_id IN (${placeholders})`;
      params.push(...serviceIds);
    }

    const result = await pool.query(
      `
      SELECT
        slot_date,
        COUNT(*) as total_slots,
        COUNT(CASE WHEN is_available = true THEN 1 END) as available_slots
      FROM booking_slots
      WHERE service_id IN (
        SELECT id FROM business_services WHERE business_id = $1
      )
      AND slot_date LIKE $2 ${servicesFilter}
      GROUP BY slot_date
      ORDER BY slot_date ASC
      `,
      params
    );

    res.json({
      success: true,
      data: {
        month,
        daysSummary: result.rows.map(day => ({
          date: day.slot_date,
          totalSlots: parseInt(day.total_slots),
          availableSlots: parseInt(day.available_slots),
          occupancyRate: Math.round(
            ((parseInt(day.total_slots) - parseInt(day.available_slots)) / parseInt(day.total_slots)) * 100
          ),
        })),
      },
    });
  } catch (error) {
    logger.error('bookingController.getBusinessAvailability', { error });
    next(error);
  }
}

// ============================================================================
// Booking Creation & Management
// ============================================================================

/**
 * Create a new booking
 * POST /api/businesses/{businessId}/bookings
 * Body: {
 *   serviceId, customerId, slotId (or slotStart/slotEnd),
 *   customerName, customerEmail, customerPhone,
 *   notes?, staffId?
 * }
 */
async function createBooking(req, res, next) {
  try {
    const { businessId } = req.params;
    const {
      serviceId,
      customerId,
      slotId,
      slotStart,
      slotEnd,
      customerName,
      customerEmail,
      customerPhone,
      notes = '',
    } = req.body;

    // Validate inputs
    if (!serviceId || !customerName || !customerEmail || !customerPhone) {
      throw new AppError(
        'Service, name, email, and phone required',
        400,
        'validation_failed'
      );
    }

    if (!slotId && (!slotStart || !slotEnd)) {
      throw new AppError('Slot ID or start/end times required', 400, 'validation_failed');
    }

    // Verify service exists
    const serviceCheck = await pool.query(
      `SELECT duration_minutes, price_cents FROM business_services WHERE id = $1 AND business_id = $2`,
      [serviceId, businessId]
    );
    if (!serviceCheck.rows.length) {
      throw new AppError('Service not found', 404, 'not_found');
    }

    const serviceDuration = serviceCheck.rows[0].duration_minutes;
    const servicePrice = serviceCheck.rows[0].price_cents;

    // Get or create slot
    let slot;
    if (slotId) {
      const [start, end] = slotId.split('-');
      slot = { start_time: start, end_time: end };
    } else {
      slot = { start_time: slotStart, end_time: slotEnd };
    }

    // Create booking in transaction (prevent double-booking)
    const booking = await withTransaction(async (client) => {
      // Verify slot still available
      const slotCheck = await client.query(
        `
        SELECT COUNT(*) as booked_count FROM bookings
        WHERE service_id = $1 AND status IN ('confirmed', 'in_progress')
        AND slot_start = $2 AND slot_end = $3
        `,
        [serviceId, slot.start_time, slot.end_time]
      );

      if (parseInt(slotCheck.rows[0].booked_count) > 0) {
        throw new AppError('Slot no longer available', 409, 'slot_unavailable');
      }

      // Create booking
      const result = await client.query(
        `
        INSERT INTO bookings
        (business_id, service_id, customer_id, customer_name, customer_email, customer_phone,
         slot_start, slot_end, notes, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending_confirmation', now())
        RETURNING *
        `,
        [
          businessId,
          serviceId,
          customerId || null,
          customerName,
          customerEmail,
          customerPhone,
          slot.start_time,
          slot.end_time,
          notes.trim(),
        ]
      );

      // Schedule confirmation reminder (24 hours before)
      const slotDateTime = new Date(`${result.rows[0].slot_start}`);
      const reminderTime = new Date(slotDateTime.getTime() - 24 * 60 * 60 * 1000);

      await client.query(
        `
        INSERT INTO booking_reminders
        (booking_id, reminder_type, scheduled_at, status)
        VALUES ($1, 'confirmation_required', $2, 'pending')
        `,
        [result.rows[0].id, reminderTime]
      );

      return result.rows[0];
    });

    logger.info('Booking created', { bookingId: booking.id, serviceId, businessId });

    // Send confirmation email (fire-and-forget)
    // sendBookingConfirmationEmail(booking, businessId);

    res.status(201).json({
      success: true,
      data: {
        id: booking.id,
        businessId: booking.business_id,
        serviceId: booking.service_id,
        customerName: booking.customer_name,
        slotStart: booking.slot_start,
        slotEnd: booking.slot_end,
        status: booking.status,
        createdAt: booking.created_at,
        priceEstimate: servicePrice,
      },
    });
  } catch (error) {
    logger.error('bookingController.createBooking', { error, body: req.body });
    next(error);
  }
}

/**
 * Get all bookings for a customer
 * GET /api/businesses/{businessId}/bookings/my
 */
async function getMyBookings(req, res, next) {
  try {
    const { businessId } = req.params;
    const { page = 0, limit = 20, status } = req.query;
    const customerId = req.user.id;

    const offset = page * limit;

    let statusFilter = '';
    const params = [businessId, customerId, limit, offset];

    if (status) {
      statusFilter = ` AND b.status = $5`;
      params.push(status);
    }

    const result = await pool.query(
      `
      SELECT
        b.id, b.service_id, b.slot_start, b.slot_end, b.status,
        bs.name as service_name, bs.price_cents,
        b.created_at, b.updated_at
      FROM bookings b
      JOIN business_services bs ON b.service_id = bs.id
      WHERE b.business_id = $1 AND b.customer_id = $2 ${statusFilter}
      ORDER BY b.slot_start DESC
      LIMIT $3 OFFSET $4
      `,
      params
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM bookings WHERE business_id = $1 AND customer_id = $2 ${statusFilter}`,
      [businessId, customerId, ...(status ? [status] : [])]
    );

    res.json({
      success: true,
      data: result.rows.map(b => ({
        id: b.id,
        serviceId: b.service_id,
        serviceName: b.service_name,
        slotStart: b.slot_start,
        slotEnd: b.slot_end,
        status: b.status,
        price: b.price_cents,
        createdAt: b.created_at,
      })),
      total: parseInt(countResult.rows[0].total),
      page,
      limit,
    });
  } catch (error) {
    logger.error('bookingController.getMyBookings', { error });
    next(error);
  }
}

/**
 * Get all bookings for a business (admin view)
 * GET /api/businesses/{businessId}/bookings
 */
async function getBusinessBookings(req, res, next) {
  try {
    const { businessId } = req.params;
    const { page = 0, limit = 50, status, dateFrom, dateTo } = req.query;
    const userId = req.user.id;

    // Verify business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    const offset = page * limit;
    const params = [businessId, limit, offset];
    let filters = '';

    if (status) {
      filters += ` AND b.status = $${params.length + 1}`;
      params.push(status);
    }

    if (dateFrom) {
      filters += ` AND b.slot_start >= $${params.length + 1}`;
      params.push(dateFrom);
    }

    if (dateTo) {
      filters += ` AND b.slot_end <= $${params.length + 1}`;
      params.push(dateTo);
    }

    const result = await pool.query(
      `
      SELECT
        b.id, b.customer_name, b.customer_email, b.customer_phone,
        b.service_id, bs.name as service_name, b.status,
        b.slot_start, b.slot_end, b.notes, b.created_at
      FROM bookings b
      JOIN business_services bs ON b.service_id = bs.id
      WHERE b.business_id = $1 ${filters}
      ORDER BY b.slot_start DESC
      LIMIT $2 OFFSET $3
      `,
      params
    );

    res.json({
      success: true,
      data: result.rows,
      page,
      limit,
    });
  } catch (error) {
    logger.error('bookingController.getBusinessBookings', { error });
    next(error);
  }
}

/**
 * Get a single booking detail
 * GET /api/businesses/{businessId}/bookings/{bookingId}
 */
async function getBooking(req, res, next) {
  try {
    const { businessId, bookingId } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT
        b.*, bs.name as service_name, bs.price_cents, bs.duration_minutes
      FROM bookings b
      JOIN business_services bs ON b.service_id = bs.id
      WHERE b.id = $1 AND b.business_id = $2
      `,
      [bookingId, businessId]
    );

    if (!result.rows.length) {
      throw new AppError('Booking not found', 404, 'not_found');
    }

    const booking = result.rows[0];

    // Verify access (owner, business owner, or customer)
    const isOwner = booking.created_by === userId;
    const isCustomer = booking.customer_id === userId;
    const bizOwner = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    const isBusinessOwner = bizOwner.rows.length > 0;

    if (!isOwner && !isCustomer && !isBusinessOwner) {
      throw new AppError('Access denied', 403, 'access_denied');
    }

    res.json({
      success: true,
      data: {
        id: booking.id,
        businessId: booking.business_id,
        serviceId: booking.service_id,
        serviceName: booking.service_name,
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        customerPhone: booking.customer_phone,
        slotStart: booking.slot_start,
        slotEnd: booking.slot_end,
        notes: booking.notes,
        status: booking.status,
        price: booking.price_cents,
        duration: booking.duration_minutes,
        createdAt: booking.created_at,
      },
    });
  } catch (error) {
    logger.error('bookingController.getBooking', { error });
    next(error);
  }
}

/**
 * Update booking status
 * PUT /api/businesses/{businessId}/bookings/{bookingId}
 * Body: { status (pending_confirmation|confirmed|cancelled|completed) }
 */
async function updateBookingStatus(req, res, next) {
  try {
    const { businessId, bookingId } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    // Validate status
    const validStatuses = ['pending_confirmation', 'confirmed', 'cancelled', 'completed'];
    if (!validStatuses.includes(status)) {
      throw new AppError('Invalid status', 400, 'validation_failed');
    }

    // Verify business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    const result = await pool.query(
      `UPDATE bookings SET status = $1, updated_at = now()
       WHERE id = $2 AND business_id = $3 RETURNING *`,
      [status, bookingId, businessId]
    );

    if (!result.rows.length) {
      throw new AppError('Booking not found', 404, 'not_found');
    }

    logger.info('Booking status updated', { bookingId, status });

    // Send status notification email
    // sendBookingStatusEmail(result.rows[0], status);

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('bookingController.updateBookingStatus', { error });
    next(error);
  }
}

/**
 * Cancel a booking
 * POST /api/businesses/{businessId}/bookings/{bookingId}/cancel
 * Body: { reason? }
 */
async function cancelBooking(req, res, next) {
  try {
    const { businessId, bookingId } = req.params;
    const { reason = '' } = req.body;
    const userId = req.user.id;

    // Verify access (customer or business owner)
    const bookingCheck = await pool.query(
      `SELECT customer_id, status FROM bookings WHERE id = $1 AND business_id = $2`,
      [bookingId, businessId]
    );
    if (!bookingCheck.rows.length) {
      throw new AppError('Booking not found', 404, 'not_found');
    }

    const isCustomer = bookingCheck.rows[0].customer_id === userId;
    const bizOwner = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    const isBusinessOwner = bizOwner.rows.length > 0;

    if (!isCustomer && !isBusinessOwner) {
      throw new AppError('Cannot cancel this booking', 403, 'access_denied');
    }

    // Check if cancellable
    if (!['pending_confirmation', 'confirmed'].includes(bookingCheck.rows[0].status)) {
      throw new AppError('Cannot cancel this booking', 409, 'invalid_state');
    }

    const result = await pool.query(
      `UPDATE bookings SET status = 'cancelled', cancellation_reason = $1, cancelled_at = now()
       WHERE id = $2 RETURNING *`,
      [reason, bookingId]
    );

    logger.info('Booking cancelled', { bookingId, reason });

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('bookingController.cancelBooking', { error });
    next(error);
  }
}

module.exports = {
  getServiceAvailability,
  getBusinessAvailability,
  createBooking,
  getMyBookings,
  getBusinessBookings,
  getBooking,
  updateBookingStatus,
  cancelBooking,
};
