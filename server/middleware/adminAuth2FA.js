// FIX #12: Admin 2FA Enforcement Middleware
// Ensure all admin/super_admin accounts have TOTP 2FA enabled

const logger = require('../utils/logger');
const { AppError } = require('./errorHandler');

/**
 * Middleware to enforce 2FA for admin accounts
 * If an admin tries to access sensitive endpoints without 2FA enabled,
 * they are redirected to set it up immediately.
 *
 * This prevents privilege escalation if admin credentials are compromised
 * by adding a second verification factor.
 */
function requireAdmin2FA(req, res, next) {
  // Skip if not authenticated or not an admin
  if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
    return next();
  }

  // Check if admin has 2FA enabled
  if (!req.user.totp_enabled) {
    // Admin MUST set up 2FA before accessing admin endpoints
    return next(
      new AppError(
        'Two-factor authentication is required for admin accounts',
        403,
        'admin_2fa_required',
        { redirect: '/admin/2fa-setup' }
      )
    );
  }

  next();
}

module.exports = {
  requireAdmin2FA
};
