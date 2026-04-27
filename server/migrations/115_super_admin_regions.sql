-- Migration 115: Super-Admin Regional Territories
--
-- Adds the `admin_regions` table used to define geographic territories that
-- regional admins can be scoped to. A region is a JSONB boundary definition
-- that supports multiple match strategies (zip range, city/state, geo radius).
--
-- Also adds `region_id` to `admin_permission_grants` so super-admins can
-- restrict a regular admin's elevated grant to a specific territory.

-- ── 1. admin_regions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_regions (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(100) NOT NULL UNIQUE,
  description         TEXT,
  -- Boundary shape examples:
  --   { "type": "zip_range",  "ranges": [{ "start": 60001, "end": 60699 }] }
  --   { "type": "city_state", "entries": [{ "city": "Chicago", "state": "IL" }] }
  --   { "type": "geo_radius", "center": { "lat": 41.87, "lng": -87.62 }, "radius_miles": 25 }
  boundary_definition JSONB        NOT NULL,
  created_by          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regions_name       ON admin_regions(name);
CREATE INDEX IF NOT EXISTS idx_regions_created_by ON admin_regions(created_by);

-- ── 2. Region scoping on permission grants ────────────────────────────────────

ALTER TABLE admin_permission_grants
  ADD COLUMN IF NOT EXISTS region_id INTEGER REFERENCES admin_regions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_perm_grants_region
  ON admin_permission_grants(region_id)
  WHERE region_id IS NOT NULL;
