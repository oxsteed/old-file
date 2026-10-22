-- Preserve the store of an inventory audit event even after its entity is
-- deleted. Global setup events and historical events whose store cannot be
-- established remain NULL and are visible only to all-store readers.
ALTER TABLE restaurant_inventory_audit_events ADD COLUMN IF NOT EXISTS location_id BIGINT;

CREATE OR REPLACE FUNCTION restaurant_inventory_audit_location(BIGINT, TEXT, BIGINT)
RETURNS BIGINT LANGUAGE SQL STABLE AS $$
  SELECT CASE $2
    WHEN 'item' THEN (SELECT location_id FROM restaurant_inventory_items WHERE restaurant_id=$1 AND id=$3)
    WHEN 'mapping' THEN (
      SELECT i.location_id FROM restaurant_inventory_item_mappings m
      JOIN restaurant_inventory_items i ON i.id=m.inventory_item_id AND i.restaurant_id=m.restaurant_id
      WHERE m.restaurant_id=$1 AND m.id=$3)
    WHEN 'transfer' THEN (SELECT location_id FROM restaurant_inventory_transfers WHERE restaurant_id=$1 AND id=$3)
    WHEN 'receipt' THEN (SELECT location_id FROM restaurant_inventory_receipts WHERE restaurant_id=$1 AND id=$3)
    WHEN 'purchase_request' THEN (SELECT location_id FROM restaurant_inventory_purchase_requests WHERE restaurant_id=$1 AND id=$3)
    WHEN 'supplier_issue' THEN (SELECT location_id FROM restaurant_inventory_supplier_issues WHERE restaurant_id=$1 AND id=$3)
    WHEN 'supplier_catalog' THEN (
      SELECT i.location_id FROM restaurant_inventory_supplier_catalog c
      JOIN restaurant_inventory_items i ON i.id=c.inventory_item_id AND i.restaurant_id=c.restaurant_id
      WHERE c.restaurant_id=$1 AND c.id=$3)
    ELSE NULL
  END;
$$;

UPDATE restaurant_inventory_audit_events
   SET location_id = restaurant_inventory_audit_location(restaurant_id, entity_type, entity_id)
 WHERE location_id IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='restaurant_inventory_audit_events_location_fk'
      AND conrelid='restaurant_inventory_audit_events'::regclass) THEN
    ALTER TABLE restaurant_inventory_audit_events
      ADD CONSTRAINT restaurant_inventory_audit_events_location_fk
      FOREIGN KEY (restaurant_id,location_id) REFERENCES restaurant_locations(restaurant_id,id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_audit_location_created
  ON restaurant_inventory_audit_events(restaurant_id,location_id,created_at DESC);
