const { verifyToken } = require('../services/authService');
const crypto          = require('crypto');
const db              = require('../db');
const logger          = require('../utils/logger');
const tokenRevocationService = require('../services/tokenRevocationService');

function rejectWrongTokenType(decoded, res) {
  if (decoded?.isMfaToken) {
    res.status(401).json({ error: 'MFA token cannot be used for admin access.' });
    return true;
  }
  if (decoded?.type === 'refresh') {
    res.status(401).json({ error: 'Refresh token cannot be used for admin access.' });
    return true;
  }
  return false;
}

async function rejectRevokedToken(token, decoded, res) {
  const tokenId = crypto.createHash('sha256').update(token).digest('hex');
  const isRevoked = await tokenRevocationService.isRevoked(tokenId, decoded.id, decoded.iat);
  if (isRevoked) {
    res.status(401).json({ error: 'Token has been revoked.' });
    return true;
  }
  return false;
}

function rejectAdminWithout2FA(user, res) {
  if (['admin', 'super_admin'].includes(user.role) && !user.totp_enabled) {
    res.status(403).json({
      error: 'Two-factor authentication is required for admin accounts.',
      code: 'admin_2fa_required',
      redirect: '/admin/2fa-setup',
    });
    return true;
  }
  return false;
}

// ── Core admin authentication ─────────────────────────────────────────────────

