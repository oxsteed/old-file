'use strict';

const jwt = require('jsonwebtoken');

/**
 * Audit fix: impersonated sessions must not perform money moves.
 * An admin impersonating a user could otherwise initiate transfers,
 * top-ups, withdrawals, holds, or conversions as that user.
 *
 * ADM-040: this middleware is mounted on admin money routes too, where the
 * admin auth middleware (requireAdmin) never sets req.isImpersonated. So
 * detection is self-sufficient: besides honoring req.isImpersonated (set by
 * the user authenticate middleware), it inspects the presented credential
 * for impersonation claims. This runs after authentication, so the token
 * has already been verified by the auth middleware ahead of it in the
 * chain; decoding here is a deny-list check, not an auth decision.
 */
function tokenCarriesImpersonationClaims(token) {
  if (!token || typeof token !== 'string') return false;
  let decoded;
  try {
    decoded = jwt.decode(token);
  } catch {
    return false;
  }
  if (!decoded || typeof decoded !== 'object') return false;
  return Boolean(decoded.impersonation || decoded.impersonated_by || decoded.isImpersonated);
}

function requestPresentsImpersonationToken(req) {
  const header = req.headers && req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    if (tokenCarriesImpersonationClaims(header.slice(7))) return true;
  }
  const cookieHeader = req.headers && req.headers.cookie;
  if (typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/(?:^|;\s*)oxsteed_access=([^;]+)/);
    if (match) {
      let cookieToken = match[1];
      try {
        cookieToken = decodeURIComponent(cookieToken);
      } catch {
        // use raw value
      }
      if (tokenCarriesImpersonationClaims(cookieToken)) return true;
    }
  }
  return false;
}

function isImpersonatedRequest(req) {
  if (req.isImpersonated) return true;
  return requestPresentsImpersonationToken(req);
}

function rejectImpersonated(req, res, next) {
  if (isImpersonatedRequest(req)) {
    return res.status(403).json({
      error: 'Impersonated sessions cannot perform this action.',
      code: 'impersonation_blocked',
    });
  }
  return next();
}

module.exports = { rejectImpersonated, isImpersonatedRequest };
