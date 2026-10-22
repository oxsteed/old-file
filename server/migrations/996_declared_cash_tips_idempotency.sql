-- Background-jobs audit (finding P1): cash-tip declarations had no
-- idempotency key, so a client retry (timeout, double-click, POS offline
-- replay) inserted a second row and inflated the payroll basis. The
-- service now accepts a client-generated idempotency key and dedupes on
-- (restaurant_id, idempotency_key); the partial index keeps legacy
-- key-less rows insertable.
ALTER TABLE restaurant_declared_cash_tips
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_declared_cash_tips_idempotency
  ON restaurant_declared_cash_tips (restaurant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
