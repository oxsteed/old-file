-- Migration 972: recipe unit conversion, yield and food-cost foundations.

ALTER TABLE restaurant_inventory_item_mappings
  ADD COLUMN IF NOT EXISTS required_unit VARCHAR(24),
  ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(12,6) NOT NULL DEFAULT 1
    CHECK (conversion_factor > 0),
  ADD COLUMN IF NOT EXISTS yield_percent NUMERIC(5,2) NOT NULL DEFAULT 100
    CHECK (yield_percent > 0 AND yield_percent <= 100);

UPDATE restaurant_inventory_item_mappings rim
   SET required_unit = i.unit
  FROM restaurant_inventory_items i
 WHERE rim.inventory_item_id = i.id
   AND rim.required_unit IS NULL;

