-- Migration 309: OxSteed Restaurants — Inventory procurement + supplier issues.
-- Extends the Phase 3 inventory backend so dedicated inventory apps can track
-- purchase requests and supplier delivery issues with restaurant scoping.

CREATE TABLE IF NOT EXISTS restaurant_inventory_purchase_requests (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  item_name VARCHAR(160) NOT NULL,
  requested_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit VARCHAR(24) NOT NULL DEFAULT 'ea',
  supplier_name VARCHAR(160),
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ordered', 'received', 'cancelled')),
  eta_window VARCHAR(80),
  note TEXT,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_purchase_requests_restaurant
  ON restaurant_inventory_purchase_requests(restaurant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_inventory_supplier_issues (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  supplier_name VARCHAR(160) NOT NULL,
  issue TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'monitoring', 'resolved')),
  related_purchase_request_id BIGINT REFERENCES restaurant_inventory_purchase_requests(id) ON DELETE SET NULL,
  reported_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_supplier_issues_restaurant
  ON restaurant_inventory_supplier_issues(restaurant_id, created_at DESC);
