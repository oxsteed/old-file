'use strict';

/**
 * scopeModel — canonical data-scope model (Analytics platform, Phase 1, Item 6).
 *
 * Problem (see docs/analytics-platform/SCOPE.md Area 4): the codebase has
 * ~470 hand-written `business_id` filters across 78 controllers and ~17
 * copy-pasted restaurant access checks, with no shared primitive. Every
 * endpoint author must remember to filter, and ~20 subtly different
 * restaurant ownership definitions must be converged before any automatic
 * layer can exist.
 *
 * This module is the shared primitive. It WRAPS the existing patterns —
 * same SQL semantics, same errors — so adoption never changes authorization
 * behavior. Convergence happens domain by domain (see
 * docs/analytics-platform/PROGRESS.md for the plan); the restaurant domain
 * is the pilot and already migrated.
 *
 * Exports:
 *   resolveScope(user, context)
 *     The general model. Given a platform user ({ id, role }), returns the
 *     data scope for that user: business IDs + per-business roles,
 *     restaurant IDs + per-restaurant roles, platform-role flags, and
 *     constraints for own-data filtering. Unifies the ownership semantics
 *     of `middleware/requireBusinessAccess.js` (owner or active member) and
 *     the legacy `utils/businessOwnership.js` helpers without replacing
 *     either yet — see "Convergence" below.
 *
 *   resolveBusinessAccess(userId, businessId)
 *     Canonical single-business gate mirroring requireBusinessAccess's row
 *     semantics (owner via businesses.user_id, else the active
 *     business_members role; soft-deleted businesses resolve to null).
 *     Returns the row or null; callers map null to 404. The middleware
 *     itself is NOT migrated in this pilot (route-layer 401/400/404/403
 *     contract); it will adopt this query in a later convergence step.
 *
 *   resolveRestaurantAccess(userId, restaurantId)
 *     THE canonical restaurant access gate. Replaces the ~17 local
 *     `requireRestaurantAccess` copies across the restaurant controllers
 *     (pilot migration, behavior-preserving). Returns the restaurant row
 *     with the union of every column the historical variants selected:
 *       - fr.* (all food_restaurants columns)
 *       - business_owner_id        (foodController, restaurantAppFlowController)
 *       - effective_role           (everyone; 'owner' | business_members role)
 *       - operator_role            (restaurantCreditFundingController's alias
 *                                   of the same CASE — kept so its mental
 *                                   model and any reader keep working)
 *       - effective_membership_id  (foodController, restaurantAppFlowController)
 *       - membership_id            (restaurantInventoryController's alias of
 *                                   the same subquery)
 *       - access_user_id           (set to userId; foodController's
 *                                   getRestaurantPermissions reads it)
 *     Throws AppError('Restaurant not found', 404, 'restaurant_not_found')
 *     when the restaurant does not exist or the caller has no standing —
 *     identical to every historical variant.
 *
 *     Deliberately NOT included (stays at the call site):
 *       - the `if (!restaurantId) throw 404` fast-fail guard. 13 of 17
 *         variants had it; 4 (foodController, foodWalletController,
 *         foodCreditDisputeController, restaurantCreditFundingController)
 *         let the driver reject instead. Moving the guard into the shared
 *         gate would turn those 4 paths' 500-on-garbage-id into 404 — an
 *         error-path behavior change. Migrated controllers keep a 4-line
 *         local wrapper with the guard exactly where they had it.
 *       - per-domain role gates (restaurantReportsController's
 *         MANAGE_ROLES 403, restaurantAppFlowController's assertManage,
 *         foodWalletController's assertWalletOperator). Those are domain
 *         policy on top of access resolution, not access resolution.
 *
 *   isRestaurantOwner(userId, restaurantId)
 *     Boolean owner check replacing the two near-duplicate local
 *     `isRestaurantOwner` helpers (restaurantMediaVideoController,
 *     restaurantTopupController): owner via businesses.user_id OR
 *     food_restaurants.owner_user_id. Keeps the topup variant's
 *     `if (!userId) return false` guard (media's callers always pass an
 *     authenticated id, so no behavior change there) and LIMIT 1.
 *
 * Deliberately NOT migrated (different semantics — documented, not changed):
 *   - routes/statementArchive.js `assertRestaurantAccountStanding`: keyed by
 *     wallet account, grants standing to the wallet's customer OR a
 *     restaurant owner/member. Not a pure restaurant gate.
 *   - controllers/mediaController.js actor verification: owner_user_id check
 *     plus status/is_verified filters for media posting. Not access control.
 *
 * Known semantic notes (verified against the historical queries):
 *   - The restaurant gate does NOT filter soft-deleted businesses (the
 *     historical JOIN has no deleted_at predicate), while
 *     resolveBusinessAccess/resolveScope treat deleted businesses as
 *     out of scope (requireBusinessAccess 404s on deleted_at). Each
 *     mirrors its own legacy pattern; do not "fix" one side without a
 *     product decision — see PROGRESS.md.
 *   - Platform admins/super_admins get NO restaurant standing from their
 *     platform role (the historical queries only look at ownership and
 *     business membership). resolveScope reflects this: admin scoping is
 *     `global: true` for admin surfaces, but restaurantIds only ever come
 *     from ownership/membership.
 */

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

