// Phase  2 - Authentication & authorization middleware
// OxSteed v2

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const pool   = require('../db');
const logger = require('../utils/logger');
const tokenRevocationService = require('../services/tokenRevocationService');
const { isDiditIdentitySatisfied } = require('../utils/diditGate');
const { getEffectiveTier, hasProAccess } = require('../utils/trial');
const { ACCESS_TOKEN_TYPE, verifyAccessToken, isAccessTokenPayload } = require('../utils/accessToken');
const { liftExpiredSuspension } = require('../utils/suspension');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = process.env.REFRESH_EXPIRES_IN || '7d';

// Review P2-7-F12: warn-once flag for the unconfigured-Didit fail-open.
let diditUnconfiguredWarned = false;

function generateTokens(user, extraClaims = {}) {
  // Session-scoped CSRF: every access token carries a `sid` identifying
  // the login session it belongs to. Fresh logins auto-mint a random sid;
  // refresh passes the session row's sid explicitly so the identifier
  // survives access-token rotation (the DB session row itself rotates on
  // every refresh, so the row PK cannot serve as the stable id). The sid
  // is not a credential: it only selects which CSRF token validates, and
  // the CSRF token itself remains the secret. It is also returned so
  // session-creating handlers can persist it on the session row and issue
  // the session's CSRF token on the auth response. Refresh tokens are
  // unchanged: they are looked up by hash in the session row, which is
  // where the sid lives.
  const sid = extraClaims.sid || crypto.randomUUID();
  const accessToken = jwt.sign(
    // F-16: `typ` is set last so no caller-supplied claim can override it.
    { id: user.id, email: user.email, role: user.role, ...extraClaims, sid, typ: ACCESS_TOKEN_TYPE },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' }
  );
  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_EXPIRES_IN, algorithm: 'HS256' }
  );
  return { accessToken, refreshToken, sid };
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

/**
 * Shared impersonation-session verification (audit fix, finding 36).
 *
 * Mirrors in one place the checks authenticate used to inline:
 *   1. revocation-store session termination (endImpersonation),
 *   2. user-wide revocation for the target (password change / logout),
 *   3. the impersonating admin's own revocation (P3-14-F07),
 *   4. the user_impersonation_log.ended_at DB check (cache is not truth).
 *
 * Returns { valid: true } or { valid: false, error } with the same
 * denial messages authenticate historically sent. Callers that must not
 * fail the whole request (optionalAuth) treat !valid as "stay
 * unauthenticated" instead of sending the 401.
 */
