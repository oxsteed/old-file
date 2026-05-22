// server/middleware/requirePlatformApproval.js
//
// Express middleware factory that gates a route behind the platform-approval
// system. Use like:
//
//   const requirePlatformApproval = require('../middleware/requirePlatformApproval');
//   router.post('/.../accept',
//     authenticate,
//     requirePlatformApproval('consultant', 'accept_paying_booking'),
//     handler,
//   );
//
// Must run AFTER `authenticate` so req.user is populated.
//
// If the user can perform the action, the middleware calls next(). If not,
// it returns 403 with a structured body the frontend uses to open the
// PlatformApprovalModal:
//
//   {
//     error: 'platform_approval_required',
//     mode, action, current_status,
//     policy: { auto_approve, application_schema, ... }
//   }
//
// Fails open on internal errors — a flaky service should never lock every
// user out of every gated action. Logs but doesn't 5xx.

'use strict';

const svc = require('../services/modePlatformApprovalService');
const logger = require('../utils/logger');

function requirePlatformApproval(mode, action) {
  if (!mode || !action) {
    throw new Error('requirePlatformApproval(mode, action) — both args required');
  }
  return async function platformApprovalGate(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'auth_required' });
      }
      // Admins / super-admins bypass — they don't get gated on platform
      // approvals (they're the ones reviewing).
      if (['admin', 'super_admin'].includes(req.user.role)) return next();

      const check = await svc.canPerformAction(req.user.id, mode, action);
      if (check.allowed) return next();

      return res.status(403).json({
        error: 'platform_approval_required',
        mode,
        action,
        current_status: check.current_status,
        policy: check.policy,
      });
    } catch (err) {
      // Fail open with logging. A broken approval service should never
      // 5xx every consultant booking attempt.
      logger.error('Platform approval gate error (failing open)', {
        err: err.message, mode, action, userId: req.user?.id,
      });
      return next();
    }
  };
}

module.exports = requirePlatformApproval;
