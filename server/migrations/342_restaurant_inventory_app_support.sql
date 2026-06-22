-- Migration 342: Complete the restaurant Inventory app data contract.
-- Additive and tenant-scoped. Existing inventory rows remain valid.

CREATE TABLE IF NOT EXISTS restaurant_inventory_storage_areas (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  area_type VARCHAR(32) NOT NULL DEFAULT 'dry_storage'
    CHECK (area_type IN ('dry_storage','walk_in_cooler','freezer','bar','packaging','receiving','prep','other')),
  temperature_range VARCHAR(80),
  responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_areas_restaurant
  ON restaurant_inventory_storage_areas(restaurant_id, is_active, name);

CREATE TABLE IF NOT EXISTS restaurant_inventory_suppliers (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(160),
  contact_name VARCHAR(160),
  phone VARCHAR(40),
  email VARCHAR(320),
  lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','issue_reported')),
  rating NUMERIC(2,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  last_delivery_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_suppliers_restaurant
  ON restaurant_inventory_suppliers(restaurant_id, is_active, name);

ALTER TABLE restaurant_inventory_items
  ADD COLUMN IF NOT EXISTS storage_area_id BIGINT REFERENCES restaurant_inventory_storage_areas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_id BIGINT REFERENCES restaurant_inventory_suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS par_level NUMERIC(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reorder_point NUMERIC(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS critical_level NUMERIC(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_counted_at TIMESTAMPTZ;

UPDATE restaurant_inventory_items
   SET reorder_point = low_stock_threshold
 WHERE reorder_point = 0 AND low_stock_threshold > 0;

ALTER TABLE restaurant_inventory_adjustments
  ADD COLUMN IF NOT EXISTS reason VARCHAR(120),
  ADD COLUMN IF NOT EXISTS client_operation_id UUID,
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS source_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_inventory_adjustment_operation
  ON restaurant_inventory_adjustments(restaurant_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

ALTER TABLE restaurant_inventory_purchase_requests
  DROP CONSTRAINT IF EXISTS restaurant_inventory_purchase_requests_status_check;
ALTER TABLE restaurant_inventory_purchase_requests
  ADD CONSTRAINT restaurant_inventory_purchase_requests_status_check
    CHECK (status IN ('pending','approved','ordered','received','delivered','rejected','cancelled')),
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS urgency VARCHAR(16) NOT NULL DEFAULT 'medium'
    CHECK (urgency IN ('low','medium','high','urgent')),
  ADD COLUMN IF NOT EXISTS client_operation_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_inventory_request_operation
  ON restaurant_inventory_purchase_requests(restaurant_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

ALTER TABLE restaurant_inventory_supplier_issues
  DROP CONSTRAINT IF EXISTS restaurant_inventory_supplier_issues_status_check;
ALTER TABLE restaurant_inventory_supplier_issues
  ADD CONSTRAINT restaurant_inventory_supplier_issues_status_check
    CHECK (status IN ('open','monitoring','in_progress','resolved')),
  ADD COLUMN IF NOT EXISTS issue_type VARCHAR(32) NOT NULL DEFAULT 'other'
    CHECK (issue_type IN ('short_delivery','wrong_item','poor_quality','late_delivery','damaged','billing','other')),
  ADD COLUMN IF NOT EXISTS delivery_reference VARCHAR(120),
  ADD COLUMN IF NOT EXISTS affected_item_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS client_operation_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_inventory_issue_operation
  ON restaurant_inventory_supplier_issues(restaurant_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS restaurant_inventory_transfers (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  item_id BIGINT REFERENCES restaurant_inventory_items(id) ON DELETE SET NULL,
  item_name VARCHAR(160) NOT NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit VARCHAR(24) NOT NULL DEFAULT 'ea',
  from_area_id BIGINT REFERENCES restaurant_inventory_storage_areas(id) ON DELETE SET NULL,
  to_area_id BIGINT REFERENCES restaurant_inventory_storage_areas(id) ON DELETE SET NULL,
  from_area_name VARCHAR(160) NOT NULL,
  to_area_name VARCHAR(160) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending','completed','cancelled')),
  note TEXT,
  transferred_by UUID REFERENCES users(id) ON DELETE SET NULL,
  client_operation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_area_name <> to_area_name)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_transfers_restaurant
  ON restaurant_inventory_transfers(restaurant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_inventory_transfer_operation
  ON restaurant_inventory_transfers(restaurant_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS restaurant_inventory_receipts (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  supplier_id BIGINT REFERENCES restaurant_inventory_suppliers(id) ON DELETE SET NULL,
  supplier_name VARCHAR(160) NOT NULL,
  invoice_number VARCHAR(120),
  status VARCHAR(24) NOT NULL DEFAULT 'received'
    CHECK (status IN ('draft','received','partial','cancelled')),
  general_note TEXT,
  received_by UUID REFERENCES users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ,
  client_operation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_receipts_restaurant
  ON restaurant_inventory_receipts(restaurant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_inventory_receipt_operation
  ON restaurant_inventory_receipts(restaurant_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS restaurant_inventory_receipt_lines (
  id BIGSERIAL PRIMARY KEY,
  receipt_id BIGINT NOT NULL REFERENCES restaurant_inventory_receipts(id) ON DELETE CASCADE,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  item_id BIGINT REFERENCES restaurant_inventory_items(id) ON DELETE SET NULL,
  item_name VARCHAR(160) NOT NULL,
  expected_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  received_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  accepted_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit VARCHAR(24) NOT NULL DEFAULT 'ea',
  issue_type VARCHAR(32),
  issue_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_receipt_lines_receipt
  ON restaurant_inventory_receipt_lines(receipt_id, id);
