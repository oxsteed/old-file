'use strict';

/**
 * Audit fix: impersonated sessions must not perform money moves.
 * An admin impersonating a user could otherwise initiate transfers,
 * top-ups, withdrawals, holds, or conversions as that user.
 */
function rejectImpersonated(req, res, next) {
  if (req.isImpersonated) {
    return res.status(403).json({
      error: 'Impersonated sessions cannot perform this action.',
      code: 'impersonation_blocked',
    });
  }
  return next();
}

module.exports = { rejectImpersonated };
