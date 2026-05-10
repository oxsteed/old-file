// Phase  2 - Authentication & authorization middleware
// OxSteed v2

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const pool   = require('../db');
const logger = require('../utils/logger');
const tokenRevocationService = require('../services/tokenRevocationService');
const { isDiditIdentitySatisfied } = require('../utils/diditGate');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = process.env.REFRESH_EXPIRES_IN || '7d';

function generateTokens(user) {
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' }
  );
  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_EXPIRES_IN, algorithm: 'HS256' }
  );
  return { accessToken, refreshToken };
}

/**
 * Derive onboarding_step from DB flags - mirrors formatAuthUser() in authController.
 * Order matters: most-complete wins.
 */
function computeOnboardingStep(user) {
  if (!user) return 'registered';

  if (user.onboarding_completed || user.onboarding_status === 'onboarding_complete') {
    return 'active';
  }
  if (user.w9_completed || user.terms_accepted) {
    return 'tax_complete';
  }
  if (user.tier_selected) {
    return 'plan_selected';
  }
  if (user.profile_completed) {
    return 'profile_complete';
  }
  // Helper users are created only after OTP → always email_verified
  if (user.email_verified) {
    return 'email_verified';
  }
  return 'registered';
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

    // Reject MFA tokens - they can only be used on the 2FA endpoint
    if (decoded.isMfaToken) {
      return res.status(401).json({ error: 'MFA token cannot be used for API access' });
    }
    if (decoded.type === 'refresh') {
      return res.status(401).json({ error: 'Refresh token cannot be used for API access' });
    }

    // Impersonation tokens: skip standard revocation check (they are short-lived
    // and tracked separately in user_impersonation_log). Flag the request so
    // downstream handlers can audit impersonated actions.
    if (decoded.impersonation) {
      req.isImpersonated   = true;
      req.impersonatedBy   = decoded.impersonated_by;
      req.impersonationJti = decoded.jti;
    } else {
      // Check if token has been revoked. Pass `iat` so user-level revocation
      // (set on logout) only invalidates tokens issued BEFORE the logout moment.
      const tokenId  = crypto.createHash('sha256').update(token).digest('hex');
      const isRevoked = await tokenRevocationService.isRevoked(tokenId, decoded.id, decoded.iat);
      if (isRevoked) {
        return res.status(401).json({ error: 'Token has been revoked' });
      }
    }

    const { rows } = await pool.query(
      `SELECT
         u.id, u.first_name, u.last_name, u.email, u.phone, u.role,
         u.email_verified, u.is_verified,
         u.onboarding_status, u.onboarding_completed,
         u.contact_completed, u.profile_completed,
         u.tier_selected, u.w9_completed, u.terms_accepted,
         u.membership_tier, u.id_verified, u.background_check_passed,
         u.city, u.state, u.zip_code,
         u.display_name_preference, u.is_active,
         u.didit_status, u.didit_verified_at,
         COALESCE(u.didit_enforcement_required, FALSE) AS didit_enforcement_required,
         u.trial_started_at, u.trial_ends_at,
         b.business_name,
         hp.is_listed,
         COALESCE(hp.allow_guest_contact, TRUE) AS allow_guest_contact
       FROM users u
       LEFT JOIN businesses b ON b.user_id = u.id AND b.is_primary = TRUE
       LEFT JOIN helper_profiles hp ON hp.user_id = u.id
       WHERE u.id = $1`,
      [decoded.id]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists' });
    }
        if (!user.is_active) {
      return res.status(403).json({ error: 'Account suspended' });
    }

    // Compute consistent onboarding_step matching authController.formatAuthUser
    user.onboarding_step = computeOnboardingStep(user);

    // Identity (Didit): block API access when email is verified but identity gate not met
    const DIDIT_EXEMPT_PATH_PREFIXES = [
      '/api/auth/',
      '/api/didit/',
      '/api/consent',
      '/api/privacy',
      '/api/geo',
      '/api/support',
    ];
    const fullPath = `${req.baseUrl || ''}${req.path || ''}` || req.originalUrl?.split('?')[0] || '';
    const isDiditExempt =
      DIDIT_EXEMPT_PATH_PREFIXES.some((p) => fullPath.startsWith(p)) ||
      fullPath.startsWith('/api/webhooks');
    if (
      user.email_verified &&
      !isDiditIdentitySatisfied(user) &&
      !isDiditExempt
    ) {
      return res.status(403).json({
        error: 'identity_verification_required',
        code: 'DIDIT_REQUIRED',
        didit_status: user.didit_status || 'pending',
        didit_enforcement_required: !!user.didit_enforcement_required,
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Check tier from helper_profiles table (not JWT)
function requireTier(...tiers) {
  return async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        'SELECT tier FROM helper_profiles WHERE user_id = $1',
        [req.user.id]
      );
      if (!rows[0] || !tiers.includes(rows[0].tier)) {
        return res.status(403).json({ error: 'Subscription tier required', requiredTiers: tiers });
      }
      next();
    } catch (err) {
      logger.error('requireTier error', { message: err.message });
      return res.status(500).json({ error: 'Failed to check tier' });
    }
  };
}

// Check active subscription from subscriptions table
async function requireActiveSubscription(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT s.status, s.current_period_end
       FROM subscriptions s
       WHERE s.user_id = $1 AND s.status = 'active'
       ORDER BY s.created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!rows[0]) {
      return res.status(403).json({ error: 'Active subscription required' });
    }
    if (rows[0].current_period_end && new Date(rows[0].current_period_end) < new Date()) {
      return res.status(403).json({ error: 'Subscription expired' });
    }
    next();
  } catch (err) {
    logger.error('requireActiveSubscription error', { message: err.message });
    return res.status(500).json({ error: 'Failed to check subscription' });
  }
}

/**
 * Optional authentication middleware
 * Tries to authenticate via Bearer token, but continues without req.user if token is missing/invalid
 * Allows endpoints to serve both authenticated and unauthenticated requests
 */
const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.isMfaToken || decoded.type === 'refresh') return next();

    if (!decoded.impersonation) {
      const tokenId = crypto.createHash('sha256').update(token).digest('hex');
      const isRevoked = await tokenRevocationService.isRevoked(tokenId, decoded.id, decoded.iat);
      if (isRevoked) return next();
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.is_active
         FROM users u WHERE u.id = $1`,
      [decoded.id]
    );
    const user = rows[0];
    if (user && user.is_active) req.user = user;
  } catch {
    // Expired, invalid, or DB error - continue as unauthenticated
  }
  next();
};

module.exports = {
  generateTokens,
  authenticate,
  requireAuth: authenticate,
  optionalAuth,
  requireRole,
  requireTier,
  requireActiveSubscription,
};
