-- Migration 332: Separate manual and inventory menu availability, plus
-- configurable ingredient requirements per menu item.

ALTER TABLE restaurant_inventory_item_mappings
  ADD COLUMN IF NOT EXISTS required_quantity NUMERIC(12,3) NOT NULL DEFAULT 0.001
    CHECK (required_quantity >= 0),
  ADD COLUMN IF NOT EXISTS auto_manage BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE food_menu_items
  ADD COLUMN IF NOT EXISTS manual_available BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS inventory_available BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS inventory_availability_state VARCHAR(24) NOT NULL DEFAULT 'available'
    CHECK (inventory_availability_state IN ('available','limited','unavailable'));

UPDATE food_menu_items fmi
   SET manual_available = CASE
         WHEN fmi.is_available = FALSE AND COALESCE((
           SELECT e.next_available
             FROM restaurant_inventory_availability_events e
            WHERE e.menu_item_id = fmi.id
            ORDER BY e.created_at DESC, e.id DESC
            LIMIT 1
         ), TRUE) = FALSE THEN TRUE
         ELSE fmi.is_available
       END,
       inventory_available = COALESCE((
         SELECT e.next_available
           FROM restaurant_inventory_availability_events e
          WHERE e.menu_item_id = fmi.id
          ORDER BY e.created_at DESC, e.id DESC
          LIMIT 1
       ), TRUE),
       inventory_availability_state = CASE
         WHEN COALESCE((
           SELECT e.next_available
             FROM restaurant_inventory_availability_events e
            WHERE e.menu_item_id = fmi.id
            ORDER BY e.created_at DESC, e.id DESC
            LIMIT 1
         ), TRUE) = FALSE THEN 'unavailable'
         ELSE 'available'
       END;
