const db = require('../db');
const logger = require('../utils/logger');

const createBooking = async (req, res) => {
  const client = await db.connect();
  try {
    const { toolId, startDate, endDate, totalPrice } = req.body;
    const userId = req.user.id;

    // Get tool and owner info
    const toolResult = await client.query(
      'SELECT owner_id FROM tool_rentals WHERE id = $1',
      [toolId]
    );
    if (toolResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tool not found' });
    }
    const ownerId = toolResult.rows[0].owner_id;

    // Create booking
    const booking = await client.query(
      `INSERT INTO tool_rentals_bookings (tool_id, customer_id, owner_id, start_date, end_date, total_price)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [toolId, userId, ownerId, startDate, endDate, totalPrice]
    );

    // Log analytics
    await client.query(
      `INSERT INTO tool_rentals_analytics (user_id, tool_id, event_type)
       VALUES ($1, $2, 'book')`,
      [userId, toolId]
    );

    res.status(201).json(booking.rows[0]);
  } catch (err) {
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

    // Verify owner
    const booking = await db.query(
      'SELECT owner_id FROM tool_rentals_bookings WHERE id = $1',
      [bookingId]
    );
    if (booking.rows[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await db.query(
      'UPDATE tool_rentals_bookings SET status = $1 WHERE id = $2 RETURNING *',
      [status, bookingId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('updateBookingStatus error', { err });
    res.status(500).json({ error: 'Failed to update booking' });
  }
};

module.exports = { createBooking, getMyBookings, getBookingsByOwner, updateBookingStatus };
