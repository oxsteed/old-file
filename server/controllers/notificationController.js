const db = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

const MEDIA_NOTIFICATION_TYPES = [
  'media_reply', 'media_like', 'media_repost', 'media_quote',
  'media_follow', 'media_creator_update',
];

function notificationScopeClause(scope, params, alias = 'n') {
  if (scope !== 'media') return '';
  params.push(MEDIA_NOTIFICATION_TYPES);
  return ` AND ${alias}.type = ANY($${params.length}::text[])`;
}

// ─── GET USER NOTIFICATIONS ───────────────────────────────────
exports.getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, unread_only, scope } = req.query;
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100);
    const safePage = Math.max(Number.parseInt(page, 10) || 1, 1);
    const offset  = (safePage - 1) * safeLimit;

    let condition = 'WHERE n.user_id = $1';
    if (unread_only === 'true') condition += ' AND n.is_read = false';
    const listParams = [userId];
    condition += notificationScopeClause(scope, listParams);
    listParams.push(safeLimit, offset);
    const listLimitParam = listParams.length - 1;
    const listOffsetParam = listParams.length;

    const { rows } = await db.query(`
      SELECT id, type, title, body, data,
             COALESCE(n.action_url, data->>'action_url') AS action_url,
             is_read, created_at, read_at
      FROM notifications n
      ${condition}
      ORDER BY created_at DESC
      LIMIT $${listLimitParam} OFFSET $${listOffsetParam}
    `, listParams);

    const countParams = [userId];
    const countScope = notificationScopeClause(scope, countParams);
    const { rows: countRows } = await db.query(`
      SELECT COUNT(*) FROM notifications n
      WHERE n.user_id = $1 AND n.is_read = false${countScope}
    `, countParams);

    res.json({
      notifications: rows,
      unread_count: parseInt(countRows[0].count),
      page: safePage,
      limit: safeLimit,
      scope: scope || null,
      has_more: offset + rows.length < Number(countRows[0].count),
      next_page: offset + rows.length < Number(countRows[0].count) ? safePage + 1 : null,
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
             COALESCE(n.action_url, data->>'action_url') AS action_url,
             is_read, created_at, read_at
      FROM notifications n
      WHERE n.user_id = $1 AND n.id = $2
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
    const scope = req.query.scope || req.body?.scope;
    const scopeParams = [userId];
    const scopeClause = notificationScopeClause(scope, scopeParams);

    if (ids === 'all') {
      await db.query(`
        UPDATE notifications
        SET is_read = true, read_at = now()
        WHERE user_id = $1 AND is_read = false${scopeClause}
      `, scopeParams);
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
      SELECT COUNT(*) FROM notifications n
      WHERE n.user_id = $1 AND n.is_read = false${scopeClause.replace(/\$\d+/g, (match) => match)}
    `, scopeParams);

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
      `SELECT np.*,
              -- Item 12: the user's per-type opt-outs ride this same query
              -- so the settings UI gets them with the preferences in one call.
              (SELECT COALESCE(json_agg(json_build_object('type', notification_type, 'channel', channel)), '[]'::json)
                 FROM notification_type_opt_outs WHERE user_id = np.user_id) AS type_opt_outs
         FROM notification_preferences np WHERE user_id = $1`,
      [userId]
    );

    res.json({ preferences: rows[0], type_opt_outs: rows[0]?.type_opt_outs || [] });
  } catch (err) {
    next(err);
  }
};

exports.updatePreferences = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    // Whitelist allowed preference keys.
    // Master toggles: push_notifications gates every push channel, and
    // sms_notifications gates all SMS (see migration 795).
    // Removed (review P2-8-F03): in_app_message_mention, push_message_mention
    // (no mention events are ever emitted) and push_new_job_nearby (no
    // nearby-job events are ever emitted). Their columns stay in the DB so
    // existing rows are untouched; the UI no longer offers them.
    const allowed = [
      'push_notifications','sms_notifications',
      // Item 12: in-app master toggle (gated in prefAllows).
      'in_app_notifications',
      // Item 33: media-creator update toggle (was a phantom column).
      'in_app_media_creator_update',
      // Item 52: support-reply SMS toggle (column existed, never offered).
      'sms_support_replies',
      'in_app_new_bid','in_app_bid_accepted','in_app_job_started',
      'in_app_job_completed','in_app_payment_released',
      'in_app_new_review','in_app_dispute_update','in_app_subscription',
      'in_app_new_message',
      // Background-jobs audit #51: restaurant alert toggles (one per type;
      // the keys are the canonical in_app_<type> keys honored by
      // prefAllows in notificationService.js).
      'in_app_staff_time_entry_system_closed',
      'in_app_staff_time_entry_missing_punch',
      // Domain 8 #25: closeout-failure alert toggle (migration
      // 20261113183500); previously absent, so managers could not
      // silence the hourly closeout-failure alert.
      'in_app_staff_time_entry_closeout_failed',
      'in_app_restaurant_temperature_breach',
      'in_app_restaurant_scheduled_report',
      // Money-flows W3: erasure lifecycle notification types (same
      // class as #51 / W6: new types must ship with a toggle).
      'in_app_restaurant_erasure_requested',
      'in_app_restaurant_erasure_decided',
      'in_app_restaurant_erasure_completed',
      'push_new_bid','push_bid_accepted',
      'push_payment_released','push_dispute_update',
      'push_new_message',
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

// Item 34: the duplicate POST /notifications/push-token endpoint is deleted.
// It wrote p256dh='legacy' rows that webPushService explicitly excludes, so
// no sender ever read them. Live paths are POST /mobile/push-token and
// POST /notifications/webpush/subscribe.
// ─── PER-TYPE OPT-OUTS (item 12) ─────────────────────────────
// One prefs API surface: the settings UI lists types from
// getNotificationTypes and reads/writes opt-outs here. A row means opted
// OUT of that type+channel; absence means ON (new types default ON).
const { NOTIFICATION_TYPES } = require('../utils/notificationTypeCatalog');

const OPT_OUT_CHANNELS = new Set(['in_app', 'push', 'email']);
const OPT_OUT_TYPE_RE = /^[A-Za-z0-9_:]{1,100}$/;

exports.getNotificationTypes = async (req, res, next) => {
  try {
    res.json({ types: NOTIFICATION_TYPES });
  } catch (err) {
    next(err);
  }
};

exports.getTypeOptOuts = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { rows } = await db.query(
      `SELECT notification_type AS type, channel, created_at
         FROM notification_type_opt_outs
        WHERE user_id = $1
        ORDER BY notification_type, channel`,
      [userId]
    );
    res.json({ opt_outs: rows });
  } catch (err) {
    next(err);
  }
};

exports.setTypeOptOut = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { type, channel, optedOut } = req.body || {};

    if (typeof type !== 'string' || !OPT_OUT_TYPE_RE.test(type)) {
      throw new AppError('Invalid notification type', 400, 'validation_failed', { type: 'Must be a notification type key' });
    }
    if (!OPT_OUT_CHANNELS.has(channel)) {
      throw new AppError('Invalid channel', 400, 'validation_failed', { channel: 'Must be in_app, push or email' });
    }
    if (typeof optedOut !== 'boolean') {
      throw new AppError('Invalid optedOut', 400, 'validation_failed', { optedOut: 'Must be a boolean' });
    }

    if (optedOut) {
      await db.query(
        `INSERT INTO notification_type_opt_outs (user_id, notification_type, channel)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, notification_type, channel) DO NOTHING`,
        [userId, type, channel]
      );
    } else {
      await db.query(
        `DELETE FROM notification_type_opt_outs
          WHERE user_id = $1 AND notification_type = $2 AND channel = $3`,
        [userId, type, channel]
      );
    }

    res.json({ message: 'Type preference updated.', type, channel, optedOut });
  } catch (err) {
    next(err);
  }
};
