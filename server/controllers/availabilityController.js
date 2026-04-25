// server/controllers/availabilityController.js
//
// Availability blocks: helper opt-in time windows (and unavailability blocks).
// Notification preference CRUD lives here too — it's the only thing that
// touches the same notification_preferences table.

const pool = require('../db');
const logger = require('../utils/logger');
const { validate, rules } = require('../utils/validate');
const { sendError, sendSuccess } = require('../utils/apiError');

const AVAILABILITY_TYPES = ['available', 'unavailable', 'busy'];
const VALID_CHANNELS = ['in_app', 'email', 'sms', 'push'];

function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function isUuid(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function sanitizeChannelArray(value) {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .map(s => String(s).toLowerCase())
    .filter(s => VALID_CHANNELS.includes(s));
  // Keep only the first occurrence of each channel
  return Array.from(new Set(cleaned));
}

// ─── createAvailabilityBlock ─────────────────────────────────
exports.createAvailabilityBlock = async (req, res) => {
  const helperId = req.user.id;
  const {
    start_time, end_time,
    type = 'available',
    title = null, notes = null,
    recurring_rule = null, recurring_until = null,
  } = req.body || {};

  const errors = validate(req.body || {}, {
    start_time: [rules.required],
    end_time:   [rules.required],
    type:       [rules.required],
    title:      [rules.maxLen(255), rules.noScript],
    notes:      [rules.maxLen(2000), rules.noScript],
    recurring_rule: [rules.maxLen(255)],
  });
  if (errors) return sendError(res, 400, 'Validation failed', 'VALIDATION_ERROR', { fields: errors });

  if (!AVAILABILITY_TYPES.includes(type)) {
    return sendError(res, 400, 'Invalid availability type', 'INVALID_TYPE');
  }

  const start = parseDate(start_time);
  const end = parseDate(end_time);
  if (!start || !end) {
    return sendError(res, 400, 'start_time / end_time must be valid timestamps', 'INVALID_TIME');
  }
  if (end <= start) {
    return sendError(res, 400, 'End time must be after start time', 'INVALID_TIME_RANGE');
  }
  const recurringUntil = parseDate(recurring_until);

  try {
    const r = await pool.query(
      `INSERT INTO availability_blocks
         (helper_id, start_time, end_time, type, title, notes, recurring_rule, recurring_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [helperId, start, end, type, title, notes, recurring_rule, recurringUntil]
    );

    logger.info('Availability block created', {
      helperId, blockId: r.rows[0].id, type,
    });
    return sendSuccess(res, r.rows[0], 201);
  } catch (err) {
    logger.error('Failed to create availability block', { err: err.message, helperId });
    return sendError(res, 500, 'Failed to create availability block', 'INTERNAL_ERROR');
  }
};

// ─── getAvailabilityBlocks (any helper, public-ish) ──────────
exports.getAvailabilityBlocks = async (req, res) => {
  const { helper_id } = req.params;
  if (!isUuid(helper_id)) {
    return sendError(res, 400, 'helper_id must be a valid UUID', 'VALIDATION_ERROR');
  }
  return queryAvailabilityBlocks(res, helper_id, req.query);
};

// ─── getMyAvailabilityBlocks ─────────────────────────────────
exports.getMyAvailabilityBlocks = async (req, res) => {
  return queryAvailabilityBlocks(res, req.user.id, req.query);
};

async function queryAvailabilityBlocks(res, helperId, query) {
  const { type } = query;
  const fromDate = parseDate(query.from_date);
  const toDate = parseDate(query.to_date);
  const limit = clampInt(query.limit, 100, 1, 500);
  const offset = clampInt(query.offset, 0, 0, 100000);

  const conditions = ['helper_id = $1'];
  const params = [helperId];

  if (fromDate) {
    params.push(fromDate);
    conditions.push(`end_time   >= $${params.length}`);
  }
  if (toDate) {
    params.push(toDate);
    conditions.push(`start_time <= $${params.length}`);
  }
  if (type && AVAILABILITY_TYPES.includes(type)) {
    params.push(type);
    conditions.push(`type = $${params.length}`);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  try {
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM availability_blocks ${whereClause}`,
      params
    );
    const total = countRes.rows[0]?.count || 0;

    const dataParams = params.slice();
    dataParams.push(limit);
    dataParams.push(offset);
    const rowsRes = await pool.query(
      `SELECT * FROM availability_blocks
       ${whereClause}
       ORDER BY start_time ASC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    return sendSuccess(res, {
      blocks: rowsRes.rows,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (err) {
    logger.error('Failed to fetch availability blocks', { err: err.message, helperId });
    return sendError(res, 500, 'Failed to fetch availability blocks', 'INTERNAL_ERROR');
  }
}

// ─── updateAvailabilityBlock ─────────────────────────────────
exports.updateAvailabilityBlock = async (req, res) => {
  const { id } = req.params;
  const helperId = req.user.id;
  const {
    start_time, end_time, type,
    title, notes,
    recurring_rule, recurring_until,
  } = req.body || {};

  if (!/^\d+$/.test(String(id))) {
    return sendError(res, 400, 'Invalid block id', 'VALIDATION_ERROR');
  }
  if (type !== undefined && !AVAILABILITY_TYPES.includes(type)) {
    return sendError(res, 400, 'Invalid availability type', 'INVALID_TYPE');
  }
  if (start_time !== undefined && !parseDate(start_time)) {
    return sendError(res, 400, 'Invalid start_time', 'INVALID_TIME');
  }
  if (end_time !== undefined && !parseDate(end_time)) {
    return sendError(res, 400, 'Invalid end_time', 'INVALID_TIME');
  }
  if (start_time && end_time) {
    const s = parseDate(start_time);
    const e = parseDate(end_time);
    if (e <= s) {
      return sendError(res, 400, 'End time must be after start time', 'INVALID_TIME_RANGE');
    }
  }

  try {
    const owned = await pool.query(
      'SELECT 1 FROM availability_blocks WHERE id = $1 AND helper_id = $2',
      [id, helperId]
    );
    if (owned.rows.length === 0) {
      return sendError(res, 404, 'Availability block not found', 'NOT_FOUND');
    }

    const r = await pool.query(
      `UPDATE availability_blocks
          SET start_time      = COALESCE($1::timestamptz, start_time),
              end_time        = COALESCE($2::timestamptz, end_time),
              type            = COALESCE($3, type),
              title           = COALESCE($4, title),
              notes           = COALESCE($5, notes),
              recurring_rule  = COALESCE($6, recurring_rule),
              recurring_until = COALESCE($7::timestamptz, recurring_until),
              updated_at      = now()
        WHERE id = $8 AND helper_id = $9
        RETURNING *`,
      [
        start_time      ?? null,
        end_time        ?? null,
        type            ?? null,
        title           ?? null,
        notes           ?? null,
        recurring_rule  ?? null,
        recurring_until ?? null,
        id, helperId,
      ]
    );

    return sendSuccess(res, r.rows[0]);
  } catch (err) {
    logger.error('Failed to update availability block', { err: err.message, id, helperId });
    return sendError(res, 500, 'Failed to update availability block', 'INTERNAL_ERROR');
  }
};

// ─── deleteAvailabilityBlock ─────────────────────────────────
exports.deleteAvailabilityBlock = async (req, res) => {
  const { id } = req.params;
  const helperId = req.user.id;

  if (!/^\d+$/.test(String(id))) {
    return sendError(res, 400, 'Invalid block id', 'VALIDATION_ERROR');
  }

  try {
    const r = await pool.query(
      'DELETE FROM availability_blocks WHERE id = $1 AND helper_id = $2 RETURNING id',
      [id, helperId]
    );
    if (r.rows.length === 0) {
      return sendError(res, 404, 'Availability block not found', 'NOT_FOUND');
    }
    return sendSuccess(res, { message: 'Availability block deleted' });
  } catch (err) {
    logger.error('Failed to delete availability block', { err: err.message, id, helperId });
    return sendError(res, 500, 'Failed to delete availability block', 'INTERNAL_ERROR');
  }
};

// ─── getNotificationPreferences ──────────────────────────────
exports.getNotificationPreferences = async (req, res) => {
  const userId = req.user.id;
  try {
    let r = await pool.query(
      'SELECT * FROM notification_preferences WHERE user_id = $1',
      [userId]
    );
    if (r.rows.length === 0) {
      // Create default row using DB-level defaults — let Postgres fill them
      r = await pool.query(
        `INSERT INTO notification_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING *`,
        [userId]
      );
      // ON CONFLICT DO NOTHING returns 0 rows when a parallel request inserted first
      if (r.rows.length === 0) {
        r = await pool.query(
          'SELECT * FROM notification_preferences WHERE user_id = $1',
          [userId]
        );
      }
    }
    return sendSuccess(res, r.rows[0]);
  } catch (err) {
    logger.error('Failed to fetch notification preferences', { err: err.message, userId });
    return sendError(res, 500, 'Failed to fetch notification preferences', 'INTERNAL_ERROR');
  }
};

// ─── updateNotificationPreferences ───────────────────────────
exports.updateNotificationPreferences = async (req, res) => {
  const userId = req.user.id;
  const {
    appointment_confirmed_channels,
    appointment_cancelled_channels,
    reminder_24h_channels,
    reminder_2h_channels,
    reminder_same_day_channels,
    quiet_hours_start = null,
    quiet_hours_end = null,
    timezone = null,
  } = req.body || {};

  // Sanitize each channel array (TEXT[] in DB — pg accepts JS arrays directly)
  const confirmed = sanitizeChannelArray(appointment_confirmed_channels);
  const cancelled = sanitizeChannelArray(appointment_cancelled_channels);
  const r24 = sanitizeChannelArray(reminder_24h_channels);
  const r2  = sanitizeChannelArray(reminder_2h_channels);
  const rsd = sanitizeChannelArray(reminder_same_day_channels);

  // Reject obviously bad timezone strings
  if (timezone && (typeof timezone !== 'string' || timezone.length > 50)) {
    return sendError(res, 400, 'Invalid timezone', 'VALIDATION_ERROR');
  }
  if (timezone) {
    try {
      // Throws if timezone is unknown
      // eslint-disable-next-line no-new
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      return sendError(res, 400, 'Unknown timezone identifier', 'VALIDATION_ERROR');
    }
  }

  // Reject obviously bad TIME strings (HH:MM or HH:MM:SS)
  const HHMM = /^\d{1,2}:\d{2}(:\d{2})?$/;
  if (quiet_hours_start && !HHMM.test(String(quiet_hours_start))) {
    return sendError(res, 400, 'Invalid quiet_hours_start (HH:MM)', 'VALIDATION_ERROR');
  }
  if (quiet_hours_end && !HHMM.test(String(quiet_hours_end))) {
    return sendError(res, 400, 'Invalid quiet_hours_end (HH:MM)', 'VALIDATION_ERROR');
  }

  try {
    // Make sure a row exists (DB defaults fill everything)
    await pool.query(
      `INSERT INTO notification_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    const r = await pool.query(
      `UPDATE notification_preferences
          SET appointment_confirmed_channels = COALESCE($1::text[], appointment_confirmed_channels),
              appointment_cancelled_channels = COALESCE($2::text[], appointment_cancelled_channels),
              reminder_24h_channels          = COALESCE($3::text[], reminder_24h_channels),
              reminder_2h_channels           = COALESCE($4::text[], reminder_2h_channels),
              reminder_same_day_channels     = COALESCE($5::text[], reminder_same_day_channels),
              quiet_hours_start              = COALESCE($6::time,    quiet_hours_start),
              quiet_hours_end                = COALESCE($7::time,    quiet_hours_end),
              timezone                       = COALESCE($8,          timezone),
              updated_at                     = now()
        WHERE user_id = $9
        RETURNING *`,
      [
        confirmed, cancelled, r24, r2, rsd,
        quiet_hours_start, quiet_hours_end, timezone,
        userId,
      ]
    );

    logger.info('Notification preferences updated', { userId });
    return sendSuccess(res, r.rows[0]);
  } catch (err) {
    logger.error('Failed to update notification preferences', { err: err.message, userId });
    return sendError(res, 500, 'Failed to update notification preferences', 'INTERNAL_ERROR');
  }
};
