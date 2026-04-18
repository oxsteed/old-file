const logger = require('../utils/logger');

/**
 * Middleware to enforce email verification for sensitive operations
 *
 * Many operations (posting jobs, bidding, becoming a helper) require email
 * verification to prevent spam, abuse, and low-quality accounts.
 *
 * Usage:
 *   router.post('/jobs', authenticate, requireEmailVerified, createJob);
 *
 * Returns 403 if user's email is not verified.
 */
function requireEmailVerified(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!req.user.email_verified) {
    logger.warn('Email verification required', {
      userId: req.user.id,
      action: `${req.method} ${req.path}`,
    });
    return res.status(403).json({
      error: 'email_not_verified',
      message: 'Please verify your email address to perform this action',
      userEmail: req.user.email,
    });
  }

  next();
}

module.exports = requireEmailVerified;
