-- Migration 389: Expire abandoned online-order inventory holds.

ALTER TABLE restaurant_inventory_order_reservations
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_inventory_order_reservations_expiry
  ON restaurant_inventory_order_reservations(expires_at)
  WHERE status = 'reserved' AND expires_at IS NOT NULL;
