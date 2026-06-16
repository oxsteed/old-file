-- Migration 311: OxSteed Restaurants — Inventory item to menu item mappings.
-- Supports the dedicated inventory app's ingredient-to-menu usage view.

CREATE TABLE IF NOT EXISTS restaurant_inventory_item_mappings (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  inventory_item_id BIGINT NOT NULL REFERENCES restaurant_inventory_items(id) ON DELETE CASCADE,
  menu_item_id BIGINT NOT NULL REFERENCES food_menu_items(id) ON DELETE CASCADE,
  usage_label VARCHAR(120) NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, inventory_item_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_item_mappings_restaurant
  ON restaurant_inventory_item_mappings(restaurant_id, inventory_item_id, menu_item_id);