async function verifyImpersonationSession(token, decoded) {
  const sessionRevoked = await tokenRevocationService.isImpersonationSessionRevoked(decoded.jti);
  if (sessionRevoked) {
    return { valid: false, error: 'Impersonation session has ended' };
  }
  // Impersonation still runs as the target user. A user-wide revocation
  // (password change, account security action, or logout) must therefore
  // invalidate the impersonation token too, before the database audit
  // lookup can authorize another request.
  const tokenId = crypto.createHash('sha256').update(token).digest('hex');
  const userRevoked = await tokenRevocationService.isRevoked(tokenId, decoded.id, decoded.iat);
  if (userRevoked) {
    return { valid: false, error: 'Token has been revoked' };
  }
  // Review P3-14-F07: the impersonating admin's own revocation must also
  // end the session. Without this, an admin password change,
  // logout-everywhere, or admin deactivation after the session started
  // would leave the impersonation token usable for its remaining life.
  // The user-level marker (revoked:user:<adminId>) is what matters here;
  // the per-token lookup above just misses for the impersonation token.
  if (decoded.impersonated_by) {
    const adminRevoked = await tokenRevocationService.isRevoked(tokenId, decoded.impersonated_by, decoded.iat);
    if (adminRevoked) {
      return { valid: false, error: 'Impersonating admin session has been revoked' };
    }
  }
  // Audit fix: also check ended_at in the database. The revocation
  // service is a cache; the database is the source of truth. If the
  // session was ended but the revocation didn't propagate, deny.
  // Fail-closed: if the query fails, deny (do not fail open).
  let session = null;
  try {
    const { rows } = await pool.query(
      `SELECT ended_at FROM user_impersonation_log WHERE token_jti = $1 LIMIT 1`,
      [decoded.jti]
    );
    session = rows[0];
  } catch (dbErr) {
    logger.error('impersonation ended_at check failed', { error: dbErr.message, jti: decoded.jti });
    return { valid: false, error: 'Impersonation session verification failed' };
  }
  if (session?.ended_at) {
    return { valid: false, error: 'Impersonation session has ended' };
  }
  return { valid: true };
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
  // Audit fix: impersonation Bearer tokens take precedence over the cookie.
  // If an admin has their own oxsteed_access cookie set but is sending an
  // impersonation Bearer token, the cookie would shadow the impersonation
  // and authenticate them as themselves. Check Bearer first for
  // impersonation sessions.
  let bearerToken = null;
  if (req.headers.authorization?.startsWith('Bearer ')) {
    bearerToken = req.headers.authorization.split(' ')[1];
  }
  let useBearer = false;
  if (bearerToken) {
    try {
      // Auth audit item 16: precedence must rest on a VERIFIED bearer,
      // not a decoded claim. A forged impersonation claim used to force
      // the bearer path (and the main verify below then 401'd instead of
      // falling back to the cookie). Now an unverifiable bearer (wrong
      // secret, expired) falls through to the cookie: an expired
      // impersonation token plus a valid cookie authenticates as the
      // cookie user rather than 401'ing, because the impersonation
      // session is over and the user's own valid session applies. No
      // privilege escalation in either case: an attacker holding only a
      // forged bearer and the victim's cookie could already authenticate
      // with the cookie alone.
      const bearerDecoded = verifyAccessToken(bearerToken, JWT_SECRET);
      // Pentest fix: minted impersonation tokens carry `impersonation: true`
      // (see superAdminController exchange); the old `isImpersonated` claim
      // name never appears on a minted token, so this precedence check
      // silently never fired and the cookie shadowed the Bearer token.
      if (bearerDecoded?.impersonation === true) {
        useBearer = true;
      }
    } catch {
      // Not a verifiable JWT; fall through to cookie.
    }
  }
  const token = useBearer
    ? bearerToken
    : cookieToken || bearerToken;
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

    // F-16: allow-list. Only a real access token (typ 'access' with a
    // session id, or a minted impersonation token) reaches the API. MFA,
    // refresh, passkey-challenge, internal-access and guest tokens share
    // the signing secret and are all refused here.
    if (decoded.isMfaToken) {
      return res.status(401).json({ error: 'MFA token cannot be used for API access' });
    }
    if (decoded.type === 'refresh') {
      return res.status(401).json({ error: 'Refresh token cannot be used for API access' });
    }
    if (!isAccessTokenPayload(decoded)) {
      return res.status(401).json({ error: 'Invalid token', code: 'invalid_token_type' });
    }

    // Impersonation tokens: skip the standard revocation check (they are
    // short-lived and tracked separately in user_impersonation_log), but
    // honor explicit session termination via endImpersonation, which records
    // the jti in the revocation store. Flag the request so downstream
    // handlers can audit impersonated actions.
    if (decoded.impersonation) {
      // Audit fix (finding 36): the full impersonation verification lives
      // in verifyImpersonationSession so optionalAuth mirrors authenticate's
      // DB + admin-revocation checks instead of consulting only the
      // revocation cache.
      const check = await verifyImpersonationSession(token, decoded);
      if (!check.valid) {
        return res.status(401).json({ error: check.error });
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
         COALESCE(u.is_suspended, FALSE) AS is_suspended,
         u.suspended_until, u.suspended_reason,
         COALESCE(u.is_restricted, FALSE) AS is_restricted,
         u.restriction_reason,
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
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [decoded.id]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists' });
    }
    const authPath = `${req.baseUrl || ''}${req.path || ''}` || req.originalUrl?.split('?')[0] || '';
    if (user.is_suspended) {
      const suspensionActive = !user.suspended_until || new Date(user.suspended_until) > new Date();
      if (suspensionActive && !authPath.startsWith('/api/auth/') && !authPath.startsWith('/api/support/')) {
        return res.status(403).json({
          error: 'Your account is suspended.',
          code: 'ACCOUNT_SUSPENDED',
          suspendedUntil: user.suspended_until || null,
        });
      }
      if (!suspensionActive) {
        try {
          await liftExpiredSuspension(pool, user);
        } catch (err) {
          logger.error('Expired suspension lift failed', { userId: user.id, error: err.message });
          return res.status(503).json({ error: 'Authentication temporarily unavailable', code: 'suspension_state_unavailable', retryable: true });
        }
      }
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account suspended' });
    }

    // Review P2-1-F04: the super-admin "Restrict" action was a dead flag —
    // nothing read users.is_restricted. Enforce it here like suspension: a
    // restricted account cannot act through the API (auth/support paths stay
    // open so the user can sign out or appeal).
    if (user.is_restricted) {
      if (!authPath.startsWith('/api/auth/') && !authPath.startsWith('/api/support/')) {
        return res.status(403).json({
          error: 'Your account is restricted.',
          code: 'ACCOUNT_RESTRICTED',
          restrictionReason: user.restriction_reason || null,
        });
      }
    }

    // Compute consistent onboarding_step matching authController.formatAuthUser
    user.onboarding_step = computeOnboardingStep(user);
    user.internal_access_route = decoded.internalAccessRoute || null;
    user.internal_access_id = decoded.internalAccessId || null;
    user.stripe_account_id = user.connect_stripe_account_id || null;
    user.stripe_charges_enabled = !!user.connect_charges_enabled;
    user.stripe_payouts_enabled = !!user.connect_payouts_enabled;
    user.stripe_connect_ready = !!(user.connect_charges_enabled && user.connect_payouts_enabled);
    user.stripe_connect_onboarded = !!user.connect_onboarding_complete;

    // Identity (Didit): block API access when the identity gate is not met.
    // Email-unverified accounts are gated too: they previously skipped the
    // identity check entirely (full API access for admin-created and legacy
    // rows). An unverified account verifies its email through the exempt
    // /api/auth paths first, then satisfies Didit (verify, or skip when
    // DIDIT_ALLOW_USER_SKIP is open) exactly like a verified account — never
    // broader access. didit_status='skipped' alone does not satisfy the gate
    // for an unverified account.
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
    // Review P2-7-F12: latent lockout trap. With DIDIT_ALLOW_USER_SKIP=false
    // (explicit opt-in) and DIDIT_API_KEY unset, no user can verify (session
    // creation 503s) and no user can skip (403) — every user would be 403'd
    // API-wide with no recovery path. When the provider is not configured the
    // gate is unenforceable, so fail open with a loud warning instead of a
    // self-inflicted lockout. Money paths keep their own identity checks
    // (credit rail review is fail-closed separately).
    if (!process.env.DIDIT_API_KEY) {
      if (!diditUnconfiguredWarned) {
        diditUnconfiguredWarned = true;
        logger.warn('DIDIT_API_KEY is not set: identity verification gate is disabled; configure Didit or set DIDIT_ALLOW_USER_SKIP explicitly.');
      }
    } else if (
      (!user.email_verified || !isDiditIdentitySatisfied(user)) &&
      !isDiditExempt
    ) {
      // Review P2-7-F13: a duplicate identity is not "verify again"; it is a
      // recovery flow. Return the actionable in-app message with locale keys
      // the client can render, instead of the generic verification-required
      // body. The error string stays in English for logs/API consumers.
      if ((user.didit_status || '').toLowerCase() === 'duplicate') {
        return res.status(403).json({
          error: 'This identity is already linked to an existing OxSteed account. Please sign in with that account instead.',
          code: 'DIDIT_DUPLICATE_IDENTITY',
          didit_status: 'duplicate',
          didit_enforcement_required: !!user.didit_enforcement_required,
          message_key: 'didit.duplicateGateMessage',
          recovery_steps: [
            { key: 'didit.duplicateRecoverySignIn' },
            { key: 'didit.duplicateRecoveryReset' },
            { key: 'didit.duplicateRecoverySupport' },
          ],
          sign_in_url: '/login',
          support_url: '/support',
        });
      }
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

function readAccessCookie(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)oxsteed_access=([^;]+)/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

function readBearer(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.split(' ')[1] || null;
}

// Same precedence as authenticate: a verified impersonation bearer wins over
// the access cookie; otherwise the cookie, then the bearer.
function selectRequestToken(req) {
  const cookieToken = readAccessCookie(req);
  const bearerToken = readBearer(req);
  if (bearerToken && cookieToken) {
    try {
      if (verifyAccessToken(bearerToken, JWT_SECRET).impersonation === true) {
        return { token: bearerToken, fromCookie: false };
      }
    } catch { /* fall through to the cookie */ }
  }
  if (cookieToken) return { token: cookieToken, fromCookie: true };
  if (bearerToken) return { token: bearerToken, fromCookie: false };
  return { token: null, fromCookie: false };
}

function clearRequestIdentity(req) {
  delete req.user;
  delete req.isImpersonated;
  delete req.impersonatedBy;
  delete req.impersonationJti;
  req.isAdmin = false;
  req.isSuperAdmin = false;
}

/**
 * Security review F-02: the shared verification for every non-rejecting
 * identity path (optionalAuth and the global parseAuthIdentity). It runs the
 * same checks as authenticate (access-token allow-list, revocation, full
 * impersonation-session verification, account existence, deleted, inactive,
 * suspended and restricted) and returns the verified user, or null when the
 * request must be treated as a guest. The Didit gate stays in authenticate
 * only (see the deliberate exception below).
 */
async function resolveOptionalIdentity(req, token) {
  let decoded;
  try {
    decoded = verifyAccessToken(token, JWT_SECRET);
  } catch {
    return null;
  }
  let impersonation = null;
  if (decoded.impersonation) {
    const check = await verifyImpersonationSession(token, decoded).catch(() => ({ valid: false }));
    if (!check.valid) return null;
    impersonation = { impersonatedBy: decoded.impersonated_by || null, jti: decoded.jti || null };
  } else {
    const tokenId = crypto.createHash('sha256').update(token).digest('hex');
    const isRevoked = await tokenRevocationService.isRevoked(tokenId, decoded.id, decoded.iat);
    if (isRevoked) return null;
  }

  const { rows } = await pool.query(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.is_active,
            u.default_mode, u.logistics_role, u.preferred_language,
            COALESCE(u.is_suspended, FALSE) AS is_suspended, u.suspended_until,
            COALESCE(u.is_restricted, FALSE) AS is_restricted
       FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [decoded.id]
  );
  const user = rows[0];
  if (!user || !user.is_active) return null;
  // Audit fix (P2-1-F05): suspended users get unauthenticated treatment on
  // public GETs too; otherwise a suspended account keeps owner-gated views
  // and authenticated behavior on optional-auth routes.
  const suspensionActive = user.is_suspended
    && (!user.suspended_until || new Date(user.suspended_until) > new Date());
  if (suspensionActive) return null;
  // Pentest fix: mirror authenticate's restriction gate (P2-1-F04). A
  // restricted account gets unauthenticated treatment on optional-auth
  // routes too, except the auth/support paths where authenticate itself
  // leaves the gate open so the user can sign out or appeal.
  // NOTE (deliberate exception, not an oversight): the Didit identity
  // gate is NOT applied here. optionalAuth routes are guest-capable by
  // design, so Didit-gating a signed-in user would only downgrade them
  // to the guest treatment guests already receive, while breaking
  // pre-verification support/chat onboarding flows that rely on
  // optional auth. Didit enforcement lives in authenticate for
  // protected routes; money-moving routes enforce their own identity
  // gates (Credit rail, payouts) on top.
  const optionalPath = `${req.baseUrl || ''}${req.path || ''}` || req.originalUrl?.split('?')[0] || '';
  const restrictionExempt = optionalPath.startsWith('/api/auth/') || optionalPath.startsWith('/api/support/');
  if (user.is_restricted && !restrictionExempt) return null;
  user.internal_access_route = decoded.internalAccessRoute || null;
  user.internal_access_id = decoded.internalAccessId || null;
  return { user, decoded, impersonation };
}

function applyIdentity(req, identity) {
  req.user = identity.user;
  req.isAdmin = ['admin', 'super_admin'].includes(identity.user.role);
  req.isSuperAdmin = identity.user.role === 'super_admin';
  if (identity.impersonation) {
    // Pentest fix: the impersonation flags are only set AFTER the session
    // check passes, so a failed check never leaves a stale flag behind.
    req.isImpersonated = true;
    req.impersonatedBy = identity.impersonation.impersonatedBy;
    req.impersonationJti = identity.impersonation.jti;
  }
}

/**
 * Optional authentication middleware.
 * With no token the request continues as a guest. With a token, the request
 * is authenticated only if the token passes every check authenticate runs;
 * otherwise ANY identity set earlier in the chain is cleared (F-02), so a
 * revoked, suspended, restricted, deleted or ended-impersonation token can
 * never act as its user on a guest-capable route.
 */
const optionalAuth = async (req, res, next) => {
  const { token } = selectRequestToken(req);
  clearRequestIdentity(req);
  if (!token) return next();
  try {
    const identity = await resolveOptionalIdentity(req, token);
    if (identity) applyIdentity(req, identity);
  } catch {
    // Revocation-store or DB failure: continue as unauthenticated.
    clearRequestIdentity(req);
  }
  return next();
};

/**
 * Money-moving guest-capable routes: a guest (no token) continues as a guest,
 * but a presented session must pass every optional-auth check. A revoked,
 * suspended, restricted, deleted, non-access or ended-impersonation session
 * is refused with 401 instead of being silently downgraded to a guest, so
 * the caller signs in again rather than acting anonymously by accident.
 * Like optionalAuth it does not apply the Didit gate (guest-capable routes
 * keep their own payment-level identity checks).
 */
async function authenticateIfPresent(req, res, next) {
  const { token } = selectRequestToken(req);
  clearRequestIdentity(req);
  if (!token) return next();
  try {
    jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    // An expired or foreign-signature cookie is a stale browser artefact,
    // not a session: treat it as absent so guests are not locked out.
    return next();
  }
  let identity = null;
  try {
    identity = await resolveOptionalIdentity(req, token);
  } catch (err) {
    if (err?.code === 'token_revocation_unavailable') {
      return res.status(503).json({
        error: 'Authentication temporarily unavailable',
        code: 'token_revocation_unavailable',
        retryable: true,
      });
    }
    identity = null;
  }
  if (!identity) {
    return res.status(401).json({
      error: 'Your session is no longer valid. Sign in again.',
      code: 'session_invalid',
    });
  }
  applyIdentity(req, identity);
  return next();
}

// Global identity parse for the CSRF boundary. It runs before route-level
// middleware on every request. Security review F-02: it used to set a bare
// `req.user = { id }` from any signature-valid token, which routes without
// authenticate then trusted. Now:
//   - req.csrfIdentity / req.csrfSid / req.csrfCookieSession carry the
//     signature-verified ACCESS token identity for CSRF only (cheap, no DB,
//     so the CSRF check stays fail-closed even when the DB is unavailable);
//   - req.user is set only after the full optional-auth verification
//     (revocation, impersonation session, active, not deleted, suspended or
//     restricted), so every route sees either a verified user or a guest.
// Route-level authenticate still owns the Didit gate and replaces req.user
// with the full record.
async function parseAuthIdentity(req, res, next) {
  clearRequestIdentity(req);
  delete req.csrfIdentity;
  req.csrfSid = null;
  req.csrfCookieSession = false;
  const { token, fromCookie } = selectRequestToken(req);
  if (!token) return next();
  let decoded;
  try {
    decoded = verifyAccessToken(token, JWT_SECRET);
  } catch {
    // Expired, malformed, wrong-signature or non-access token:
    // unauthenticated for CSRF purposes. authenticate still rejects it.
    return next();
  }
  req.csrfIdentity = { id: decoded.id };
  // Session-scoped CSRF: expose the access token's session id on a field
  // authenticate does NOT replace, so the CSRF middleware and the logout
  // handler can bind to the presented session even after authenticate runs.
  req.csrfSid = decoded.sid || null;
  req.csrfCookieSession = fromCookie;
  try {
    const identity = await resolveOptionalIdentity(req, token);
    if (identity) applyIdentity(req, identity);
  } catch {
    clearRequestIdentity(req);
  }
  return next();
}

module.exports = {
  generateTokens,
  authenticate,
  requireAuth: authenticate,
  parseAuthIdentity,
  optionalAuth,
  authenticateIfPresent,
  resolveOptionalIdentity,
  verifyImpersonationSession,
  requireRole,
  requireTier,
  requireActiveSubscription,
};
