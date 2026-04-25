const db = require('../db');
const logger = require('../utils/logger');
const { validateInput, rules } = require('../utils/validate');
const { sendError, sendSuccess } = require('../utils/apiError');

const AVAILABILITY_TYPES = ['available', 'unavailable', 'busy'];

// Create availability block
exports.createAvailabilityBlock = async (req, res) => {
  const { start_time, end_time, type = 'available', title, notes, recurring_rule, recurring_until } = req.body;
  const helper_id = req.user.id;

  const validation = validateInput(req.body, {
    start_time: [rules.required()],
    end_time: [rules.required()],
    type: [rules.required()],
  });

  if (!validation.valid) return sendValidationError(res, validation);

  if (!AVAILABILITY_TYPES.includes(type)) {
    return sendError(res, 400, 'Invalid availability type', 'INVALID_TYPE');
  }

  const start = new Date(start_time);
  const end = new Date(end_time);

  if (end <= start) {
    return sendError(res, 400, 'End time must be after start time', 'INVALID_TIME_RANGE');
  }

  try {
    const result = await db.query(
      `INSERT INTO availability_blocks (
        helper_id, start_time, end_time, type, title, notes, recurring_rule, recurring_until
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [helper_id, start, end, type, title, notes, recurring_rule, recurring_until]
    );

    logger.info('Availability block created', {
      helper_id,
      block_id: result.rows[0].id,
      type,
      start_time: start.toISOString(),
    });

    return sendSuccess(res, result.rows[0], 201);
  } catch (err) {
    logger.error('Failed to create availability block', { err, helper_id });
    return sendError(res, 500, 'Failed to create availability block', 'INTERNAL_ERROR');
  }
};

// Get availability blocks for helper
exports.getAvailabilityBlocks = async (req, res) => {
  const { helper_id } = req.params;
  const { from_date, to_date, type, limit = 100, offset = 0 } = req.query;

  const limit_int = Math.min(parseInt(limit) || 100, 500);
  const offset_int = Math.max(0, parseInt(offset) || 0);

  try {
    let query = `SELECT * FROM availability_blocks WHERE helper_id = $1`;
    const params = [helper_id];

    if (from_date) {
      query += ` AND start_time >= $${params.length + 1}`;
      params.push(new Date(from_date));
    }

    if (to_date) {
      query += ` AND end_time <= $${params.length + 1}`;
      params.push(new Date(to_date));
    }

    if (type && AVAILABILITY_TYPES.includes(type)) {
      query += ` AND type = $${params.length + 1}`;
      params.push(type);
    }

    // Get count
    const countResult = await db.query(
      `SELECT COUNT(*) as count FROM availability_blocks WHERE helper_id = $1 ${from_date ? 'AND start_time >= $2' : ''} ${to_date ? (from_date ? 'AND end_time <= $3' : 'AND end_time <= $2') : ''}`,
      params.slice(0, from_date && to_date ? 3 : from_date || to_date ? 2 : 1)
    );

    const total = parseInt(countResult.rows[0].count);

    query += ` ORDER BY start_time ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit_int, offset_int);

    const result = await db.query(query, params);

    return sendSuccess(res, {
      blocks: result.rows,
      total,
      limit: limit_int,
      offset: offset_int,
      hasMore: offset_int + limit_int < total
    });
  } catch (err) {
    logger.error('Failed to fetch availability blocks', { err, helper_id });
    return sendError(res, 500, 'Failed to fetch availability blocks', 'INTERNAL_ERROR');
  }
};

// Get my availability blocks (authenticated helper)
exports.getMyAvailabilityBlocks = async (req, res) => {
  const helper_id = req.user.id;
  const { from_date, to_date, type, limit = 100, offset = 0 } = req.query;

  return exports.getAvailabilityBlocks(
    { params: { helper_id }, query: { from_date, to_date, type, limit, offset } },
    res
  );
};

// Update availability block
exports.updateAvailabilityBlock = async (req, res) => {
  const { id } = req.params;
  const { start_time, end_time, type, title, notes, recurring_rule, recurring_until } = req.body;
  const helper_id = req.user.id;

  try {
    // Verify ownership
    const blockResult = await db.query(
      `SELECT * FROM availability_blocks WHERE id = $1 AND helper_id = $2`,
      [id, helper_id]
    );

    if (blockResult.rows.length === 0) {
      return sendError(res, 404, 'Availability block not found', 'NOT_FOUND');
    }

    const block = blockResult.rows[0];

    // Validate type if provided
    if (type && !AVAILABILITY_TYPES.includes(type)) {
      return sendError(res, 400, 'Invalid availability type', 'INVALID_TYPE');
    }

    // Validate times if provided
    if (start_time && end_time) {
      const start = new Date(start_time);
      const end = new Date(end_time);
      if (end <= start) {
        return sendError(res, 400, 'End time must be after start time', 'INVALID_TIME_RANGE');
      }
    }

    const result = await db.query(
      `UPDATE availability_blocks SET
        start_time = COALESCE($1, start_time),
        end_time = COALESCE($2, end_time),
        type = COALESCE($3, type),
        title = COALESCE($4, title),
        notes = COALESCE($5, notes),
        recurring_rule = COALESCE($6, recurring_rule),
        recurring_until = COALESCE($7, recurring_until),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 RETURNING *`,
      [start_time, end_time, type, title, notes, recurring_rule, recurring_until, id]
    );

    logger.info('Availability block updated', {
      helper_id,
      block_id: id,
      changes: { start_time, end_time, type }
    });

    return sendSuccess(res, result.rows[0]);
  } catch (err) {
    logger.error('Failed to update availability block', { err, id, helper_id });
    return sendError(res, 500, 'Failed to update availability block', 'INTERNAL_ERROR');
  }
};

