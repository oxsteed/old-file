'use strict';

/**
 * requireCorporatePermission — middleware factory that gates an admin route
 * behind one or more corporate permission codes.
 *
 * Must run AFTER `requireAdmin` (adminAuth.js) — it relies on `req.user` and
 * `req.isSuper` being set.
 *
 * Usage:
 *   router.get('/foo',
 *     requireAdmin,
 *     requireCorporatePermission('finance.view_payouts'),
 *     ctrl.handler);
 *
 *   router.post('/bar',
 *     requireAdmin,
 *     requireCorporatePermission(['marketing.send_broadcast','marketing.manage_campaigns'], 'any'),
 *     ctrl.handler);
 *
 * Country scoping: if `?country=US` is on the request, the middleware uses the
 * user's effective permissions FOR that country (i.e. assignments scoped to
 * that country or global). Otherwise it uses the union across all active
 * assignments.
 *
 * Super-admin always passes. The corporate permission system is in addition
 * to the existing `admin_permission_grants` capability layer — it does not
 * replace it.
 */

const corporateRolesService = require('../services/corporateRolesService');
const logger = require('../utils/logger');

/**
 * @param {string|string[]} permissions
 * @param {'any'|'all'} [mode] - if multiple permissions, require any (default) or all
 */
function requireCorporatePermission(permissions, mode = 'any') {
  const required = Array.isArray(permissions) ? permissions : [permissions];

  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    // Super-admin bypass
    if (req.isSuper) {
      req.corporatePermissions = null; // means "all"
      return next();
    }

    try {
      const country = (req.query.country || req.headers['x-corporate-country'] || null);
      const { permissions: permSet, assignments } =
        await corporateRolesService.getEffectiveCorporatePermissions({
          userId:  req.user.id,
          role:    req.user.role,
          country,
        });

      const ok = mode === 'all'
        ? corporateRolesService.hasAll(permSet, required)
        : corporateRolesService.hasAny(permSet, required);

      if (!ok) {
        return res.status(403).json({
          error: 'Corporate permission required.',
          code: 'corporate_permission_denied',
          required,
          mode,
        });
      }

      req.corporatePermissions = permSet;
      req.corporateAssignments = assignments;
      return next();
    } catch (err) {
      logger.error('Corporate permission check failed', {
        adminId: req.user?.id,
        required,
        error: err.message,
      });
      return res.status(500).json({ error: 'Permission check failed.' });
    }
  };
}

module.exports = requireCorporatePermission;
module.exports.requireCorporatePermission = requireCorporatePermission;
