const db = require('../db');
const logger = require('../utils/logger');
const bookingEmailService = require('../services/bookingEmailService');

const createBooking = async (req, res) => {
  const client = await db.connect();
  try {
    const { toolId, startDate, endDate, totalPrice } = req.body;
    const userId = req.user.id;

    // Validate dates
    if (new Date(startDate) >= new Date(endDate)) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    // Get tool and owner info
    const toolResult = await client.query(
      'SELECT owner_id FROM tool_rentals WHERE id = $1',
      [toolId]
    );
    if (toolResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tool not found' });
    }
    const ownerId = toolResult.rows[0].owner_id;

    // Check for calendar conflicts (overlapping confirmed/pending bookings)
    const conflictResult = await client.query(
      `SELECT COUNT(*) as conflict_count FROM tool_rentals_bookings
       WHERE tool_id = $1
         AND status IN ('pending', 'confirmed')
         AND start_date < $3
         AND end_date > $2`,
      [toolId, startDate, endDate]
    );

    if (parseInt(conflictResult.rows[0].conflict_count) > 0) {
      return res.status(409).json({ error: 'Tool is already booked for these dates' });
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
    await client.query('ROLLBACK');
    logger.error('createBooking error', { err });
    res.status(500).json({ error: 'Failed to create booking' });
  } finally {
    client.release();
  }
};

const getMyBookings = async (req, res) => {
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
    logger.error('getMyBookings error', { err });
    res.status(500).json({ error: 'Failed to load bookings' });
  }
};

const getBookingsByOwner = async (req, res) => {
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
    logger.error('getBookingsByOwner error', { err });
    res.status(500).json({ error: 'Failed to load bookings' });
  }
};

const updateBookingStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    // Verify owner and get booking details
    const bookingQuery = await db.query(
      'SELECT * FROM tool_rentals_bookings WHERE id = $1',
      [bookingId]
    );
    if (!bookingQuery.rows[0]) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingQuery.rows[0];
    if (booking.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
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
    logger.error('updateBookingStatus error', { err });
    res.status(500).json({ error: 'Failed to update booking' });
  }
};

const checkAvailability = async (req, res) => {
  try {
    const { toolId } = req.params;
    const result = await db.query(
      `SELECT start_date, end_date, status
       FROM tool_rentals_bookings
       WHERE tool_id = $1 AND status IN ('pending', 'confirmed')
       ORDER BY start_date ASC`,
      [toolId]
    );
    res.json({ booked_dates: result.rows });
  } catch (err) {
    logger.error('checkAvailability error', { err });
    res.status(500).json({ error: 'Failed to check availability' });
  }
};

module.exports = { createBooking, getMyBookings, getBookingsByOwner, updateBookingStatus, checkAvailability };
