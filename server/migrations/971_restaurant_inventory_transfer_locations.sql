-- Migration 971: retain the store tenant on inventory transfers.
-- Existing transfers are backfilled from their inventory item's location;
-- legacy rows with no item location remain nullable during the staged rollout.

ALTER TABLE restaurant_inventory_transfers
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL;

UPDATE restaurant_inventory_transfers t
   SET location_id = i.location_id
  FROM restaurant_inventory_items i
 WHERE t.item_id = i.id
   AND t.location_id IS NULL
   AND i.location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_transfers_location
  ON restaurant_inventory_transfers(restaurant_id, location_id, created_at DESC);

