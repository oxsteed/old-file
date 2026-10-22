-- Store-specific order pacing and prep-time extensions. NULL pacing values
-- inherit the restaurant setting; zero explicitly disables pacing for a store.
ALTER TABLE restaurant_locations
  ADD COLUMN IF NOT EXISTS online_order_pacing_max_per_15_min INTEGER,
  ADD COLUMN IF NOT EXISTS in_store_order_pacing_max_per_15_min INTEGER,
  ADD COLUMN IF NOT EXISTS prep_time_extension_min INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_locations_online_pacing_valid') THEN
    ALTER TABLE restaurant_locations ADD CONSTRAINT restaurant_locations_online_pacing_valid
      CHECK (online_order_pacing_max_per_15_min IS NULL OR online_order_pacing_max_per_15_min BETWEEN 0 AND 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_locations_in_store_pacing_valid') THEN
    ALTER TABLE restaurant_locations ADD CONSTRAINT restaurant_locations_in_store_pacing_valid
      CHECK (in_store_order_pacing_max_per_15_min IS NULL OR in_store_order_pacing_max_per_15_min BETWEEN 0 AND 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_locations_prep_extension_valid') THEN
    ALTER TABLE restaurant_locations ADD CONSTRAINT restaurant_locations_prep_extension_valid
      CHECK (prep_time_extension_min BETWEEN 0 AND 240);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_restaurant_locations_order_pacing
  ON restaurant_locations(restaurant_id, id, online_order_pacing_max_per_15_min,
    in_store_order_pacing_max_per_15_min);
