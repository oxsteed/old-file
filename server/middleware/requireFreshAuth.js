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
 * Domain 6 finding 2 (2026-11-13): events are SINGLE-USE. One TOTP proof
 * used to authorize unlimited same-purpose actions for the whole TTL
 * window (including multiple super-admin password-sets). latestFreshAuthEvent
 * now consumes the event atomically on first use: it selects the latest
 * unconsumed event in the window and stamps consumed_at in the same
 * statement, so a second use (or a concurrent replay) finds nothing and
 * fails closed with 401 fresh_auth_required. A proof spent on a request
 * whose handler then fails is still spent, exactly like a consumed
 * step-up challenge: the proof authorizes one guarded action, not one
 * successful one.
 *
 * No consumer relies on reuse: every guarded route (password-set,
 * impersonation start, refund approve, purchase-order approve) calls the
 * middleware exactly once per request, and the approve service only
 * re-checks the returned event's recency in memory.
 *
 * On success sets req.freshAuth = { completedAt, authHash, method }.
 * The approve service records freshAuth.authHash on the decision row and
 * freshAuth.completedAt as the case's fresh_auth_at.
 */

const pool = require('../db');
const { FRESH_AUTH_TTL_MINUTES } = require('../services/logisticsRefundService');

async function latestFreshAuthEvent(userId, purpose) {
  const { rows } = await pool.query(
    `WITH candidate AS (
       SELECT id
         FROM logistics_fresh_auth_events
        WHERE user_id = $1
          AND purpose = $2
          AND completed_at > NOW() - ($3 || ' minutes')::interval
          AND consumed_at IS NULL
        ORDER BY completed_at DESC
        LIMIT 1
     )
     UPDATE logistics_fresh_auth_events e
        SET consumed_at = NOW()
       FROM candidate c
      WHERE e.id = c.id
        AND e.consumed_at IS NULL
      RETURNING e.completed_at, e.auth_hash, e.method`,
    [userId, purpose, String(FRESH_AUTH_TTL_MINUTES)]
  );
  const r = rows[0];
  if (!r) return null;
  return { completedAt: r.completed_at, authHash: r.auth_hash, method: r.method };
}

/**
 * requireFreshAuth(purpose) — rejects with 401 fresh_auth_required when the
 * user has no unconsumed step-up event inside the TTL window.
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