exports.requireAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized.' });

    const decoded = verifyToken(token);
    if (rejectWrongTokenType(decoded, res)) return;
    if (await rejectRevokedToken(token, decoded, res)) return;

    const { rows } = await db.query(
      `SELECT id, role, is_active, first_name, last_name, email, COALESCE(totp_enabled, FALSE) AS totp_enabled
       FROM users WHERE id = $1`,
      [decoded.id]
    );

    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: 'Account not found or inactive.' });
    }

    const user = rows[0];

    if (!['admin', 'super_admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    if (rejectAdminWithout2FA(user, res)) return;

    req.user    = user;
    req.isSuper = user.role === 'super_admin';
    next();
  } catch (err) {
    if (err?.code === 'token_revocation_unavailable') {
      return res.status(503).json({
        error: 'Authentication temporarily unavailable.',
        code: 'token_revocation_unavailable',
        retryable: true,
      });
    }
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

exports.requireSuperAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized.' });

    const decoded = verifyToken(token);
    if (rejectWrongTokenType(decoded, res)) return;
    if (await rejectRevokedToken(token, decoded, res)) return;

    const { rows } = await db.query(
      `SELECT id, role, is_active, first_name, last_name, email, COALESCE(totp_enabled, FALSE) AS totp_enabled
       FROM users WHERE id = $1`,
      [decoded.id]
    );

    if (!rows.length || rows[0].role !== 'super_admin' || !rows[0].is_active) {
      return res.status(403).json({ error: 'Super Admin access required.' });
    }
    if (rejectAdminWithout2FA(rows[0], res)) return;

    req.user    = rows[0];
    req.isSuper = true;
    next();
  } catch (err) {
    if (err?.code === 'token_revocation_unavailable') {
      return res.status(503).json({
        error: 'Authentication temporarily unavailable.',
        code: 'token_revocation_unavailable',
        retryable: true,
      });
    }
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

// ── Permission-grant middleware factory ───────────────────────────────────────
// Usage:  router.get('/route', requireAdmin, requirePermission('view_financials'), ctrl)
//
// Super-admins pass unconditionally.
// Regular admins must have an active (non-expired, non-revoked) grant that
// includes the requested permission scope.

const GRANT_LOOKUP_SQL = `
      SELECT id, region_id, 'direct' AS grant_source
        FROM admin_permission_grants
       WHERE grantee_id = $1
         AND permissions ? $2
         AND expires_at  > NOW()
         AND revoked_at IS NULL
      UNION ALL
      SELECT d.id, NULL AS region_id, 'delegated' AS grant_source
        FROM delegation_grants d
        JOIN users grantor ON grantor.id = d.grantor_admin_id
        LEFT JOIN admin_permission_grants grantor_grant
          ON grantor_grant.grantee_id = d.grantor_admin_id
         AND grantor_grant.permissions ? $2
         AND grantor_grant.expires_at > NOW()
         AND grantor_grant.revoked_at IS NULL
         AND grantor_grant.region_id IS NULL
       WHERE d.grantee_admin_id = $1
         AND d.scopes @> ARRAY[$2]::text[]
         AND d.status = 'active'
         AND d.expires_at > NOW()
         AND (grantor.role = 'super_admin' OR grantor_grant.id IS NOT NULL)
      ORDER BY (region_id IS NULL) DESC
      LIMIT 1
    `;

async function lookupGrants(userId, permission) {
  const { rows } = await db.query(GRANT_LOOKUP_SQL, [userId, permission]);
  return rows;
}

/**
 * Shared predicate behind requirePermission: true when the admin holds an
 * active, non-revoked, non-expired global (region-free) grant containing the
 * permission. Super-admins bypass via the caller (mirrors requirePermission).
 * Exported so controllers that must apply the same staff gate inside a
 * non-admin route can reuse the exact grant semantics instead of duplicating
 * the query.
 */
async function hasGlobalGrant(userId, permission) {
  const rows = await lookupGrants(userId, permission);
  return rows.some((row) => row.region_id == null);
}
exports.hasGlobalGrant = hasGlobalGrant;

/**
 * Shared predicate behind requireAdmin's MFA requirement: true when the
 * admin account has TOTP enabled. Exported for the same reuse as
 * hasGlobalGrant.
 */
async function adminTotpEnabled(userId) {
  const { rows } = await db.query(
    'SELECT COALESCE(totp_enabled, FALSE) AS totp_enabled FROM users WHERE id = $1',
    [userId]
  );
  return rows.length > 0 && rows[0].totp_enabled === true;
}
exports.adminTotpEnabled = adminTotpEnabled;

function permissionMiddleware(permission, { globalOnly = true } = {}) {
  return async (req, res, next) => {
  // requireAdmin must run before this - req.user and req.isSuper are already set.
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });

  // Super-admins always pass
  if (req.isSuper) return next();

  try {
    const rows = await lookupGrants(req.user.id, permission);

    const grant = rows.find((row) => !globalOnly || row.region_id == null);
    if (grant) {
      req.grantedPermission = permission; // useful for downstream controllers
      req.delegatedPermission = grant.grant_source === 'delegated';
      return next();
    }

    if (rows.length && globalOnly) {
      return res.status(403).json({
        error: `Permission '${permission}' is limited to a region and cannot authorize this global action.`,
        code: 'global_permission_required',
        required: permission,
      });
    }

    return res.status(403).json({
      error: `Permission '${permission}' required. Contact a super-admin to request access.`,
    });
  } catch (err) {
    logger.error('Permission check failed', { adminId: req.user?.id, permission, error: err.message });
    return res.status(500).json({ error: 'Permission check failed.' });
  }
  };
}

// All current delegated admin endpoints operate on platform-wide data. A
// regional grant must not accidentally authorize one of them.
exports.requirePermission = (permission) => permissionMiddleware(permission, { globalOnly: true });

/**
 * Opt-in middleware for a future endpoint that resolves and verifies the
 * target record's region before allowing a regional grant.
 */
exports.requireRegionalPermission = (permission) => permissionMiddleware(permission, { globalOnly: false });

/**
 * Require an unscoped grant for an endpoint whose data or mutation is global.
 * Region-scoped grants must be paired with an explicit record-region check;
 * silently treating them as platform-wide access would bypass that boundary.
 */
exports.requireGlobalPermission = (permission) => permissionMiddleware(permission, { globalOnly: true });

/** Super-admin bypasses; otherwise same grant check as requirePermission. */
exports.requireSuperAdminOrPermission = (permission) => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });
  if (req.isSuper) return next();
  return exports.requirePermission(permission)(req, res, next);
};
