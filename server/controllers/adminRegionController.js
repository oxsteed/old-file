'use strict';

/**
 * Admin Region CRUD
 *
 * Super-admins define geographic territories (regions) that can be assigned
 * to regular admins via the existing `admin_permission_grants` mechanism
 * (via the new `region_id` column).
 */

const db             = require('../db');
const logger         = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');
const countriesUtil  = require('../utils/countries');

// ── Validation helpers ──────────────────────────────────────────────────────

function validateBoundary(def) {
  if (!def || typeof def !== 'object') return 'boundary_definition must be an object.';
  if (!def.type) return 'boundary_definition.type is required.';

  switch (def.type) {
    case 'zip_range':
      if (!Array.isArray(def.ranges) || def.ranges.length === 0) {
        return 'zip_range requires a non-empty `ranges` array.';
      }
      for (const r of def.ranges) {
        if (!Number.isFinite(r.start) || !Number.isFinite(r.end) || r.start > r.end) {
          return 'Each zip range must have numeric start <= end.';
        }
      }
      return null;

    case 'city_state':
      if (!Array.isArray(def.entries) || def.entries.length === 0) {
        return 'city_state requires a non-empty `entries` array.';
      }
      for (const e of def.entries) {
        if (!e.city || !e.state) {
          return 'Each city_state entry requires both `city` and `state`.';
        }
      }
      return null;

    case 'geo_radius':
      if (!def.center || !Number.isFinite(def.center.lat) || !Number.isFinite(def.center.lng)) {
        return 'geo_radius requires `center.lat` and `center.lng` numbers.';
      }
      if (!Number.isFinite(def.radius_miles) || def.radius_miles <= 0) {
        return 'geo_radius requires a positive `radius_miles`.';
      }
      return null;

    // country_region: explicit (country, region) pairs — e.g. give a regional
    // admin authority over Ontario (CA) and New York (US) at the same time.
    case 'country_region':
      if (!Array.isArray(def.entries) || def.entries.length === 0) {
        return 'country_region requires a non-empty `entries` array.';
      }
      for (const e of def.entries) {
        if (!e.country || !countriesUtil.isValidCountry(e.country)) {
          return 'Each country_region entry requires a valid ISO-2 `country`.';
        }
        if (!e.region) {
          return 'Each country_region entry requires a `region`.';
        }
        // For known-region countries the region must be in the canonical list;
        // for free-text countries any non-empty string is acceptable.
        if (!countriesUtil.isValidRegion(e.country, e.region)) {
          return `Region '${e.region}' is not valid for country '${e.country}'.`;
        }
      }
      return null;

    // country_only: territory is the entire country/countries — useful for
    // launch markets that don't yet have a finer-grained breakdown.
    case 'country_only':
      if (!Array.isArray(def.countries) || def.countries.length === 0) {
        return 'country_only requires a non-empty `countries` array.';
      }
      for (const c of def.countries) {
        if (!countriesUtil.isValidCountry(c)) {
          return `Unknown country code: ${c}.`;
        }
      }
      return null;

    default:
      return `Unknown boundary type: ${def.type}.`;
  }
}

// ── GET /admin/super/regions ────────────────────────────────────────────────

