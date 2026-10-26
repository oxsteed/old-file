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
          ip_address, user_agent, impersonated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
        // Audit fix (finding 35): attribute impersonated actions to the
        // admin driving them. req.impersonatedBy is stamped by the auth
        // middleware for impersonated sessions (server/middleware/auth.js).
        req.impersonatedBy || null,
      ]
    );
    // F-20: a handler-written entry supersedes the baseline request audit.
    if (req && !entry._baseline) req.auditRecorded = true;
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
 * @param {string} [opts.actionPrefix] filter by action prefix (e.g. 'business.member')
 * @param {string} [opts.actorUserId]
 * @param {string} [opts.from]        ISO timestamp/date, inclusive lower bound on created_at
 * @param {string} [opts.to]          ISO timestamp/date, inclusive upper bound on created_at
 * @returns {Promise<{rows: object[], total: number}>}
 */
function auditStoreClause(opts, params, alias = '') {
  if (opts.locationIds == null) return '';
  params.push(opts.locationIds);
  const locationParam = params.length;
  // Legacy entries without a resolvable store stay visible only to all-store readers.
  return ` AND EXISTS (SELECT 1 FROM restaurant_locations audit_location
    WHERE audit_location.id = ANY($${locationParam}::bigint[])
      AND audit_location.restaurant_id = ${Number(opts.restaurantId) || 0}
      AND audit_location.id::text = COALESCE(${alias}metadata->>'location_id', ${alias}after_state->>'location_id', ${alias}before_state->>'location_id'))`;
}

async function listBusinessAudit(businessId, opts = {}) {
  const limit  = Math.min(Math.max(parseInt(opts.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(opts.offset, 10) || 0, 0);
  const params = [businessId];
  const where  = ['business_id = $1'];

  if (opts.action) {
    params.push(opts.action);
    where.push(`action = $${params.length}`);
  }
  if (opts.actionPrefix) {
    params.push(`${String(opts.actionPrefix).replace(/[%_\\]/g, '')}%`);
    where.push(`action LIKE $${params.length}`);
  }
  if (opts.actorUserId) {
    params.push(opts.actorUserId);
    where.push(`actor_user_id = $${params.length}`);
  }
  if (opts.from) {
    params.push(opts.from);
    if (opts.timezone && /^\d{4}-\d{2}-\d{2}$/.test(opts.from)) {
      const dateParam = params.length; params.push(opts.timezone);
      where.push(`created_at >= ($${dateParam}::date::timestamp AT TIME ZONE $${params.length})`);
    } else where.push(`created_at >= $${params.length}`);
  }
  if (opts.to) {
    params.push(opts.to);
    if (opts.timezone && /^\d{4}-\d{2}-\d{2}$/.test(opts.to)) {
      const dateParam = params.length; params.push(opts.timezone);
      where.push(`created_at < (($${dateParam}::date + 1)::timestamp AT TIME ZONE $${params.length})`);
    } else where.push(`created_at <= $${params.length}`);
  }

  const whereSql = where.join(' AND ') + auditStoreClause(opts, params);
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

/**
 * Distinct actors who appear in a business's audit log, with display
 * names — feeds the Team activity view's person filter (S-16).
 */
async function listBusinessAuditActors(businessId, opts = {}) {
  const params = [businessId];
  const storeClause = auditStoreClause(opts, params, 'bal.');
  const { rows } = await pool.query(
    `SELECT bal.actor_user_id AS user_id,
            COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
                     u.email) AS name,
            COUNT(*)::int AS events
       FROM business_audit_log bal
       LEFT JOIN users u ON u.id = bal.actor_user_id
      WHERE bal.business_id = $1 AND bal.actor_user_id IS NOT NULL${storeClause}
      GROUP BY bal.actor_user_id, name
      ORDER BY events DESC`,
    params
  );
  return rows;
}

module.exports = { logBusinessAction, listBusinessAudit, listBusinessAuditActors };
