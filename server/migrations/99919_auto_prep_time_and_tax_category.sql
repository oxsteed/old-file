-- Migration 99919: F-33 automatic prep-time extension + F-19 named tax categories.
--
-- F-33: per-store settings for automatic prep-time extension when the
-- kitchen is under load. All three default to 0 (disabled), preserving
-- current behavior until a manager opts a store in:
--   prep_time_auto_extend_max_min          — cap on the automatic extension
--   prep_time_auto_extend_threshold_orders — open tickets above this count trigger
--   prep_time_auto_extend_per_order_min    — extra minutes per open ticket above threshold
-- The manual prep_time_extension_min stays untouched and stacks on top.
--
-- F-19: a menu item may carry a tax_category (e.g. 'standard', 'alcohol',
-- 'grocery'). A tax rule with a matching tax_category applies only to
-- lines in that category; a rule with NULL tax_category keeps the
-- legacy behavior and applies to every line. Fee rules never carry a
-- category (fees are not categorized).

ALTER TABLE restaurant_locations
  ADD COLUMN IF NOT EXISTS prep_time_auto_extend_max_min INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prep_time_auto_extend_threshold_orders INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prep_time_auto_extend_per_order_min INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_locations_auto_extend_valid') THEN
    ALTER TABLE restaurant_locations ADD CONSTRAINT restaurant_locations_auto_extend_valid
      CHECK (prep_time_auto_extend_max_min BETWEEN 0 AND 240
         AND prep_time_auto_extend_threshold_orders BETWEEN 0 AND 1000
         AND prep_time_auto_extend_per_order_min BETWEEN 0 AND 60);
  END IF;
END $$;

ALTER TABLE food_menu_items
  ADD COLUMN IF NOT EXISTS tax_category VARCHAR(40);

ALTER TABLE restaurant_tax_rules
  ADD COLUMN IF NOT EXISTS tax_category VARCHAR(40);
