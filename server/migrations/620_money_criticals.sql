-- Migration 620: Money-critical audit remediation (WS2)
--
-- C8: Track Stripe charge-dispute outcomes on the payments row so a lost
-- dispute can be posted to the ledger and block related payouts.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS stripe_dispute_id TEXT,
  ADD COLUMN IF NOT EXISTS dispute_status TEXT; -- open | won | lost
CREATE INDEX IF NOT EXISTS idx_payments_stripe_dispute_id
  ON payments (stripe_dispute_id) WHERE stripe_dispute_id IS NOT NULL;

-- C9: Idempotency key for admin-triggered payout processing. The column is
-- nullable so historical rows stay valid; uniqueness is enforced only for
-- rows that carry a key.
ALTER TABLE payout_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_transactions_idempotency_key
  ON payout_transactions (idempotency_key) WHERE idempotency_key IS NOT NULL;
