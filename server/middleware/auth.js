// Phase  2 - Authentication & authorization middleware
// OxSteed v2

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const pool   = require('../db');
const logger = require('../utils/logger');
const tokenRevocationService = require('../services/tokenRevocationService');
const { isDiditIdentitySatisfied } = require('../utils/diditGate');
const { getEffectiveTier, hasProAccess } = require('../utils/trial');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = process.env.REFRESH_EXPIRES_IN || '7d';

function generateTokens(user, extraClaims = {}) {
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role, ...extraClaims },
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
  // Audit fix: accept the access token from the httpOnly cookie first,
  // falling back to the Authorization header for backward compat.
  // The cookie is not accessible to JavaScript, closing the XSS vector.
  let cookieToken = null;
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)oxsteed_access=([^;]+)/);
    if (match) {
      try {
        cookieToken = decodeURIComponent(match[1]);
      } catch {
        cookieToken = match[1];
      }
    }
  }
  const token = cookieToken
    || (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : null);
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

    // Reject MFA tokens - they can only be used on the 2FA endpoint
    if (decoded.isMfaToken) {
      return res.status(401).json({ error: 'MFA token cannot be used for API access' });
    }
    if (decoded.type === 'refresh') {
      return res.status(401).json({ error: 'Refresh token cannot be used for API access' });
    }

    // Impersonation tokens: skip the standard revocation check (they are
    // short-lived and tracked separately in user_impersonation_log), but
    // honor explicit session termination via endImpersonation, which records
    // the jti in the revocation store. Flag the request so downstream
    // handlers can audit impersonated actions.
    if (decoded.impersonation) {
      const sessionRevoked = await tokenRevocationService.isImpersonationSessionRevoked(decoded.jti);
      if (sessionRevoked) {
        return res.status(401).json({ error: 'Impersonation session has ended' });
      }
      // Audit fix: also check ended_at in the database. The revocation
      // service is a cache; the database is the source of truth. If the
      // session was ended but the revocation didn't propagate, deny.
      const { rows: [session] } = await db.query(
        `SELECT ended_at FROM user_impersonation_log WHERE token_jti = $1 LIMIT 1`,
        [decoded.jti]
      ).catch(() => ({ rows: [] }));
      if (session?.ended_at) {
        return res.status(401).json({ error: 'Impersonation session has ended' });
      }
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
         u.address_line1, u.address_line2, u.city, u.state, u.zip_code, u.country,
         u.bio, u.profile_photo_url,
         u.preferred_language,
         u.display_name_preference, u.is_active,
         u.didit_status, u.didit_verified_at,
         COALESCE(u.didit_enforcement_required, FALSE) AS didit_enforcement_required,
         u.trial_started_at, u.trial_ends_at,
         u.default_mode, u.logistics_role,
         b.business_name,
         hp.is_listed,
         COALESCE(hp.allow_guest_contact, TRUE) AS allow_guest_contact,
         COALESCE(hp.allow_booking, TRUE) AS allow_booking,
         COALESCE(hp.allow_scheduling, TRUE) AS allow_scheduling,
         COALESCE(hp.allow_live_chat, TRUE) AS allow_live_chat,
         ca.stripe_account_id AS connect_stripe_account_id,
         ca.charges_enabled AS connect_charges_enabled,
         ca.payouts_enabled AS connect_payouts_enabled,
         ca.onboarding_complete AS connect_onboarding_complete
       FROM users u
       LEFT JOIN businesses b ON b.user_id = u.id AND b.is_primary = TRUE
       LEFT JOIN helper_profiles hp ON hp.user_id = u.id
       LEFT JOIN connect_accounts ca ON ca.user_id = u.id
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
    user.internal_access_route = decoded.internalAccessRoute || null;
    user.internal_access_id = decoded.internalAccessId || null;
    user.stripe_account_id = user.connect_stripe_account_id || null;
    user.stripe_charges_enabled = !!user.connect_charges_enabled;
    user.stripe_payouts_enabled = !!user.connect_payouts_enabled;
    user.stripe_connect_ready = !!user.connect_charges_enabled;
    user.stripe_connect_onboarded = !!user.connect_onboarding_complete;

    // Identity (Didit): block API access when email is verified but identity gate not met
    const DIDIT_EXEMPT_PATH_PREFIXES = [
      '/api/auth/',
      '/api/didit/',
      '/api/consent',
      '/api/privacy',
      '/api/geo',
      '/api/support',
      '/api/mobile/profile',
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
    req.isAdmin = ['admin', 'super_admin'].includes(user.role);
    req.isSuperAdmin = user.role === 'super_admin';
    next();
  } catch (err) {
    if (err?.code === 'token_revocation_unavailable') {
      logger.error('Authentication unavailable: token revocation check failed', { error: err.message });
      return res.status(503).json({
        error: 'Authentication temporarily unavailable',
        code: 'token_revocation_unavailable',
        retryable: true,
      });
    }
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

// Check the caller's effective tier, including a live first-year Pro trial.
function requireTier(...tiers) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    try {
      const effectiveTier = getEffectiveTier(req.user);
      const acceptsProTrial = tiers.some((tier) => ['pro', 'tier2'].includes(tier))
        && hasProAccess(req.user);
      if (!tiers.includes(effectiveTier) && !acceptsProTrial) {
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
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (hasProAccess(req.user)) {
    return next();
  }
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

    if (decoded.impersonation) {
      // Ended impersonation sessions must not authenticate, even optionally.
      if (await tokenRevocationService.isImpersonationSessionRevoked(decoded.jti)) return next();
    } else {
      const tokenId = crypto.createHash('sha256').update(token).digest('hex');
      const isRevoked = await tokenRevocationService.isRevoked(tokenId, decoded.id, decoded.iat);
      if (isRevoked) return next();
    }

    const { rows } = await pool.query(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.is_active,
                u.default_mode, u.logistics_role, u.preferred_language
         FROM users u WHERE u.id = $1`,
      [decoded.id]
    );
    const user = rows[0];
    if (user && user.is_active) {
      user.internal_access_route = decoded.internalAccessRoute || null;
      user.internal_access_id = decoded.internalAccessId || null;
      req.user = user;
      req.isAdmin = ['admin', 'super_admin'].includes(user.role);
      req.isSuperAdmin = user.role === 'super_admin';
    }
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