// The one canonical ownership CASE shared by every restaurant access query
// (byte-equivalent to the historical variants' CASE).
const EFFECTIVE_ROLE_CASE = `CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END`;

const EFFECTIVE_MEMBERSHIP_ID_SUBQUERY = `(
              SELECT bm.id
                FROM business_members bm
               WHERE bm.business_id = fr.business_id
                 AND bm.member_id = $2
                 AND bm.status = 'active'
               LIMIT 1
            )`;

/**
 * Canonical restaurant access gate (see module docstring).
 */
async function resolveRestaurantAccess(userId, restaurantId) {
  const { rows } = await pool.query(
    `SELECT fr.*,
            b.user_id AS business_owner_id,
            ${EFFECTIVE_ROLE_CASE} AS effective_role,
            ${EFFECTIVE_ROLE_CASE} AS operator_role,
            ${EFFECTIVE_MEMBERSHIP_ID_SUBQUERY} AS effective_membership_id,
            ${EFFECTIVE_MEMBERSHIP_ID_SUBQUERY} AS membership_id
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [restaurantId, userId]
  );
  const restaurant = rows[0];
  if (!restaurant || !restaurant.effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  restaurant.access_user_id = userId;
  return restaurant;
}

/**
 * Boolean restaurant-owner check (see module docstring).
 */
async function isRestaurantOwner(userId, restaurantId) {
  if (!userId) return false;
  const { rows } = await pool.query(
    `SELECT 1
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1 AND (b.user_id = $2 OR fr.owner_user_id = $2)
      LIMIT 1`,
    [restaurantId, userId]
  );
  return rows.length > 0;
}

/**
 * Canonical single-business gate mirroring
 * middleware/requireBusinessAccess.js row semantics. Returns the business row
 * ({ id, business_name, is_primary, tax_rate, owner_id, is_active,
 * deleted_at, effective_role, membership_id }) or null when the business
 * does not exist, is soft-deleted, or the user has no standing. Callers map
 * null to their own 404 (the middleware uses 404 for both not-found and
 * no-access to avoid leaking which businesses exist).
 */
async function resolveBusinessAccess(userId, businessId, { includeDeleted = false } = {}) {
  if (!userId || businessId == null) return null;
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
      WHERE b.id = $1 AND ($3::boolean OR b.deleted_at IS NULL)`,
    [businessId, userId, includeDeleted]
  );
  const row = rows[0];
  if (!row || (!includeDeleted && row.deleted_at) || !row.effective_role) return null;
  return row;
}

