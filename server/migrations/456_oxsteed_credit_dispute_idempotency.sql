-- Persist customer dispute request keys so a lost response can be retried
-- without creating a second financial review record.
ALTER TABLE oxsteed_credit_disputes
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_dispute_idempotency
  ON oxsteed_credit_disputes(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
