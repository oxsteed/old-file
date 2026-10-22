-- Migration 969: attach inventory procurement records to a physical store.
-- Existing rows are backfilled to the restaurant's primary location when one
-- exists; the column stays nullable for restaurants still completing rollout.

ALTER TABLE restaurant_inventory_purchase_requests
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL;

ALTER TABLE restaurant_inventory_supplier_issues
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL;

UPDATE restaurant_inventory_purchase_requests r
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = r.restaurant_id
   AND l.is_primary = TRUE
   AND r.location_id IS NULL;

UPDATE restaurant_inventory_supplier_issues i
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = i.restaurant_id
   AND l.is_primary = TRUE
   AND i.location_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_purchase_requests_location
  ON restaurant_inventory_purchase_requests(restaurant_id, location_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_supplier_issues_location
  ON restaurant_inventory_supplier_issues(restaurant_id, location_id, created_at DESC);
