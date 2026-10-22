-- Migration 1000: brand-source dedup index must be UNIQUE (F-02 phase 2 fix).
--
-- Migration 995 created idx_food_menu_items_brand_source as a plain partial
-- index, but the publish sync upserts with ON CONFLICT (restaurant_id,
-- brand_source_item_id) WHERE brand_source_item_id IS NOT NULL, and only a
-- unique index can serve as an ON CONFLICT arbiter (42P10 otherwise). The
-- uniqueness is also the real invariant: at most one target copy of a brand
-- menu item per restaurant, so re-publishes update instead of duplicating.

DROP INDEX IF EXISTS idx_food_menu_items_brand_source;

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_menu_items_brand_source
  ON food_menu_items (restaurant_id, brand_source_item_id)
  WHERE brand_source_item_id IS NOT NULL;
