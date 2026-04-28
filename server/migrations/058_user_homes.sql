-- Migration 058: User Homes
-- Home profiles enriched from Census + OSM + FEMA lookups.
-- OxSteed v2

CREATE TABLE IF NOT EXISTS user_homes (
  id                    BIGSERIAL    PRIMARY KEY,
  user_id               UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Address (from Census geocoder — confirmed, standardised)
  address               VARCHAR(300) NOT NULL,
  city                  VARCHAR(80),
  state                 VARCHAR(20),
  zip                   VARCHAR(20),
  lat                   NUMERIC(10,7),
  lng                   NUMERIC(10,7),

  -- User-provided details
  nickname              VARCHAR(80),
  home_type             VARCHAR(50),   -- 'house' | 'condo' | 'townhouse' | 'mobile' | 'other'
  year_built            SMALLINT,
  sqft                  INTEGER,
  bedrooms              SMALLINT,
  bathrooms             NUMERIC(3,1),
  notes                 TEXT,

  -- Auto-populated from public APIs
  flood_zone            VARCHAR(20),   -- from FEMA NFHL
  osm_building_levels   SMALLINT,      -- from OpenStreetMap

  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_homes_user ON user_homes (user_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_homes_updated_at') THEN
    CREATE TRIGGER trg_user_homes_updated_at
      BEFORE UPDATE ON user_homes
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
