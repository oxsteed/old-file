-- Migration 99920: first-class restaurant brands + per-brand tenancy (F-02 phase 2).
--
-- Until now the restaurant row doubled as the brand anchor and one restaurant
-- per business was enforced (idx_food_restaurants_business_unique), so a
-- multi-unit operator had no parent entity to group stores, publish menus
-- from, or roll up. This adds restaurant_brands as that parent: a brand
-- groups one or more restaurants (concepts) across businesses, each restaurant
-- keeps its own regions -> stores hierarchy, and HQ consoles aggregate at the
-- brand. The brand is now the required tenancy parent above
-- restaurant -> region -> store:
--   1. every business that owns restaurants gets exactly one brand, so every
--      existing restaurant keeps a 1:1 brand until an owner merges brands;
--   2. a BEFORE INSERT trigger assigns NEW.brand_id, so brand_id NOT NULL
--      holds at insert time;
--   3. idx_food_restaurants_business_unique is dropped: a business may now own
--      multiple restaurants, and they all join the business's brand;
--   4. brands with restaurants cannot be deleted (ON DELETE RESTRICT):
--      archive the brand instead;
--   5. adds the per-store identity primitive
--      restaurant_locations.store_code (franchise store numbers), unique per
--      restaurant when set.

CREATE TABLE IF NOT EXISTS restaurant_brands (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  logo_url TEXT,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_brands_slug
  ON restaurant_brands (LOWER(slug));
CREATE INDEX IF NOT EXISTS idx_restaurant_brands_owner
  ON restaurant_brands (owner_user_id, status);

ALTER TABLE food_restaurants
  ADD COLUMN IF NOT EXISTS brand_id BIGINT;

-- Staged rollout: every business that owns restaurants gets exactly one brand,
-- so every existing restaurant keeps a 1:1 brand until an owner merges brands.
INSERT INTO restaurant_brands (name, slug, owner_user_id, created_by)
SELECT DISTINCT
  b.business_name,
  'brand-' || b.id,
  (SELECT fr.owner_user_id FROM food_restaurants fr WHERE fr.business_id = b.id ORDER BY fr.id LIMIT 1),
  (SELECT fr.owner_user_id FROM food_restaurants fr WHERE fr.business_id = b.id ORDER BY fr.id LIMIT 1)
FROM businesses b
JOIN food_restaurants fr ON fr.business_id = b.id
WHERE NOT EXISTS (
  SELECT 1 FROM restaurant_brands rb WHERE rb.slug = 'brand-' || b.id
);

UPDATE food_restaurants fr
   SET brand_id = rb.id
  FROM businesses b
  JOIN restaurant_brands rb ON rb.slug = 'brand-' || b.id
 WHERE fr.business_id = b.id
   AND fr.brand_id IS NULL;

-- New restaurants join their business's brand automatically so the invariant
-- "every restaurant belongs to exactly one brand" holds at insert time.
CREATE OR REPLACE FUNCTION restaurant_brand_assign() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE brand_key BIGINT;
DECLARE biz_key BIGINT;
BEGIN
  IF NEW.brand_id IS NOT NULL THEN RETURN NEW; END IF;
  biz_key := NEW.business_id;
  IF biz_key IS NULL THEN RETURN NEW; END IF;
  SELECT rb.id INTO brand_key FROM restaurant_brands rb WHERE rb.slug = 'brand-' || biz_key;
  IF brand_key IS NULL THEN
    INSERT INTO restaurant_brands (name, slug, owner_user_id, created_by)
    SELECT b.business_name, 'brand-' || b.id, NEW.owner_user_id, NEW.owner_user_id
      FROM businesses b WHERE b.id = biz_key
    RETURNING id INTO brand_key;
  END IF;
  NEW.brand_id := brand_key;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS restaurant_brand_created ON food_restaurants;
CREATE TRIGGER restaurant_brand_created BEFORE INSERT ON food_restaurants
  FOR EACH ROW EXECUTE FUNCTION restaurant_brand_assign();

-- Deleting a brand with restaurants is refused; archive it instead.
ALTER TABLE food_restaurants DROP CONSTRAINT IF EXISTS food_restaurants_brand_fk;
ALTER TABLE food_restaurants
  ADD CONSTRAINT food_restaurants_brand_fk
  FOREIGN KEY (brand_id) REFERENCES restaurant_brands(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_food_restaurants_brand
  ON food_restaurants (brand_id);

-- The brand is now the required tenancy parent (backfill above ran first).
ALTER TABLE food_restaurants ALTER COLUMN brand_id SET NOT NULL;

-- One restaurant per business is no longer enforced.
DROP INDEX IF EXISTS idx_food_restaurants_business_unique;

-- Per-store identity: franchise store numbers, unique per restaurant.
ALTER TABLE restaurant_locations
  ADD COLUMN IF NOT EXISTS store_code VARCHAR(24);

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_locations_store_code
  ON restaurant_locations (restaurant_id, store_code)
  WHERE store_code IS NOT NULL;
