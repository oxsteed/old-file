'use strict';

/**
 * corporateRolesService — resolves the effective CORPORATE permission set for
 * an internal OxSteed staff member, merging:
 *   1. department-level defaults from corporate_department_permissions,
 *      computed across every ACTIVE assignment the user holds
 *      (a user can hold multiple titles — e.g. CTO + acting Head of Marketing).
 *   2. per-assignment overrides from corporate_assignment_permission_overrides
 *      (allow / deny, both supported).
 *   3. Implicit super_admin = ALL permissions  (super-admin always passes).
 *
 * This permission layer is INDEPENDENT from the existing
 * `admin_permission_grants` table (049). They are two different surfaces:
 *
 *   * admin_permission_grants — capability grants issued by a super-admin
 *     to a specific admin user for a bounded window. Backwards-compat path.
 *
 *   * corporate_* tables (this service) — corporate title + permission overlay
 *     so we can express the OxSteed org chart (CEO, CTO, VP Marketing, ...)
 *     and let the UI gate features by department / title.
 *
 * Permission codes live in `corporate_permissions` and follow the pattern
 *   <group>.<verb_or_noun>      e.g. "finance.view_payouts"
 *
 * Backed by a small in-process cache keyed on userId. Cache TTL is 60 s.
 */

const pool = require('../db');

const TTL_MS = 60 * 1000;
const cache = new Map();

function cacheKey(userId, country) {
  return `${userId}|${country || ''}`;
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
  cache.set(key, { at: Date.now(), value });
}

/**
 * Returns the resolved corporate permission Set for an authenticated user.
 *
 * @param {object} ctx
 * @param {string} ctx.userId                 - users.id (UUID)
 * @param {string} [ctx.role]                 - 'admin' | 'super_admin' (others get empty set)
 * @param {string} [ctx.country]              - ISO-3166 alpha-2; filters assignments to that country
 *                                              and globals; omit for "any active assignment".
 * @returns {Promise<{ permissions: Set<string>, raw: object, assignments: object[] }>}
 */
async function getEffectiveCorporatePermissions(ctx) {
  const userId = ctx?.userId;
  const role = ctx?.role || null;
  const country = ctx?.country ? String(ctx.country).toUpperCase() : null;

  if (!userId) {
    return { permissions: new Set(), raw: { reason: 'missing_user' }, assignments: [] };
  }

  // Only internal staff (admin / super_admin) get a corporate permission set.
  if (role && !['admin', 'super_admin'].includes(role)) {
    return { permissions: new Set(), raw: { reason: 'not_internal_staff' }, assignments: [] };
  }

  const key = cacheKey(userId, country);
  const cached = readCached(key);
  if (cached) return cached;

  // Super-admin short-circuit — every permission.
  if (role === 'super_admin') {
    const { rows } = await pool.query('SELECT code FROM corporate_permissions');
    const perms = new Set(rows.map((r) => r.code));
    const assignmentsRes = await pool.query(
      `SELECT ca.id, ca.title_id, ca.department_id, ca.country_code, ca.region_id,
              ca.started_at, ca.ended_at, ca.is_active,
              t.code AS title_code, t.name AS title_name, t.seniority_level, t.is_csuite,
              d.code AS department_code, d.name AS department_name
         FROM corporate_assignments ca
         JOIN corporate_titles      t ON t.id = ca.title_id
         JOIN corporate_departments d ON d.id = ca.department_id
        WHERE ca.user_id = $1 AND ca.is_active = TRUE
        ORDER BY t.seniority_level DESC, ca.started_at ASC`,
      [userId]
    );
    const result = {
      permissions: perms,
      raw: { role: 'super_admin', source: 'super_admin_bypass' },
      assignments: assignmentsRes.rows,
    };
    writeCached(key, result);
    return result;
  }

  // Pull every active assignment that matches the country filter (or is global).
  const params = [userId];
  let where = 'ca.user_id = $1 AND ca.is_active = TRUE';
  if (country) {
    params.push(country);
    where += ` AND (ca.country_code IS NULL OR ca.country_code = $${params.length})`;
  }

  const { rows: assignments } = await pool.query(
    `SELECT ca.id, ca.title_id, ca.department_id, ca.country_code, ca.region_id,
            ca.started_at, ca.ended_at, ca.is_active,
            t.code AS title_code, t.name AS title_name, t.seniority_level, t.is_csuite,
            d.code AS department_code, d.name AS department_name
       FROM corporate_assignments ca
       JOIN corporate_titles      t ON t.id = ca.title_id
       JOIN corporate_departments d ON d.id = ca.department_id
      WHERE ${where}
      ORDER BY t.seniority_level DESC, ca.started_at ASC`,
    params
  );

  if (!assignments.length) {
    const result = {
      permissions: new Set(),
      raw: { role, source: 'no_active_assignments' },
      assignments: [],
    };
    writeCached(key, result);
    return result;
  }

  const departmentIds = [...new Set(assignments.map((a) => a.department_id))];
  const assignmentIds = assignments.map((a) => a.id);

  // Department default permissions (union across all departments the user holds).
  const { rows: defaults } = await pool.query(
    `SELECT p.code, cdp.allow
       FROM corporate_department_permissions cdp
       JOIN corporate_permissions p ON p.id = cdp.permission_id
      WHERE cdp.department_id = ANY ($1::int[])`,
    [departmentIds]
  );

  const allowed = new Set();
  const denied = new Set();
  for (const row of defaults) {
    if (row.allow) allowed.add(row.code);
    else denied.add(row.code);
  }

  // Per-assignment overrides — applied last so they trump department defaults.
  if (assignmentIds.length) {
    const { rows: overrides } = await pool.query(
      `SELECT p.code, o.effect, o.expires_at
         FROM corporate_assignment_permission_overrides o
         JOIN corporate_permissions p ON p.id = o.permission_id
        WHERE o.assignment_id = ANY ($1::bigint[])
          AND (o.expires_at IS NULL OR o.expires_at > NOW())`,
      [assignmentIds]
    );
    for (const row of overrides) {
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
    raw: { role, source: 'dept_defaults+overrides', count: perms.size },
    assignments,
  };
  writeCached(key, result);
  return result;
}

/**
 * Returns the highest seniority_level across the caller's active assignments.
 * Used by the "cannot_grant_above_level" guard when an admin tries to assign
 * a title to someone else.
 *
 * Super-admin always returns Infinity.
 */
async function getMaxActiveSeniority(userId, role) {
  if (role === 'super_admin') return Number.POSITIVE_INFINITY;
  if (!userId) return 0;

  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(t.seniority_level), 0) AS max_seniority
       FROM corporate_assignments ca
       JOIN corporate_titles t ON t.id = ca.title_id
      WHERE ca.user_id = $1 AND ca.is_active = TRUE`,
    [userId]
  );
  return Number(rows[0]?.max_seniority || 0);
}

function hasAny(permSet, requested) {
  if (!requested || requested.length === 0) return true;
  for (const code of requested) {
    if (permSet.has(code)) return true;
  }
  return false;
}

function hasAll(permSet, requested) {
  if (!requested || requested.length === 0) return true;
  for (const code of requested) {
    if (!permSet.has(code)) return false;
  }
  return true;
}

function invalidateCache(userId) {
  if (!userId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}|`)) cache.delete(key);
  }
}

