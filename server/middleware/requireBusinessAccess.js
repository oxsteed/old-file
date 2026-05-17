'use strict';

/**
 * requireBusinessAccess(options) — Express middleware factory
 *
 * Enforces per-business workspace tenancy at the route layer. Replaces the
 * pattern of calling ownedBusiness / canEditProfile / canManageBusinessFinance
 * inside every controller. The resolved business row is attached to
 * `req.business`; the caller's effective role is attached to `req.businessRole`;
 * the business_members row id is attached to `req.membership` (null for owners);
 * the effective permission Set is attached to `req.permissions`.
 *
 * Options:
 *   - paramName  (string, default 'businessId') — request param holding the business id
 *   - minRole    (string, optional)             — minimum role: 'owner' | 'manager' | 'representative' | 'employee' | 'support_agent' | 'any'
 *                                                  Default 'any' (owner or any active member).
 *   - allowOwnerOnly (bool, default false)      — shortcut: shorthand for minRole='owner'
 *   - resolvePermissions (bool, default true)   — set false to skip the perm-set lookup (small perf win on hot endpoints that don't gate)
 *
 * Role ordering (descending):
 *   owner > manager > representative > support_agent > employee
 *
 * On success:
 *   req.business      = { id, business_name, is_primary, tax_rate, owner_id }
 *   req.businessRole  = role code
 *   req.membership    = { id } | null   (null when the caller IS the owner)
 *   req.permissions   = Set<string>     (effective permission codes)
 *   next()
 *
 * On failure:
 *   401 if not authenticated
 *   400 if the param is missing or not a valid id
 *   404 if the business does not exist OR the user has no access
 *       (we return 404 not 403 to avoid leaking which businesses exist)
 *   403 if minRole is not met
 */

const pool = require('../db');
const { sendError } = require('../utils/apiError');
const permissionsService = require('../services/permissionsService');

const ROLE_RANK = {
  owner: 5,
  manager: 4,
  representative: 3,
  support_agent: 2,
  employee: 1,
};

function meetsMin(actual, minRole) {
  if (!minRole || minRole === 'any') return actual !== null;
  const need = ROLE_RANK[minRole];
  const have = ROLE_RANK[actual];
  return need != null && have != null && have >= need;
}

function parseBusinessId(raw) {
  if (raw == null) return null;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0 || String(n) !== String(raw).replace(/^0+/, '')) {
    return null;
  }
  return n;
}

function requireBusinessAccess(options = {}) {
  const paramName = options.paramName || 'businessId';
  const minRole = options.allowOwnerOnly ? 'owner' : (options.minRole || 'any');
  const resolvePermissions = options.resolvePermissions !== false;

  return async function requireBusinessAccessMw(req, res, next) {
    if (!req.user || !req.user.id) {
      return sendError(res, 401, 'Authentication required.', 'auth_required');
    }

    const raw = req.params[paramName];
    const businessId = parseBusinessId(raw);
    if (businessId == null) {
      return sendError(res, 400, 'Invalid business id.', 'invalid_business_id');
    }

    try {
      const { rows } = await pool.query(
        `SELECT b.id,
                b.business_name,
                b.is_primary,
                b.tax_rate,
                b.user_id AS owner_id,
                b.is_active,
                b.deleted_at,
                CASE
                  WHEN b.user_id = $2 THEN 'owner'
                  ELSE (
                    SELECT bm.role
                    FROM business_members bm
                    WHERE bm.business_id = b.id
                      AND bm.member_id   = $2
                      AND bm.status      = 'active'
                    LIMIT 1
                  )
                END AS effective_role,
                CASE
                  WHEN b.user_id = $2 THEN NULL
                  ELSE (
                    SELECT bm.id
                    FROM business_members bm
                    WHERE bm.business_id = b.id
                      AND bm.member_id   = $2
                      AND bm.status      = 'active'
                    LIMIT 1
                  )
                END AS membership_id
         FROM businesses b
         WHERE b.id = $1`,
        [businessId, req.user.id]
      );

      const row = rows[0];
      if (!row || row.deleted_at) {
        return sendError(res, 404, 'Business not found.', 'business_not_found');
      }
      if (row.is_active === false) {
        return sendError(res, 404, 'Business not found.', 'business_not_found');
      }

      const role = row.effective_role;
      if (!role) {
        return sendError(res, 404, 'Business not found.', 'business_not_found');
      }

      if (!meetsMin(role, minRole)) {
        return sendError(res, 403, 'Insufficient business permissions.', 'business_role_required', {
          required: minRole,
          actual: role,
        });
      }

      req.business = {
        id: row.id,
        business_name: row.business_name,
        is_primary: row.is_primary,
        tax_rate: row.tax_rate,
        owner_id: row.owner_id,
      };
      req.businessRole = role;
      req.membership = row.membership_id ? { id: row.membership_id } : null;

      if (resolvePermissions) {
        const { permissions } = await permissionsService.getEffectivePermissions({
          businessId: row.id,
          userId: req.user.id,
          role,
          membershipId: row.membership_id,
        });
        req.permissions = permissions;
      }

      next();
    } catch (err) {
      return next(err);
    }
  };
}

// Convenience shortcuts so route files read naturally.
requireBusinessAccess.owner          = () => requireBusinessAccess({ minRole: 'owner' });
requireBusinessAccess.manager        = () => requireBusinessAccess({ minRole: 'manager' });
requireBusinessAccess.representative = () => requireBusinessAccess({ minRole: 'representative' });
requireBusinessAccess.supportAgent   = () => requireBusinessAccess({ minRole: 'support_agent' });
requireBusinessAccess.employee       = () => requireBusinessAccess({ minRole: 'employee' });
requireBusinessAccess.member         = () => requireBusinessAccess({ minRole: 'any' });

module.exports = requireBusinessAccess;
