-- Migration 99921: brand menu publications (F-02 phase 2).
--
-- Cross-brand menu publishing: HQ picks items from a source restaurant's menu
-- and publishes them to stores of other restaurants in the same brand. The
-- publish fans out to one row per (source item, target store); the sync step
-- copies the item into the target restaurant (linked via
-- food_menu_items.brand_source_item_id so re-publishes update instead of
-- duplicating) and writes per-store overrides into
-- restaurant_store_menu_overrides (migration 963) for price/availability.
-- Request-level idempotency lives on brand_menu_publish_batches so a retried
-- POST with the same key returns the stored result instead of re-fanning.
--
-- The brand-source dedup index is UNIQUE from the start: the publish sync
-- upserts with ON CONFLICT (restaurant_id, brand_source_item_id) WHERE
-- brand_source_item_id IS NOT NULL, and only a unique index can serve as an
-- ON CONFLICT arbiter (42P10 otherwise). The uniqueness is also the real
-- invariant: at most one target copy of a brand menu item per restaurant, so
-- re-publishes update instead of duplicating.

ALTER TABLE food_menu_items
  ADD COLUMN IF NOT EXISTS brand_source_item_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'food_menu_items_brand_source_fk'
       AND conrelid = 'food_menu_items'::regclass
  ) THEN
    ALTER TABLE food_menu_items
      ADD CONSTRAINT food_menu_items_brand_source_fk
      FOREIGN KEY (brand_source_item_id) REFERENCES food_menu_items(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_menu_items_brand_source
  ON food_menu_items (restaurant_id, brand_source_item_id)
  WHERE brand_source_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS brand_menu_publish_batches (
  id BIGSERIAL PRIMARY KEY,
  brand_id BIGINT NOT NULL REFERENCES restaurant_brands(id) ON DELETE CASCADE,
  source_restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(200) NOT NULL,
  target_count INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_menu_publish_batches_idem
  ON brand_menu_publish_batches (brand_id, idempotency_key);

CREATE TABLE IF NOT EXISTS brand_menu_publications (
  id BIGSERIAL PRIMARY KEY,
  brand_id BIGINT NOT NULL REFERENCES restaurant_brands(id) ON DELETE CASCADE,
  batch_id BIGINT REFERENCES brand_menu_publish_batches(id) ON DELETE SET NULL,
  source_restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  source_menu_item_id BIGINT NOT NULL REFERENCES food_menu_items(id) ON DELETE CASCADE,
  target_restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  target_location_id BIGINT NOT NULL REFERENCES restaurant_locations(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(200) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'synced', 'failed')),
  target_menu_item_id BIGINT REFERENCES food_menu_items(id) ON DELETE SET NULL,
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  is_available BOOLEAN,
  error_message TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT brand_menu_pub_cross_restaurant CHECK (source_restaurant_id <> target_restaurant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_menu_publications_idem
  ON brand_menu_publications (brand_id, idempotency_key);

-- One live publication per (source item, target store): re-publishing the same
-- item to the same store updates the target copy instead of duplicating it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_menu_publications_target
  ON brand_menu_publications (source_menu_item_id, target_restaurant_id, target_location_id);

CREATE INDEX IF NOT EXISTS idx_brand_menu_publications_batch
  ON brand_menu_publications (batch_id, status);

-- Tenant guard: a publication's brand must own both the source and the target
-- restaurant. Enforced in the service; this index keeps the check cheap.
CREATE INDEX IF NOT EXISTS idx_brand_menu_publications_brand
  ON brand_menu_publications (brand_id, target_restaurant_id, status);
