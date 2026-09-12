'use strict';

const db = require('../db');
const logger = require('../utils/logger');

async function recordDirectCalendarAudit({ requestId = null, blockId = null, action, actorId = null, beforeData = {}, afterData = {}, reason = null }) {
  if (!requestId && !blockId) return;
  try {
    await db.query(
      `INSERT INTO direct_calendar_audit_history
         (request_id, block_id, action, actor_id, before_data, after_data, reason, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, NOW())`,
      [requestId, blockId, String(action || 'updated').slice(0, 48), actorId, JSON.stringify(beforeData || {}), JSON.stringify(afterData || {}), reason ? String(reason).slice(0, 500) : null]
    );
  } catch (err) {
    // Auditing must never turn a successful dispatch action into a failed request.
    logger.error('Direct calendar audit write failed', { error: err.message, requestId, blockId, action });
  }
}

module.exports = { recordDirectCalendarAudit };
