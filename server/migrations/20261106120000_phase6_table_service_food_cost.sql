-- Migration 20261106120000: Phase 6 table service + food-cost depth.
--
-- Table service (gap 13): real table identity on orders. food_orders gains
-- table_id (FK to restaurant_tables, SET NULL on delete) and covers. The
-- backfill links a legacy free-text table_label to a table only when the
-- label matches exactly one table name for the same restaurant + location
-- (the per-location lower(name) unique index makes the join unambiguous);
-- unmatched labels stay unlinked rather than guessed.
--
-- Food-cost depth (gaps 10, 12, 14):
--   - restaurant_inventory_modifier_mappings: modifier option -> inventory
--     item, so an extra-chicken modifier depletes chicken at order time.
--   - restaurant_inventory_lots + restaurant_inventory_lot_consumptions:
--     lot/batch + expiry tracking with FEFO-aware consumption.
--   - restaurant_inventory_purchase_requests gains approved_by /
--     approved_at (PO approval gate: requester != approver), source
--     (manual vs auto_reorder draft) and inventory_item_id (auto-reorder
--     dedupe), plus receipt-line lot_number / expires_at so a receipt
--     records the lot it brings in.
-- Tip-out weight_basis (gap 12) lives in the tip_out_rules JSONB and needs
-- no schema change. Plate cost (gap 10) is computed on read from the
-- existing mappings, so it needs no schema change either.

ALTER TABLE food_orders
  ADD COLUMN IF NOT EXISTS table_id BIGINT REFERENCES restaurant_tables(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS covers INTEGER CHECK (covers IS NULL OR (covers > 0 AND covers <= 1000));

CREATE INDEX IF NOT EXISTS idx_food_orders_table_open
  ON food_orders(restaurant_id, table_id, status, created_at)
  WHERE table_id IS NOT NULL;

-- Backfill: link only exact (case/whitespace-insensitive) label matches.
-- restaurant_tables has a unique index on (restaurant_id, location_id,
-- lower(name)), so at most one row can match per order.
UPDATE food_orders fo
   SET table_id = t.id
  FROM restaurant_tables t
 WHERE fo.table_id IS NULL
   AND fo.table_label IS NOT NULL
   AND btrim(fo.table_label) <> ''
   AND t.restaurant_id = fo.restaurant_id
   AND t.location_id = fo.location_id
   AND lower(t.name) = lower(btrim(fo.table_label));

CREATE TABLE IF NOT EXISTS restaurant_inventory_modifier_mappings (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  modifier_id BIGINT NOT NULL REFERENCES food_modifiers(id) ON DELETE CASCADE,
  inventory_item_id BIGINT NOT NULL REFERENCES restaurant_inventory_items(id) ON DELETE CASCADE,
  usage_label VARCHAR(120) NOT NULL,
  required_quantity NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (required_quantity > 0),
  required_unit VARCHAR(24),
  conversion_factor NUMERIC(12,6) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  yield_percent NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (yield_percent > 0 AND yield_percent <= 100),
  auto_manage BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, modifier_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_modifier_mappings_restaurant
  ON restaurant_inventory_modifier_mappings(restaurant_id, modifier_id, inventory_item_id);

CREATE TABLE IF NOT EXISTS restaurant_inventory_lots (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  inventory_item_id BIGINT NOT NULL REFERENCES restaurant_inventory_items(id) ON DELETE CASCADE,
  location_id BIGINT,
  lot_number VARCHAR(120),
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  received_quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  expires_at TIMESTAMPTZ,
  receipt_id BIGINT REFERENCES restaurant_inventory_receipts(id) ON DELETE SET NULL,
  received_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_lots_item_fefo
  ON restaurant_inventory_lots(restaurant_id, inventory_item_id, expires_at NULLS LAST, created_at, id)
  WHERE quantity > 0;
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_lots_expiry
  ON restaurant_inventory_lots(restaurant_id, expires_at)
  WHERE quantity > 0 AND expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS restaurant_inventory_lot_consumptions (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  lot_id BIGINT NOT NULL REFERENCES restaurant_inventory_lots(id) ON DELETE CASCADE,
  inventory_item_id BIGINT NOT NULL REFERENCES restaurant_inventory_items(id) ON DELETE CASCADE,
  food_order_id BIGINT NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_lot_consumptions_lot
  ON restaurant_inventory_lot_consumptions(lot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_lot_consumptions_order
  ON restaurant_inventory_lot_consumptions(food_order_id, inventory_item_id);

ALTER TABLE restaurant_inventory_purchase_requests
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source VARCHAR(24) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'auto_reorder')),
  ADD COLUMN IF NOT EXISTS inventory_item_id BIGINT REFERENCES restaurant_inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_reorder_key VARCHAR(180);

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_purchase_requests_auto_reorder_key
  ON restaurant_inventory_purchase_requests(restaurant_id, auto_reorder_key)
  WHERE auto_reorder_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_restaurant_purchase_requests_item_open
  ON restaurant_inventory_purchase_requests(restaurant_id, inventory_item_id, status)
  WHERE inventory_item_id IS NOT NULL;

ALTER TABLE restaurant_inventory_receipt_lines
  ADD COLUMN IF NOT EXISTS lot_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