exports.listRegions = async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT r.id, r.name, r.description, r.boundary_definition,
             r.created_by, r.created_at, r.updated_at,
             u.first_name || ' ' || u.last_name AS created_by_name,
             (SELECT COUNT(*) FROM admin_permission_grants g
                WHERE g.region_id = r.id
                  AND g.revoked_at IS NULL
                  AND g.expires_at > NOW())::int AS active_grants_count
        FROM admin_regions r
        LEFT JOIN users u ON u.id = r.created_by
       ORDER BY r.name ASC
    `);
    return res.json({ regions: rows });
  } catch (err) {
    logger.error('listRegions error', { err: err.message });
    return res.status(500).json({ error: 'Failed to list regions.' });
  }
};

// ── POST /admin/super/regions ───────────────────────────────────────────────

exports.createRegion = async (req, res) => {
  try {
    const { name, description = null, boundary_definition } = req.body || {};
    if (!name || !name.toString().trim()) {
      return res.status(400).json({ error: 'name is required.' });
    }
    const boundaryError = validateBoundary(boundary_definition);
    if (boundaryError) return res.status(400).json({ error: boundaryError });

    const { rows } = await db.query(`
      INSERT INTO admin_regions (name, description, boundary_definition, created_by)
      VALUES ($1, $2, $3::jsonb, $4)
      RETURNING *
    `, [name.trim(), description, JSON.stringify(boundary_definition), req.user.id]);

    logAdminAction({
      adminId: req.user.id,
      action: 'region_created',
      targetType: 'admin_region',
      targetId: rows[0].id,
      description: `Created region "${name}"`,
      after: rows[0],
      req,
    }).catch(() => {});

    return res.status(201).json({ region: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A region with that name already exists.' });
    }
    logger.error('createRegion error', { err: err.message });
    return res.status(500).json({ error: 'Failed to create region.' });
  }
};

// ── PUT /admin/super/regions/:regionId ──────────────────────────────────────

exports.updateRegion = async (req, res) => {
  try {
    const { regionId } = req.params;
    const { name, description, boundary_definition } = req.body || {};

    const { rows: existing } = await db.query(
      'SELECT * FROM admin_regions WHERE id = $1', [regionId]
    );
    if (!existing.length) return res.status(404).json({ error: 'Region not found.' });

    if (boundary_definition !== undefined) {
      const err = validateBoundary(boundary_definition);
      if (err) return res.status(400).json({ error: err });
    }

    const updates = [];
    const values  = [];
    let p = 1;

    if (name !== undefined) {
      if (!name || !name.toString().trim()) {
        return res.status(400).json({ error: 'name cannot be empty.' });
      }
      updates.push(`name = $${p++}`);  values.push(name.trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${p++}`); values.push(description);
    }
    if (boundary_definition !== undefined) {
      updates.push(`boundary_definition = $${p++}::jsonb`);
      values.push(JSON.stringify(boundary_definition));
    }
    if (!updates.length) {
      return res.status(400).json({ error: 'No updatable fields supplied.' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(regionId);
    const { rows } = await db.query(
      `UPDATE admin_regions SET ${updates.join(', ')} WHERE id = $${p} RETURNING *`,
      values
    );

    logAdminAction({
      adminId: req.user.id,
      action: 'region_updated',
      targetType: 'admin_region',
      targetId: regionId,
      description: `Updated region #${regionId}`,
      before: existing[0],
      after: rows[0],
      req,
    }).catch(() => {});

    return res.json({ region: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A region with that name already exists.' });
    }
    logger.error('updateRegion error', { err: err.message });
    return res.status(500).json({ error: 'Failed to update region.' });
  }
};

// ── DELETE /admin/super/regions/:regionId ───────────────────────────────────

exports.deleteRegion = async (req, res) => {
  try {
    const { regionId } = req.params;
    const { rows: existing } = await db.query(
      'SELECT * FROM admin_regions WHERE id = $1', [regionId]
    );
    if (!existing.length) return res.status(404).json({ error: 'Region not found.' });

    // Refuse delete if any active grant references this region
    const { rows: gr } = await db.query(`
      SELECT COUNT(*)::int AS c FROM admin_permission_grants
       WHERE region_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
    `, [regionId]);
    if (gr[0].c > 0) {
      return res.status(409).json({
        error: 'Region is assigned to one or more active admin grants. Revoke them first.',
      });
    }

    await db.query('DELETE FROM admin_regions WHERE id = $1', [regionId]);

    logAdminAction({
      adminId: req.user.id,
      action: 'region_deleted',
      targetType: 'admin_region',
      targetId: regionId,
      description: `Deleted region "${existing[0].name}"`,
      before: existing[0],
      req,
    }).catch(() => {});

    return res.json({ deleted: true });
  } catch (err) {
    logger.error('deleteRegion error', { err: err.message });
    return res.status(500).json({ error: 'Failed to delete region.' });
  }
};