/**
 * resolveScope(user, context) — the general data-scope model.
 *
 * user:    { id, role } where role is a platform user_role
 *          (customer | helper | helper_pro | broker | admin | super_admin |
 *          employee). `id` may be null for anonymous callers.
 * context: reserved for future scoping dimensions (e.g. regionId). Accepted
 *          and ignored for now.
 *
 * Returns:
 *   {
 *     userId, role,
 *     isAdmin, isSuperAdmin,
 *     global,               // true for admin/super_admin: admin surfaces
 *                            // read unconstrained (or fail closed when a
 *                            // grant is required — see regionRestricted).
 *     regionRestricted,     // admin has unexpired region-scoped grants.
 *                            // INFORMATIONAL ONLY: no row-level region
 *                            // scoping exists anywhere in the codebase, so
 *                            // consumers must keep today's fail-closed
 *                            // behavior and never treat this as enforced.
 *     regionIds,              // region ids from those grants (admins only).
 *     businesses:   [{ id, role }],  // owned + active memberships;
 *                                     // soft-deleted businesses excluded
 *                                     // (matches requireBusinessAccess 404).
 *     businessIds:  [...],
 *     restaurants:  [{ id, businessId, role }],  // ownership/membership
 *                                     // standing per the restaurant gate's
 *                                     // CASE (no deleted_at filter, like
 *                                     // the historical gate queries).
 *     restaurantIds: [...],
 *     constraints:  { userId },      // own-data filtering for
 *                                     // customers/helpers/brokers/employees.
 *   }
 *
 * The function never throws for unknown users; anonymous or role-less
 * callers get an empty scope.
 */
async function resolveScope(user, context = {}) {
  void context;
  const userId = user?.id ?? null;
  const role = user?.role ?? null;
  const scope = {
    userId,
    role,
    isAdmin: role === 'admin',
    isSuperAdmin: role === 'super_admin',
    global: role === 'admin' || role === 'super_admin',
    regionRestricted: false,
    regionIds: [],
    businesses: [],
    businessIds: [],
    restaurants: [],
    restaurantIds: [],
    constraints: { userId },
  };
  if (!userId) return scope;

  const { rows: businessRows } = await pool.query(
    `SELECT b.id,
            CASE
              WHEN b.user_id = $1 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = b.id
                   AND bm.member_id = $1
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS role
       FROM businesses b
      WHERE b.deleted_at IS NULL
        AND (
          b.user_id = $1
          OR EXISTS (
            SELECT 1
              FROM business_members bm
             WHERE bm.business_id = b.id
               AND bm.member_id = $1
               AND bm.status = 'active'
          )
        )`,
    [userId]
  );
  for (const row of businessRows) {
    scope.businesses.push({ id: Number(row.id), role: row.role });
    scope.businessIds.push(Number(row.id));
  }

  const { rows: restaurantRows } = await pool.query(
    `SELECT fr.id,
            fr.business_id,
            CASE
              WHEN b.user_id = $1 OR fr.owner_user_id = $1 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $1
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS role
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE b.user_id = $1
         OR fr.owner_user_id = $1
         OR EXISTS (
           SELECT 1
             FROM business_members bm
            WHERE bm.business_id = fr.business_id
              AND bm.member_id = $1
              AND bm.status = 'active'
         )`,
    [userId]
  );
  for (const row of restaurantRows) {
    scope.restaurants.push({
      id: Number(row.id),
      businessId: Number(row.business_id),
      role: row.role,
    });
    scope.restaurantIds.push(Number(row.id));
  }

  if (scope.global) {
    const { rows: regionRows } = await pool.query(
      `SELECT DISTINCT region_id
         FROM admin_permission_grants
        WHERE grantee_id = $1
          AND region_id IS NOT NULL
          AND revoked_at IS NULL
          AND expires_at > NOW()`,
      [userId]
    );
    scope.regionRestricted = regionRows.length > 0;
    scope.regionIds = regionRows.map((r) => r.region_id);
  }

  return scope;
}

module.exports = {
  resolveScope,
  resolveBusinessAccess,
  resolveRestaurantAccess,
  isRestaurantOwner,
};
