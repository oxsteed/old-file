-- Migration 333: Persist the published pricing rules applied to each order.

ALTER TABLE food_orders
  ADD COLUMN IF NOT EXISTS service_fee_cents INTEGER NOT NULL DEFAULT 0
    CHECK (service_fee_cents >= 0),
  ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER NOT NULL DEFAULT 0
    CHECK (delivery_fee_cents >= 0),
  ADD COLUMN IF NOT EXISTS tax_rate_bps INTEGER NOT NULL DEFAULT 0
    CHECK (tax_rate_bps >= 0 AND tax_rate_bps <= 10000),
  ADD COLUMN IF NOT EXISTS service_fee_bps INTEGER NOT NULL DEFAULT 0
    CHECK (service_fee_bps >= 0 AND service_fee_bps <= 10000);
