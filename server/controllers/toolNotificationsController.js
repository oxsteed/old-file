const db = require('../db');
const logger = require('../utils/logger');

const getNotificationPrefs = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await db.query(
      'SELECT * FROM tool_rental_notifications WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      // Create default prefs
      const newPrefs = await db.query(
        `INSERT INTO tool_rental_notifications (user_id) VALUES ($1) RETURNING *`,
        [userId]
      );
      return res.json(newPrefs.rows[0]);
    }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('getNotificationPrefs error', { err });
    res.status(500).json({ error: 'Failed to load preferences' });
  }
};

const updateNotificationPrefs = async (req, res) => {
  try {
    const userId = req.user.id;
    const { notify_new_tools, notify_bookings, notify_messages, notify_price_drop, saved_filters } = req.body;

    const result = await db.query(
      `INSERT INTO tool_rental_notifications
       (user_id, notify_new_tools, notify_bookings, notify_messages, notify_price_drop, saved_filters)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
       notify_new_tools = $2, notify_bookings = $3, notify_messages = $4, notify_price_drop = $5, saved_filters = $6
       RETURNING *`,
      [userId, notify_new_tools, notify_bookings, notify_messages, notify_price_drop, saved_filters ? JSON.stringify(saved_filters) : null]
    );

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('updateNotificationPrefs error', { err });
    res.status(500).json({ error: 'Failed to update preferences' });
  }
};

module.exports = { getNotificationPrefs, updateNotificationPrefs };
