-- Hold replay checks search by idempotency key before account resolution.
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_holds_idempotency
  ON oxsteed_credit_holds(idempotency_key);
