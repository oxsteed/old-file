-- Inventory on-hand and warning thresholds are physical quantities and cannot
-- be negative. Normalize legacy rows before enforcing the invariant.
UPDATE restaurant_inventory_items
   SET quantity = GREATEST(quantity, 0),
       low_stock_threshold = GREATEST(low_stock_threshold, 0)
 WHERE quantity < 0 OR low_stock_threshold < 0;

ALTER TABLE restaurant_inventory_items
  DROP CONSTRAINT IF EXISTS restaurant_inventory_items_quantity_nonnegative,
  DROP CONSTRAINT IF EXISTS restaurant_inventory_items_threshold_nonnegative;

ALTER TABLE restaurant_inventory_items
  ADD CONSTRAINT restaurant_inventory_items_quantity_nonnegative CHECK (quantity >= 0),
  ADD CONSTRAINT restaurant_inventory_items_threshold_nonnegative CHECK (low_stock_threshold >= 0);

ALTER TABLE restaurant_inventory_adjustments
  DROP CONSTRAINT IF EXISTS restaurant_inventory_adjustments_after_nonnegative;

ALTER TABLE restaurant_inventory_adjustments
  ADD CONSTRAINT restaurant_inventory_adjustments_after_nonnegative CHECK (quantity_after >= 0);
