const db = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const bookingEmailService = require('../services/bookingEmailService');

const createBooking = async (req, res, next) => {
  const client = await db.connect();
  try {
    const { toolId, startDate, endDate } = req.body;
    const userId = req.user.id;

    const fields = {};
    if (!toolId) fields.toolId = 'toolId is required';
    if (!startDate) fields.startDate = 'startDate is required';
    if (!endDate) fields.endDate = 'endDate is required';
    if (Object.keys(fields).length) throw new AppError('Validation failed', 400, 'validation_failed', fields);

    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new AppError('Invalid date', 400, 'validation_failed', { startDate: 'Invalid date', endDate: 'Invalid date' });
    }

    if (start >= end) {
      throw new AppError('End date must be after start date', 400, 'validation_failed', { endDate: 'Must be after startDate' });
    }

    // Get tool and owner info
    const toolResult = await client.query(
      'SELECT user_id AS owner_id, daily_rate, is_available FROM tool_rentals WHERE id = $1',
      [toolId]
    );
    if (toolResult.rows.length === 0) {
      throw new AppError('Tool not found', 404, 'not_found');
    }
    const listedTool = toolResult.rows[0];
    const ownerId = listedTool.owner_id;
    if (ownerId === userId) {
      throw new AppError('You cannot book your own tool', 409, 'state_conflict');
    }
    if (!listedTool.is_available) {
      throw new AppError('Tool is not available', 409, 'state_conflict');
    }
    const dailyRate = parseFloat(listedTool.daily_rate);
    if (!Number.isFinite(dailyRate) || dailyRate <= 0) {
      throw new AppError('Tool cannot be booked online because pricing is not configured', 409, 'pricing_unavailable');
    }

    const rentalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const totalPrice = Number((rentalDays * dailyRate).toFixed(2));

    // Check for calendar conflicts (overlapping confirmed/pending bookings)
    const conflictResult = await client.query(
      `SELECT COUNT(*) as conflict_count FROM tool_rentals_bookings
       WHERE tool_id = $1
         AND status IN ('pending', 'invoice_sent', 'payment_confirmed')
         AND start_date <= $3
         AND end_date >= $2`,
      [toolId, startDate, endDate]
    );

    if (parseInt(conflictResult.rows[0].conflict_count) > 0) {
      throw new AppError('Tool is already booked for these dates', 409, 'conflict');
    }

    // Create booking in transaction
    await client.query('BEGIN');

    const booking = await client.query(
      `INSERT INTO tool_rentals_bookings (tool_id, customer_id, owner_id, start_date, end_date, total_price)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [toolId, userId, ownerId, startDate, endDate, totalPrice]
    );

    // Log analytics
    await client.query(
      `INSERT INTO tool_rentals_analytics (user_id, tool_id, event_type, metadata)
       VALUES ($1, $2, 'book', $3)`,
      [userId, toolId, JSON.stringify({ startDate, endDate, totalPrice })]
    );

    await client.query('COMMIT');

    // Fetch customer and owner data for email
    const customerData = await db.query('SELECT email, first_name FROM users WHERE id = $1', [userId]);
    const ownerData = await db.query('SELECT email, first_name FROM users WHERE id = $1', [ownerId]);
    const toolData = await db.query('SELECT name FROM tool_rentals WHERE id = $1', [toolId]);

    const customer = customerData.rows[0];
    const owner = ownerData.rows[0];
    const tool = toolData.rows[0];

    // Send confirmation emails asynchronously (non-blocking)
    if (customer && owner && tool) {
      bookingEmailService.sendBookingConfirmation(booking.rows[0], tool, customer, owner);
    }

    res.status(201).json(booking.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
};

const getMyBookings = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await db.query(
      `SELECT b.*, tr.name, tr.daily_rate
       FROM tool_rentals_bookings b
       JOIN tool_rentals tr ON b.tool_id = tr.id
       WHERE b.customer_id = $1
       ORDER BY b.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

const getBookingsByOwner = async (req, res, next) => {
  try {
    const ownerId = req.user.id;
    const result = await db.query(
      `SELECT b.*, tr.name, u.first_name, u.last_name
       FROM tool_rentals_bookings b
       JOIN tool_rentals tr ON b.tool_id = tr.id
       JOIN users u ON b.customer_id = u.id
       WHERE b.owner_id = $1
       ORDER BY b.created_at DESC`,
      [ownerId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

const updateBookingStatus = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    if (!status) {
      throw new AppError('status is required', 400, 'validation_failed', { status: 'status is required' });
    }

    // Verify owner and get booking details
    const bookingQuery = await db.query(
      'SELECT * FROM tool_rentals_bookings WHERE id = $1',
      [bookingId]
    );
    if (!bookingQuery.rows[0]) {
      throw new AppError('Booking not found', 404, 'not_found');
    }

    const booking = bookingQuery.rows[0];
    const isOwner = booking.owner_id === userId;
    const isCustomer = booking.customer_id === userId;
    if (!isOwner && !isCustomer) {
      throw new AppError('Unauthorized', 403, 'forbidden');
    }

    const validStatuses = ['cancelled', 'completed'];
    if (!validStatuses.includes(status)) {
      throw new AppError('Invalid status transition', 400, 'validation_failed', { status: 'Must be cancelled or completed' });
    }
    if (status === 'cancelled' && !['pending', 'invoice_sent'].includes(booking.status)) {
      throw new AppError('Booking can no longer be cancelled', 409, 'state_conflict');
    }
    if (status === 'completed' && (!isOwner || booking.status !== 'payment_confirmed')) {
      throw new AppError('Booking cannot be completed in its current state', 409, 'state_conflict');
    }

    const result = await db.query(
      'UPDATE tool_rentals_bookings SET status = $1 WHERE id = $2 RETURNING *',
      [status, bookingId]
    );

    const updatedBooking = result.rows[0];

    // Send status update emails asynchronously
    if (status === 'confirmed') {
      const customerData = await db.query('SELECT email, first_name FROM users WHERE id = $1', [booking.customer_id]);
      const toolData = await db.query('SELECT name FROM tool_rentals WHERE id = $1', [booking.tool_id]);
      if (customerData.rows[0] && toolData.rows[0]) {
        bookingEmailService.sendBookingApproved(updatedBooking, toolData.rows[0], customerData.rows[0]);
      }
    } else if (status === 'cancelled' && booking.status !== 'cancelled') {
      const customerData = await db.query('SELECT email, first_name FROM users WHERE id = $1', [booking.customer_id]);
      const toolData = await db.query('SELECT name FROM tool_rentals WHERE id = $1', [booking.tool_id]);
      if (customerData.rows[0] && toolData.rows[0]) {
        bookingEmailService.sendBookingDeclined(updatedBooking, toolData.rows[0], customerData.rows[0]);
      }
    }

    res.json(updatedBooking);
  } catch (err) {
    next(err);
  }
};

const checkAvailability = async (req, res, next) => {
  try {
    const { toolId } = req.params;
    if (!toolId) {
      throw new AppError('toolId is required', 400, 'validation_failed', { toolId: 'toolId is required' });
    }
    const result = await db.query(
      `SELECT start_date, end_date, status
       FROM tool_rentals_bookings
       WHERE tool_id = $1 AND status IN ('pending', 'invoice_sent', 'payment_confirmed')
       ORDER BY start_date ASC`,
      [toolId]
    );
    res.json({ booked_dates: result.rows });
  } catch (err) {
    next(err);
  }
};

module.exports = { createBooking, getMyBookings, getBookingsByOwner, updateBookingStatus, checkAvailability };
