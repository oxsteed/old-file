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
  } catch {
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
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

// ── Permission-grant middleware factory ───────────────────────────────────────
// Usage:  router.get('/route', requireAdmin, requirePermission('view_financials'), ctrl)
//
// Super-admins pass unconditionally.
// Regular admins must have an active (non-expired, non-revoked) grant that
// includes the requested permission scope.

exports.requirePermission = (permission) => async (req, res, next) => {
  // requireAdmin must run before this - req.user and req.isSuper are already set.
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });

  // Super-admins always pass
  if (req.isSuper) return next();

  try {
    const { rows } = await db.query(`
      SELECT id FROM admin_permission_grants
      WHERE grantee_id = $1
        AND permissions ? $2
        AND expires_at  > NOW()
        AND revoked_at IS NULL
      LIMIT 1
    `, [req.user.id, permission]);

    if (rows.length) {
      req.grantedPermission = permission; // useful for downstream controllers
      return next();
    }

    return res.status(403).json({
      error: `Permission '${permission}' required. Contact a super-admin to request access.`,
    });
  } catch (err) {
    logger.error('Permission check failed', { adminId: req.user?.id, permission, error: err.message });
    return res.status(500).json({ error: 'Permission check failed.' });
  }
};

/** Super-admin bypasses; otherwise same grant check as requirePermission. */
exports.requireSuperAdminOrPermission = (permission) => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });
  if (req.isSuper) return next();
  return exports.requirePermission(permission)(req, res, next);
};
