'use strict';

/**
 * permissionsService — resolves the effective permission set for a given
 * user in a given business, merging:
 *   1. role defaults from team_role_permissions
 *   2. per-membership overrides from membership_permission_overrides
 *   3. implicit owner = ALL permissions
 *
 * Permission codes follow the OxSteed team-role spec
 * (server/migrations/245_team_roles_permissions_access_codes.sql).
 *
 * Backed by a small in-process cache keyed on (business_id, user_id, role).
 * Cache TTL is short (30s) so role changes propagate quickly without
 * needing pubsub. The cache key includes role so revoke + reassign
 * naturally invalidates.
 */

const pool = require('../db');

const TTL_MS = 30 * 1000;
const MAX_CACHE_ENTRIES = 5000;
const cache = new Map();

function cacheKey(businessId, userId, role) {
  return `${businessId}|${userId}|${role}`;
}

function readCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCached(key, value) {
  // V2-P1-06: size bound — evict oldest-inserted when full.
  if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { at: Date.now(), value });
}

/**
 * Returns the resolved permission Set for an authenticated user inside a
 * given business. Pass the user's row from requireBusinessAccess.
 *
 * @param {object} ctx
 * @param {number} ctx.businessId  - businesses.id
 * @param {string} ctx.userId      - users.id (UUID)
 * @param {string} ctx.role        - 'owner' | 'manager' | 'representative' | 'employee' | 'support_agent'
 * @param {number} [ctx.membershipId] - business_members.id (omit for owner)
 * @returns {Promise<{ permissions: Set<string>, raw: object }>}
 */
async function getEffectivePermissions(ctx) {
  const businessId = ctx.businessId;
  const userId     = ctx.userId;
  const role       = ctx.role;
  const membershipId = ctx.membershipId || null;

  if (!businessId || !userId || !role) {
    return { permissions: new Set(), raw: { reason: 'missing_context' } };
  }

  const key = cacheKey(businessId, userId, role);
  const cached = readCached(key);
  if (cached) return cached;

  // Owner short-circuit — owner gets every permission.
  if (role === 'owner') {
    const { rows } = await pool.query(
      'SELECT code FROM team_permissions'
    );
    const perms = new Set(rows.map((r) => r.code));
    const result = { permissions: perms, raw: { role: 'owner', source: 'owner_grant' } };
    writeCached(key, result);
    return result;
  }

  // Role defaults via team_role_permissions
  const defaults = await pool.query(
    `SELECT p.code, rp.allow
       FROM team_role_permissions rp
       JOIN team_roles r       ON r.id = rp.role_id
       JOIN team_permissions p ON p.id = rp.permission_id
      WHERE r.code = $1`,
    [role]
  );

  const allowed = new Set();
  const denied  = new Set();
  for (const row of defaults.rows) {
    if (row.allow) allowed.add(row.code);
    else denied.add(row.code);
  }

  // Per-membership overrides (only if we know the membership_id)
  if (membershipId) {
    const overrides = await pool.query(
      `SELECT p.code, mpo.effect, mpo.expires_at
         FROM membership_permission_overrides mpo
         JOIN team_permissions p ON p.id = mpo.permission_id
        WHERE mpo.membership_id = $1
          AND (mpo.expires_at IS NULL OR mpo.expires_at > NOW())`,
      [membershipId]
    );
    for (const row of overrides.rows) {
      if (row.effect === 'allow') {
        allowed.add(row.code);
        denied.delete(row.code);
      } else if (row.effect === 'deny') {
        denied.add(row.code);
        allowed.delete(row.code);
      }
    }
  }

  const perms = new Set();
  for (const code of allowed) {
    if (!denied.has(code)) perms.add(code);
  }

  const result = {
    permissions: perms,
    raw: { role, source: 'role_defaults+overrides', count: perms.size },
  };
  writeCached(key, result);
  return result;
}

/**
 * Convenience: does a user hold at least one of the requested permissions?
 * Empty / null request is treated as a pass (caller only needed membership).
 */
function hasAny(permSet, requested) {
  if (!requested || requested.length === 0) return true;
  for (const code of requested) {
    if (permSet.has(code)) return true;
  }
  return false;
}

/**
 * Convenience: does a user hold ALL of the requested permissions?
 */
function hasAll(permSet, requested) {
  if (!requested || requested.length === 0) return true;
  for (const code of requested) {
    if (!permSet.has(code)) return false;
  }
  return true;
}

function invalidateCache(businessId, userId) {
  if (businessId && userId) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${businessId}|${userId}|`)) cache.delete(key);
    }
    return;
  }
  if (businessId) {
    const prefix = `${businessId}|`;
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
    return;
  }
  cache.clear();
}

/**
 * Returns a JSON-safe snapshot of the role catalog + permission catalog +
 * role defaults for the UI to use when building menus. Lightly cached
 * (in-process, 60s).
 */
let catalogCache = null;
let catalogCacheAt = 0;
const CATALOG_TTL_MS = 60 * 1000;

async function getCatalog() {
  if (catalogCache && Date.now() - catalogCacheAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const [rolesRes, permsRes, rpRes] = await Promise.all([
    pool.query('SELECT id, code, name, description, sort_order FROM team_roles ORDER BY sort_order, id'),
    pool.query('SELECT id, code, group_key, description FROM team_permissions ORDER BY group_key, code'),
    pool.query(
      `SELECT r.code AS role_code, p.code AS permission_code, rp.allow
         FROM team_role_permissions rp
         JOIN team_roles r       ON r.id = rp.role_id
         JOIN team_permissions p ON p.id = rp.permission_id`
    ),
  ]);
  const rolesByCode = {};
  for (const r of rolesRes.rows) {
    rolesByCode[r.code] = { ...r, permissions: [] };
  }
  for (const row of rpRes.rows) {
    if (rolesByCode[row.role_code] && row.allow) {
      rolesByCode[row.role_code].permissions.push(row.permission_code);
    }
  }
  catalogCache = {
    roles: Object.values(rolesByCode),
    permissions: permsRes.rows,
  };
  catalogCacheAt = Date.now();
  return catalogCache;
}

module.exports = {
  getEffectivePermissions,
  hasAny,
  hasAll,
  invalidateCache,
  getCatalog,
};
