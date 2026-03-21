const { ROLES, isInGroup } = require('../constants/roles');

/**
 * Middleware: require user to have one of the specified roles.
 * Accepts role strings or role group names.
 *
 * Usage:
 *   requireRole('super_admin')
 *   requireRole('admin', 'super_admin')
 *   requireRole('helper_pro', 'broker')
 */
module.exports = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const userRole = req.user.role;

  // Direct role match
  const hasRole = allowedRoles.some(r => r === userRole);

  if (!hasRole) {
    return res.status(403).json({
      error:    'Insufficient permissions.',
      required: allowedRoles,
      actual:   userRole,
    });
  }

  next();
};
