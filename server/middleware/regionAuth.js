'use strict';

/**
 * Regional admin scope enforcement.
 *
 * Three layers:
 *   1. `loadAssignedRegions`     — express middleware that hydrates
 *                                  `req.user.assigned_regions` (array of region rows)
 *                                  for the current admin from active permission grants.
 *   2. `userMatchesAnyRegion`    — pure helper: does a target user match
 *                                  any of the supplied regions?
 *   3. `requireRegionAccessForUser` — middleware factory that asserts the
 *                                  admin can act on `req.params[paramName]`.
 *
 * Super-admins bypass all checks. Admins with no region restriction on
 * their grants behave like full admins (legacy behaviour).
 */

const db     = require('../db');
const logger = require('../utils/logger');

// ── Pure region-match helpers ───────────────────────────────────────────────

function isUserInZipRangeRegion(user, def) {
  const zipRaw = (user.zip_code || '').toString().trim();
  if (!zipRaw) return false;
  const userZip = parseInt(zipRaw.slice(0, 5), 10);
  if (!Number.isFinite(userZip)) return false;
  return (def.ranges || []).some(r =>
    Number.isFinite(r.start) && Number.isFinite(r.end) &&
    userZip >= r.start && userZip <= r.end
  );
}

function isUserInCityStateRegion(user, def) {
  const userCity  = (user.city  || '').trim().toLowerCase();
  const userState = (user.state || '').trim().toUpperCase();
  return (def.entries || []).some(entry =>
    (entry.city || '').trim().toLowerCase() === userCity &&
    (entry.state || '').trim().toUpperCase() === userState
  );
}

function haversineMiles(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.7613;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function isUserInGeoRadiusRegion(user, def) {
  if (user.latitude == null || user.longitude == null) return false;
  if (!def?.center || def.radius_miles == null) return false;
  const d = haversineMiles(
    { lat: parseFloat(user.latitude), lng: parseFloat(user.longitude) },
    { lat: parseFloat(def.center.lat), lng: parseFloat(def.center.lng) }
  );
  return d <= parseFloat(def.radius_miles);
}

function isUserInRegion(user, region) {
  if (!region || !region.boundary_definition) return false;
  const def = typeof region.boundary_definition === 'string'
    ? JSON.parse(region.boundary_definition)
    : region.boundary_definition;
  switch (def.type) {
    case 'zip_range':  return isUserInZipRangeRegion(user, def);
    case 'city_state': return isUserInCityStateRegion(user, def);
    case 'geo_radius': return isUserInGeoRadiusRegion(user, def);
    default:           return false;
  }
}

function userMatchesAnyRegion(user, regions) {
  if (!Array.isArray(regions) || regions.length === 0) return false;
  return regions.some(r => isUserInRegion(user, r));
}

// ── Express middleware ──────────────────────────────────────────────────────

/**
 * Hydrates `req.user.assigned_regions` (array of region rows) from active,
 * non-revoked permission grants. Super-admins receive all regions.
 *
 * Must run AFTER `requireAdmin` so `req.user` and `req.isSuper` are set.
 */
async function loadAssignedRegions(req, res, next) {
  try {
    if (!req.user) {
      req.assigned_regions = [];
      return next();
    }

    if (req.isSuper) {
      req.assigned_regions = null; // null sentinel = "no restriction"
      return next();
    }

    const { rows } = await db.query(`
      SELECT r.id, r.name, r.boundary_definition
        FROM admin_permission_grants g
        JOIN admin_regions r ON r.id = g.region_id
       WHERE g.grantee_id = $1
         AND g.region_id IS NOT NULL
         AND g.revoked_at IS NULL
         AND g.expires_at > NOW()
    `, [req.user.id]);

    // Deduplicate by region id (an admin may have several grants on same region)
    const seen = new Map();
    for (const r of rows) seen.set(r.id, r);
    req.assigned_regions = Array.from(seen.values());
    next();
  } catch (err) {
    logger.error('loadAssignedRegions failed', { error: err.message });
    req.assigned_regions = [];
    next();
  }
}

/**
 * Middleware factory: enforces that the current admin can act on the user
 * whose id is in `req.params[paramName]`. Super-admins bypass. Admins with
 * no region scope (no region_id grants) are treated as full admins —
 * region scoping is opt-in and only applies once a region is assigned.
 */
function requireRegionAccessForUser(paramName = 'userId') {
  return async (req, res, next) => {
    try {
      if (req.isSuper) return next();

      // Admin with no scoped region grants — fall through (legacy admins)
      const regions = req.assigned_regions;
      if (regions === null || regions === undefined) return next();
      if (!Array.isArray(regions) || regions.length === 0) return next();

      const targetId = req.params[paramName];
      if (!targetId) return res.status(400).json({ error: 'Missing user id.' });

      const { rows } = await db.query(
        `SELECT id, city, state, zip_code, latitude, longitude
           FROM users WHERE id = $1`,
        [targetId]
      );
      if (!rows.length) return res.status(404).json({ error: 'User not found.' });

      if (!userMatchesAnyRegion(rows[0], regions)) {
        return res.status(403).json({
          error: 'Access denied: user is outside your assigned region.',
        });
      }
      req.targetUser = rows[0];
      return next();
    } catch (err) {
      logger.error('requireRegionAccessForUser failed', { error: err.message });
      return res.status(500).json({ error: 'Region authorization check failed.' });
    }
  };
}

module.exports = {
  loadAssignedRegions,
  requireRegionAccessForUser,
  userMatchesAnyRegion,
  isUserInRegion,
};
