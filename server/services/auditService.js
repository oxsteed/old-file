const db = require('../db');
const logger = require('../utils/logger');

/**
 * Log every admin action for compliance and audit.
 */
exports.logAdminAction = async ({
  adminId,
  action,
  targetType = null,
  targetId = null,
  description = null,
  before = null,
  after = null,
  req = null
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
      after ? JSON.stringify(after) : null
    ]);
  } catch (err) {
    logger.error('Audit log error:', err.message);
  }
};
