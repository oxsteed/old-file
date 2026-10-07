-- Add payment_reference to runner settlements for audit trail.
-- Required when marking a settlement as paid with non-zero amounts.

ALTER TABLE restaurant_runner_settlements
  ADD COLUMN IF NOT EXISTS payment_reference TEXT;

-- Prevent modification of financial columns once paid (application enforces,
-- this is a backstop).
-- Note: Full immutability is enforced in application code via settlement_frozen check.
