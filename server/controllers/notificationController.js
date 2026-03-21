const db = require('../db');

// ─── GET USER NOTIFICATIONS ───────────────────────────────────
exports.getNotifications = async (req, res) => {
  try {
    const userId  = req.user.id;
    const { page = 1, limit = 20, unread_only } = req.query;
    const offset  = (page - 1) * limit;

    let condition = 'WHERE n.user_id = $1';
    if (unread_only === 'true') condition += ' AND n.is_read = false';

    const { rows } = await db.query(`
      SELECT id, type, title, body, data, action_url,
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
      unread_count:  parseInt(countRows[0].count),
      page:          parseInt(page),
      limit:         parseInt(limit)
    });
  } catch (err) {
    console.error('getNotifications error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
};

// ─── MARK AS READ ─────────────────────────────────────────────
exports.markRead = async (req, res) => {
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
          AND id = ANY($2::uuid[])
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
    console.error('markRead error:', err);
    res.status(500).json({ error: 'Failed to mark notifications.' });
  }
};

// ─── GET + UPDATE PREFERENCES ─────────────────────────────────
exports.getPreferences = async (req, res) => {
  try {
    const userId = req.user.id;

    // Upsert default prefs if not set
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
    console.error('getPreferences error:', err);
    res.status(500).json({ error: 'Failed to fetch preferences.' });
  }
};

exports.updatePreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    // Whitelist allowed preference keys
    const allowed = [
      'in_app_new_bid','in_app_bid_accepted','in_app_job_started',
      'in_app_job_completed','in_app_payment_released',
      'in_app_new_review','in_app_dispute_update','in_app_subscription',
      'push_new_job_nearby','push_new_bid','push_bid_accepted',
      'push_payment_released','push_dispute_update',
      'email_bid_accepted','email_payment_released',
      'email_subscription','email_dispute_update','email_weekly_summary'
    ];

    const filteredKeys = Object.keys(updates).filter(k => allowed.includes(k));
    if (!filteredKeys.length) {
      return res.status(400).json({ error: 'No valid preference keys provided.' });
    }

    // Dynamic SET clause
    const setClause = filteredKeys
      .map((key, i) => `${key} = $${i + 2}`)
      .join(', ');
    const values    = filteredKeys.map(k => Boolean(updates[k]));

    await db.query(`
      INSERT INTO notification_preferences (user_id, ${filteredKeys.join(', ')})
      VALUES ($1, ${filteredKeys.map((_, i) => `$${i + 2}`).join(', ')})
      ON CONFLICT (user_id) DO UPDATE
      SET ${setClause}, updated_at = now()
    `, [userId, ...values]);

    res.json({ message: 'Preferences updated.' });
  } catch (err) {
    console.error('updatePreferences error:', err);
    res.status(500).json({ error: 'Failed to update preferences.' });
  }
};

// ─── REGISTER PUSH TOKEN ──────────────────────────────────────
exports.registerPushToken = async (req, res) => {
  try {
    const userId = req.user.id;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Push token required.' });
    }

    await db.query(`
      INSERT INTO helper_profiles (user_id, push_token)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE
      SET push_token = $2, updated_at = now()
    `, [userId, token]);

    res.json({ message: 'Push token registered.' });
  } catch (err) {
    console.error('registerPushToken error:', err);
    res.status(500).json({ error: 'Failed to register push token.' });
  }
};
