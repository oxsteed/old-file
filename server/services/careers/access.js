'use strict';

// Who may hire, where (careers spec §4, Q17; fixes C-01, C-05).
//
//   owner                  anywhere in the business; may approve above-range offers
//   manager + brand scope  brand admin: anywhere; may approve above-range offers
//   manager + region scope regional manager: stores in that region
//   manager (no scope)     store manager: their assigned stores, or the whole
//                          business when they have no store assignments
//   anyone else            only with a careers.manage_hiring override, scoped
//                          like a store manager
//
// Every non-owner may only hire into roles strictly below their own (S-09).
// Deleted or inactive businesses are never writable (C-05).

const pool = require('../../db');
const { AppError } = require('../../middleware/errorHandler');
const { resolveBusinessAccess } = require('../scopeModel');
const { getEffectivePermissions } = require('../permissionsService');
const { canActOnRole } = require('../../utils/teamRanks');

const MANAGE_HIRING = 'careers.manage_hiring';
const APPROVE_ABOVE_RANGE = 'careers.approve_above_range';

async function hasAdminGrant(user, permission, db = pool) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (user.role !== 'admin') return false;
  const { rows } = await db.query(
    `SELECT 1
       FROM admin_permission_grants
      WHERE grantee_id = $1
        AND permissions ? $2
        AND region_id IS NULL
        AND expires_at > NOW()
        AND revoked_at IS NULL
      LIMIT 1`,
    [user.id, permission]
  );
  return rows.length > 0;
}

const canManagePlatformHiring = (user, db) => hasAdminGrant(user, 'manage_hiring', db);
const canModerateCareers = (user, db) => hasAdminGrant(user, 'moderate_careers', db);

async function loadScope(db, { businessId, membershipId }) {
  const { rows: scopes } = await db.query(
    `SELECT scope_level, region_id
       FROM career_hiring_scopes
      WHERE business_id = $1 AND membership_id = $2 AND revoked_at IS NULL`,
    [businessId, membershipId]
  );
  if (scopes.some((s) => s.scope_level === 'brand')) {
    return { mode: 'brand', regionIds: null, locationIds: null };
  }
  const regionIds = scopes.filter((s) => s.scope_level === 'region').map((s) => Number(s.region_id));
  if (regionIds.length) {
    const { rows } = await db.query(
      `SELECT l.id
         FROM restaurant_locations l
         JOIN food_restaurants fr ON fr.id = l.restaurant_id
        WHERE fr.business_id = $1 AND l.region_id = ANY($2::bigint[])`,
      [businessId, regionIds]
    );
    return { mode: 'region', regionIds, locationIds: rows.map((r) => Number(r.id)) };
  }
  const { rows: stores } = await db.query(
    `SELECT DISTINCT lm.location_id
       FROM restaurant_location_memberships lm
      WHERE lm.membership_id = $1 AND lm.status = 'active'`,
    [membershipId]
  );
  if (stores.length) {
    return { mode: 'stores', regionIds: null, locationIds: stores.map((r) => Number(r.location_id)) };
  }
  return { mode: 'business', regionIds: null, locationIds: null };
}

/**
 * Resolve hiring access for a business. Returns null when the caller has no
 * live membership (callers answer 404 so business ids are not enumerable).
 */
async function resolveHiringAccess(user, businessId, { db = pool } = {}) {
  if (!user || businessId == null) return null;
  const access = await resolveBusinessAccess(user.id, businessId);
  if (!access || access.deleted_at || access.is_active === false) return null;
  const role = access.effective_role;
  const isOwner = role === 'owner';
  const { permissions } = await getEffectivePermissions({
    businessId: Number(businessId), userId: user.id, role, membershipId: access.membership_id,
  });
  const canHire = isOwner || permissions.has(MANAGE_HIRING);
  const scope = isOwner
    ? { mode: 'business', regionIds: null, locationIds: null }
    : await loadScope(db, { businessId: Number(businessId), membershipId: access.membership_id });
  return {
    businessId: Number(businessId),
    businessName: access.business_name,
    ownerId: access.owner_id,
    role,
    membershipId: access.membership_id || null,
    isOwner,
    canHire,
    scope,
    canApproveAboveRange: isOwner || scope.mode === 'brand' || permissions.has(APPROVE_ABOVE_RANGE),
  };
}

async function requireHiringAccess(user, businessId, opts) {
  if (!user) throw new AppError('Authentication required', 401, 'auth_required');
  const access = await resolveHiringAccess(user, businessId, opts);
  if (!access) throw new AppError('Business not found', 404, 'not_found');
  if (!access.canHire) throw new AppError('You do not have hiring permission for this business', 403, 'hiring_forbidden');
  return access;
}

// May this access hire into the given team role? (C-01)
function canHireRole(access, teamRole) {
  if (!access) return false;
  if (access.kind === 'platform' || access.isOwner) return true;
  return canActOnRole(access.role, teamRole || 'employee');
}

function assertCanHireRole(access, teamRole) {
  if (!canHireRole(access, teamRole)) {
    throw new AppError('You can only hire into roles below your own', 403, 'role_rank_forbidden', { team_role: 'Choose a role below yours' });
  }
}

// Is a set of store ids inside the access scope? Empty store list means
// "business-wide", which only business/brand-level hirers may manage.
function locationsInScope(access, locationIds) {
  if (!access || access.kind === 'platform') return true;
  const mode = access.scope?.mode;
  if (access.isOwner || mode === 'business' || mode === 'brand') return true;
  const ids = (locationIds || []).map(Number).filter(Boolean);
  if (!ids.length) return false;
  const allowed = new Set(access.scope.locationIds || []);
  return ids.every((id) => allowed.has(id));
}

function assertLocationsInScope(access, locationIds) {
  if (!locationsInScope(access, locationIds)) {
    throw new AppError('That store is outside your hiring scope', 403, 'location_scope_forbidden', { location_ids: 'Pick stores you manage' });
  }
}

/**
 * Management access to one opening (row from career_openings). Platform
 * openings need the admin manage_hiring grant. Business openings need
 * hiring access, the store scope and the role rank.
 */
async function assertCanManageOpening(user, opening, { db = pool, write = true } = {}) {
  if (!user) throw new AppError('Authentication required', 401, 'auth_required');
  if (!opening) throw new AppError('Opening not found', 404, 'not_found');
  if (opening.employer_type === 'platform') {
    if (!(await canManagePlatformHiring(user, db))) throw new AppError('Opening not found', 404, 'not_found');
    return { kind: 'platform', isOwner: false, role: 'platform', canApproveAboveRange: true, scope: { mode: 'business' } };
  }
  const access = await requireHiringAccess(user, opening.business_id, { db });
  if (!locationsInScope(access, opening.location_ids)) throw new AppError('Opening not found', 404, 'not_found');
  if (write) assertCanHireRole(access, opening.team_role);
  return { kind: 'business', ...access };
}

module.exports = {
  MANAGE_HIRING,
  APPROVE_ABOVE_RANGE,
  hasAdminGrant,
  canManagePlatformHiring,
  canModerateCareers,
  resolveHiringAccess,
  requireHiringAccess,
  canHireRole,
  assertCanHireRole,
  locationsInScope,
  assertLocationsInScope,
  assertCanManageOpening,
};
