'use strict';

/**
 * server/services/businessAuditLog.js
 *
 * Fire-and-forget per-business audit logger. Wraps an INSERT into
 * business_audit_log. Failures are logged but never thrown — audit must
 * not block business operations.
 *
 * Usage (from a controller, after requireBusinessAccess has populated req):
 *
 *   const { logBusinessAction } = require('../services/businessAuditLog');
 *   await logBusinessAction(req, {
 *     action:      'invoice.updated',
 *     target_type: 'invoice',
 *     target_id:   invoice.id,
 *     before_state: prev,
 *     after_state:  next,
 *   });
 *
 * Standard action namespaces (lowercase, dot-separated):
 *   business.profile.updated
 *   business.member.invited / .accepted / .revoked / .role_changed
 *   business.service.created / .updated / .deleted
 *   business.product.created / .updated / .deleted / .stock_changed
 *   business.pricing_rule.created / .updated / .deleted / .toggled
 *   business.appointment.confirmed / .declined / .cancelled / .rescheduled
 *   business.conversation.assigned / .released / .archived
 *   business.invoice.created / .sent / .marked_paid / .deleted
 */

const pool = require('../db');
const logger = require('../utils/logger');

function pickIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || (req.connection && req.connection.remoteAddress) || null;
}

/**
 * Log an action. Will never throw.
 *
 * @param {import('express').Request} req
 * @param {object} entry
 * @param {string} entry.action       - Required, snake/dot-cased.
 * @param {string} [entry.target_type]
 * @param {string|number} [entry.target_id]
 * @param {object} [entry.before_state]
 * @param {object} [entry.after_state]
 * @param {object} [entry.metadata]
 * @param {number} [entry.business_id] - Falls back to req.business.id
 * @param {string} [entry.actor_role]  - Falls back to req.businessRole
 */
async function logBusinessAction(req, entry) {
  try {
    if (!entry || !entry.action) return;
    const businessId = entry.business_id || (req.business && req.business.id);
    if (!businessId) return;

    const actorUserId = req.user && req.user.id ? req.user.id : null;
    const actorRole = entry.actor_role || req.businessRole || null;
    const ua = req.headers && req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 500) : null;

    const runner = entry.client || pool;
    await runner.query(
      `INSERT INTO business_audit_log
         (business_id, actor_user_id, actor_role, action,
          target_type, target_id, before_state, after_state, metadata,
          ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        businessId,
        actorUserId,
        actorRole,
        String(entry.action).slice(0, 80),
        entry.target_type ? String(entry.target_type).slice(0, 60) : null,
        entry.target_id != null ? String(entry.target_id).slice(0, 120) : null,
        entry.before_state ? JSON.stringify(entry.before_state) : null,
        entry.after_state  ? JSON.stringify(entry.after_state)  : null,
        entry.metadata     ? JSON.stringify(entry.metadata)     : null,
        pickIp(req),
        ua,
      ]
    );
  } catch (err) {
    // Audit must never break the request.
    logger.warn('business_audit_log insert failed', {
      err: err && err.message,
      action: entry && entry.action,
    });
    if (entry && entry.throwOnError) throw err;
  }
}

/**
 * Fetch recent audit entries for a business. Used by the workspace activity tab.
 *
 * @param {number} businessId
 * @param {object} [opts]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @param {string} [opts.action]      filter by exact action
 * @param {string} [opts.actorUserId]
 * @returns {Promise<{rows: object[], total: number}>}
 */
async function listBusinessAudit(businessId, opts = {}) {
  const limit  = Math.min(Math.max(parseInt(opts.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(opts.offset, 10) || 0, 0);
  const params = [businessId];
  const where  = ['business_id = $1'];

  if (opts.action) {
    params.push(opts.action);
    where.push(`action = $${params.length}`);
  }
  if (opts.actorUserId) {
    params.push(opts.actorUserId);
    where.push(`actor_user_id = $${params.length}`);
  }

  const whereSql = where.join(' AND ');
  const { rows } = await pool.query(
    `SELECT id, business_id, actor_user_id, actor_role, action,
            target_type, target_id, before_state, after_state, metadata,
            created_at
     FROM business_audit_log
     WHERE ${whereSql}
     ORDER BY created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM business_audit_log WHERE ${whereSql}`,
    params
  );
  return { rows, total: countRows[0] ? countRows[0].n : 0 };
}

module.exports = { logBusinessAction, listBusinessAudit };
