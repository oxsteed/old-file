const db     = require('../db');
const logger = require('../utils/logger');

/**
 * Log every admin action for compliance and audit (general action log).
 *
 * Writes to `admin_audit_log` - the legacy, free-form action log used by
 * existing controllers (permission grants, user bans, etc.). This is kept
 * unchanged for backward compatibility.
 */
exports.logAdminAction = async ({
  adminId,
  action,
  targetType  = null,
  targetId    = null,
  description = null,
  before      = null,
  after       = null,
  req         = null
}) => {
  try {
    await db.query(`
      INSERT INTO admin_audit_log (
        admin_id, action, target_type, target_id,
        description, ip_address, user_agent,
        before_state, after_state
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      adminId,
      action,
      targetType,
      targetId,
      description,
      req ? req.ip : null,
      req ? req.headers['user-agent'] : null,
      before ? JSON.stringify(before) : null,
      after  ? JSON.stringify(after)  : null
    ]);
  } catch (err) {
    logger.error('Failed to log admin action', { adminId, action, error: err.message });
  }
};

/**
 * Log a user-account modification to the dedicated per-field audit table
 * `admin_user_action_log`.
 *
 * Designed for the super-admin / regional-admin user management workflow
 * where every field change (email, password, tier, etc.) needs structured
 * before/after capture for compliance and export.
 *
 * Pass an existing `client` when running inside a transaction; otherwise
 * the shared `db` pool is used. Errors are swallowed and logged - audit
 * failures must never break the main action.
 *
 * @param {Object}   options
 * @param {Object}   [options.client]         pg client (for transactional logging)
 * @param {string}   options.adminId          UUID of admin performing the action
 * @param {string}   options.targetUserId     UUID of user being modified
 * @param {string}   options.actionType       e.g. 'create_user', 'edit_email'
 * @param {string}   [options.fieldName]      Field name for edits
 * @param {string}   [options.oldValue]       Previous value (redacted if sensitive)
 * @param {string}   [options.newValue]       New value (redacted if sensitive)
 * @param {string}   [options.ipAddress]
 * @param {number}   [options.regionId]
 * @param {string}   [options.notes]
 * @returns {Promise<{ id: number, created_at: Date } | null>}
 */
exports.logUserAction = async ({
  client     = null,
  adminId,
  targetUserId,
  actionType,
  fieldName  = null,
  oldValue   = null,
  newValue   = null,
  ipAddress  = null,
  regionId   = null,
  notes      = null
}) => {
  const runner = client || db;
  try {
    const { rows } = await runner.query(`
      INSERT INTO admin_user_action_log (
        admin_id, target_user_id, action_type, field_name,
        old_value, new_value, ip_address, region_id, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, created_at
    `, [
      adminId,
      targetUserId,
      actionType,
      fieldName,
      oldValue == null ? null : String(oldValue),
      newValue == null ? null : String(newValue),
      ipAddress,
      regionId,
      notes
    ]);
    return rows[0];
  } catch (err) {
    logger.error('Failed to log user action', {
      adminId, targetUserId, actionType, error: err.message
    });
    return null;
  }
};

/**
 * Mark recent log rows for an (admin, target) pair as notified, attaching
 * the notification ID. Called after a user notification is dispatched in
 * response to one or more edits.
 */
exports.markUserActionsNotified = async ({
  client = null,
  adminId,
  targetUserId,
  notificationId,
  withinSeconds = 30
}) => {
  const runner = client || db;
  try {
    await runner.query(`
      UPDATE admin_user_action_log
         SET user_notified   = TRUE,
             notification_id = $1
       WHERE admin_id        = $2
         AND target_user_id  = $3
         AND created_at > NOW() - ($4 || ' seconds')::interval
         AND user_notified   = FALSE
    `, [notificationId, adminId, targetUserId, String(withinSeconds)]);
  } catch (err) {
    logger.error('Failed to mark user actions as notified', {
      adminId, targetUserId, notificationId, error: err.message
    });
  }
};

/**
 * Query the user-action audit log with filters.
 *
 * @param {Object} filters
 * @param {string} [filters.adminId]
 * @param {string} [filters.targetUserId]
 * @param {string} [filters.actionType]
 * @param {number} [filters.regionId]
 * @param {string} [filters.fromDate]   ISO timestamp
 * @param {string} [filters.toDate]     ISO timestamp
 * @param {number} [filters.limit=100]
 * @param {number} [filters.offset=0]
 * @returns {Promise<{ rows: Array, total: number }>}
 */
exports.getUserActionLogs = async ({
  adminId      = null,
  targetUserId = null,
  actionType   = null,
  regionId     = null,
  fromDate     = null,
  toDate       = null,
  limit        = 100,
  offset       = 0
} = {}) => {
  const conditions = [];
  const values     = [];
  let p = 1;

  if (adminId)      { conditions.push(`l.admin_id = $${p++}`);        values.push(adminId); }
  if (targetUserId) { conditions.push(`l.target_user_id = $${p++}`);  values.push(targetUserId); }
  if (actionType)   { conditions.push(`l.action_type = $${p++}`);     values.push(actionType); }
  if (regionId)     { conditions.push(`l.region_id = $${p++}`);       values.push(regionId); }
  if (fromDate)     { conditions.push(`l.created_at >= $${p++}`);     values.push(fromDate); }
  if (toDate)       { conditions.push(`l.created_at <= $${p++}`);     values.push(toDate); }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const limitN  = Math.min(Math.max(1, parseInt(limit, 10)  || 100), 500);
  const offsetN = Math.max(0, parseInt(offset, 10) || 0);

  const dataSql = `
    SELECT
      l.id, l.admin_id, l.target_user_id, l.action_type, l.field_name,
      l.old_value, l.new_value, l.notes, l.ip_address, l.region_id,
      l.user_notified, l.notification_id, l.created_at,
      a.first_name || ' ' || a.last_name AS admin_name,
      a.email                            AS admin_email,
      t.first_name || ' ' || t.last_name AS target_name,
      t.email                            AS target_email,
      r.name                             AS region_name
    FROM admin_user_action_log l
    JOIN users a ON a.id = l.admin_id
    JOIN users t ON t.id = l.target_user_id
    LEFT JOIN admin_regions r ON r.id = l.region_id
    ${whereSql}
    ORDER BY l.created_at DESC
    LIMIT $${p++} OFFSET $${p++}
  `;

  const countSql = `SELECT COUNT(*)::int AS c FROM admin_user_action_log l ${whereSql}`;

  try {
    const [dataRes, countRes] = await Promise.all([
      db.query(dataSql, [...values, limitN, offsetN]),
      db.query(countSql, values),
    ]);
    return { rows: dataRes.rows, total: countRes.rows[0]?.c || 0 };
  } catch (err) {
    logger.error('getUserActionLogs error', { error: err.message });
    throw err;
  }
};
