const { verifyToken } = require('../services/authService');
const db              = require('../db');

// ── Core admin authentication ─────────────────────────────────────────────────

exports.requireAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized.' });

    const decoded = verifyToken(token);

    const { rows } = await db.query(
      `SELECT id, role, is_active, first_name, last_name, email
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

    const { rows } = await db.query(
      `SELECT id, role, is_active, first_name, last_name, email
       FROM users WHERE id = $1`,
      [decoded.id]
    );

    if (!rows.length || rows[0].role !== 'super_admin' || !rows[0].is_active) {
      return res.status(403).json({ error: 'Super Admin access required.' });
    }

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
  // requireAdmin must run before this — req.user and req.isSuper are already set.
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
    console.error('requirePermission error:', err);
    return res.status(500).json({ error: 'Permission check failed.' });
  }
};
