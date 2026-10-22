-- Migration 988: first-class restaurant brand regions.
--
-- The restaurant row is the existing brand anchor.  This adds an explicit
-- region layer between that brand and its physical stores, while preserving
-- the staged location rollout and keeping every relationship tenant-bound.

CREATE TABLE IF NOT EXISTS restaurant_regions (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  parent_region_id BIGINT,
  code VARCHAR(48) NOT NULL,
  name VARCHAR(160) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, id),
  CONSTRAINT restaurant_regions_parent_fk
    FOREIGN KEY (restaurant_id, parent_region_id)
    REFERENCES restaurant_regions(restaurant_id, id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_regions_code
  ON restaurant_regions (restaurant_id, LOWER(code));
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_regions_name
  ON restaurant_regions (restaurant_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_restaurant_regions_parent
  ON restaurant_regions (restaurant_id, parent_region_id, status, name);

ALTER TABLE restaurant_locations
  ADD COLUMN IF NOT EXISTS region_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurant_locations_region_fk'
       AND conrelid = 'restaurant_locations'::regclass
  ) THEN
    ALTER TABLE restaurant_locations
      ADD CONSTRAINT restaurant_locations_region_fk
      FOREIGN KEY (restaurant_id, region_id)
      REFERENCES restaurant_regions(restaurant_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_restaurant_locations_region
  ON restaurant_locations (restaurant_id, region_id, status, name);

-- Every existing brand receives a stable root region.  Stores remain in that
-- root until an owner assigns them to a more specific region.
INSERT INTO restaurant_regions (restaurant_id, code, name)
SELECT fr.id, 'all-stores', 'All stores'
  FROM food_restaurants fr
 WHERE NOT EXISTS (
   SELECT 1 FROM restaurant_regions rr
    WHERE rr.restaurant_id = fr.id AND LOWER(rr.code) = 'all-stores'
 );

UPDATE restaurant_locations l
   SET region_id = rr.id
  FROM restaurant_regions rr
 WHERE rr.restaurant_id = l.restaurant_id
   AND LOWER(rr.code) = 'all-stores'
   AND l.region_id IS NULL;

CREATE OR REPLACE FUNCTION restaurant_ensure_default_region(restaurant_key BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE region_key BIGINT;
BEGIN
  SELECT id INTO region_key
    FROM restaurant_regions
   WHERE restaurant_id = restaurant_key
     AND LOWER(code) = 'all-stores'
   LIMIT 1;
  IF region_key IS NULL THEN
    INSERT INTO restaurant_regions (restaurant_id, code, name)
    VALUES (restaurant_key, 'all-stores', 'All stores')
    ON CONFLICT DO NOTHING;
    SELECT id INTO region_key
      FROM restaurant_regions
     WHERE restaurant_id = restaurant_key AND LOWER(code) = 'all-stores'
     LIMIT 1;
  END IF;
  RETURN region_key;
END;
$$;

CREATE OR REPLACE FUNCTION restaurant_default_region_created()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM restaurant_ensure_default_region(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restaurant_default_region_created ON food_restaurants;
CREATE TRIGGER restaurant_default_region_created
  AFTER INSERT ON food_restaurants
  FOR EACH ROW EXECUTE FUNCTION restaurant_default_region_created();

CREATE OR REPLACE FUNCTION restaurant_location_default_region()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE region_key BIGINT;
BEGIN
  IF NEW.region_id IS NULL THEN
    region_key := restaurant_ensure_default_region(NEW.restaurant_id);
    NEW.region_id := region_key;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM restaurant_regions rr
     WHERE rr.restaurant_id = NEW.restaurant_id AND rr.id = NEW.region_id
  ) THEN
    RAISE EXCEPTION 'restaurant location region crosses a brand tenant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restaurant_location_default_region ON restaurant_locations;
CREATE TRIGGER restaurant_location_default_region
  BEFORE INSERT OR UPDATE OF restaurant_id, region_id ON restaurant_locations
  FOR EACH ROW EXECUTE FUNCTION restaurant_location_default_region();

CREATE OR REPLACE FUNCTION restaurant_regions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restaurant_regions_updated_at ON restaurant_regions;
CREATE TRIGGER restaurant_regions_updated_at
  BEFORE UPDATE ON restaurant_regions
  FOR EACH ROW EXECUTE FUNCTION restaurant_regions_updated_at();