// Delete availability block
exports.deleteAvailabilityBlock = async (req, res) => {
  const { id } = req.params;
  const helper_id = req.user.id;

  try {
    const result = await db.query(
      `DELETE FROM availability_blocks WHERE id = $1 AND helper_id = $2 RETURNING id`,
      [id, helper_id]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Availability block not found', 'NOT_FOUND');
    }

    logger.info('Availability block deleted', { helper_id, block_id: id });

    return sendSuccess(res, { message: 'Availability block deleted' });
  } catch (err) {
    logger.error('Failed to delete availability block', { err, id, helper_id });
    return sendError(res, 500, 'Failed to delete availability block', 'INTERNAL_ERROR');
  }
};

// Get notification preferences
exports.getNotificationPreferences = async (req, res) => {
  const user_id = req.user.id;

  try {
    let result = await db.query(
      `SELECT * FROM notification_preferences WHERE user_id = $1`,
      [user_id]
    );

    if (result.rows.length === 0) {
      // Create default preferences
      const defaultPrefs = {
        user_id,
        appointment_confirmed_channels: ['in_app', 'email'],
        appointment_cancelled_channels: ['in_app', 'email'],
        reminder_24h_channels: ['in_app', 'email'],
        reminder_2h_channels: ['in_app'],
        reminder_same_day_channels: ['in_app', 'sms'],
        timezone: 'UTC'
      };

      result = await db.query(
        `INSERT INTO notification_preferences
        (user_id, appointment_confirmed_channels, appointment_cancelled_channels,
         reminder_24h_channels, reminder_2h_channels, reminder_same_day_channels, timezone)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          user_id,
          defaultPrefs.appointment_confirmed_channels,
          defaultPrefs.appointment_cancelled_channels,
          defaultPrefs.reminder_24h_channels,
          defaultPrefs.reminder_2h_channels,
          defaultPrefs.reminder_same_day_channels,
          defaultPrefs.timezone
        ]
      );
    }

    return sendSuccess(res, result.rows[0]);
  } catch (err) {
    logger.error('Failed to fetch notification preferences', { err, user_id });
    return sendError(res, 500, 'Failed to fetch notification preferences', 'INTERNAL_ERROR');
  }
};

// Update notification preferences
exports.updateNotificationPreferences = async (req, res) => {
  const user_id = req.user.id;
  const {
    appointment_confirmed_channels,
    appointment_cancelled_channels,
    reminder_24h_channels,
    reminder_2h_channels,
    reminder_same_day_channels,
    quiet_hours_start,
    quiet_hours_end,
    timezone
  } = req.body;

  try {
    // Ensure preferences exist
    await db.query(
      `INSERT INTO notification_preferences (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [user_id]
    );

    const result = await db.query(
      `UPDATE notification_preferences SET
        appointment_confirmed_channels = COALESCE($1, appointment_confirmed_channels),
        appointment_cancelled_channels = COALESCE($2, appointment_cancelled_channels),
        reminder_24h_channels = COALESCE($3, reminder_24h_channels),
        reminder_2h_channels = COALESCE($4, reminder_2h_channels),
        reminder_same_day_channels = COALESCE($5, reminder_same_day_channels),
        quiet_hours_start = COALESCE($6, quiet_hours_start),
        quiet_hours_end = COALESCE($7, quiet_hours_end),
        timezone = COALESCE($8, timezone),
        updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $9 RETURNING *`,
      [
        appointment_confirmed_channels ? JSON.stringify(appointment_confirmed_channels) : null,
        appointment_cancelled_channels ? JSON.stringify(appointment_cancelled_channels) : null,
        reminder_24h_channels ? JSON.stringify(reminder_24h_channels) : null,
        reminder_2h_channels ? JSON.stringify(reminder_2h_channels) : null,
        reminder_same_day_channels ? JSON.stringify(reminder_same_day_channels) : null,
        quiet_hours_start,
        quiet_hours_end,
        timezone,
        user_id
      ]
    );

    logger.info('Notification preferences updated', { user_id });

    return sendSuccess(res, result.rows[0]);
  } catch (err) {
    logger.error('Failed to update notification preferences', { err, user_id });
    return sendError(res, 500, 'Failed to update notification preferences', 'INTERNAL_ERROR');
  }
};
