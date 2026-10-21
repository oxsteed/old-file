-- Migration 973: supplier catalog entries for store inventory items.

CREATE TABLE IF NOT EXISTS restaurant_inventory_supplier_catalog (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES restaurant_inventory_suppliers(id) ON DELETE CASCADE,
  inventory_item_id BIGINT NOT NULL REFERENCES restaurant_inventory_items(id) ON DELETE CASCADE,
  supplier_sku VARCHAR(80),
  pack_quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (pack_quantity > 0),
  pack_unit VARCHAR(24) NOT NULL,
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  lead_time_days INTEGER CHECK (lead_time_days IS NULL OR (lead_time_days >= 0 AND lead_time_days <= 365)),
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, supplier_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_supplier_catalog_store
  ON restaurant_inventory_supplier_catalog(restaurant_id, inventory_item_id, is_active);

