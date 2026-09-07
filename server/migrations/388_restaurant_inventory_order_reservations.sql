-- Migration 388: Reserve mapped restaurant inventory for open food orders.
-- Reservations prevent concurrent orders from overselling the same stock.

CREATE TABLE IF NOT EXISTS restaurant_inventory_order_reservations (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  food_order_id BIGINT NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
  food_order_item_id BIGINT NOT NULL REFERENCES food_order_items(id) ON DELETE CASCADE,
  inventory_item_id BIGINT NOT NULL REFERENCES restaurant_inventory_items(id) ON DELETE CASCADE,
  menu_item_id BIGINT REFERENCES food_menu_items(id) ON DELETE SET NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','consumed','released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  UNIQUE (food_order_item_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_order_reservations_stock
  ON restaurant_inventory_order_reservations(restaurant_id, inventory_item_id, status);

CREATE INDEX IF NOT EXISTS idx_inventory_order_reservations_order
  ON restaurant_inventory_order_reservations(restaurant_id, food_order_id, status);
