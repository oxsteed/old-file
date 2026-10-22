-- Migration 99914: F-19 tax depth.
--
-- Per-store tax rules (multiple named rates with a target: line items,
-- the delivery fee, or the service fee), per-store fee taxability flags,
-- tax-exempt orders, and a snapshot of the applied rules on every order.
-- The external tax-engine integration (Avalara / Stripe Tax) is
-- deliberately out of scope; this is the local rule model only.

CREATE TABLE IF NOT EXISTS restaurant_tax_rules (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  rate_bps INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  applies_to VARCHAR(24) NOT NULL DEFAULT 'items'
    CHECK (applies_to IN ('items', 'delivery_fee', 'service_fee')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_tax_rules_store
  ON restaurant_tax_rules(restaurant_id, location_id, is_active, sort_order, id);

ALTER TABLE restaurant_locations
  ADD COLUMN IF NOT EXISTS service_fee_taxable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delivery_fee_taxable BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE food_orders
  ADD COLUMN IF NOT EXISTS tax_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tax_exempt_reason VARCHAR(160),
  ADD COLUMN IF NOT EXISTS tax_rule_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
