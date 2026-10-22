-- Migration 99992: F-23 vendor price history + PO cost estimates.
--
-- restaurant_inventory_vendor_price_history is an append-only ledger of
-- the unit price paid per vendor per inventory item (recorded from
-- receipts that carry a line unit cost, or entered manually).
--
-- Receipt lines gain unit_cost_cents so the receiving price is captured
-- at goods receipt. Purchase requests gain an estimated unit cost so the
-- three-way PO / receipt / invoice match can flag price variances.

CREATE TABLE IF NOT EXISTS restaurant_inventory_vendor_price_history (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  supplier_id BIGINT REFERENCES restaurant_inventory_suppliers(id) ON DELETE SET NULL,
  inventory_item_id BIGINT NOT NULL REFERENCES restaurant_inventory_items(id) ON DELETE CASCADE,
  unit VARCHAR(24) NOT NULL DEFAULT 'ea',
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  source_type VARCHAR(24) NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'receipt', 'purchase_order')),
  source_id BIGINT,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_price_history_item
  ON restaurant_inventory_vendor_price_history(restaurant_id, inventory_item_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_price_history_supplier
  ON restaurant_inventory_vendor_price_history(restaurant_id, supplier_id, recorded_at DESC);

ALTER TABLE restaurant_inventory_receipt_lines
  ADD COLUMN IF NOT EXISTS unit_cost_cents INTEGER
    CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);

ALTER TABLE restaurant_inventory_purchase_requests
  ADD COLUMN IF NOT EXISTS estimated_unit_cost_cents INTEGER
    CHECK (estimated_unit_cost_cents IS NULL OR estimated_unit_cost_cents >= 0),
  ADD COLUMN IF NOT EXISTS estimated_currency_code VARCHAR(3);
