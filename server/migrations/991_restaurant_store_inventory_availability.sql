-- Migration 991: keep inventory availability store-scoped.
-- Brand menu rows remain the fallback for legacy/all-store syncs; an
-- inventory-backed store override records the stock state for one location.

ALTER TABLE restaurant_store_menu_overrides
  ADD COLUMN IF NOT EXISTS inventory_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS inventory_availability_state VARCHAR(24);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurant_store_menu_overrides_inventory_state_check'
       AND conrelid = 'restaurant_store_menu_overrides'::regclass
  ) THEN
    ALTER TABLE restaurant_store_menu_overrides
      ADD CONSTRAINT restaurant_store_menu_overrides_inventory_state_check
      CHECK (inventory_availability_state IS NULL
        OR inventory_availability_state IN ('available', 'limited', 'unavailable'));
  END IF;
END $$;

ALTER TABLE restaurant_inventory_availability_events
  ADD COLUMN IF NOT EXISTS location_id BIGINT;

UPDATE restaurant_inventory_availability_events e
   SET location_id = COALESCE(
     (SELECT i.location_id
        FROM restaurant_inventory_items i
       WHERE i.id = e.inventory_item_id
         AND i.restaurant_id = e.restaurant_id),
     (SELECT l.id
        FROM restaurant_locations l
       WHERE l.restaurant_id = e.restaurant_id
         AND l.is_primary = TRUE
       ORDER BY l.id
       LIMIT 1)
   )
 WHERE e.location_id IS NULL
   AND EXISTS (
     SELECT 1 FROM restaurant_locations l
      WHERE l.restaurant_id = e.restaurant_id
        AND l.is_primary = TRUE
   );

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_availability_events_location
  ON restaurant_inventory_availability_events(restaurant_id, location_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurant_inventory_availability_events_restaurant_location_fk'
       AND conrelid = 'restaurant_inventory_availability_events'::regclass
  ) THEN
    ALTER TABLE restaurant_inventory_availability_events
      ADD CONSTRAINT restaurant_inventory_availability_events_restaurant_location_fk
      FOREIGN KEY (restaurant_id, location_id)
      REFERENCES restaurant_locations(restaurant_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;
