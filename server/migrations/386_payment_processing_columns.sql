-- Add payment processor state used by protected-payment and refund workflows.
-- These columns are nullable so existing payment rows remain valid.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_hold_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_refund_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_account_id
  ON payments(stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_stripe_refund_id
  ON payments(stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;
