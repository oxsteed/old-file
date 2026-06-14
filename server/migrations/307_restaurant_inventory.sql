-- Migration 307: OxSteed Restaurants — Inventory (Phase 3, App 7 backend).
-- Additive only. Adds inventory items + an adjustment ledger on top of the
-- food_* ordering foundation and the 306 operations tables. Nothing prior is
-- modified. New tables use the restaurant_* prefix.
--
-- FK note: food_restaurants.id is BIGINT (BIGSERIAL); users.id is UUID.

-- Stock-tracked items (ingredients/supplies). Quantities are stored as NUMERIC
-- so fractional units (e.g. 2.5 kg) work; unit is a free label (kg, ea, case).
CREATE TABLE IF NOT EXISTS restaurant_inventory_items (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'general'
    CHECK (category IN ('general', 'produce', 'meat', 'dairy', 'dry_goods', 'frozen', 'beverage', 'packaging', 'cleaning')),
  unit VARCHAR(24) NOT NULL DEFAULT 'ea',
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  low_stock_threshold NUMERIC(12,3) NOT NULL DEFAULT 0,
  sku VARCHAR(60),
  supplier_name VARCHAR(160),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_items_restaurant
  ON restaurant_inventory_items(restaurant_id, is_active, category);

-- Append-only ledger of every stock change. `quantity_delta` is the signed
-- change applied; `quantity_after` snapshots the resulting on-hand level so
-- history is accurate even if the item is later edited or deleted (SET NULL).
CREATE TABLE IF NOT EXISTS restaurant_inventory_adjustments (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  item_id BIGINT REFERENCES restaurant_inventory_items(id) ON DELETE SET NULL,
  item_name VARCHAR(160) NOT NULL,
  adjustment_type VARCHAR(20) NOT NULL
    CHECK (adjustment_type IN ('count', 'receive', 'waste', 'usage', 'correction')),
  quantity_delta NUMERIC(12,3) NOT NULL DEFAULT 0,
  quantity_after NUMERIC(12,3) NOT NULL DEFAULT 0,
  note TEXT,
  adjusted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_adjustments_restaurant
  ON restaurant_inventory_adjustments(restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_adjustments_item
  ON restaurant_inventory_adjustments(item_id, created_at DESC);
