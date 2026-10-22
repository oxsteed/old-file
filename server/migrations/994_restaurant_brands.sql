-- Migration 994: first-class restaurant brands above food_restaurants.
--
-- F-02 phase 2. Until now the restaurant row doubled as the brand anchor and
-- one restaurant per business is enforced (idx_food_restaurants_business_unique),
-- so a multi-unit operator had no parent entity to group stores, publish menus
-- from, or roll up. This adds restaurant_brands as that parent: a brand groups
-- one or more restaurants (concepts) across businesses, each restaurant keeps
-- its own regions -> stores hierarchy, and HQ consoles aggregate at the brand.
-- The business -> one-restaurant constraint is intentionally left intact; the
-- brand is the cross-business grouping, not a replacement tenancy.

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'food_restaurants_brand_fk'
       AND conrelid = 'food_restaurants'::regclass
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_brand_fk
      FOREIGN KEY (brand_id) REFERENCES restaurant_brands(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_food_restaurants_brand
  ON food_restaurants (brand_id);

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
-- "every restaurant belongs to exactly one brand" holds going forward.
CREATE OR REPLACE FUNCTION restaurant_ensure_brand(restaurant_key BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE brand_key BIGINT;
DECLARE biz_key BIGINT;
DECLARE owner_key UUID;
BEGIN
  SELECT fr.business_id, fr.owner_user_id INTO biz_key, owner_key
    FROM food_restaurants fr WHERE fr.id = restaurant_key;
  IF biz_key IS NULL THEN RETURN; END IF;
  SELECT rb.id INTO brand_key FROM restaurant_brands rb WHERE rb.slug = 'brand-' || biz_key;
  IF brand_key IS NULL THEN
    INSERT INTO restaurant_brands (name, slug, owner_user_id, created_by)
    SELECT b.business_name, 'brand-' || b.id, owner_key, owner_key
      FROM businesses b WHERE b.id = biz_key
    RETURNING id INTO brand_key;
  END IF;
  IF brand_key IS NOT NULL THEN
    UPDATE food_restaurants SET brand_id = brand_key
     WHERE id = restaurant_key AND brand_id IS NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION restaurant_brand_created() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM restaurant_ensure_brand(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS restaurant_brand_created ON food_restaurants;
CREATE TRIGGER restaurant_brand_created AFTER INSERT ON food_restaurants
  FOR EACH ROW EXECUTE FUNCTION restaurant_brand_created();
