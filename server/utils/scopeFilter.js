'use strict';

/**
 * E05 — shared, fail-closed request scoping.
 *
 * Several admin list/detail/export surfaces historically returned rows with
 * no scope filtering at all, so a regional admin could read records from
 * outside their assigned region. This module is the single contract:
 *
 *   resolveScope(req)
 *     - super-admin                      -> { type: 'global' }
 *     - regional admin with regions       -> { type: 'regions', regions, regionIds }
 *     - regional admin with no regions    -> { type: 'empty', regionIds: [] }
 *     - scope lookup failed / never ran   -> throws ScopeUnavailableError (503)
 *
 * There is deliberately no silent "unscoped" outcome: when scope is missing
 * the request fails closed instead of leaking rows.
 *
 * SQL helpers turn a resolved scope into WHERE fragments:
 *   regionIdsScopeClause('l.region_id', ids, startParam)
 *     Tables carrying a region_id column. Empty scope -> FALSE (no rows).
 *   userLocationScopeClause('u', regions, startParam)
 *     Boundary-definition matching against a users alias (zip_range,
 *     city_state, country_region, country_only). Empty scope -> FALSE.
 *     Pure geo_radius regions cannot be expressed in SQL; the helper
 *     reports geoRadiusOnly so the caller can do the wider-fetch + JS
 *     filter pattern instead of leaking rows.
 *
 * Extension point: the grant model currently carries only the region
 * dimension (admin_permission_grants.region_id). Entity/team scoping needs
 * grant-schema + migration work first; when it lands, resolveScope gains
 * new scope types and these fragment builders gain siblings.
 */

class ScopeUnavailableError extends Error {
  constructor(reason = 'scope_not_loaded') {
    super('Request scope is unavailable; refusing to serve unscoped data');
    this.name = 'ScopeUnavailableError';
    this.code = 'SCOPE_UNAVAILABLE';
    this.statusCode = 503;
    this.reason = reason;
  }
}

/**
 * Resolve the calling admin's data scope. Must run after requireAdmin and
 * (for regional admins) loadAssignedRegions. Throws ScopeUnavailableError
 * when scope cannot be established: fail closed, never unscoped.
 */
function resolveScope(req) {
  if (req.isSuper) return { type: 'global' };
  if (req.region_scope_unavailable) {
    throw new ScopeUnavailableError('scope_lookup_failed');
  }
  const regions = req.assigned_regions;
  if (regions === undefined || regions === null) {
    // The route did not load the admin's scope (or the loader is in an
    // unexpected state). Serving data now would be unscoped: refuse.
    throw new ScopeUnavailableError(regions === undefined ? 'scope_not_loaded' : 'scope_invalid');
  }
  if (!Array.isArray(regions)) throw new ScopeUnavailableError('scope_invalid');
  if (regions.length === 0) return { type: 'empty', regionIds: [] };
  const regionIds = [...new Set(
    regions.map((r) => r && r.id).filter((id) => id !== null && id !== undefined)
  )];
  return { type: 'regions', regions, regionIds };
}

/**
 * Express middleware: 503 when the request scope is unavailable, so routes
 * that forgot loadAssignedRegions (or hit a grant-lookup outage) fail
 * closed instead of serving unscoped data.
 */
function requireScopeAvailable(req, res, next) {
  try {
    resolveScope(req);
    return next();
  } catch (err) {
    if (err instanceof ScopeUnavailableError) {
      return res.status(err.statusCode).json({
        error: 'Request scope is temporarily unavailable. Please retry.',
        code: err.code,
      });
    }
    return next(err);
  }
}

/**
 * Scope fragment for tables with a region_id column.
 * Returns { clause, values, nextParam }. Empty scope -> 'FALSE'.
 */
function regionIdsScopeClause(columnRef, regionIds, startParam = 1) {
  const ids = Array.isArray(regionIds)
    ? regionIds.filter((id) => id !== null && id !== undefined)
    : [];
  if (ids.length === 0) return { clause: 'FALSE', values: [], nextParam: startParam };
  const placeholders = ids.map((_, i) => `$${startParam + i}`).join(',');
  return {
    clause: `(${columnRef} IN (${placeholders}))`,
    values: ids,
    nextParam: startParam + ids.length,
  };
}

function parseBoundary(region) {
  const def = region && region.boundary_definition;
  if (!def) return null;
  try {
    return typeof def === 'string' ? JSON.parse(def) : def;
  } catch {
    return null;
  }
}

/**
 * Scope fragment matching a users-table alias against region boundary
 * definitions. Same semantics as the region-scoped user list.
 * Empty/unexpressible scope -> 'FALSE' (no rows leak). Pure geo_radius
 * regions set geoRadiusOnly: true so the caller can widen the fetch and
 * filter in JS instead.
 */
function userLocationScopeClause(userAlias, regions, startParam = 1) {
  const a = userAlias;
  const orFragments = [];
  const values = [];
  let p = startParam;
  const list = Array.isArray(regions) ? regions : [];
  let geoRadiusOnly = list.length > 0;

  for (const r of list) {
    const def = parseBoundary(r);
    if (!def || typeof def.type !== 'string') {
      geoRadiusOnly = false;
      continue;
    }
    if (def.type === 'geo_radius') continue; // SQL cannot express; JS-filtered
    geoRadiusOnly = false;
    if (def.type === 'zip_range' && Array.isArray(def.ranges)) {
      for (const rng of def.ranges) {
        if (Number.isFinite(rng.start) && Number.isFinite(rng.end)) {
          orFragments.push(
            `(LEFT(${a}.zip_code, 5) ~ '^[0-9]+$' AND ` +
            `CAST(LEFT(${a}.zip_code, 5) AS INTEGER) BETWEEN $${p} AND $${p + 1})`
          );
          values.push(rng.start, rng.end);
          p += 2;
        }
      }
    } else if (def.type === 'city_state' && Array.isArray(def.entries)) {
      for (const e of def.entries) {
        orFragments.push(`(LOWER(${a}.city) = LOWER($${p}) AND UPPER(${a}.state) = UPPER($${p + 1}))`);
        values.push(e.city || '', e.state || '');
        p += 2;
      }
    } else if (def.type === 'country_region' && Array.isArray(def.entries)) {
      for (const e of def.entries) {
        if (!e || !e.country || !e.region) continue;
        orFragments.push(`(UPPER(${a}.country) = UPPER($${p}) AND UPPER(${a}.state) = UPPER($${p + 1}))`);
        values.push(e.country, e.region);
        p += 2;
      }
    } else if (def.type === 'country_only' && Array.isArray(def.countries)) {
      for (const c of def.countries) {
        if (!c) continue;
        orFragments.push(`(UPPER(${a}.country) = UPPER($${p}))`);
        values.push(c);
        p += 1;
      }
    }
  }

  if (orFragments.length === 0) {
    return { clause: 'FALSE', values: [], nextParam: startParam, geoRadiusOnly };
  }
  return { clause: `(${orFragments.join(' OR ')})`, values, nextParam: p, geoRadiusOnly: false };
}

module.exports = {
  ScopeUnavailableError,
  resolveScope,
  requireScopeAvailable,
  regionIdsScopeClause,
  userLocationScopeClause,
};
