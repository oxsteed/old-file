-- Migration 173: add stripe_transfer_id, notes, and updated_at to cancellation_fees
-- These columns are written by cancellationFeeService after the Stripe charge + transfer.

ALTER TABLE cancellation_fees
  ADD COLUMN IF NOT EXISTS stripe_transfer_id VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS notes              TEXT         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ  DEFAULT NOW();

-- Back-fill updated_at for existing rows
UPDATE cancellation_fees SET updated_at = created_at WHERE updated_at IS NULL;
