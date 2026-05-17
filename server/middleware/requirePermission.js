'use strict';

/**
 * requirePermission('perm.code' | ['perm.a','perm.b'], options)
 *
 * Express middleware that runs AFTER requireBusinessAccess (which attaches
 * req.permissions as a Set<string>). Returns 403 with code='permission_denied'
 * when the active member lacks the requested permission(s).
 *
 * Modes:
 *   - mode: 'any'  (default) — pass if the member has at least one listed permission
 *   - mode: 'all'            — pass only if the member has all listed permissions
 *
 * Owners always pass (their permissions set contains every code).
 *
 * Usage:
 *   router.post('/businesses/:businessId/jobs',
 *     requireAuth,
 *     requireBusinessAccess({ minRole: 'any' }),
 *     requirePermission('jobs.create'),
 *     createJob);
 */

const { sendError } = require('../utils/apiError');

function asArray(perms) {
  if (!perms) return [];
  return Array.isArray(perms) ? perms.filter(Boolean) : [String(perms)];
}

function requirePermission(perms, options = {}) {
  const wanted = asArray(perms);
  const mode = options.mode === 'all' ? 'all' : 'any';

  return function requirePermissionMw(req, res, next) {
    const set = req.permissions;
    if (!(set instanceof Set)) {
      return sendError(res, 500, 'Permission set not resolved. requireBusinessAccess must run first.', 'permission_set_missing');
    }
    if (wanted.length === 0) return next();

    let ok = false;
    if (mode === 'all') {
      ok = wanted.every((code) => set.has(code));
    } else {
      ok = wanted.some((code) => set.has(code));
    }

    if (!ok) {
      return sendError(res, 403, 'You do not have permission to perform this action.', 'permission_denied', {
        required: wanted,
        mode,
      });
    }
    next();
  };
}

module.exports = requirePermission;
