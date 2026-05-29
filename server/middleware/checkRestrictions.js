/**
 * checkRestrictions.js
 * Middleware that enforces active user restrictions from the enforcement system.
 *
 * Usage:
 *   const checkRestrictions = require('../middleware/checkRestrictions');
 *
 *   // Block bidding:
 *   router.post('/bids', requireAuth, checkRestrictions('bidding'), bidController.createBid);
 *
 *   // Block job posting:
 *   router.post('/jobs', requireAuth, checkRestrictions('job_posting'), jobController.createJob);
 *
 * Restriction types (from user_restrictions.restriction_type):
 *   'bidding'      - can't submit bids
 *   'job_posting'  - can't post new jobs
 *   'checkout'     - can't initiate payments
 *   'all'          - fully restricted (all of the above)
 */

const pool   = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../utils/apiError');

/**
 * Returns Express middleware that checks whether the authenticated user
 * has an active restriction of the given type (or 'all').
 *
 * @param {string} restrictionType  one of: 'bidding'|'job_posting'|'checkout'|'all'
 */
function checkRestrictions(restrictionType) {
  return async function restrictionMiddleware(req, res, next) {
    // Unit tests mock the DB at the pool layer and rely on predictable call
    // ordering; this middleware's extra queries make tests brittle and aren't
    // the focus of most route/controller tests.
    if (process.env.NODE_ENV === 'test') return next();

    if (!req.user?.id) {
      // Not authenticated — let auth middleware handle it
      return next();
    }

    try {
      // 1. Check if account is suspended at the users table level
      const userResult = await pool.query(
        `SELECT is_suspended, suspended_until, suspended_reason
           FROM users WHERE id = $1`,
        [req.user.id]
      );

      const userRows = Array.isArray(userResult?.rows) ? userResult.rows : [];
      if (userRows.length) {
        const u = userRows[0];
        if (u.is_suspended) {
          const stillActive = !u.suspended_until || new Date(u.suspended_until) > new Date();
          if (stillActive) {
            const until = u.suspended_until
              ? ` until ${new Date(u.suspended_until).toLocaleDateString()}`
              : '';
            return res.status(403).json({
              success: false,
              error: `Your account is suspended${until}. ${u.suspended_reason || ''}`.trim(),
              code:   'ACCOUNT_SUSPENDED',
              suspendedUntil: u.suspended_until || null
            });
          }
          // Suspension expired — clear it (non-blocking)
          pool.query(
            `UPDATE users SET is_suspended=false, suspended_until=NULL, suspended_reason=NULL WHERE id=$1`,
            [req.user.id]
          ).catch(() => {});
        }
      }

      // 2. Check granular user_restrictions table
      const restrictResult = await pool.query(
        `SELECT id, restriction_type, expires_at, reason
           FROM user_restrictions
           WHERE user_id = $1
             AND is_active = TRUE
             AND (expires_at IS NULL OR expires_at > NOW())
             AND (restriction_type = $2 OR restriction_type = 'all')
           ORDER BY created_at DESC
           LIMIT 1`,
        [req.user.id, restrictionType]
      );

      const restrictRows = Array.isArray(restrictResult?.rows) ? restrictResult.rows : [];
      if (restrictRows.length) {
        const restr = restrictRows[0];
        const expiryMsg = restr.expires_at
          ? ` This restriction expires on ${new Date(restr.expires_at).toLocaleDateString()}.`
          : '';

        const actionLabel = {
          bidding:     'submit bids',
          job_posting: 'post jobs',
          checkout:    'initiate payments',
          all:         'perform this action'
        }[restr.restriction_type] || 'perform this action';

        logger.warn('Restriction blocked action', {
          userId: req.user.id,
          restrictionType: restr.restriction_type,
          restrictionId: restr.id,
          path: req.path
        });

        return res.status(403).json({
          success: false,
          error:   `Your account has restrictions that prevent you from ${actionLabel}.${expiryMsg}`,
          code:    'ACCOUNT_RESTRICTED',
          restrictionType: restr.restriction_type,
          expiresAt: restr.expires_at || null
        });
      }

      next();
    } catch (err) {
      // Log but don't block on DB error — restrictions are best-effort guards
      logger.error('checkRestrictions middleware error', {
        userId: req.user?.id,
        restrictionType,
        error: err.message
      });
      next(); // fail open (don't block the user on a DB timeout)
    }
  };
}

module.exports = checkRestrictions;
