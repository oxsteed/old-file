'use strict';

/**
 * requireBusinessAccess(options) — Express middleware factory
 *
 * Enforces per-business workspace tenancy at the route layer. Replaces the
 * pattern of calling ownedBusiness / canEditProfile / canManageBusinessFinance
 * inside every controller. The resolved business row is attached to
 * `req.business`; the caller's effective role is attached to `req.businessRole`.
 *
 * Options:
 *   - paramName  (string, default 'businessId') — request param holding the business id
 *   - minRole    (string, optional)             — minimum role: 'owner' | 'manager' | 'representative' | 'any'
 *                                                  Default 'any' (owner or any active member).
 *   - allowOwnerOnly (bool, default false)      — shortcut: shorthand for minRole='owner'
 *
 * Role ordering (descending): owner > manager > representative
 *
 * On success:
 *   req.business      = { id, business_name, is_primary, tax_rate, owner_id }
 *   req.businessRole  = 'owner' | 'manager' | 'representative'
 *   next()
 *
 * On failure:
 *   401 if not authenticated
 *   400 if the param is missing or not a valid id
 *   404 if the business does not exist OR the user has no access
 *       (we return 404 not 403 to avoid leaking which businesses exist)
 *
 * Usage:
 *   const requireBusinessAccess = require('../middleware/requireBusinessAccess');
 *   router.get(
 *     '/api/businesses/:businessId/invoices',
 *     requireAuth,
 *     requireBusinessAccess({ minRole: 'manager' }),
 *     listInvoices
 *   );
 */

const pool = require('../db');
const { sendError } = require('../utils/apiError');

const ROLE_RANK = { owner: 3, manager: 2, representative: 1 };

function meetsMin(actual, minRole) {
  if (!minRole || minRole === 'any') return actual !== null;
  const need = ROLE_RANK[minRole];
  const have = ROLE_RANK[actual];
  return need != null && have != null && have >= need;
}

function parseBusinessId(raw) {
  if (raw == null) return null;
  // businesses.id is SERIAL/INT — accept numeric strings only
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0 || String(n) !== String(raw).replace(/^0+/, '')) {
    return null;
  }
  return n;
}

function requireBusinessAccess(options = {}) {
  const paramName = options.paramName || 'businessId';
  const minRole = options.allowOwnerOnly ? 'owner' : (options.minRole || 'any');

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
                END AS effective_role
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
        // 404 (not 403) — don't leak which businesses exist.
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
      next();
    } catch (err) {
      return next(err);
    }
  };
}

// Convenience shortcuts so route files read naturally.
requireBusinessAccess.owner    = () => requireBusinessAccess({ minRole: 'owner' });
requireBusinessAccess.manager  = () => requireBusinessAccess({ minRole: 'manager' });
requireBusinessAccess.member   = () => requireBusinessAccess({ minRole: 'any' });

module.exports = requireBusinessAccess;
