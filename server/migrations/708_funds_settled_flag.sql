-- 708: Add funds_settled flag to restaurant_payouts
-- Separate "did money actually leave our account" from the workflow status.
-- Only the Stripe webhook confirmation sets this to true. The retry worker
-- checks this flag (not status) before creating a new transfer, preventing
-- double-pays even if the Stripe idempotency key has expired.

ALTER TABLE restaurant_payouts
  ADD COLUMN IF NOT EXISTS funds_settled BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: payouts already marked completed had their transfers confirmed.
UPDATE restaurant_payouts
SET funds_settled = TRUE
WHERE status = 'completed' AND funds_settled = FALSE;

CREATE INDEX IF NOT EXISTS idx_restaurant_payouts_funds_settled
  ON restaurant_payouts(funds_settled) WHERE funds_settled = FALSE;
