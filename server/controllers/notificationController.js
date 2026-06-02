const db = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

// ─── GET USER NOTIFICATIONS ───────────────────────────────────
exports.getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, unread_only } = req.query;
    const offset  = (page - 1) * limit;

    let condition = 'WHERE n.user_id = $1';
    if (unread_only === 'true') condition += ' AND n.is_read = false';

    const { rows } = await db.query(`
      SELECT id, type, title, body, data,
             data->>'action_url' AS action_url,
             is_read, created_at, read_at
      FROM notifications n
      ${condition}
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);

    const { rows: countRows } = await db.query(`
      SELECT COUNT(*) FROM notifications
      WHERE user_id = $1 AND is_read = false
    `, [userId]);

    res.json({
      notifications: rows,
      unread_count: parseInt(countRows[0].count),
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET SINGLE NOTIFICATION ─────────────────────────────────
exports.getNotification = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { rows } = await db.query(`
      SELECT id, type, title, body, data,
             data->>'action_url' AS action_url,
             is_read, created_at, read_at
      FROM notifications
      WHERE user_id = $1 AND id = $2
      LIMIT 1
    `, [userId, id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ notification: rows[0] });
  } catch (err) {
    next(err);
  }
};

// ─── MARK AS READ ─────────────────────────────────────────────
exports.markRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { ids } = req.body; // array of notification IDs, or 'all'

    if (ids === 'all') {
      await db.query(`
        UPDATE notifications
        SET is_read = true, read_at = now()
        WHERE user_id = $1 AND is_read = false
      `, [userId]);
    } else if (Array.isArray(ids) && ids.length) {
      await db.query(`
        UPDATE notifications
        SET is_read = true, read_at = now()
        WHERE user_id = $1
          AND id = ANY($2::bigint[])
          AND is_read = false
      `, [userId, ids]);
    }

    // Return new unread count
    const { rows } = await db.query(`
      SELECT COUNT(*) FROM notifications
      WHERE user_id = $1 AND is_read = false
    `, [userId]);

    res.json({ unread_count: parseInt(rows[0].count) });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE / DISMISS SINGLE NOTIFICATION ─────────────────────
exports.deleteNotification = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    await db.query(`
      DELETE FROM notifications
      WHERE user_id = $1 AND id = $2
    `, [userId, id]);

    const { rows } = await db.query(`
      SELECT COUNT(*) FROM notifications
      WHERE user_id = $1 AND is_read = false
    `, [userId]);

    res.json({ success: true, unread_count: parseInt(rows[0].count, 10) });
  } catch (err) {
    next(err);
  }
};

// ─── GET + UPDATE PREFERENCES ─────────────────────────────────
exports.getPreferences = async (req, res, next) => {
  try {
    const userId = req.user.id;

    await db.query(`
      INSERT INTO notification_preferences (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
    `, [userId]);

    const { rows } = await db.query(
      `SELECT * FROM notification_preferences WHERE user_id = $1`,
      [userId]
    );

    res.json({ preferences: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updatePreferences = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    // Whitelist allowed preference keys
    const allowed = [
      'in_app_new_bid','in_app_bid_accepted','in_app_job_started',
      'in_app_job_completed','in_app_payment_released',
      'in_app_new_review','in_app_dispute_update','in_app_subscription',
      'in_app_new_message','in_app_message_mention',
      'push_new_job_nearby','push_new_bid','push_bid_accepted',
      'push_payment_released','push_dispute_update',
      'push_new_message','push_message_mention',
      'email_bid_accepted','email_payment_released',
      'email_subscription','email_dispute_update','email_weekly_summary',
      'email_new_message'
    ];

    const filteredKeys = Object.keys(updates).filter(k => allowed.includes(k));
    if (!filteredKeys.length) {
      throw new AppError('No valid preference keys provided', 400, 'validation_failed');
    }

    // Dynamic SET clause
    const setClause = filteredKeys
      .map((key, i) => `${key} = $${i + 2}`)
      .join(', ');
    const values = filteredKeys.map(k => Boolean(updates[k]));

    await db.query(`
      INSERT INTO notification_preferences (user_id, ${filteredKeys.join(', ')})
      VALUES ($1, ${filteredKeys.map((_, i) => `$${i + 2}`).join(', ')})
      ON CONFLICT (user_id) DO UPDATE
      SET ${setClause}, updated_at = now()
    `, [userId, ...values]);

    res.json({ message: 'Preferences updated.' });
  } catch (err) {
    next(err);
  }
};

// ─── REGISTER PUSH TOKEN ──────────────────────────────────────
exports.registerPushToken = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { token } = req.body;

    const fields = {};
    if (!token) fields.token = 'Push token required';
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE
       SET user_id = $1, p256dh = $3, auth = $4, user_agent = $5, last_used_at = now()`,
      [userId, token, 'legacy', 'legacy', req.headers['user-agent'] || null]
    );

    return res.json({ success: true, message: 'Push token registered.' });
  } catch (err) {
    next(err);
  }
};