/**
 * Returns a JSON-safe snapshot of the departments + titles + permissions
 * catalog for the UI to render menus, assignment forms, and the org chart.
 * In-process cached, 60 s.
 */
let catalogCache = null;
let catalogCacheAt = 0;
const CATALOG_TTL_MS = 60 * 1000;

async function getCatalog() {
  if (catalogCache && Date.now() - catalogCacheAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const [deptsRes, titlesRes, permsRes, dpRes] = await Promise.all([
    pool.query(
      `SELECT id, code, name, description, icon, color, sort_order, is_active
         FROM corporate_departments
        WHERE is_active = TRUE
        ORDER BY sort_order, name`
    ),
    pool.query(
      `SELECT id, department_id, code, name, description,
              seniority_level, is_csuite, is_system, is_active, sort_order
         FROM corporate_titles
        WHERE is_active = TRUE
        ORDER BY department_id, sort_order, name`
    ),
    pool.query(
      `SELECT id, code, group_key, description
         FROM corporate_permissions
        ORDER BY group_key, code`
    ),
    pool.query(
      `SELECT d.code AS department_code, p.code AS permission_code, cdp.allow
         FROM corporate_department_permissions cdp
         JOIN corporate_departments d ON d.id = cdp.department_id
         JOIN corporate_permissions  p ON p.id = cdp.permission_id`
    ),
  ]);

  const deptsByCode = {};
  for (const d of deptsRes.rows) {
    deptsByCode[d.code] = { ...d, titles: [], permissions: [] };
  }
  for (const t of titlesRes.rows) {
    const dept = Object.values(deptsByCode).find((d) => d.id === t.department_id);
    if (dept) dept.titles.push(t);
  }
  for (const row of dpRes.rows) {
    if (deptsByCode[row.department_code] && row.allow) {
      deptsByCode[row.department_code].permissions.push(row.permission_code);
    }
  }

  catalogCache = {
    departments: Object.values(deptsByCode),
    titles: titlesRes.rows,
    permissions: permsRes.rows,
  };
  catalogCacheAt = Date.now();
  return catalogCache;
}

function invalidateCatalog() {
  catalogCache = null;
  catalogCacheAt = 0;
}

module.exports = {
  getEffectiveCorporatePermissions,
  getMaxActiveSeniority,
  hasAny,
  hasAll,
  invalidateCache,
  getCatalog,
  invalidateCatalog,
};
