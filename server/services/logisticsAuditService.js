'use strict';
const pool = require('../db');
const logger = require('../utils/logger');

/**
 * Fire-and-forget audit log writer for the logistics branch.
 * Never throws — if it fails, it logs the error and moves on.
 */
async function logLogisticsAction(
  entityType,
  entityId,
  action,
  { actorUserId = null, beforeState = null, afterState = null, notes = null, ipAddress = null } = {}
) {
  try {
    await pool.query(
      `INSERT INTO logistics_audit_log
         (entity_type, entity_id, action, actor_user_id, before_state, after_state, notes, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        entityType,
        entityId,
        action,
        actorUserId,
        beforeState ? JSON.stringify(beforeState) : null,
        afterState  ? JSON.stringify(afterState)  : null,
        notes,
        ipAddress,
      ]
    );
  } catch (err) {
    logger.error('logisticsAuditService: write failed', { err: err.message, entityType, entityId, action });
  }
}

/**
 * List audit entries for a given entity.
 */
async function listLogisticsAudit(entityType, entityId, { limit = 50, offset = 0 } = {}) {
  const result = await pool.query(
    `SELECT la.*, u.first_name || ' ' || u.last_name AS actor_name
     FROM logistics_audit_log la
     LEFT JOIN users u ON u.id = la.actor_user_id
     WHERE la.entity_type = $1 AND la.entity_id = $2
     ORDER BY la.created_at DESC
     LIMIT $3 OFFSET $4`,
    [entityType, entityId, Math.min(limit, 200), offset]
  );
  return result.rows;
}

module.exports = { logLogisticsAction, listLogisticsAudit };
