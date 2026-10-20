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
 * Cache TTL is short (30s). The cache key includes role so revoke +
 * reassign naturally invalidates.
 *
 * Cross-instance invalidation (S-21): invalidateCache() also publishes the
 * evicted (business_id, user_id) pair to the Redis channel
 * 'oxsteed:permissions:invalidate'; every instance subscribes and applies
 * the same eviction locally. When REDIS_URL is configured (production)
 * propagation is effectively immediate. When Redis is not configured the
 * invalidation bound is the cache TTL: a permission change made on another
 * instance can take up to TTL_MS (30s) to reach permission-gated routes
 * served by this instance. Membership checks themselves are never cached,
 * so a removed member loses access on the very next request everywhere.
 */

const pool = require('../db');
const logger = require('../utils/logger');

const TTL_MS = 30 * 1000;
const MAX_CACHE_ENTRIES = 5000;
const cache = new Map();

// Role ordering (descending privilege). Mirrors the ordering documented in
// middleware/requireBusinessAccess.js; defined here so services and
// controllers share one rank model (S-22 guardrails).
const ROLE_RANK = {
  owner: 5,
  manager: 4,
  representative: 3,
  support_agent: 2,
  employee: 1,
};

function roleRank(role) {
  return ROLE_RANK[role] || 0;
}

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
      'SELECT code FROM team_permissions',
      []
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

function evictLocal(businessId, userId) {
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

// ── Cross-instance invalidation bus (S-21) ─────────────────────────────────
// Uses the shared Redis client (server/utils/redis). Publishing is
// fire-and-forget: a Redis outage never blocks or fails a permission
// write; the local eviction above has already happened and the TTL bound
// documented in the header applies until Redis recovers.
const INVALIDATION_CHANNEL = 'oxsteed:permissions:invalidate';
let invalidationPublisher = null; // async (businessId, userId) => void
let invalidationSubscriber = null;

function handleInvalidationMessage(raw) {
  try {
    const msg = JSON.parse(raw);
    if (msg && (msg.businessId || msg.userId)) {
      evictLocal(msg.businessId || null, msg.userId || null);
    }
  } catch (_) {
    // A malformed message must never crash the subscriber; ignore it.
  }
}

function initInvalidationBus() {
  if (invalidationPublisher || invalidationSubscriber) return;
  let redis = null;
  try {
    redis = require('../utils/redis');
  } catch (_) {
    redis = null;
  }
  if (!redis) return; // No Redis configured: TTL bound applies (see header).
  invalidationPublisher = async (businessId, userId) => {
    try {
      await redis.publish(INVALIDATION_CHANNEL, JSON.stringify({ businessId, userId }));
    } catch (err) {
      logger.warn('permissionsService: invalidation publish failed', { message: err.message });
    }
  };
  try {
    const sub = redis.duplicate();
    sub.on('error', (err) => logger.warn('permissionsService: invalidation subscriber error', { message: err.message }));
    sub.subscribe(INVALIDATION_CHANNEL).catch((err) => {
      logger.warn('permissionsService: invalidation subscribe failed', { message: err.message });
    });
    sub.on('message', (channel, message) => {
      if (channel === INVALIDATION_CHANNEL) handleInvalidationMessage(message);
    });
    invalidationSubscriber = sub;
  } catch (err) {
    logger.warn('permissionsService: invalidation subscriber setup failed', { message: err.message });
  }
}

function invalidateCache(businessId, userId) {
  evictLocal(businessId, userId);
  initInvalidationBus();
  if (invalidationPublisher) {
    // Fire-and-forget; the publisher swallows its own errors.
    invalidationPublisher(businessId || null, userId || null);
  }
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

/**
 * S-08: THE single permission resolver for restaurant surfaces.
 *
 * Every restaurant controller gate must resolve through here (directly or
 * via hasRestaurantPermission) so the catalog + per-membership overrides
 * are the only source of truth. Role-only checks (the old MANAGE_ROLES
 * sets) cannot see deny overrides and are not used for authorization.
 *
 * `restaurant` is the row returned by scopeModel.resolveRestaurantAccess:
 * it carries business_id, effective_role and effective_membership_id.
 * Platform-admin requests arrive with effective_role 'owner' and resolve
 * to the full catalog, exactly like the business owner.
 *
 * Fails closed: missing context resolves to an empty set, and a resolver
 * error propagates (the caller's error handler returns 5xx, never a pass).
 */
async function getRestaurantPermissions(restaurant, userId) {
  if (!restaurant || !userId || !restaurant.business_id || !restaurant.effective_role) {
    return new Set();
  }
  const { permissions } = await getEffectivePermissions({
    businessId: restaurant.business_id,
    userId,
    role: restaurant.effective_role,
    membershipId: restaurant.effective_membership_id || null,
  });
  return permissions;
}

/**
 * True when the caller's resolved set contains at least one of `codes`
 * (or the owner '*' marker). Use for restaurant manage gates that used to
 * be `MANAGE_ROLES.has(restaurant.effective_role)`.
 */
async function hasRestaurantPermission(restaurant, userId, codes) {
  const permissions = await getRestaurantPermissions(restaurant, userId);
  if (permissions.has('*')) return true;
  return hasAny(permissions, codes);
}

/**
 * True when `code` exists in the permission catalog. The override write
 * path uses this to reject unknown codes instead of silently dropping
 * them (S-08). Reads the table directly (not the 60s catalog cache) so a
 * freshly migrated code is valid immediately.
 */
async function isKnownPermissionCode(code) {
  if (typeof code !== 'string' || !code) return false;
  const { rows } = await pool.query('SELECT 1 FROM team_permissions WHERE code = $1', [code]);
  return rows.length > 0;
}

module.exports = {
  getEffectivePermissions,
  hasAny,
  hasAll,
  invalidateCache,
  getCatalog,
  getRestaurantPermissions,
  hasRestaurantPermission,
  isKnownPermissionCode,
  ROLE_RANK,
  roleRank,
  // Test hooks for the S-21 invalidation bus (no Redis needed to verify
  // the publish/evict wiring).
  _testHooks: {
    setInvalidationPublisher(fn) { invalidationPublisher = fn; },
    getInvalidationPublisher() { return invalidationPublisher; },
    handleInvalidationMessage,
    INVALIDATION_CHANNEL,
  },
};
