-- Migration 377: OxSteed Direct service areas
-- Stores company-owned Direct coverage radii and a small geocode cache for
-- public availability checks.

CREATE TABLE IF NOT EXISTS direct_service_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label VARCHAR(160) NOT NULL,
  anchor_zip VARCHAR(20) NOT NULL,
  anchor_lat NUMERIC(9, 6) NOT NULL,
  anchor_lng NUMERIC(9, 6) NOT NULL,
  radius_miles NUMERIC(7, 2) NOT NULL DEFAULT 60 CHECK (radius_miles > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS direct_geocode_cache (
  query VARCHAR(300) PRIMARY KEY,
  label TEXT,
  zip_code VARCHAR(20),
  lat NUMERIC(9, 6) NOT NULL,
  lng NUMERIC(9, 6) NOT NULL,
  provider VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_direct_service_areas_active
  ON direct_service_areas (active);

CREATE INDEX IF NOT EXISTS idx_direct_service_areas_zip
  ON direct_service_areas (anchor_zip);

INSERT INTO direct_service_areas (
  id,
  label,
  anchor_zip,
  anchor_lat,
  anchor_lng,
  radius_miles,
  active,
  notes
) VALUES (
  '45503000-0000-4000-8000-000000000001',
  'Springfield, OH',
  '45503',
  39.952800,
  -83.780400,
  60,
  TRUE,
  'Default OxSteed Direct service radius from ZIP 45503.'
)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  anchor_zip = EXCLUDED.anchor_zip,
  anchor_lat = EXCLUDED.anchor_lat,
  anchor_lng = EXCLUDED.anchor_lng,
  radius_miles = EXCLUDED.radius_miles,
  active = EXCLUDED.active,
  notes = EXCLUDED.notes,
  updated_at = CURRENT_TIMESTAMP;
