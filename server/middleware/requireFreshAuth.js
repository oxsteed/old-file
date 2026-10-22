'use strict';

/**
 * Fresh-auth (step-up) middleware for money-critical logistics actions.
 *
 * The existing step-up in this codebase (requireDg1StepUp) only checks that
 * TOTP is ENABLED. Refund approvals need recency: the approver must have
 * completed a TOTP verification within FRESH_AUTH_TTL_MINUTES. Step-up
 * events are recorded in logistics_fresh_auth_events by
 * POST /api/admin/logistics/refunds/stepup/verify.
 *
 * On success sets req.freshAuth = { completedAt, authHash, method }.
 * The approve service records freshAuth.authHash on the decision row and
 * freshAuth.completedAt as the case's fresh_auth_at.
 */

const pool = require('../db');
const { FRESH_AUTH_TTL_MINUTES } = require('../services/logisticsRefundService');

async function latestFreshAuthEvent(userId, purpose) {
  const { rows } = await pool.query(
    `SELECT completed_at, auth_hash, method
       FROM logistics_fresh_auth_events
      WHERE user_id = $1
        AND purpose = $2
        AND completed_at > NOW() - ($3 || ' minutes')::interval
      ORDER BY completed_at DESC
      LIMIT 1`,
    [userId, purpose, String(FRESH_AUTH_TTL_MINUTES)]
  );
  const r = rows[0];
  if (!r) return null;
  return { completedAt: r.completed_at, authHash: r.auth_hash, method: r.method };
}

/**
 * requireFreshAuth(purpose) — rejects with 401 fresh_auth_required when the
 * user has no step-up event inside the TTL window.
 *
 * The returned middleware is named (requireFreshAuthMiddleware) so route
 * wiring tests can assert its presence on guarded routes.
 */
function requireFreshAuth(purpose = 'logistics_refund_approve') {
  async function requireFreshAuthMiddleware(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'Authentication required', code: 'auth_required' });
      }
      const event = await latestFreshAuthEvent(req.user.id, purpose);
      if (!event) {
        return res.status(401).json({
          error: `Fresh authentication required. Complete TOTP step-up within the last ${FRESH_AUTH_TTL_MINUTES} minutes.`,
          code: 'fresh_auth_required',
        });
      }
      req.freshAuth = event;
      return next();
    } catch (err) {
      return res.status(500).json({ error: 'Fresh-auth check failed' });
    }
  }
  return requireFreshAuthMiddleware;
}

module.exports = { requireFreshAuth, latestFreshAuthEvent, FRESH_AUTH_TTL_MINUTES };
